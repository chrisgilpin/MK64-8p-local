/* -------------------------------------------------------------- minimap */

const MM = { w: 112, h: 128 };
let pminX = Infinity, pmaxX = -Infinity, pminZ = Infinity, pmaxZ = -Infinity;
for (const p of pathPts) { pminX = Math.min(pminX, p.x); pmaxX = Math.max(pmaxX, p.x); pminZ = Math.min(pminZ, p.z); pmaxZ = Math.max(pmaxZ, p.z); }
MM.scale = Math.floor(Math.min((MM.w - 10) / (pmaxX - pminX + 400), (MM.h - 10) / (pmaxZ - pminZ + 400)) * 1000) / 1000;
MM.playerX = Math.round(MM.w / 2 - ((pminX + pmaxX) / 2) * MM.scale);
MM.playerY = Math.round(MM.h / 2 - ((pminZ + pmaxZ) / 2) * MM.scale);
const mmPix = new Uint8Array(MM.w * MM.h);
for (let s = 0; s < L; s += 4) {
  const p = M.pose(s), px = MM.playerX + p.x * MM.scale, py = MM.playerY + p.z * MM.scale;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const x = Math.round(px + dx), y = Math.round(py + dy);
    if (x >= 0 && y >= 0 && x < MM.w && y < MM.h && dx * dx + dy * dy <= 1.5) mmPix[y * MM.w + x] = 255;
  }
}
const mmImg = { w: MM.w, h: MM.h, p: new Float32Array(MM.w * MM.h * 3) };
for (let i = 0; i < MM.w * MM.h; i++) mmImg.p[i * 3] = mmImg.p[i * 3 + 1] = mmImg.p[i * 3 + 2] = mmPix[i] / 255;
const minimapPng = toPNG(mmImg, deflateSync);

/* --------------------------------------------------------- XML emitters */

const VTX_BATCH = 32;
const r = Math.round;
const nb = (v) => clamp(r(v * 127), -128, 127);
function materialXml(tex) {
  const line = (tex.w * 16) / 8 / 8, lrs = tex.w * tex.h - 1, words = Math.max(1, (tex.w * 2) / 8), dxt = Math.floor((2048 + words - 1) / words);
  return `<DisplayList Version="0">
\t<SetGeometryMode G_FOG="1" />
\t<ClearGeometryMode G_CLIPPING="1" />
\t<ClearGeometryMode G_CULL_BOTH="1" />
\t<PipeSync/>
\t<SetCombineLERP A0="G_CCMUX_TEXEL0" B0="G_CCMUX_0" C0="G_CCMUX_SHADE" D0="G_CCMUX_0" Aa0="G_ACMUX_0" Ab0="G_ACMUX_0" Ac0="G_ACMUX_0" Ad0="${tex.cutout ? 'G_ACMUX_TEXEL0' : 'G_ACMUX_1'}" A1="G_CCMUX_COMBINED" B1="G_CCMUX_0" C1="G_CCMUX_PRIMITIVE" D1="G_CCMUX_0" Aa1="G_ACMUX_0" Ab1="G_ACMUX_0" Ac1="G_ACMUX_0" Ad1="G_ACMUX_COMBINED"/>
\t<SetRenderMode Mode1="G_RM_PASS" Mode2="${tex.cutout ? 'G_RM_AA_ZB_TEX_EDGE2' : 'G_RM_AA_ZB_OPA_SURF2'}" />
\t<Texture S="65535" T="65535" Level="0" Tile="0" On="1"/>
\t<SetPrimColor M="0" L="0" R="255" G="255" B="255" A="255"/>
\t<SetTextureImage Path="${tex.path}" Format="G_IM_FMT_RGBA" Size="G_IM_SIZ_16b_LOAD_BLOCK" Width="1"/>
\t<SetTile Format="G_IM_FMT_RGBA" Size="G_IM_SIZ_16b_LOAD_BLOCK" Line="0" TMem="0" Tile="7" Palette="0" Cms0="G_TX_WRAP" Cms1="G_TX_NOMIRROR" Cmt0="G_TX_WRAP" Cmt1="G_TX_NOMIRROR" MaskS="0" ShiftS="0" MaskT="0" ShiftT="0"/>
\t<LoadBlock Tile="7" Uls="0" Ult="0" Lrs="${lrs}" Dxt="${dxt}"/>
\t<SetTile Format="G_IM_FMT_RGBA" Size="G_IM_SIZ_16b" Line="${line}" TMem="0" Tile="0" Palette="0" Cms0="G_TX_WRAP" Cms1="G_TX_NOMIRROR" Cmt0="G_TX_WRAP" Cmt1="G_TX_NOMIRROR" MaskS="${Math.log2(tex.w)}" ShiftS="0" MaskT="${Math.log2(tex.h)}" ShiftT="0"/>
\t<SetTileSize T="0" Uls="0" Ult="0" Lrs="${(tex.w - 1) << 2}" Lrt="${(tex.h - 1) << 2}"/>
\t<EndDisplayList/>
</DisplayList>`;
}
const materialRevertXml = `<DisplayList Version="0">
\t<ClearGeometryMode G_FOG="1" />
\t<SetGeometryMode G_CLIPPING="1" />
\t<PipeSync/>
\t<EndDisplayList/>
</DisplayList>`;
function meshFiles(sec) {
  const name = sec.name, verts = [], batches = [], per = Math.floor(VTX_BATCH / 3);
  for (let i = 0; i < sec.tris.length; i += per) {
    const chunk = sec.tris.slice(i, i + per);
    batches.push({ offset: verts.length, count: chunk.length * 3, tris: chunk.length });
    for (const t of chunk) verts.push(...t);
  }
  const vtx = ['<Vertex Version="0">'];
  for (const v of verts) {
    const n = v.n ?? [0, 1, 0];
    vtx.push(`\t<Vtx X="${r(v.x)}" Y="${r(v.y)}" Z="${r(v.z)}" S="${r(v.s)}" T="${r(v.t)}" R="${nb(n[0])}" G="${nb(n[1])}" B="${nb(n[2])}" A="255"/>`);
  }
  vtx.push('</Vertex>');
  const tri = ['<DisplayList Version="0">'];
  for (const b of batches) {
    tri.push(`\t<LoadVertices Path="${DIR}/${name}_vtx_0" VertexBufferIndex="0" VertexOffset="${b.offset}" Count="${b.count}"/>`);
    let t = 0;
    while (t + 1 < b.tris) {
      const a0 = t * 3, c0 = (t + 1) * 3;
      tri.push(`\t<Triangles2 V00="${a0}" V01="${a0 + 1}" V02="${a0 + 2}" Flag0="0" V10="${c0}" V11="${c0 + 1}" V12="${c0 + 2}" Flag1="0"/>`);
      t += 2;
    }
    if (t < b.tris) tri.push(`\t<Triangle1 V00="${t * 3}" V01="${t * 3 + 1}" V02="${t * 3 + 2}" Flag0="0"/>`);
  }
  tri.push('\t<EndDisplayList/>', '</DisplayList>');
  const root = `<DisplayList Version="0">
\t<ClearGeometryMode G_LIGHTING="1" />
\t<SetGeometryMode G_LIGHTING="1" />
\t<CallDisplayList Path="${DIR}/mat_${name}"/>
\t<CallDisplayList Path="${DIR}/${name}_tri_0"/>
\t<CallDisplayList Path="${DIR}/mat_revert_${name}"/>
\t<EndDisplayList/>
</DisplayList>`;
  return [[`${DIR}/${name}_vtx_0`, vtx.join('\n')], [`${DIR}/${name}_tri_0`, tri.join('\n')], [`${DIR}/${name}_mesh`, root], [`${DIR}/mat_${name}`, materialXml(sec.tex)], [`${DIR}/mat_revert_${name}`, materialRevertXml]];
}

// floors first, then walls, then visual-only (the double-sided-wall flag is sticky)
const rank = (s) => (s.clip === CLIP.DEFAULT ? 0 : s.clip === CLIP.WALL ? 1 : 2);
const secList = [...sections.values()].filter((s) => s.tris.length).sort((a, b) => rank(a) - rank(b));

const files = [];
for (const sec of secList) files.push(...meshFiles(sec));
files.push([`${DIR}/data_track_sections`, ['<TrackSections XMLSucks="1">',
  ...secList.map((s) => `\t<Section gfx_path="${DIR}/${s.name}_mesh" surface="${s.surface}" section="0xff" flags="${s.clip}" drawlayer="${s.layer}" x="0" y="0" z="0" />`),
  '</TrackSections>'].join('\n')]);
files.push([`${DIR}/data_paths`, ['<Paths XMLSucks="1">', '\t<TrackWaypoint>',
  ...pathPts.map((p) => `\t\t<Point X="${p.x}" Y="${p.y}" Z="${p.z}" ID="0"/>`),
  '\t\t<Point X="-32768" Y="-32768" Z="-32768" ID="0"/>', '\t</TrackWaypoint>', '</Paths>'].join('\n')]);
const scene = {
  Props: {
    ResourceName: RES,
    Name: 'Downtown Toronto',
    DebugName: 'toronto',
    TrackLength: `${Math.round(L / 10)}m`,
    AIDistance: [20, 5, 10, 15, 20, 25, 30, 35, 30, 25, 45, 65, 90, 115, 140, 165, 40, 3, 6, 16, 46, 49, 59, 89, 50, 30, 60, 63, 73, 78, 108, 138],
    AIMaximumSeparation: 50.0,
    AIMinimumSeparation: 0.30000001192092896,
    AISteeringSensitivity: 48,
    CurveTargetSpeed: [4.166666507720947, 5.583333492279053, 6.166666507720947, 6.75],
    NormalTargetSpeed: [3.75, 5.166666507720947, 5.75, 6.333333492279053],
    D_0D0096B8: [3.3333332538604736, 3.9166667461395264, 4.5, 5.083333492279053],
    OffTrackTargetSpeed: [3.75, 5.166666507720947, 5.75, 6.333333492279053],
    NearPersp: 3.0,
    FarPersp: 16000.0,
    LakituTowType: 0,
    Sequence: 32, // MUSIC_SEQ_ROYAL_RACEWAY
    WaterLevel: -700.0,
    // clear autumn sky over London, Ontario
    Skybox: [60, 120, 200, 180, 210, 235, 180, 210, 235, 60, 120, 200, 100, 130, 90, 100, 130, 90, 100, 130, 90, 100, 130, 90],
    MinimapColour: [255, 255, 255],
    MinimapPosition: [262, 170],
    MinimapPosition2P: [5, 0],
    MinimapPlayerX: MM.playerX,
    MinimapPlayerY: MM.playerY,
    MinimapPlayerScaleFactor: MM.scale,
    MinimapFinishlineX: 0.0,
    MinimapFinishlineY: 0.0,
  },
  Actors: actors,
  StaticMeshActors: null,
};
files.push([`${DIR}/scene.json`, JSON.stringify(scene, null, 2)]);
files.push(['mods.toml', `[mod]\nname = "${MOD}"\nversion = "1.0.0"\n`]);

/* ------------------------------------------------------------------ zip */

const CRC_T = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = (buf) => { let c = -1; for (let i = 0; i < buf.length; i++) c = CRC_T[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function zipStore(entries) {
  const locals = [], central = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8'), crc = crc32(data);
    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26); nameBuf.copy(local, 30);
    locals.push(local, data);
    const cen = Buffer.alloc(46 + nameBuf.length);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x21, 14);
    cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(data.length, 20); cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28); cen.writeUInt32LE(offset, 42); nameBuf.copy(cen, 46);
    central.push(cen);
    offset += local.length + data.length;
  }
  const centralBuf = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}
const entries = files.map(([name, text]) => ({ name, data: Buffer.from(text, 'utf8') }));
const usedTex = new Set(secList.map((s) => s.tex.path));
for (const [k, im] of Object.entries(PAINTED)) if (usedTex.has(TEX[k].path)) entries.push({ name: TEX[k].path, data: texResource(im) });
entries.push({ name: `${DIR}/minimap.png`, data: minimapPng });

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, `${MOD}.o2r`), zipStore(entries));
mkdirSync(join(OUT, 'preview', 'tex'), { recursive: true });
for (const [k, im] of Object.entries(PAINTED)) writeFileSync(join(OUT, 'preview', 'tex', `tex_${k}.png`), toPNG(im, deflateSync));
writeFileSync(join(OUT, 'preview', 'minimap.png'), minimapPng);
writeFileSync(join(OUT, 'preview', 'geometry.json'), JSON.stringify({
  sections: secList.map((s) => ({ name: s.name, tex: s.tex, surface: s.surface, clip: s.clip, layer: s.layer, tris: s.tris.map((t) => t.map((v) => [r(v.x), r(v.y), r(v.z), r(v.s), r(v.t)])) })),
  path: pathPts, pathS,
  frames: frames.map((f) => ({ s: f.s, x: f.x, y: f.y, z: f.z, w: f.w, nx: f.nx, nz: f.nz, kind: tagAt(Math.min(f.s, L - 1)).kind, gap: false, ceil: tagAt(Math.min(f.s, L - 1)).ceil ?? null })),
  actors,
  marks: { L, ...mark, G_MAX, PARK, TOWER, GARDINER, RAILS, QQ_X, BAY_Z, SHORE },
  minimap: MM,
}));

const triCount = secList.reduce((a, s) => a + s.tris.length, 0);
const collTris = secList.filter((s) => s.clip !== 0).reduce((a, s) => a + s.tris.length, 0);
console.log(`Downtown Toronto: lap ${Math.round(L)} units, ${pathPts.length} waypoints, ${triCount} triangles (${collTris} with collision), ${secList.length} sections`);
console.log(`  actors ${actors.length} (${actors.filter((a) => a.Name === 'mk:item_box').length} item boxes)`);
console.log(`  textures packed: ${[...usedTex].filter((p) => p.startsWith(DIR)).length}; minimap ${MM.w}x${MM.h} scale ${MM.scale} @(${MM.playerX},${MM.playerY})`);
