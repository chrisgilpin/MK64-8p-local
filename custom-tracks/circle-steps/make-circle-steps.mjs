#!/usr/bin/env node
/**
 * Circle Steps — a custom SpaghettiKart course.
 *
 * The finish straight runs north into a stone tower. A circular stair wraps
 * the tower three and a half times. At the top the road runs east, dives,
 * and a yellow ramp launches the karts across a gap onto a hill. The hill
 * descends through a wide loop back to the finish.
 *
 *   node make-circle-steps.mjs [outDir]
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

const TRACK = 'circle_steps';
const MOD = 'circle-steps';
const RES = 'chris:circle_steps';
const DIR = `tracks/${TRACK}`;
const OUT = process.argv[2] ?? '.';

const SURF = { ASPHALT: 1, GRASS: 8, BOOST: 0xfe };
const CLIP = { NONE: 0, FLOOR: 1, WALL: 4 };
const LAYER = { OPAQUE: 1 };

const STEP = 22;
const ROAD_HALF = { start: 190, stair: 150, high: 155, kick: 170, land: 250, back: 180 };

/* ------------------------------------------------------- centreline */

const pts = [];

function pushPoint(p) {
  const prev = pts[pts.length - 1];
  if (prev) {
    const d = Math.hypot(p.x - prev.x, p.z - prev.z);
    if (d < 1.5) return;
  }
  pts.push(p);
}

function addLine(x1, y1, z1, step, kind, half) {
  const a = pts[pts.length - 1];
  const dx = x1 - a.x;
  const dy = y1 - a.y;
  const dz = z1 - a.z;
  const len = Math.hypot(dx, dz) || 1;
  const n = Math.max(1, Math.round(len / step));
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    pushPoint({
      x: a.x + dx * t,
      y: a.y + dy * t,
      z: a.z + dz * t,
      tx: dx / len,
      tz: dz / len,
      kind,
      half,
    });
  }
}

/** Signed turn. Positive sweep is a left turn (heading angle increases). */
function addTurn(radius, sweep, y1, step, kind, half) {
  const a = pts[pts.length - 1];
  const psi0 = Math.atan2(a.tz, a.tx);
  const sg = Math.sign(sweep);
  const len = radius * Math.abs(sweep);
  const n = Math.max(2, Math.round(len / step));
  for (let i = 1; i <= n; i++) {
    const u = (i / n) * len;
    const psi = psi0 + (sg * u) / radius;
    const x = a.x + (radius / sg) * (Math.sin(psi) - Math.sin(psi0));
    const z = a.z - (radius / sg) * (Math.cos(psi) - Math.cos(psi0));
    const y = a.y + (y1 - a.y) * (i / n);
    pushPoint({ x, y, z, tx: Math.cos(psi), tz: Math.sin(psi), kind, half });
  }
}

function stairY(u, len, y0, y1) {
  const TREAD = 120;
  const RISE_LEN = 38;
  const n = Math.max(1, Math.floor(len / TREAD));
  const rise = (y1 - y0) / n;
  const i = Math.min(n - 1, Math.floor(u / TREAD));
  const local = u - i * TREAD;
  const base = y0 + i * rise;
  if (i === n - 1) {
    const climb = Math.min(RISE_LEN, (len - i * TREAD) * 0.5);
    if (local < climb) return base + (y1 - base) * (local / climb);
    return y1;
  }
  if (local < RISE_LEN) return base + rise * (local / RISE_LEN);
  return base + rise;
}

function addStair(cx, cz, radius, th0, turns, y0, y1, step, half) {
  const sweep = turns * Math.PI * 2;
  const len = radius * sweep;
  const n = Math.max(2, Math.round(len / step));
  for (let i = 1; i <= n; i++) {
    const u = (i / n) * len;
    const th = th0 + u / radius;
    const tx = -Math.sin(th);
    const tz = Math.cos(th);
    pushPoint({
      x: cx + radius * Math.cos(th),
      y: stairY(u, len, y0, y1),
      z: cz + radius * Math.sin(th),
      tx,
      tz,
      kind: 'stairs',
      half,
    });
  }
}

// Finish at the origin, heading north (negative Z). A right-hand bend
// meets the stair on the south side of the tower, heading west.
pushPoint({ x: 0, y: 0, z: 0, tx: 0, tz: -1, kind: 'road', half: ROAD_HALF.start });
addLine(0, 0, -420, STEP, 'road', ROAD_HALF.start);
addTurn(220, -Math.PI / 2, 0, STEP, 'road', ROAD_HALF.start);

const mouth = pts[pts.length - 1];
const STAIR_R = 560;
const TURNS = 3.5;
const TOP_Y = 840;
// Mouth heads west, which is the tangent at angle π/2 on this circle.
const CX = mouth.x;
const CZ = mouth.z - STAIR_R;
addStair(CX, CZ, STAIR_R, Math.PI / 2, TURNS, 0, TOP_Y, 16, ROAD_HALF.stair);

const deck = pts[pts.length - 1];
addLine(deck.x + 260, TOP_Y - 20, deck.z, STEP, 'road', ROAD_HALF.high);
addLine(deck.x + 980, 340, deck.z, STEP, 'road', ROAD_HALF.high);
const beforeKick = pts[pts.length - 1];
addLine(beforeKick.x + 300, 410, beforeKick.z, STEP, 'boost', ROAD_HALF.kick);
const lip = pts[pts.length - 1];
// Air. The path still crosses so the computers aim at the hill.
addLine(lip.x + 300, 360, lip.z, STEP, 'gap', ROAD_HALF.land);
const gapEnd = pts[pts.length - 1];
addLine(gapEnd.x + 520, 500, gapEnd.z, STEP, 'road', ROAD_HALF.land);
addLine(pts[pts.length - 1].x + 280, 490, pts[pts.length - 1].z, STEP, 'road', ROAD_HALF.land);

// Wide right-hand loop back to the finish, dropping off the hill.
addTurn(640, Math.PI / 2, 360, STEP, 'road', ROAD_HALF.back);
addLine(pts[pts.length - 1].x, 160, 280, STEP, 'road', ROAD_HALF.back);
addTurn(520, Math.PI / 2, 40, STEP, 'road', ROAD_HALF.back);
addLine(520, 8, pts[pts.length - 1].z, STEP, 'road', ROAD_HALF.back);
addTurn(520, Math.PI / 2, 0, STEP, 'road', ROAD_HALF.back);
addLine(0, 0, 12, STEP, 'road', ROAD_HALF.start);

// Headings follow the road that was actually drawn. A turn's stored
// tangent can come out backwards even when the points themselves are fine.
for (let i = 0; i < pts.length; i++) {
  const a = i + 1 < pts.length ? pts[i] : pts[i - 1];
  const b = i + 1 < pts.length ? pts[i + 1] : pts[i];
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz) || 1;
  pts[i].tx = dx / len;
  pts[i].tz = dz / len;
}

/* ---------------------------------------------------------- mesh */

const sections = new Map();
function section(name, surface, clip) {
  if (!sections.has(name)) sections.set(name, { name, surface, clip, verts: [], batches: [] });
  return sections.get(name);
}

function emitTri(sec, a, b, c) {
  if (ny(a, b, c) < 0) {
    const swap = b;
    b = c;
    c = swap;
  }
  const base = sec.verts.length;
  sec.verts.push(a, b, c);
  sec.batches.push({ off: base, idx: [0, 1, 2] });
}

function emitRaw(sec, a, b, c, d) {
  const base = sec.verts.length;
  sec.verts.push(a, b, c, d);
  sec.batches.push({ off: base, idx: [0, 1, 2, 0, 2, 3] });
}

function emitQuad(sec, a, b, c, d) {
  emitTri(sec, a, b, c);
  emitTri(sec, a, c, d);
}

function emitWall(sec, a, b, c, d) {
  emitRaw(sec, a, b, c, d);
  emitRaw(sec, a, d, c, b);
}

function col(r, g, b) {
  return { r, g, b, a: 255 };
}
const COLOR = {
  road: col(168, 164, 156),
  stairs: col(186, 168, 142),
  boost: col(232, 196, 64),
  rail: col(120, 112, 104),
  tower: col(142, 138, 132),
  roof: col(92, 78, 70),
  grass: col(78, 132, 64),
};

function side(p, sign, extra = 0) {
  const nx = -p.tz;
  const nz = p.tx;
  const w = p.half + extra;
  return { x: p.x + sign * nx * w, z: p.z + sign * nz * w };
}

function quadUp(sec, p0, p1, y0, y1, color, inset = 0) {
  const l0 = side(p0, -1, -inset);
  const r0 = side(p0, 1, -inset);
  const l1 = side(p1, -1, -inset);
  const r1 = side(p1, 1, -inset);
  const c = color;
  emitQuad(
    sec,
    { ...l0, y: y0, ...c },
    { ...r0, y: y0, ...c },
    { ...r1, y: y1, ...c },
    { ...l1, y: y1, ...c },
  );
}

const road = section('road', SURF.ASPHALT, CLIP.FLOOR);
const stairs = section('stairs', SURF.ASPHALT, CLIP.FLOOR);
const boost = section('boost', SURF.BOOST, CLIP.FLOOR);
const rails = section('rails', SURF.ASPHALT, CLIP.WALL);
const tower = section('tower', SURF.ASPHALT, CLIP.WALL);
const roof = section('roof', SURF.ASPHALT, CLIP.NONE);
const grass = section('grass', SURF.GRASS, CLIP.FLOOR);

for (let i = 0; i + 1 < pts.length; i++) {
  const a = pts[i];
  const b = pts[i + 1];
  if (a.kind === 'gap' || b.kind === 'gap') continue;
  const sec = a.kind === 'stairs' ? stairs : a.kind === 'boost' ? boost : road;
  const color = COLOR[a.kind] || COLOR.road;
  quadUp(sec, a, b, a.y, b.y, color);

  const elevated = a.y > 30 || a.kind === 'stairs';
  if (elevated && a.kind !== 'road') {
    // Outside rail. +side points at the tower on the stair, so the rail is -1.
    const h = 58;
    const e0 = side(a, -1);
    const e1 = side(b, -1);
    const c = COLOR.rail;
    emitWall(
      rails,
      { x: e0.x, y: a.y, z: e0.z, ...c },
      { x: e1.x, y: b.y, z: e1.z, ...c },
      { x: e1.x, y: b.y + h, z: e1.z, ...c },
      { x: e0.x, y: a.y + h, z: e0.z, ...c },
    );
  }
  if (a.kind === 'road' && a.y > 40) {
    for (const sign of [-1, 1]) {
      const e0 = side(a, sign);
      const e1 = side(b, sign);
      const c = COLOR.rail;
      emitWall(
        rails,
        { x: e0.x, y: a.y, z: e0.z, ...c },
        { x: e1.x, y: b.y, z: e1.z, ...c },
        { x: e1.x, y: b.y + 48, z: e1.z, ...c },
        { x: e0.x, y: a.y + 48, z: e0.z, ...c },
      );
    }
  }
}

// Spawn apron behind the finish, where the grid is placed at positive Z.
{
  const apron = [
    { x: 0, y: 0, z: 0, tx: 0, tz: -1, half: ROAD_HALF.start, kind: 'road' },
    { x: 0, y: 0, z: 260, tx: 0, tz: -1, half: ROAD_HALF.start, kind: 'road' },
  ];
  quadUp(road, apron[1], apron[0], 0, 0, COLOR.road);
}

// Grass shoulder under the hill and the way home. Skip any piece steep
// enough that the engine would treat it as a wall.
for (let i = 0; i + 1 < pts.length; i++) {
  const a = pts[i];
  const b = pts[i + 1];
  if (a.kind === 'gap' || a.kind === 'stairs' || a.kind === 'boost') continue;
  if (a.y < 12 && b.y < 12) continue;
  const horiz = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  if (Math.abs(b.y - a.y) / horiz > 0.45) continue;
  const wideA = { ...a, half: a.half + 90 };
  const wideB = { ...b, half: b.half + 90 };
  quadUp(grass, wideA, wideB, a.y - 8, b.y - 8, COLOR.grass);
}

// A gentle grass slope fills the jump, so a kart that falls short can drive up.
{
  const run = gapEnd.x - (lip.x + 30);
  const n = Math.max(2, Math.round(run / STEP));
  for (let i = 0; i < n; i++) {
    const t0 = i / n;
    const t1 = (i + 1) / n;
    const x0 = lip.x + 30 + run * t0;
    const x1 = lip.x + 30 + run * t1;
    const y0 = 160 + (gapEnd.y - 20 - 160) * t0;
    const y1 = 160 + (gapEnd.y - 20 - 160) * t1;
    const a = { x: x0, z: lip.z, tx: 1, tz: 0, half: 340 };
    const b = { x: x1, z: lip.z, tx: 1, tz: 0, half: 340 };
    quadUp(grass, a, b, y0, y1, COLOR.grass);
  }
}

// Tower column and a pointed roof. The column is the inner wall of the stair.
{
  const SEG = 28;
  const CORE = 330;
  const TOP = 1120;
  const ROOF = 1460;
  for (let k = 0; k < SEG; k++) {
    const a0 = (k / SEG) * Math.PI * 2;
    const a1 = ((k + 1) / SEG) * Math.PI * 2;
    const c0 = [Math.cos(a0), Math.sin(a0)];
    const c1 = [Math.cos(a1), Math.sin(a1)];
    const band = 140;
    for (let y = 0; y < TOP; y += band) {
      const y2 = Math.min(TOP, y + band);
      const p = (c, yy) => ({ x: CX + c[0] * CORE, y: yy, z: CZ + c[1] * CORE, ...COLOR.tower });
      emitWall(tower, p(c0, y), p(c1, y), p(c1, y2), p(c0, y2));
    }
    const tip = { x: CX, y: ROOF, z: CZ, ...COLOR.roof };
    const e0 = { x: CX + c0[0] * (CORE + 30), y: TOP, z: CZ + c0[1] * (CORE + 30), ...COLOR.roof };
    const e1 = { x: CX + c1[0] * (CORE + 30), y: TOP, z: CZ + c1[1] * (CORE + 30), ...COLOR.roof };
    roof.verts.push(e0, e1, tip);
    roof.batches.push({ off: roof.verts.length - 3, idx: [0, 1, 2] });
  }
}

/* ------------------------------------------------------------- xml / zip */

function xmlEscape(s) {
  return String(s);
}

function vertexXml(verts) {
  const rows = verts.map(
    (v) =>
      `\t<Vtx X="${Math.round(v.x)}" Y="${Math.round(v.y)}" Z="${Math.round(v.z)}" S="0" T="0" R="${v.r}" G="${v.g}" B="${v.b}" A="${v.a}"/>`,
  );
  return `<Vertex Version="0">\n${rows.join('\n')}\n</Vertex>\n`;
}

function triXml(name, sec) {
  const lines = ['<DisplayList Version="0">'];
  // Group whole quads into loads of at most 32 vertices.
  let batch = [];
  const flush = () => {
    if (!batch.length) return;
    const off = batch[0].off;
    const count = batch.reduce((n, b) => n + (b.idx.length === 6 ? 4 : 3), 0);
    lines.push(
      `\t<LoadVertices Path="${DIR}/${name}_vtx_0" VertexBufferIndex="0" VertexOffset="${off}" Count="${count}"/>`,
    );
    for (let i = 0; i < batch.length; i++) {
      const local = batch[i].idx;
      if (local.length === 6) {
        lines.push(
          `\t<Triangles2 V00="${local[0]}" V01="${local[1]}" V02="${local[2]}" Flag0="0" V10="${local[3]}" V11="${local[4]}" V12="${local[5]}" Flag1="0"/>`,
        );
      } else {
        lines.push(`\t<Triangle1 V00="${local[0]}" V01="${local[1]}" V02="${local[2]}" Flag0="0"/>`);
      }
    }
    batch = [];
  };
  let used = 0;
  for (const b of sec.batches) {
    const need = b.idx.length === 6 ? 4 : 3;
    if (used + need > 32) {
      flush();
      used = 0;
    }
    const local = b.idx.map((k) => k + used);
    batch.push({ off: b.off, idx: local });
    used += need;
  }
  flush();
  lines.push('\t<EndDisplayList/>', '</DisplayList>', '');
  return lines.join('\n');
}

const shade = (prim) => `<DisplayList Version="0">
	<ClearGeometryMode G_LIGHTING="1" />
	<SetGeometryMode G_CULL_BACK="1" G_ZBUFFER="1" G_SHADING_SMOOTH="1" />
	<PipeSync/>
	<SetCombineLERP A0="G_CCMUX_0" B0="G_CCMUX_0" C0="G_CCMUX_0" D0="G_CCMUX_SHADE" Aa0="G_ACMUX_0" Ab0="G_ACMUX_0" Ac0="G_ACMUX_0" Ad0="G_ACMUX_1" A1="G_CCMUX_0" B1="G_CCMUX_0" C1="G_CCMUX_0" D1="G_CCMUX_SHADE" Aa1="G_ACMUX_0" Ab1="G_ACMUX_0" Ac1="G_ACMUX_0" Ad1="G_ACMUX_1"/>
	<SetRenderMode Mode1="G_RM_AA_ZB_OPA_SURF" Mode2="G_RM_AA_ZB_OPA_SURF2" />
	<SetPrimColor M="0" L="0" R="${prim[0]}" G="${prim[1]}" B="${prim[2]}" A="255"/>
	<EndDisplayList/>
</DisplayList>
`;
const revert = `<DisplayList Version="0">
	<PipeSync/>
	<EndDisplayList/>
</DisplayList>
`;

function meshXml(name) {
  return `<DisplayList Version="0">
	<CallDisplayList Path="${DIR}/mat_${name}"/>
	<CallDisplayList Path="${DIR}/${name}_tri_0"/>
	<CallDisplayList Path="${DIR}/mat_revert_${name}"/>
	<EndDisplayList/>
</DisplayList>
`;
}

const files = [];
const order = ['road', 'stairs', 'boost', 'grass', 'rails', 'tower', 'roof'];
for (const name of order) {
  const sec = sections.get(name);
  if (!sec || !sec.verts.length) continue;
  files.push([`${DIR}/${name}_vtx_0`, vertexXml(sec.verts)]);
  files.push([`${DIR}/${name}_tri_0`, triXml(name, sec)]);
  files.push([`${DIR}/${name}_mesh`, meshXml(name)]);
  files.push([`${DIR}/mat_${name}`, shade(name === 'grass' ? [200, 220, 180] : [255, 255, 255])]);
  files.push([`${DIR}/mat_revert_${name}`, revert]);
}

const secList = order.map((n) => sections.get(n)).filter((s) => s && s.verts.length);
files.push([
  `${DIR}/data_track_sections`,
  [
    '<TrackSections Version="0">',
    ...secList.map(
      (s) =>
        `\t<Section gfx_path="${DIR}/${s.name}_mesh" surface="${s.surface}" section="255" flags="${s.clip}" drawlayer="${LAYER.OPAQUE}" x="0" y="0" z="0" />`,
    ),
    '</TrackSections>',
    '',
  ].join('\n'),
]);

const pathPts = pts.filter((p) => p.kind !== 'gap' || true);
files.push([
  `${DIR}/data_paths`,
  [
    '<Paths Version="0">',
    '\t<TrackWaypoint type="0">',
    ...pathPts.map((p) => `\t\t<Point X="${Math.round(p.x)}" Y="${Math.round(p.y)}" Z="${Math.round(p.z)}" ID="0"/>`),
    '\t\t<Point X="-32768" Y="-32768" Z="-32768" ID="0"/>',
    '\t</TrackWaypoint>',
    '</Paths>',
    '',
  ].join('\n'),
]);

let length = 0;
for (let i = 1; i < pts.length; i++) length += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);

const boxes = [0.15, 0.32, 0.48, 0.62, 0.78].map((t) => {
  const p = pts[Math.min(pts.length - 1, Math.floor(t * pts.length))];
  return { Name: 'mk:item_box', Location: { x: Math.round(p.x), y: Math.round(p.y + 30), z: Math.round(p.z) } };
});

const xs = pts.map((p) => p.x);
const zs = pts.map((p) => p.z);
const minX = Math.min(...xs);
const maxX = Math.max(...xs);
const minZ = Math.min(...zs);
const maxZ = Math.max(...zs);
const scale = 52 / Math.max(maxX - minX, maxZ - minZ);
const playerX = Math.round(32 - ((minX + maxX) / 2) * scale);
const playerY = Math.round(40 - ((minZ + maxZ) / 2) * scale);

const scene = {
  Props: {
    ResourceName: RES,
    Name: 'Circle Steps',
    DebugName: 'circlestep',
    TrackLength: `${Math.round(length / 10)}m`,
    AIDistance: [20, 5, 10, 15, 20, 25, 30, 35, 30, 25, 45, 65, 90, 115, 140, 165, 40, 3, 6, 16, 46, 49, 59, 89, 50, 30, 60, 63, 73, 78, 108, 138],
    AIMaximumSeparation: 50,
    AIMinimumSeparation: 0.3,
    AISteeringSensitivity: 48,
    CurveTargetSpeed: [4.1666665, 5.5833335, 6.1666665, 6.75],
    NormalTargetSpeed: [3.75, 5.1666665, 5.75, 6.3333335],
    D_0D0096B8: [3.3333333, 3.9166667, 4.5, 5.0833335],
    OffTrackTargetSpeed: [3.75, 5.1666665, 5.75, 6.3333335],
    NearPersp: 3,
    FarPersp: 9000,
    LakituTowType: 0,
    Sequence: 9,
    WaterLevel: -160,
    Skybox: [70, 120, 190, 190, 220, 245, 190, 220, 245, 70, 120, 190, 150, 170, 140, 150, 170, 140, 150, 170, 140, 150, 170, 140],
    MinimapColour: [255, 255, 255],
    MinimapPosition: [262, 166],
    MinimapPosition2P: [5, 0],
    MinimapPlayerX: playerX,
    MinimapPlayerY: playerY,
    MinimapPlayerScaleFactor: scale,
    MinimapFinishlineX: 0,
    MinimapFinishlineY: 0,
  },
  Actors: boxes,
  StaticMeshActors: null,
};
files.push([`${DIR}/scene.json`, JSON.stringify(scene, null, 2)]);
files.push(['mods.toml', `[mod]\nname = "${MOD}"\nversion = "1.0.0"\n`]);

function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const chunk = (type, data) => {
    const t = Buffer.from(type);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    const c = crc32(Buffer.concat([t, data]));
    crc.writeUInt32BE(c);
    return Buffer.concat([len, t, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const CRC_T = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_T[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

const MW = 64;
const MH = 64;
const img = Buffer.alloc(MW * MH * 4, 0);
for (let i = 0; i < MW * MH; i++) {
  img[i * 4] = 214;
  img[i * 4 + 1] = 206;
  img[i * 4 + 2] = 184;
  img[i * 4 + 3] = 255;
}
function plot(x, z, r, g, b) {
  const px = Math.round((x - minX) / (maxX - minX) * (MW - 4) + 2);
  const py = Math.round((z - minZ) / (maxZ - minZ) * (MH - 4) + 2);
  if (px < 0 || py < 0 || px >= MW || py >= MH) return;
  const o = (py * MW + px) * 4;
  img[o] = r;
  img[o + 1] = g;
  img[o + 2] = b;
}
for (const p of pts) plot(p.x, p.z, 40, 40, 48);
plot(CX, CZ, 90, 90, 96);
const minimap = png(MW, MH, img);
files.push([`${DIR}/minimap.png`, minimap]);

function zipStore(entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name);
    const crc = crc32(data);
    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    nameBuf.copy(local, 30);
    parts.push(local, data);
    const cen = Buffer.alloc(46 + nameBuf.length);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x21, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(data.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt32LE(offset, 42);
    nameBuf.copy(cen, 46);
    central.push(cen);
    offset += local.length + data.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, centralBuf, end]);
}

/* ------------------------------------------------------------ self-check */

const fails = [];
function check(ok, msg) {
  console.log((ok ? 'PASS ' : 'FAIL ') + msg);
  if (!ok) fails.push(msg);
}

function ny(a, b, c) {
  const ab = [b.x - a.x, b.y - a.y, b.z - a.z];
  const ac = [c.x - a.x, c.y - a.y, c.z - a.z];
  const n = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
  const l = Math.hypot(...n) || 1;
  return n[1] / l;
}

for (const name of ['road', 'stairs', 'boost', 'grass']) {
  const sec = sections.get(name);
  let min = 1;
  for (const b of sec.batches) {
    const v = b.idx.map((k) => sec.verts[b.off + k]);
    if (v.length === 6) min = Math.min(min, ny(v[0], v[1], v[2]), ny(v[3], v[4], v[5]));
    else min = Math.min(min, ny(v[0], v[1], v[2]));
  }
  check(min > 0.55, `${name} floors face up (min ny ${min.toFixed(3)})`);
}

const all = [...sections.values()].flatMap((s) => s.verts);
const maxC = Math.max(...all.map((v) => Math.max(Math.abs(v.x), Math.abs(v.y), Math.abs(v.z))));
check(maxC < 32000, `coordinates fit in a signed 16-bit value (max ${maxC.toFixed(0)})`);
check(Math.hypot(pts[0].x, pts[0].y, pts[0].z) < 0.01, 'path starts at the origin');
check(pts[0].tz < -0.9, 'path leaves the line heading north');

let minClear = 1e9;
const stairPts = pts.filter((p) => p.kind === 'stairs');
for (let i = 0; i < stairPts.length; i++) {
  for (let j = i + 1; j < stairPts.length; j++) {
    const ds = Math.hypot(stairPts[i].x - stairPts[j].x, stairPts[i].z - stairPts[j].z);
    if (ds < 80) {
      const dy = Math.abs(stairPts[i].y - stairPts[j].y);
      if (dy > 40 && dy < minClear) minClear = dy;
    }
  }
}
check(minClear >= 180, `stacked stair levels stay 180 apart (min ${minClear.toFixed(0)})`);
check(pts.length < 2000, `path has ${pts.length} points`);

const end = pts[pts.length - 1];
check(Math.hypot(end.x, end.z) < 30, `lap returns to the line (end ${end.x.toFixed(0)}, ${end.z.toFixed(0)})`);

let worstTurn = 0;
let worstAt = 0;
for (let i = 1; i < pts.length; i++) {
  const dot = pts[i - 1].tx * pts[i].tx + pts[i - 1].tz * pts[i].tz;
  const turn = Math.acos(Math.max(-1, Math.min(1, dot))) * (180 / Math.PI);
  if (turn > worstTurn) {
    worstTurn = turn;
    worstAt = i;
  }
}
check(worstTurn < 35, `no sharp corner (worst ${worstTurn.toFixed(0)}° at point ${worstAt})`);

if (fails.length) {
  console.log(`${fails.length} failures`);
  process.exit(1);
}

const entries = files.map(([name, text]) => ({
  name,
  data: Buffer.isBuffer(text) ? text : Buffer.from(text),
}));
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, `${MOD}.o2r`), zipStore(entries));
console.log(`Circle Steps: ${pts.length} points, lap ${Math.round(length)} , tower centre (${CX.toFixed(0)}, ${CZ.toFixed(0)})`);
console.log(`  lip (${lip.x.toFixed(0)}, ${lip.y.toFixed(0)}, ${lip.z.toFixed(0)})`);
console.log(`wrote ${join(OUT, `${MOD}.o2r`)}`);
