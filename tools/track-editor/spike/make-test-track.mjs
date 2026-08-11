#!/usr/bin/env node
/**
 * M0 spike: emit a minimal but complete custom track as a .o2r archive.
 *
 * The point of this script is to prove the SpaghettiKart custom-track format
 * end to end BEFORE any editor UI exists. Specifically it proves:
 *
 *   1. A mod's display list can reference a BASE GAME texture by resource path
 *      (here `textures/other_textures/checkerboard_black_white` from mk64.o2r),
 *      so the browser editor's texture picker never needs to copy texture data.
 *   2. The runtime collision generator accepts our triangle winding and our
 *      32-vertex batching, and spawns players on the surface.
 *   3. A ramp is nothing more than geometry plus a `surface` tag on its section.
 *
 * Everything here is hand-rolled with zero dependencies so it can be diffed
 * against the real exporter later.
 *
 * Usage:
 *   node make-test-track.mjs [--out <path/to/mods>]
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

/* ------------------------------------------------------------------ config */

const TRACK = 'spike';                    // folder name under tracks/
const MOD = 'spike-track';                // mods.toml name
const RES = `spike:${TRACK}`;             // ResourceName, "author:track"
const DIR = `tracks/${TRACK}`;            // resource path prefix

// A base-game texture, referenced not copied. 32x32 RGBA16.
const TEX = {
    path: 'textures/other_textures/checkerboard_black_white',
    width: 32,
    height: 32,
};

// Ground plane extents, in game units. Must comfortably contain the spawn
// area: players spawn near the origin and stretch back to z = -420.
const X0 = -1000, X1 = 2800;
const Z0 = -2000, Z1 = 1200;
const CELL = 200;                         // subdivision; a single huge quad
                                          // makes the collision generator
                                          // "wig out" (docs/tracks/quick.md)

// The circuit, as a closed polyline. First point MUST be the origin and the
// track must leave the line heading -Z (docs/tracks/quick.md).
const CIRCUIT = [
    [0, 0], [0, -1500], [1800, -1500], [1800, 600], [0, 600],
];
const PATH_SPACING = 40;

// A ramp laid across the far straight, to prove jumps. Spans z, sits at x.
const RAMP = {
    xMin: 1650, xMax: 1950,               // across the +x straight
    zMin: -700, zMax: -400,
    peak: 120,                            // lift at the lip, game units
};

const SURFACE = { ASPHALT: 1, RAMP: 0xff, BOOST_RAMP_ASPHALT: 0xfe };

// NB: these values come from `enum class SurfaceClip` in
// src/engine/tracks/CustomTrack.h, NOT from docs/tracks/objectproperties.md.
// The docs list four clip modes and omit CLIP_DEFAULT, so every value from
// SINGLE_SIDED_WALL onwards is one higher than the docs imply. CLIP_DEFAULT is
// what an ordinary drivable surface wants: it matches no case in
// ParseMeshForCollision's switch, so it generates plain surface collision.
// Tagging the road CLIP_SURFACE(3) or SINGLE_SIDED_WALL(2) makes players fall
// through it and spawn at 3000.0f.
const CLIP = {
    NONE: 0,
    DEFAULT: 1,
    SINGLE_SIDED_WALL: 2,
    SURFACE: 3,
    DOUBLE_SIDED_WALL: 4,
};
const LAYER = { INVISIBLE: 0, OPAQUE: 1, TRANSLUCENT: 2, TRANSLUCENT_NO_Z: 3 };

const VTX_BATCH = 32;                     // F3DEX vertex cache size. Hard limit.

/* --------------------------------------------------------------- zip writer */

const crcTable = (() => {
    const t = new Int32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[i] = c;
    }
    return t;
})();

function crc32(buf) {
    let c = -1;
    for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
}

/** Build a ZIP with stored (uncompressed) entries — what the docs recommend. */
function zipStore(entries) {
    const locals = [];
    const central = [];
    let offset = 0;

    for (const { name, data } of entries) {
        const nameBuf = Buffer.from(name, 'utf8');
        const crc = crc32(data);

        const local = Buffer.alloc(30 + nameBuf.length);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);        // version needed
        local.writeUInt16LE(0, 6);         // flags
        local.writeUInt16LE(0, 8);         // method: store
        local.writeUInt16LE(0, 10);        // time
        local.writeUInt16LE(0x21, 12);     // date (1996-01-01, deterministic)
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(data.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(nameBuf.length, 26);
        local.writeUInt16LE(0, 28);
        nameBuf.copy(local, 30);
        locals.push(local, data);

        const cen = Buffer.alloc(46 + nameBuf.length);
        cen.writeUInt32LE(0x02014b50, 0);
        cen.writeUInt16LE(20, 4);          // version made by
        cen.writeUInt16LE(20, 6);          // version needed
        cen.writeUInt16LE(0, 8);
        cen.writeUInt16LE(0, 10);
        cen.writeUInt16LE(0, 12);
        cen.writeUInt16LE(0x21, 14);
        cen.writeUInt32LE(crc, 16);
        cen.writeUInt32LE(data.length, 20);
        cen.writeUInt32LE(data.length, 24);
        cen.writeUInt16LE(nameBuf.length, 28);
        cen.writeUInt16LE(0, 30);          // extra
        cen.writeUInt16LE(0, 32);          // comment
        cen.writeUInt16LE(0, 34);          // disk
        cen.writeUInt16LE(0, 36);          // internal attrs
        cen.writeUInt32LE(0, 38);          // external attrs
        cen.writeUInt32LE(offset, 42);
        nameBuf.copy(cen, 46);
        central.push(cen);

        offset += local.length + data.length;
    }

    const centralBuf = Buffer.concat(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(centralBuf.length, 12);
    end.writeUInt32LE(offset, 16);
    end.writeUInt16LE(0, 20);

    return Buffer.concat([...locals, centralBuf, end]);
}

/* ------------------------------------------------------------------ helpers */

const log2 = (n) => Math.round(Math.log2(n));

/**
 * Material display list. Modelled byte-for-byte on the shipping
 * tracks/harbour/mat_mk64_path, with only the texture swapped, so the spike
 * inherits a combiner/tile setup that is known to work in game.
 *
 * The derived tile fields are the formulas the real exporter will use:
 *   MaskS/MaskT = log2(w/h)   Line = (w * bpp/8)/8
 *   LoadBlock Lrs = w*h - 1   SetTileSize Lrs/Lrt = (dim-1) << 2
 */
function material(name, tex) {
    const bpp = 16;                                   // RGBA16
    const line = (tex.width * bpp / 8) / 8;
    const lrs = tex.width * tex.height - 1;
    return `<DisplayList Version="0">
\t<SetGeometryMode G_FOG="1" />
\t<ClearGeometryMode G_CLIPPING="1" />
\t<!-- Cull nothing: the spike must be visible regardless of winding. -->
\t<ClearGeometryMode G_CULL_BOTH="1" />
\t<PipeSync/>
\t<SetCombineLERP A0="G_CCMUX_TEXEL0" B0="G_CCMUX_0" C0="G_CCMUX_SHADE" D0="G_CCMUX_0" Aa0="G_ACMUX_0" Ab0="G_ACMUX_0" Ac0="G_ACMUX_0" Ad0="G_ACMUX_1" A1="G_CCMUX_COMBINED" B1="G_CCMUX_0" C1="G_CCMUX_PRIMITIVE" D1="G_CCMUX_0" Aa1="G_ACMUX_0" Ab1="G_ACMUX_0" Ac1="G_ACMUX_0" Ad1="G_ACMUX_COMBINED"/>
\t<SetRenderMode Mode1="G_RM_PASS" Mode2="G_RM_AA_ZB_OPA_SURF2" />
\t<Texture S="65535" T="65535" Level="0" Tile="0" On="1"/>
\t<SetPrimColor M="0" L="0" R="255" G="255" B="255" A="255"/>
\t<SetTextureImage Path="${tex.path}" Format="G_IM_FMT_RGBA" Size="G_IM_SIZ_16b_LOAD_BLOCK" Width="1"/>
\t<SetTile Format="G_IM_FMT_RGBA" Size="G_IM_SIZ_16b_LOAD_BLOCK" Line="0" TMem="0" Tile="7" Palette="0" Cms0="G_TX_WRAP" Cms1="G_TX_NOMIRROR" Cmt0="G_TX_WRAP" Cmt1="G_TX_NOMIRROR" MaskS="0" ShiftS="0" MaskT="0" ShiftT="0"/>
\t<LoadBlock Tile="7" Uls="0" Ult="0" Lrs="${lrs}" Dxt="256"/>
\t<SetTile Format="G_IM_FMT_RGBA" Size="G_IM_SIZ_16b" Line="${line}" TMem="0" Tile="0" Palette="0" Cms0="G_TX_WRAP" Cms1="G_TX_NOMIRROR" Cmt0="G_TX_WRAP" Cmt1="G_TX_NOMIRROR" MaskS="${log2(tex.width)}" ShiftS="0" MaskT="${log2(tex.height)}" ShiftT="0"/>
\t<SetTileSize T="0" Uls="0" Ult="0" Lrs="${(tex.width - 1) << 2}" Lrt="${(tex.height - 1) << 2}"/>
\t<EndDisplayList/>
</DisplayList>`;
}

const materialRevert = () => `<DisplayList Version="0">
\t<ClearGeometryMode G_FOG="1" />
\t<SetGeometryMode G_CLIPPING="1" />
\t<PipeSync/>
\t<EndDisplayList/>
</DisplayList>`;

/**
 * Emit a mesh as three resources: a vertex array, a triangle display list
 * chunked into 32-vertex batches, and a root display list that binds the
 * material around the triangles.
 *
 * `tris` is a flat list of {v: [p0, p1, p2]} where each p is
 * {x, y, z, s, t}. Vertices are NOT shared between triangles; the exporter can
 * optimise that later, correctness first.
 */
function mesh(name, tris) {
    const verts = [];
    const batches = [];

    // Each batch holds at most VTX_BATCH vertices, i.e. 10 whole triangles
    // (30 verts). Indices inside a batch are re-based to 0..31.
    const trisPerBatch = Math.floor(VTX_BATCH / 3);
    for (let i = 0; i < tris.length; i += trisPerBatch) {
        const chunk = tris.slice(i, i + trisPerBatch);
        const base = verts.length;
        for (const t of chunk) verts.push(...t.v);
        batches.push({ offset: base, count: chunk.length * 3, tris: chunk.length });
    }

    const vtxXml = [
        '<Vertex Version="0">',
        ...verts.map((v) =>
            `\t<Vtx X="${v.x}" Y="${v.y}" Z="${v.z}" S="${v.s}" T="${v.t}" R="0" G="127" B="0" A="255"/>`),
        '</Vertex>',
    ].join('\n');

    const triLines = ['<DisplayList Version="0">'];
    for (const b of batches) {
        triLines.push(`\t<LoadVertices Path="${DIR}/${name}_vtx_0" VertexBufferIndex="0" VertexOffset="${b.offset}" Count="${b.count}"/>`);
        // Pair triangles up into Triangles2 where possible; odd one out uses Triangle1.
        let t = 0;
        while (t + 1 < b.tris) {
            const a = t * 3, c = (t + 1) * 3;
            triLines.push(`\t<Triangles2 V00="${a}" V01="${a + 1}" V02="${a + 2}" Flag0="0" V10="${c}" V11="${c + 1}" V12="${c + 2}" Flag1="0"/>`);
            t += 2;
        }
        if (t < b.tris) {
            const a = t * 3;
            // Triangle1 uses the same V0x attribute names as Triangles2.
            triLines.push(`\t<Triangle1 V00="${a}" V01="${a + 1}" V02="${a + 2}" Flag0="0"/>`);
        }
    }
    triLines.push('\t<EndDisplayList/>', '</DisplayList>');

    const rootXml = `<DisplayList Version="0">
\t<ClearGeometryMode G_LIGHTING="1" />
\t<SetGeometryMode G_LIGHTING="1" />
\t<CallDisplayList Path="${DIR}/mat_${name}"/>
\t<CallDisplayList Path="${DIR}/${name}_tri_0"/>
\t<CallDisplayList Path="${DIR}/mat_revert_${name}"/>
\t<EndDisplayList/>
</DisplayList>`;

    return {
        files: [
            [`${DIR}/${name}_vtx_0`, vtxXml],
            [`${DIR}/${name}_tri_0`, triLines.join('\n')],
            [`${DIR}/${name}_mesh`, rootXml],
            [`${DIR}/mat_${name}`, material(name, TEX)],
            [`${DIR}/mat_revert_${name}`, materialRevert()],
        ],
        gfxPath: `${DIR}/${name}_mesh`,
        vertexCount: verts.length,
        triangleCount: tris.length,
    };
}

/* ----------------------------------------------------------------- geometry */

const UV = 32 << 5;   // one full texture repeat per cell, in 1/32-texel units

const inRamp = (x, z) => x >= RAMP.xMin && x <= RAMP.xMax && z >= RAMP.zMin && z <= RAMP.zMax;

/**
 * Ramp height profile: rises smoothly from zMin and is cut off flat at zMax so
 * the kart leaves a lip rather than rolling back down. Karts travel +z along
 * this straight, so the lip is at zMax.
 */
function rampHeight(x, z) {
    if (!inRamp(x, z)) return 0;
    const u = (z - RAMP.zMin) / (RAMP.zMax - RAMP.zMin);   // 0 at foot, 1 at lip
    return Math.round(RAMP.peak * u * u);                   // ease in
}

/** Build the ground plane, splitting cells into the flat road and the ramp. */
function buildGround() {
    const flat = [];
    const ramp = [];

    const corner = (x, z, su, tv) => ({ x, y: rampHeight(x, z), z, s: su, t: tv });

    for (let x = X0; x < X1; x += CELL) {
        for (let z = Z0; z < Z1; z += CELL) {
            const a = corner(x, z, 0, 0);
            const b = corner(x + CELL, z, UV, 0);
            const c = corner(x + CELL, z + CELL, UV, UV);
            const d = corner(x, z + CELL, 0, UV);

            // A cell belongs to the ramp if any corner is lifted, so the
            // approach and lip land in the ramp section and get its surface tag.
            const lifted = a.y || b.y || c.y || d.y;
            (lifted ? ramp : flat).push({ v: [a, b, c] }, { v: [a, c, d] });
        }
    }
    return { flat, ramp };
}

/** Resample the circuit into evenly spaced waypoints, starting at the origin. */
function buildPath() {
    const pts = [];
    const n = CIRCUIT.length;
    for (let i = 0; i < n; i++) {
        const [ax, az] = CIRCUIT[i];
        const [bx, bz] = CIRCUIT[(i + 1) % n];
        const dx = bx - ax, dz = bz - az;
        const len = Math.hypot(dx, dz);
        const steps = Math.max(1, Math.round(len / PATH_SPACING));
        for (let s = 0; s < steps; s++) {          // exclusive of the endpoint,
            const u = s / steps;                    // the next leg supplies it
            const x = Math.round(ax + dx * u);
            const z = Math.round(az + dz * u);
            pts.push({ x, y: rampHeight(x, z), z });
        }
    }
    return pts;
}

/* -------------------------------------------------------------------- build */

const { flat, ramp } = buildGround();
const road = mesh('road', flat);
const jump = mesh('jump', ramp);
const path = buildPath();

const sections = [
    { gfx: road.gfxPath, surface: SURFACE.ASPHALT, clip: CLIP.DEFAULT },
    { gfx: jump.gfxPath, surface: SURFACE.BOOST_RAMP_ASPHALT, clip: CLIP.DEFAULT },
];

const sectionsXml = [
    '<TrackSections XMLSucks="1">',
    ...sections.map((s) =>
        `\t<Section gfx_path="${s.gfx}" surface="${s.surface}" section="0xff" flags="${s.clip}" drawlayer="${LAYER.OPAQUE}" x="0" y="0" z="0" />`),
    '</TrackSections>',
].join('\n');

// load_track_path() walks the point array until it hits a sentinel; it does not
// use the resource length. Without this terminator it reads off the end of the
// allocation and the game aborts under ASan the moment the race starts.
const PATH_TERMINATOR = '\t\t<Point X="-32768" Y="-32768" Z="-32768" ID="0"/>';

const pathsXml = [
    '<Paths XMLSucks="1">',
    '\t<TrackWaypoint>',
    ...path.map((p) => `\t\t<Point X="${p.x}" Y="${p.y}" Z="${p.z}" ID="0"/>`),
    PATH_TERMINATOR,
    '\t</TrackWaypoint>',
    '</Paths>',
].join('\n');

// Props mirror the defaults in CustomTrack::CustomTrack() and the shipping
// harbour scene.json, so the game has every key it expects.
const scene = {
    Props: {
        ResourceName: RES,
        Name: 'Spike Test',
        DebugName: 'spike',
        TrackLength: '100m',
        AIDistance: [20, 5, 10, 15, 20, 25, 30, 35, 30, 25, 45, 65, 90, 115, 140, 165,
                     40, 3, 6, 16, 46, 49, 59, 89, 50, 30, 60, 63, 73, 78, 108, 138],
        AIMaximumSeparation: 50.0,
        AIMinimumSeparation: 0.30000001192092896,
        AISteeringSensitivity: 48,
        CurveTargetSpeed: [4.166666507720947, 5.583333492279053, 6.166666507720947, 6.75],
        NormalTargetSpeed: [3.75, 5.166666507720947, 5.75, 6.333333492279053],
        D_0D0096B8: [3.3333332538604736, 3.9166667461395264, 4.5, 5.083333492279053],
        OffTrackTargetSpeed: [3.75, 5.166666507720947, 5.75, 6.333333492279053],
        NearPersp: 3.0,
        FarPersp: 6800.0,
        LakituTowType: 0,
        Sequence: 6,
        WaterLevel: -10000.0,
        Skybox: [66, 179, 246, 255, 118, 118, 0, 198, 255, 0, 180, 255,
                 0, 96, 255, 0, 96, 255, 0, 96, 255, 0, 96, 255],
        MinimapColour: [255, 255, 255],
        MinimapPosition: [257, 170],
        MinimapPosition2P: [5, 0],
        MinimapPlayerX: 0,
        MinimapPlayerY: 0,
        MinimapPlayerScaleFactor: 0.22,
        MinimapFinishlineX: 0.0,
        MinimapFinishlineY: 0.0,
    },
    StaticMeshActors: null,
};

const modsToml = `[mod]
name = "${MOD}"
version = "1.0.0"
`;

const files = [
    ['mods.toml', modsToml],
    ...road.files,
    ...jump.files,
    [`${DIR}/data_track_sections`, sectionsXml],
    [`${DIR}/data_paths`, pathsXml],
    [`${DIR}/scene.json`, JSON.stringify(scene, null, 2)],
];

/* --------------------------------------------------------------------- emit */

const argOut = process.argv.indexOf('--out');
const outDir = argOut !== -1
    ? process.argv[argOut + 1]
    : join(homedir(), 'Library', 'Application Support', 'SpaghettiKart', 'mods');
const outFile = join(outDir, `${MOD}.o2r`);

// process_path_data() scans at most 0x7D0 entries looking for the terminator,
// so a path at or over that limit is as fatal as a missing terminator.
if (path.length + 1 >= 0x7d0) {
    throw new Error(`path has ${path.length} points; the engine scans at most ${0x7d0}`);
}
if (!pathsXml.includes('X="-32768"')) {
    throw new Error('path is missing its terminating sentinel point');
}

const zip = zipStore(files.map(([name, text]) => ({ name, data: Buffer.from(text, 'utf8') })));
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, zip);

console.log(`wrote ${outFile}  (${zip.length} bytes, ${files.length} entries)`);
console.log(`  road   ${road.triangleCount} tris, ${road.vertexCount} verts`);
console.log(`  ramp   ${jump.triangleCount} tris, ${jump.vertexCount} verts  surface=BOOST_RAMP_ASPHALT`);
console.log(`  path   ${path.length} waypoints, first = (${path[0].x}, ${path[0].y}, ${path[0].z})`);
console.log(`  texture referenced (not copied): ${TEX.path}`);
