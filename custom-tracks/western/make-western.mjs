#!/usr/bin/env node
/**
 * "Western" — a SpaghettiKart track through the campus of Western University
 * (London, Ontario). A stylised tribute: the landmarks are real, their exact
 * positions and sizes are squeezed into a race lap.
 *
 * Lap (game units, Y up; the race starts at the origin heading -Z, which is
 * real-world west):
 *   1. Start just inside the Richmond Street gates (stone pillars, purple
 *      WESTERN banner) and run down University Drive.
 *   2. Cross the stone University Drive Bridge (1923) high over the Thames.
 *   3. Climb UC Hill straight at University College and its 130-ft
 *      Middlesex Memorial Tower, then drive through the archway under it.
 *   4. Swing out across Concrete Beach in front of the UCC, past Weldon Library
 *      and the Physics & Astronomy building, to Middlesex College's clock tower.
 *   5. Wind down through the woods to a purple steel footbridge over the river.
 *   6. Follow the Thames Valley pathway along the river, under the University
 *      Drive Bridge, past Medway-Sydenham Hall.
 *   7. Climb back up to Richmond Street and turn in through the gates.
 * Every edge of the route is lined (hedges, balustrades, seat walls, rails,
 * river walls), so the only way round is the whole lap.
 *
 * Usage: node make-western.mjs [outDir]
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { makeTextures, texResource, toPNG } from './textures.mjs';

const TRACK = 'western';
const MOD = 'western-university';
const RES = 'chris:western';
const DIR = `tracks/${TRACK}`;
const OUT = process.argv[2] ?? '.';

const PAINTED = makeTextures();
const TEX = {};
for (const [k, im] of Object.entries(PAINTED)) TEX[k] = { path: `${DIR}/tex_${k}`, w: im.w, h: im.h, custom: true, cutout: !!im.cutout };
TEX.grass = { path: 'textures/other_textures/grass_3', w: 32, h: 32 };

const SURF = { ASPHALT: 1, CEMENT: 4, GRASS: 8, WOOD: 17, OOB: 0xfd };
const CLIP = { NONE: 0, DEFAULT: 1, WALL: 4 };
const LAYER = { INVISIBLE: 0, OPAQUE: 1 };

const G_MAX = 0.14; // steepest climb anywhere (players bog down much past ~15%)
const SAMPLE = 18;
const PATH_SPACING = 25;
const ARCH_CEIL = 235; // ceiling of the passage under the UC tower
const RIVER = { zE: -1380, zW: -1720, water: -290, bed: -330 };
const PLATEAU_E = 0, FLOOD = -250, HILLTOP = 95;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const normalize = (v) => { const l = Math.hypot(...v) || 1; return v.map((c) => c / l); };
const TC = (texels) => texels * 32;
const V = (x, y, z, s, t, n) => ({ x, y, z, s, t, n });
const Q = Math.PI / 2;

/* ------------------------------------------------------------ path builder */

class Path {
  constructor(x, z, psi, y) { this.pieces = []; this.cur = { x, z, psi, y }; this.len = 0; }
  push(len, at, yAt, tag) {
    this.pieces.push({ s0: this.len, len, at, yAt, tag });
    this.len += len;
    const e = at(len);
    this.cur = { x: e.x, z: e.z, psi: Math.atan2(e.tz, e.tx), y: yAt(len) };
    return this;
  }
  prof(y0, y1, len, o = {}) {
    if (o.g) { const [g0, g1] = o.g; return (u) => y0 + g0 * u + ((g1 - g0) * u * u) / (2 * len); }
    return (u) => lerp(y0, y1, smooth(u / len));
  }
  line(len, y1, tag, o = {}) {
    const { x, z, psi, y } = this.cur;
    const dx = Math.cos(psi), dz = Math.sin(psi);
    return this.push(len, (u) => ({ x: x + dx * u, z: z + dz * u, tx: dx, tz: dz }), this.prof(y, y1, len, o), tag);
  }
  arc(R, sweep, y1, tag, o = {}) {
    const { x: x0, z: z0, psi: p0, y } = this.cur;
    const sg = Math.sign(sweep), len = R * Math.abs(sweep);
    return this.push(len, (u) => {
      const p = p0 + (sg * u) / R;
      return { x: x0 + (R / sg) * (Math.sin(p) - Math.sin(p0)), z: z0 - (R / sg) * (Math.cos(p) - Math.cos(p0)), tx: Math.cos(p), tz: Math.sin(p) };
    }, this.prof(y, y1, len, o), tag);
  }
  /** grade changes linearly from g0 to g1 over the piece */
  gline(len, g0, g1, tag) { return this.line(len, this.cur.y + (len * (g0 + g1)) / 2, tag, { g: [g0, g1] }); }
  garc(R, sweep, g0, g1, tag) { return this.arc(R, sweep, this.cur.y + (R * Math.abs(sweep) * (g0 + g1)) / 2, tag, { g: [g0, g1] }); }
  piece(s) {
    s = clamp(s, 0, this.len);
    let lo = 0, hi = this.pieces.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (this.pieces[m].s0 <= s) lo = m; else hi = m - 1; }
    return this.pieces[lo];
  }
  pose(s) {
    s = ((s % this.len) + this.len) % this.len;
    const p = this.piece(s), u = clamp(s - p.s0, 0, p.len), a = p.at(u);
    return { ...a, y: p.yAt(u), tag: p.tag, s };
  }
}

/* ------------------------------------------------------------ route tags */

const HEDGE = { tex: 'hedge', h: 42, off: 12, top: true };
const ROAD = (o = {}) => ({ kind: 'road', hw: 170, floor: 'road', walls: [HEDGE, HEDGE], ground: true, ...o });
const BRIDGE = (o = {}) => ({ kind: 'bridge', hw: 170, floor: 'road', walls: [{ tex: 'balustrade', h: 46, off: 2 }, { tex: 'balustrade', h: 46, off: 2 }], ground: false, ...o });
const WALK = (o = {}) => ({ kind: 'walk', hw: 170, floor: 'pavers', walls: [HEDGE, HEDGE], ground: true, ...o });
const ARCH = (o = {}) => ({ kind: 'arch', hw: 170, floor: 'pavers', walls: [{ tex: 'arcade', h: ARCH_CEIL, off: 4 }, { tex: 'arcade', h: ARCH_CEIL, off: 4 }], ceil: ARCH_CEIL, ground: true, ...o });
const PLAZA = (o = {}) => ({ kind: 'plaza', hw: 250, floor: 'slabs', walls: [{ tex: 'concrete', h: 34, off: 6, top: true }, { tex: 'concrete', h: 34, off: 6, top: true }], ground: true, ...o });
const WOODS = (o = {}) => ({ kind: 'woods', hw: 150, floor: 'road', walls: [{ tex: 'rail', h: 44, off: 10 }, { tex: 'rail', h: 44, off: 10 }], ground: true, ...o });
const FOOT = (o = {}) => ({ kind: 'footbridge', hw: 140, floor: 'planks', walls: [{ tex: 'truss', h: 75, off: 2 }, { tex: 'truss', h: 75, off: 2 }], ground: false, ...o });
// heading along the river with the water on the right: retaining wall on the left, low river wall on the right
const PATHWAY = (o = {}) => ({ kind: 'path', hw: 120, floor: 'path', walls: [{ tex: 'rubble', h: 52, off: 10 }, { tex: 'rubble', h: 30, off: 10 }], ground: true, ...o });

/* --------------------------------------------------------------- the lap */

const M = new Path(0, 0, -Q, 0);
const mark = {};
// 1. University Drive from the gates down towards the river
M.line(300, 0, ROAD({ name: 'University Drive' }));
M.gline(200, 0, -0.1, ROAD()); M.gline(200, -0.1, 0, ROAD()); // down to -40
M.line(230, M.cur.y, ROAD());
// 2. the University Drive Bridge, high over the riverside path and the Thames
mark.bridge0 = M.len; mark.bridgeZ0 = M.cur.z;
M.line(870, M.cur.y, BRIDGE({ name: 'University Drive Bridge' }));
mark.bridgeZ1 = M.cur.z;
// 3. UC Hill: straight up at the tower
mark.hill0 = M.len;
{
  const rise = HILLTOP + 5 - M.cur.y, L = rise / G_MAX - 150;
  M.gline(150, 0, G_MAX, ROAD({ name: 'UC Hill' })); M.gline(L, G_MAX, G_MAX, ROAD()); M.gline(150, G_MAX, 0, ROAD());
}
mark.hill1 = M.len;
const Y_TOP = M.cur.y;
// the brick walk (Kent Drive) up to the tower, through the arch, out the back
const UC = { zF: -3430, zB: -3830, tw: 230, wing: 1050, zWF: -3480, zWB: -3780 };
M.line(M.cur.z - UC.zF, Y_TOP, WALK({ name: 'Kent Drive' }));
mark.arch0 = M.len;
M.line(UC.zF - UC.zB, Y_TOP, ARCH({ name: 'UC Tower Arch' }));
mark.arch1 = M.len;
M.line(320, Y_TOP, WALK());
// 4. round onto Concrete Beach, along to Middlesex College
M.arc(400, Q, Y_TOP, WALK());
mark.plaza0 = M.len; mark.plazaZ = M.cur.z;
M.line(1500, Y_TOP, PLAZA({ name: 'Concrete Beach' }));
mark.plaza1 = M.len;
M.arc(400, Q, Y_TOP, ROAD());
mark.mcX = M.cur.x;
M.line(200, Y_TOP, ROAD({ name: 'Middlesex Drive' }));
// 5. down through the woods to the footbridge (constant grade, one S-bend)
const FOOT_Y = -215;
mark.woods0 = M.len;
{
  const zEnd = -1800, drop = M.cur.y - FOOT_Y;
  // lay the S-bend out on a scratch path to learn how far it advances
  const S = [[500, 1.0], [500, -2.0], [500, 1.0]];
  const probe = new Path(0, 0, Q, 0);
  for (const [R, a] of S) probe.arc(R, a, 0, {});
  const sAdv = probe.cur.z, sLen = probe.len;
  const L1 = 100, L2 = zEnd - M.cur.z - 150 - L1 - sAdv - 150;
  if (L2 < 50) throw new Error('woods too short');
  const g = drop / (75 + L1 + sLen + L2 + 75);
  if (g > G_MAX + 1e-9) throw new Error(`woods grade ${g}`);
  M.gline(150, 0, -g, WOODS({ name: 'The Woods' }));
  M.gline(L1, -g, -g, WOODS());
  for (const [R, a] of S) M.garc(R, a, -g, -g, WOODS());
  M.gline(L2, -g, -g, WOODS());
  M.gline(150, -g, 0, WOODS());
  mark.woodsGrade = g;
}
mark.woods1 = M.len;
// 6. footbridge over the Thames, onto the riverside pathway
mark.foot0 = M.len;
M.line(450, FOOT_Y, FOOT({ name: 'Footbridge' }));
mark.foot1 = M.len;
M.arc(220, Q, FOOT_Y, PATHWAY({ name: 'Thames Valley Parkway' }));
mark.pathZ = M.cur.z;
const PATH_Y = FLOOD + 5;
M.gline(300, 0, -0.1, PATHWAY()); M.gline(300, -0.1, 0, PATHWAY()); // down to -245
mark.path0 = M.len;
M.line(M.cur.x + 1600, PATH_Y, PATHWAY());
mark.path1 = M.len;
// 7. up Sydenham hill to Richmond Street and in through the gates
M.arc(300, -Q, PATH_Y, PATHWAY());
{
  const rise = -PATH_Y, L = rise / G_MAX - 150;
  M.gline(150, 0, G_MAX, ROAD({ name: 'Sydenham Hill' })); M.gline(L, G_MAX, G_MAX, ROAD()); M.gline(150, G_MAX, 0, ROAD());
}
mark.climbEnd = M.len;
M.line(1150 - M.cur.z, 0, ROAD());
M.arc(400, -Q, 0, ROAD());
mark.rich0 = M.len;
M.line(1100, 0, ROAD({ name: 'Richmond Street' }));
mark.rich1 = M.len;
M.arc(400, -Q, 0, ROAD());
M.line(M.cur.z, 0, ROAD());
if (Math.hypot(M.cur.x, M.cur.z) > 0.5) throw new Error(`lap does not close: ${M.cur.x.toFixed(1)}, ${M.cur.z.toFixed(1)}`);
const L = M.len;

/* ------------------------------------------------------------- frames */

const breaks = M.pieces.map((p) => p.s0).concat([30, L - 30]);
let sampleS = [];
for (let s = 0; s < L; s += SAMPLE) sampleS.push(s);
sampleS.push(...breaks);
sampleS = [...new Set(sampleS.map((v) => Math.round(v * 1000) / 1000))].filter((v) => v >= 0 && v < L - 0.5).sort((a, b) => a - b);
sampleS = sampleS.filter((v) => breaks.some((b) => Math.abs(b - v) < 1e-3) || !breaks.some((b) => Math.abs(b - v) < 8));
function frame(s) {
  const p = M.pose(s);
  const tag = M.piece(Math.min(L, s + 0.01)).tag; // at a seam, the piece being entered
  return { s, x: p.x, z: p.z, y: p.y, tx: p.tx, tz: p.tz, nx: -p.tz, nz: p.tx, w: tag.hw, tag };
}
const frames = sampleS.map(frame);
frames.push({ ...frame(0), s: L });
const tagAt = (s) => M.piece(clamp(s, 0, L - 0.01)).tag;

// spatial hash of frames for terrain and placement queries
const HCELL = 300;
const fhash = new Map();
for (const f of frames) {
  const k = `${Math.floor(f.x / HCELL)},${Math.floor(f.z / HCELL)}`;
  if (!fhash.has(k)) fhash.set(k, []);
  fhash.get(k).push(f);
}
function framesNear(x, z, r) {
  const out = [];
  const i0 = Math.floor((x - r) / HCELL), i1 = Math.floor((x + r) / HCELL), j0 = Math.floor((z - r) / HCELL), j1 = Math.floor((z + r) / HCELL);
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (const f of fhash.get(`${i},${j}`) ?? []) out.push(f);
  return out;
}
/** clearance from (x,z) to the edge of the nearest lane (negative = inside a lane) */
function laneClearance(x, z) {
  let best = Infinity;
  for (const f of framesNear(x, z, 700)) best = Math.min(best, Math.hypot(x - f.x, z - f.z) - f.w);
  return best;
}

/* ------------------------------------------------------------ sections */

const sections = new Map();
function section(name, tex, surface, clip, layer = LAYER.OPAQUE) {
  if (!sections.has(name)) sections.set(name, { name, tex, surface, clip, layer, tris: [] });
  return sections.get(name);
}
const decor = (key, name = key) => section(`deco_${name}`, TEX[key], SURF.CEMENT, CLIP.NONE);
function triNormal(a, b, c) {
  const u = [b.x - a.x, b.y - a.y, b.z - a.z], v = [c.x - a.x, c.y - a.y, c.z - a.z];
  return normalize([u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]);
}
function quad(sec, a, b, c, d, n) {
  const nn = n ?? triNormal(a, b, c);
  for (const v of [a, b, c, d]) if (!v.n) v.n = nn;
  sec.tris.push([a, b, c], [a, c, d]);
}
/** upward-facing horizontal rectangle */
function floorRect(sec, x0, x1, z0, z1, y, tex, unit, cell = 200) {
  const nx = Math.max(1, Math.ceil((x1 - x0) / cell)), nz = Math.max(1, Math.ceil((z1 - z0) / cell));
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const xa = lerp(x0, x1, i / nx), xb = lerp(x0, x1, (i + 1) / nx), za = lerp(z0, z1, j / nz), zb = lerp(z0, z1, (j + 1) / nz);
    const bx = Math.floor(xa / unit) * unit, bz = Math.floor(za / unit) * unit;
    const mk = (x, z) => V(x, y, z, TC(((x - bx) / unit) * tex.w), TC(((z - bz) / unit) * tex.h), [0, 1, 0]);
    quad(sec, mk(xa, za), mk(xa, zb), mk(xb, zb), mk(xb, za), [0, 1, 0]);
  }
}
/** vertical wall p0 -> p1 between y0 and y1; reads correctly from its right-hand side */
function wallRect(sec, p0, p1, y0, y1, tex, uPer, vPer, opts = {}) {
  const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
  if (len < 0.5 || y1 - y0 < 0.5) return;
  const dir = [(p1[0] - p0[0]) / len, (p1[1] - p0[1]) / len];
  const n = normalize([-dir[1], 0.7, dir[0]]);
  const nu = Math.max(1, Math.ceil(len / (opts.maxW ?? 200))), nv = Math.max(1, Math.ceil((y1 - y0) / (opts.maxH ?? 200)));
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const ua = (len * i) / nu, ub = (len * (i + 1)) / nu, ya = lerp(y0, y1, j / nv), yb = lerp(y0, y1, (j + 1) / nv);
    const baseU = Math.floor(ua / uPer) * uPer, baseV = opts.vAnchor ?? Math.floor(ya / vPer) * vPer;
    const sA = TC(((ua - baseU) / uPer) * tex.w), sB = TC(((ub - baseU) / uPer) * tex.w);
    const tTop = (y) => TC(((baseV + vPer - y) / vPer) * tex.h);
    const [xa, za] = [p0[0] + dir[0] * ua, p0[1] + dir[1] * ua], [xb, zb] = [p0[0] + dir[0] * ub, p0[1] + dir[1] * ub];
    quad(sec, V(xa, ya, za, sA, tTop(ya)), V(xb, ya, zb, sB, tTop(ya)), V(xb, yb, zb, sB, tTop(yb)), V(xa, yb, za, sA, tTop(yb)), n);
  }
}
/** one textured panel facing `normal` (XZ), centred at c, w x h, bottom at y0 */
function panel(sec, c, normal, w, h, y0, tex) {
  const r = [normal[1], -normal[0]];
  const a = [c[0] - (r[0] * w) / 2, c[1] - (r[1] * w) / 2], b = [c[0] + (r[0] * w) / 2, c[1] + (r[1] * w) / 2];
  quad(sec, V(a[0], y0, a[1], 0, TC(tex.h)), V(b[0], y0, b[1], TC(tex.w), TC(tex.h)), V(b[0], y0 + h, b[1], TC(tex.w), 0), V(a[0], y0 + h, a[1], 0, 0), normalize([normal[0], 0.5, normal[1]]));
}
/** a sign: the face towards `normal`, a plain stone back the other way (so it never reads mirrored) */
function sign(sec, c, normal, w, h, y0, tex) {
  panel(sec, c, normal, w, h, y0, tex);
  panel(section('deco_sign_backs', TEX.limestone, SURF.CEMENT, CLIP.NONE), [c[0] - normal[0] * 1.5, c[1] - normal[1] * 1.5], [-normal[0], -normal[1]], w, h, y0, TEX.limestone);
}
/** axis-aligned box: four walls (faces outward) and an optional top */
function box(sec, top, x0, x1, z0, z1, y0, y1, tex, uPer, vPer, topTex, opts = {}) {
  wallRect(sec, [x0, z1], [x1, z1], y0, y1, tex, uPer, vPer, opts);
  wallRect(sec, [x1, z1], [x1, z0], y0, y1, tex, uPer, vPer, opts);
  wallRect(sec, [x1, z0], [x0, z0], y0, y1, tex, uPer, vPer, opts);
  wallRect(sec, [x0, z0], [x0, z1], y0, y1, tex, uPer, vPer, opts);
  if (top) floorRect(top, x0, x1, z0, z1, y1, topTex ?? tex, 100, 400);
}
/** four-sided pyramid roof/spire over an axis-aligned rectangle */
function pyramid(sec, x0, x1, z0, z1, y, apex, tex) {
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const corners = [[x0, z1], [x1, z1], [x1, z0], [x0, z0]];
  for (let k = 0; k < 4; k++) {
    const [ax, az] = corners[k], [bx, bz] = corners[(k + 1) % 4];
    const A = V(ax, y, az, 0, TC(tex.h * 4)), B = V(bx, y, bz, TC(tex.w * 2), TC(tex.h * 4)), Cc = V(cx, apex, cz, TC(tex.w), 0);
    const n = triNormal(A, B, Cc);
    sec.tris.push([A, B, Cc].map((v) => ({ ...v, n })));
  }
}
/** gable roof, ridge along x */
function gable(roofSec, endSec, x0, x1, z0, z1, y, h, roofTex, endTex) {
  const zm = (z0 + z1) / 2, run = Math.hypot((z1 - z0) / 2, h);
  const u = (x) => TC(((x - x0) / 100) * roofTex.w), v = (d) => TC((d / 100) * roofTex.h);
  quad(roofSec, V(x0, y, z1, u(x0), v(run)), V(x1, y, z1, u(x1), v(run)), V(x1, y + h, zm, u(x1), 0), V(x0, y + h, zm, u(x0), 0));
  quad(roofSec, V(x1, y, z0, u(x1), v(run)), V(x0, y, z0, u(x0), v(run)), V(x0, y + h, zm, u(x0), 0), V(x1, y + h, zm, u(x1), 0));
  for (const [x, s] of [[x0, -1], [x1, 1]]) {
    const A = V(x, y, s < 0 ? z0 : z1, 0, TC(endTex.h)), B = V(x, y, s < 0 ? z1 : z0, TC(endTex.w * 2), TC(endTex.h)), Cc = V(x, y + h, zm, TC(endTex.w), 0);
    const n = triNormal(A, B, Cc);
    endSec.tris.push([A, B, Cc].map((q) => ({ ...q, n })));
  }
}
/** a row of merlons (crenellation) along p0 -> p1 */
function battlement(sec, p0, p1, y, tex, h = 34, w = 34, gap = 30) {
  const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), d = [(p1[0] - p0[0]) / len, (p1[1] - p0[1]) / len], n = [-d[1], d[0]];
  wallRect(sec, p0, p1, y, y + 12, tex, 64, 64);
  for (let u = 0; u + w <= len; u += w + gap) {
    const a = [p0[0] + d[0] * u, p0[1] + d[1] * u], b = [p0[0] + d[0] * (u + w), p0[1] + d[1] * (u + w)];
    const ai = [a[0] - n[0] * 14, a[1] - n[1] * 14], bi = [b[0] - n[0] * 14, b[1] - n[1] * 14];
    wallRect(sec, a, b, y + 12, y + 12 + h, tex, 64, 64);
    wallRect(sec, bi, ai, y + 12, y + 12 + h, tex, 64, 64);
    wallRect(sec, ai, a, y + 12, y + 12 + h, tex, 64, 64);
    wallRect(sec, b, bi, y + 12, y + 12 + h, tex, 64, 64);
  }
}
/** crenellated parapet round an axis-aligned roof, outward-facing */
function parapet(sec, x0, x1, z0, z1, y, tex) {
  battlement(sec, [x0, z1], [x1, z1], y, tex);
  battlement(sec, [x1, z1], [x1, z0], y, tex);
  battlement(sec, [x1, z0], [x0, z0], y, tex);
  battlement(sec, [x0, z0], [x0, z1], y, tex);
}

/* ------------------------------------------------- floors, walls, ceilings */

const FLOOR = {
  road: { tex: 'road', surf: SURF.ASPHALT, unit: 160, across: () => 1 },
  path: { tex: 'path', surf: SURF.ASPHALT, unit: 96, across: () => 1 },
  pavers: { tex: 'pavers', surf: SURF.CEMENT, unit: 80, across: (w) => (2 * w) / 80 },
  slabs: { tex: 'slabs', surf: SURF.CEMENT, unit: 110, across: (w) => (2 * w) / 110 },
  planks: { tex: 'planks', surf: SURF.WOOD, unit: 70, across: () => 3 },
  finish: { tex: 'finish', surf: SURF.ASPHALT, unit: 60, across: () => 1 },
};
const floorSec = (key) => section(`floor_${key}`, TEX[FLOOR[key].tex], FLOOR[key].surf, CLIP.DEFAULT);
const WALL_U = { hedge: 64, balustrade: 48, arcade: 110, concrete: 64, rail: 64, truss: 75, rubble: 64 };
const wallSec = (key) => section(`wall_${key}`, TEX[key], SURF.CEMENT, CLIP.WALL);
const hedgeTop = section('hedge_tops', TEX.hedge, SURF.GRASS, CLIP.NONE);
const concreteTop = section('wall_tops', TEX.concrete, SURF.CEMENT, CLIP.NONE);
const vaultSec = section('ceiling_vault', TEX.vault, SURF.CEMENT, CLIP.NONE);

for (let i = 0; i + 1 < frames.length; i++) {
  const f0 = frames[i], f1 = frames[i + 1];
  const t = tagAt((f0.s + f1.s) / 2);
  // floor ribbon
  const key = (f0.s < 30 || f0.s >= L - 30) ? 'finish' : t.floor;
  const spec = FLOOR[key], sec = floorSec(key), tex = TEX[spec.tex];
  let t0, t1;
  if (key === 'finish') {
    const wrap = (s) => (s > L / 2 ? s - L : s) + 30;
    t0 = TC((wrap(f0.s) / 60) * tex.h); t1 = TC(((f1.s >= L - 1e-6 ? 30 : wrap(f1.s)) / 60) * tex.h);
  } else {
    const base = Math.floor(f0.s / spec.unit) * spec.unit;
    t0 = TC(((f0.s - base) / spec.unit) * tex.h); t1 = TC(((f1.s - base) / spec.unit) * tex.h);
  }
  const across = spec.across(f0.w), LAT = f0.w > 200 ? 4 : 2;
  for (let k = 0; k < LAT; k++) {
    const la = lerp(-1, 1, k / LAT), lb = lerp(-1, 1, (k + 1) / LAT);
    const P = (f, l) => [f.x + f.nx * f.w * l, f.z + f.nz * f.w * l];
    const sAt = (l) => TC(((l + 1) / 2) * across * tex.w);
    const [ax, az] = P(f0, la), [bx, bz] = P(f0, lb), [cx, cz] = P(f1, lb), [dx, dz] = P(f1, la);
    quad(sec, V(ax, f0.y, az, sAt(la), t0), V(bx, f0.y, bz, sAt(lb), t0), V(cx, f1.y, cz, sAt(lb), t1), V(dx, f1.y, dz, sAt(la), t1), [0, 1, 0]);
  }
  // side walls: index 0 = left (-n), 1 = right (+n)
  t.walls.forEach((w, idx) => {
    if (!w) return;
    const side = idx === 0 ? -1 : 1;
    const E = (f, extra = 0) => [f.x + side * f.nx * (f.w + w.off + extra), f.z + side * f.nz * (f.w + w.off + extra)];
    const e0 = E(f0), e1 = E(f1);
    const wsec = wallSec(w.tex), wt = TEX[w.tex], uPer = WALL_U[w.tex];
    const base = Math.floor(f0.s / uPer) * uPer;
    const sA = TC(((f0.s - base) / uPer) * wt.w), sB = TC(((f1.s - base) / uPer) * wt.w);
    const nIn = normalize([-side * f0.nx, 0.7, -side * f0.nz]);
    quad(wsec, V(e0[0], f0.y, e0[1], sA, TC(wt.h)), V(e1[0], f1.y, e1[1], sB, TC(wt.h)), V(e1[0], f1.y + w.h, e1[1], sB, 0), V(e0[0], f0.y + w.h, e0[1], sA, 0), nIn);
    if (w.top) {
      const o0 = E(f0, 16), o1 = E(f1, 16), ts = w.tex === 'hedge' ? hedgeTop : concreteTop;
      const order = side < 0 ? [o0, e0, e1, o1] : [e0, o0, o1, e1];
      const ys = side < 0 ? [f0.y, f0.y, f1.y, f1.y] : [f0.y, f0.y, f1.y, f1.y];
      quad(ts, ...order.map((p, j) => V(p[0], ys[j] + w.h, p[1], TC(j === 1 || j === 2 ? 8 : 0), TC(j >= 2 ? 32 : 0))), [0, 1, 0]);
    }
  });
  if (t.ceil) {
    const cy0 = f0.y + t.ceil, cy1 = f1.y + t.ceil, w0 = f0.w + 4, w1 = f1.w + 4;
    const base = Math.floor(f0.s / 128) * 128;
    const ta = TC(((f0.s - base) / 128) * 32), tb = TC(((f1.s - base) / 128) * 32), sw = TC(((2 * w0) / 128) * 32);
    quad(vaultSec, V(f0.x - f0.nx * w0, cy0, f0.z - f0.nz * w0, 0, ta), V(f0.x + f0.nx * w0, cy0, f0.z + f0.nz * w0, sw, ta),
      V(f1.x + f1.nx * w1, cy1, f1.z + f1.nz * w1, sw, tb), V(f1.x - f1.nx * w1, cy1, f1.z - f1.nz * w1, 0, tb), [0, -1, 0]);
  }
}

/* ------------------------------------------------------------ terrain */

// the valley across the map: Richmond Street plateau, the floodplain, the
// Thames, the far floodplain and UC Hill up to the campus plateau
function baseHeight(x, z) {
  if (z >= -600) return PLATEAU_E;
  if (z >= -950) return lerp(FLOOD, PLATEAU_E, smooth((z + 950) / 350));
  if (z >= RIVER.zE + 40) return FLOOD;
  if (z >= RIVER.zE) return lerp(RIVER.bed, FLOOD, (z - RIVER.zE) / 40);
  if (z >= RIVER.zW) return RIVER.bed;
  if (z >= RIVER.zW - 40) return lerp(FLOOD, RIVER.bed, (z - (RIVER.zW - 40)) / 40);
  if (z >= -2050) return FLOOD;
  if (z >= -3150) return lerp(HILLTOP, FLOOD, smooth((z + 3150) / 1100));
  return HILLTOP;
}
function groundAt(x, z) {
  let h = baseHeight(x, z);
  // pull the ground up/down to the nearest road beside it (not past its ends)
  let best = null, bd = Infinity;
  for (const f of framesNear(x, z, 520)) {
    if (!f.tag.ground) continue;
    const d = Math.hypot(x - f.x, z - f.z);
    if (d < bd) { bd = d; best = f; }
  }
  if (best && bd < best.w + 320) {
    const along = Math.abs((x - best.x) * best.tx + (z - best.z) * best.tz);
    const wgt = smooth(1 - (bd - best.w - 20) / 290) * smooth(1 - (along - SAMPLE) / 120);
    h = lerp(h, best.y - 6, wgt);
  }
  // never above any road (bridges included) near here: flat 6 below out to a
  // cell beyond the edge, then a 31-degree bank
  for (const f of framesNear(x, z, 900)) {
    const d = Math.hypot(x - f.x, z - f.z);
    if (d > f.w + 800) continue;
    h = Math.min(h, f.y - 6 + 0.6 * Math.max(0, d - f.w - 110));
  }
  return h;
}
let bx0 = Infinity, bx1 = -Infinity, bz0 = Infinity, bz1 = -Infinity;
for (const f of frames) { bx0 = Math.min(bx0, f.x); bx1 = Math.max(bx1, f.x); bz0 = Math.min(bz0, f.z); bz1 = Math.max(bz1, f.z); }
const CELL = 100;
const GX0 = Math.floor((bx0 - 900) / CELL) * CELL, GX1 = Math.ceil((Math.max(bx1, 3400) + 900) / CELL) * CELL;
const GZ0 = Math.floor((bz0 - 1000) / CELL) * CELL, GZ1 = Math.ceil((bz1 + 900) / CELL) * CELL;
const NX = (GX1 - GX0) / CELL, NZ = (GZ1 - GZ0) / CELL;
const H = new Float32Array((NX + 1) * (NZ + 1));
for (let j = 0; j <= NZ; j++) for (let i = 0; i <= NX; i++) H[j * (NX + 1) + i] = groundAt(GX0 + i * CELL, GZ0 + j * CELL);
const Hv = (i, j) => H[j * (NX + 1) + i];
/** terrain height exactly as triangulated (cells split along x0z0-x1z1) */
function terrainY(x, z) {
  const fi = clamp((x - GX0) / CELL, 0, NX - 1e-6), fj = clamp((z - GZ0) / CELL, 0, NZ - 1e-6);
  const i = Math.floor(fi), j = Math.floor(fj), u = fi - i, v = fj - j;
  const h00 = Hv(i, j), h10 = Hv(i + 1, j), h01 = Hv(i, j + 1), h11 = Hv(i + 1, j + 1);
  return v >= u ? h00 + (h11 - h01) * u + (h01 - h00) * v : h00 + (h10 - h00) * u + (h11 - h10) * v;
}
{
  const grass = section('terrain_grass', TEX.grass, SURF.GRASS, CLIP.DEFAULT);
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
    const x0 = GX0 + i * CELL, x1 = x0 + CELL, z0 = GZ0 + j * CELL, z1 = z0 + CELL;
    const mk = (x, z, h) => V(x, h, z, TC(((x - x0) / CELL) * 32 * 3), TC(((z - z0) / CELL) * 32 * 3));
    const a = mk(x0, z0, Hv(i, j)), b = mk(x0, z1, Hv(i, j + 1)), c = mk(x1, z1, Hv(i + 1, j + 1)), d = mk(x1, z0, Hv(i + 1, j));
    for (const [p, q, r2] of [[a, b, c], [a, c, d]]) { const n = triNormal(p, q, r2); grass.tris.push([p, q, r2].map((vv) => ({ ...vv, n }))); }
  }
  // the Thames: an out-of-bounds water surface (fall in and Lakitu fishes you out)
  const water = section('river', TEX.water, SURF.OOB, CLIP.DEFAULT);
  floorRect(water, GX0, GX1, RIVER.zW, RIVER.zE, RIVER.water, TEX.water, 140, 400);
}
// retaining walls wherever a ground-level road stands above the terrain beside it
{
  const sec = section('retaining_walls', TEX.rubble, SURF.CEMENT, CLIP.NONE);
  for (let i = 0; i + 1 < frames.length; i++) {
    const f0 = frames[i], f1 = frames[i + 1], t = tagAt((f0.s + f1.s) / 2);
    if (!t.ground) continue;
    for (const [idx, side] of [[0, -1], [1, 1]]) {
      const off = (t.walls[idx]?.off ?? 10) + 18;
      const P = (f) => [f.x + side * f.nx * (f.w + off), f.z + side * f.nz * (f.w + off)];
      const p0 = P(f0), p1 = P(f1);
      const g0 = terrainY(...p0), g1 = terrainY(...p1);
      if (f0.y - g0 < 14 && f1.y - g1 < 14) continue;
      const lo = Math.min(g0, g1) - 8;
      const [a, b] = side < 0 ? [p1, p0] : [p0, p1];
      wallRect(sec, a, b, lo, Math.max(f0.y, f1.y), TEX.rubble, 64, 64);
    }
  }
}

/* ------------------------------------------------------------ landmarks */

const BUILDINGS = []; // footprints, to keep trees out
const addFoot = (x0, x1, z0, z1) => BUILDINGS.push({ x0, x1, z0, z1 });

// Richmond Street gates: two stone pillars and the purple WESTERN banner over the road
{
  const z0 = -150, z1 = -90, xi = 192, xo = 252;
  const st = decor('limestone', 'gate_pillars');
  for (const s of [-1, 1]) {
    const [a, b] = s < 0 ? [-xo, -xi] : [xi, xo];
    box(st, st, a, b, z0, z1, -5, 230, TEX.limestone, 60, 60);
    box(st, st, a - 8, b + 8, z0 - 8, z1 + 8, 230, 250, TEX.limestone, 60, 60);
    addFoot(a - 10, b + 10, z0 - 10, z1 + 10);
  }
  panel(decor('signWestern', 'gate_banner'), [0, (z0 + z1) / 2 + 2], [0, 1], 2 * xo - 20, 80, 160, TEX.signWestern);
  panel(decor('signWestern', 'gate_banner'), [0, (z0 + z1) / 2 - 2], [0, -1], 2 * xo - 20, 80, 160, TEX.signWestern);
  box(st, null, -xo, xo, z0 + 18, z1 - 18, 240, 250, TEX.limestone, 60, 60);
}

// University Drive Bridge: deck fascia, soffit, stone piers and round-arch spandrels
{
  const zA = mark.bridgeZ0, zB = mark.bridgeZ1, yD = -40, xs = 174;
  const stone = decor('bridgeStone', 'bridge');
  for (const s of [-1, 1]) {
    const [p, q] = s < 0 ? [[-xs, zB], [-xs, zA]] : [[xs, zA], [xs, zB]];
    wallRect(stone, p, q, yD - 42, yD, TEX.bridgeStone, 64, 64);
  }
  // soffit under the deck
  const soff = decor('bridgeStone', 'bridge_soffit');
  for (let z = zA; z > zB; z -= 100) {
    const za = z, zb = Math.max(zB, z - 100);
    quad(soff, V(-xs, yD - 42, za, 0, 0), V(xs, yD - 42, za, TC(160), 0), V(xs, yD - 42, zb, TC(160), TC(32)), V(-xs, yD - 42, zb, 0, TC(32)), [0, -1, 0]);
  }
  const piers = [[zA, zA - 45], [-1285, -1365], [zB + 55, zB]];
  for (const [za, zb] of piers) box(stone, null, -xs, xs, zb, za, RIVER.bed, yD - 42, TEX.bridgeStone, 64, 64);
  // round arches springing from the path and from the water: the stone between
  // the arch curve and the deck is real geometry (so its true shape is checked)
  const yTop = yD - 42;
  for (const [za, zb, ySpring] of [[zA - 45, -1285, PATH_Y], [-1365, zB + 55, RIVER.water]]) {
    const span = za - zb, zc = (za + zb) / 2, rad = span / 2, N = 16;
    const yArc = (z) => Math.min(yTop - 4, ySpring + Math.sqrt(Math.max(0, rad * rad - (z - zc) ** 2)));
    for (const s of [-1, 1]) for (let k = 0; k < N; k++) {
      const z0 = lerp(za, zb, k / N), z1 = lerp(za, zb, (k + 1) / N), x = s * xs;
      const ya = yArc(z0), yb = yArc(z1);
      const [p, q, pa, pb] = s > 0 ? [z0, z1, ya, yb] : [z1, z0, yb, ya];
      const u = (z) => TC(((za - z) / 64) * 32), v = (y) => TC(((yTop - y) / 64) * 32);
      quad(stone, V(x, pa, p, u(p), v(pa)), V(x, pb, q, u(q), v(pb)), V(x, yTop, q, u(q), 0), V(x, yTop, p, u(p), 0), [s, 0, 0]);
      // the arch's soffit (the underside of the voussoirs), 40 deep
      quad(stone, V(x, pa, p, 0, 0), V(x - s * 40, pa, p, TC(16), 0), V(x - s * 40, pb, q, TC(16), TC(16)), V(x, pb, q, 0, TC(16)), [0, -1, 0]);
    }
  }
  addFoot(-xs, xs, zB, zA);
}

// University College: sandstone wings, crenellated parapets, and the Middlesex
// Memorial Tower with the road running through the arch at its foot
{
  const yb = HILLTOP - 5, yw = yb + 300, yt = yb + 560;
  const g = decor('gothic', 'uc_walls'), sst = decor('sandstone', 'uc_stone'), lime = decor('limestone', 'uc_trim');
  const roof = decor('slate', 'uc_roof');
  for (const [x0, x1] of [[-UC.wing, -UC.tw], [UC.tw, UC.wing]]) {
    box(g, null, x0, x1, UC.zWB, UC.zWF, yb, yw, TEX.gothic, 110, 150, null, { vAnchor: yb, maxH: 150 });
    box(lime, null, x0 - 2, x1 + 2, UC.zWB - 2, UC.zWF + 2, yb + 140, yb + 152, TEX.limestone, 64, 64);
    floorRect(roof, x0, x1, UC.zWB, UC.zWF, yw, TEX.slate, 100, 400);
    parapet(sst, x0, x1, UC.zWB, UC.zWF, yw, TEX.sandstone);
    addFoot(x0, x1, UC.zWB, UC.zWF);
  }
  // tower: faces built around the archway (x in [-185, 185], y up to yb+250)
  const T = UC.tw, ao = 185, ah = yb + 250;
  const faces = [[[-T, UC.zF], [T, UC.zF], 1], [[T, UC.zB], [-T, UC.zB], -1]];
  for (const [p0, p1, s] of faces) {
    const lft = s > 0 ? [[-T, UC.zF], [-ao, UC.zF]] : [[T, UC.zB], [ao, UC.zB]];
    const rgt = s > 0 ? [[ao, UC.zF], [T, UC.zF]] : [[-ao, UC.zB], [-T, UC.zB]];
    wallRect(sst, ...lft, yb, ah, TEX.sandstone, 64, 64);
    wallRect(sst, ...rgt, yb, ah, TEX.sandstone, 64, 64);
    wallRect(sst, p0, p1, ah, yb + 420, TEX.sandstone, 64, 64);
    wallRect(decor('belfry', 'uc_belfry'), p0, p1, yb + 420, yb + 520, TEX.belfry, 92, 100, { vAnchor: yb + 420 });
    wallRect(sst, p0, p1, yb + 520, yt, TEX.sandstone, 64, 64);
    // the pointed arch head inside the opening, and the name over it
    const zf = p0[1] + s * 1.5;
    panel(section('uc_arch_head', TEX.archHead, SURF.CEMENT, CLIP.NONE), [0, zf], [0, s], 2 * ao, 100, ah - 100, TEX.archHead);
    panel(decor('signUC', 'uc_sign'), [0, zf], [0, s], 220, 90, ah + 30, TEX.signUC);
  }
  // tower sides above the wings, and the full-height sides where they show
  for (const [x, s] of [[-T, -1], [T, 1]]) {
    const [a, b] = s < 0 ? [[x, UC.zB], [x, UC.zF]] : [[x, UC.zF], [x, UC.zB]];
    wallRect(sst, a, b, yw, yb + 420, TEX.sandstone, 64, 64);
    wallRect(decor('belfry', 'uc_belfry'), a, b, yb + 420, yb + 520, TEX.belfry, 100, 100, { vAnchor: yb + 420 });
    wallRect(sst, a, b, yb + 520, yt, TEX.sandstone, 64, 64);
    const front = s < 0 ? [[x, UC.zWF], [x, UC.zF]] : [[x, UC.zF], [x, UC.zWF]];
    const back = s < 0 ? [[x, UC.zB], [x, UC.zWB]] : [[x, UC.zWB], [x, UC.zB]];
    wallRect(sst, ...front, yb, yw, TEX.sandstone, 64, 64);
    wallRect(sst, ...back, yb, yw, TEX.sandstone, 64, 64);
  }
  floorRect(decor('limestone', 'uc_tower_roof'), -T, T, UC.zB, UC.zF, yt, TEX.limestone, 100, 400);
  parapet(sst, -T, T, UC.zB, UC.zF, yt, TEX.sandstone);
  for (const [x, z] of [[-T, UC.zF], [T, UC.zF], [T, UC.zB], [-T, UC.zB]]) {
    box(sst, null, x - 22, x + 22, z - 22, z + 22, yt, yt + 120, TEX.sandstone, 64, 64);
    pyramid(sst, x - 22, x + 22, z - 22, z + 22, yt + 120, yt + 190, TEX.sandstone);
  }
  // flagpole and a purple flag
  const zc = (UC.zF + UC.zB) / 2;
  box(decor('limestone', 'flagpole'), null, -3, 3, zc - 3, zc + 3, yt, yt + 230, TEX.limestone, 16, 64);
  panel(decor('signWestern', 'uc_flag'), [45, zc], [0, 1], 84, 46, yt + 175, TEX.signWestern);
  panel(decor('signWestern', 'uc_flag'), [45, zc], [0, -1], 84, 46, yt + 175, TEX.signWestern);
  addFoot(-T, T, UC.zB, UC.zF);
}

// Concrete Beach: the UCC on its far side, sign and banners
{
  const zN = mark.plazaZ - 250 - 300;
  const m = decor('modern', 'ucc');
  box(m, null, -200, 1700, zN - 300, zN, HILLTOP - 5, HILLTOP + 220, TEX.modern, 120, 110, null, { vAnchor: HILLTOP - 5, maxH: 110 });
  floorRect(decor('concrete', 'ucc_roof'), -200, 1700, zN - 300, zN, HILLTOP + 220, TEX.concrete, 100, 400);
  sign(decor('signUCC', 'ucc_sign'), [750, zN + 2], [0, 1], 160, 80, HILLTOP + 130, TEX.signUCC);
  addFoot(-200, 1700, zN - 300, zN);
  const sb = decor('signBeach', 'beach_sign');
  sign(sb, [420, mark.plazaZ + 265], [0, -1], 150, 75, HILLTOP + 50, TEX.signBeach);
}
// Weldon Library: brutalist block with a heavy cantilevered top
{
  const c = decor('brutal', 'weldon');
  box(c, null, -1750, -750, -4850, -4000, HILLTOP - 5, HILLTOP + 90, TEX.concrete, 64, 64);
  box(c, decor('concrete', 'weldon_roof'), -1850, -650, -4950, -3900, HILLTOP + 90, HILLTOP + 360, TEX.brutal, 140, 90, TEX.concrete, { vAnchor: HILLTOP + 90, maxH: 90 });
  floorRect(decor('concrete', 'weldon_soffit'), -1850, -650, -4950, -3900, HILLTOP + 90, TEX.concrete, 100, 400);
  sign(decor('signWeldon', 'weldon_sign'), [-648, -4400], [1, 0], 200, 100, HILLTOP + 240, TEX.signWeldon);
  addFoot(-1850, -650, -4950, -3900);
}
// Physics & Astronomy (1924): another collegiate-gothic block
{
  const yb = HILLTOP - 5, top = yb + 240;
  box(decor('gothic', 'physics'), null, 1150, 1850, -4150, -3700, yb, top, TEX.gothic, 110, 120, null, { vAnchor: yb, maxH: 120 });
  floorRect(decor('slate', 'physics_roof'), 1150, 1850, -4150, -3700, top, TEX.slate, 100, 400);
  parapet(decor('sandstone', 'physics_parapet'), 1150, 1850, -4150, -3700, top, TEX.sandstone);
  addFoot(1150, 1850, -4150, -3700);
}
// Middlesex College and its clock tower with the green copper spire
{
  const yb = HILLTOP - 5, top = yb + 260, X0 = mark.mcX + 260;
  box(decor('gothic', 'mc_walls'), null, X0, X0 + 700, -4420, -3620, yb, top, TEX.gothic, 110, 130, null, { vAnchor: yb, maxH: 130 });
  floorRect(decor('slate', 'mc_roof'), X0, X0 + 700, -4420, -3620, top, TEX.slate, 100, 400);
  parapet(decor('sandstone', 'mc_parapet'), X0, X0 + 700, -4420, -3620, top, TEX.sandstone);
  const tx0 = X0 - 20, tx1 = X0 + 200, tz0 = -4140, tz1 = -3920, tt = yb + 640;
  const st = decor('sandstone', 'mc_tower');
  box(st, null, tx0, tx1, tz0, tz1, yb, yb + 420, TEX.sandstone, 64, 64);
  box(decor('belfry', 'mc_belfry'), null, tx0, tx1, tz0, tz1, yb + 420, yb + 500, TEX.belfry, 110, 80, null, { vAnchor: yb + 420 });
  box(st, null, tx0, tx1, tz0, tz1, yb + 500, tt, TEX.sandstone, 64, 64);
  const ck = decor('clock', 'mc_clock');
  const cx = (tx0 + tx1) / 2, cz = (tz0 + tz1) / 2;
  panel(ck, [tx0 - 1.5, cz], [-1, 0], 120, 120, yb + 510, TEX.clock);
  panel(ck, [tx1 + 1.5, cz], [1, 0], 120, 120, yb + 510, TEX.clock);
  panel(ck, [cx, tz0 - 1.5], [0, -1], 120, 120, yb + 510, TEX.clock);
  panel(ck, [cx, tz1 + 1.5], [0, 1], 120, 120, yb + 510, TEX.clock);
  pyramid(decor('copper', 'mc_spire'), tx0 - 8, tx1 + 8, tz0 - 8, tz1 + 8, tt, tt + 330, TEX.copper);
  sign(decor('signMC', 'mc_sign'), [tx0 - 1.5, tz1 + 140], [-1, 0], 200, 100, yb + 120, TEX.signMC);
  addFoot(tx0, X0 + 700, -4420, -3620);
}
// Medway-Sydenham Hall on the east bank, above the river path
{
  const yb = PLATEAU_E - 8, top = yb + 230;
  box(decor('residence', 'medway'), null, 600, 1800, -560, -260, yb, top, TEX.residence, 70, 76, null, { vAnchor: yb, maxH: 76 });
  gable(decor('slate', 'medway_roof'), decor('residence', 'medway_gables'), 600, 1800, -560, -260, top, 110, TEX.slate, TEX.residence);
  addFoot(600, 1800, -560, -260);
}
// street signs and purple light-pole banners
{
  const post = decor('limestone', 'posts');
  const signAt = (s, side, key, name, h = 90) => {
    const f = frame(s), w = f.w + 60;
    const c = [f.x + side * f.nx * w, f.z + side * f.nz * w];
    const y = terrainY(...c);
    sign(decor(key, name), c, [-f.tx, -f.tz], 160, 80, Math.max(y, f.y) + h - 40, TEX[key]);
    box(post, null, c[0] - 4, c[0] + 4, c[1] - 4, c[1] + 4, y - 5, Math.max(y, f.y) + h - 40, TEX.limestone, 16, 64);
  };
  signAt(260, -1, 'signUDr', 'sign_udr');
  signAt(mark.hill0 + 300, 1, 'signUC', 'sign_uc_hill');
  signAt(mark.path0 + 120, -1, 'signTVP', 'sign_tvp');
  signAt(mark.rich0 + 200, -1, 'signRichmond', 'sign_richmond');
  signAt(mark.rich0 + 700, 1, 'signMustangs', 'sign_mustangs');
  const bannerSec = decor('banner', 'banners');
  const bannerRun = (s0, s1, step) => {
    for (let s = s0; s < s1; s += step) for (const side of [-1, 1]) {
      const f = frame(s), w = f.w + 50, c = [f.x + side * f.nx * w, f.z + side * f.nz * w], y = terrainY(...c);
      box(post, null, c[0] - 4, c[0] + 4, c[1] - 4, c[1] + 4, y - 5, f.y + 260, TEX.limestone, 16, 64);
      panel(bannerSec, [c[0] - side * f.nx * 4, c[1] - side * f.nz * 4], [-side * f.nx, -side * f.nz], 50, 100, f.y + 150, TEX.banner);
    }
  };
  bannerRun(500, mark.bridge0 - 50, 300);
  bannerRun(mark.hill0 + 150, mark.hill1 - 100, 280);
  bannerRun(mark.rich0 + 150, mark.rich1, 320);
  bannerRun(L - 1000, L - 450, 280);
}

/* ------------------------------------------------------------ path, actors */

const pathPts = [], pathS = [];
for (let s = 0; s < L - PATH_SPACING / 2; s += PATH_SPACING) {
  const f = M.pose(s);
  pathPts.push({ x: Math.round(f.x), y: Math.round(f.y), z: Math.round(f.z) }); pathS.push(s);
}
pathPts[0] = { x: 0, y: 0, z: 0 };

const actors = [];
const ITEM_GAP = 34, ROW_GAP = 40;
function itemCluster(s, n) {
  for (let row = 0; row < 2; row++) {
    const f = frame(s + row * ROW_GAP), m = n - row;
    for (let k = 0; k < m; k++) {
      const lat = (k - (m - 1) / 2) * ITEM_GAP;
      actors.push({ Name: 'mk:item_box', Location: { x: Math.round(f.x + f.nx * lat), y: Math.round(f.y + 5), z: Math.round(f.z + f.nz * lat) } });
    }
  }
}
itemCluster(560, 7); // University Drive, just past the gates
itemCluster((mark.hill0 + mark.hill1) / 2, 7); // UC Hill
itemCluster((mark.plaza0 + mark.plaza1) / 2, 9); // Concrete Beach
itemCluster(mark.woods0 + 1300, 6); // the woods
itemCluster(mark.path0 + 900, 5); // riverside path
itemCluster(mark.path1 - 700, 5); // riverside path, past the bridge
itemCluster(mark.climbEnd - 700, 7); // Sydenham Hill
itemCluster((mark.rich0 + mark.rich1) / 2, 7); // Richmond Street

// trees: dense in the woods and along the river banks, scattered elsewhere
{
  let seed = 1878;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const placed = [];
  const okAt = (x, z, minGap) => {
    if (x < GX0 + 150 || x > GX1 - 150 || z < GZ0 + 150 || z > GZ1 - 150) return false;
    if (z < RIVER.zE + 70 && z > RIVER.zW - 70) return false;
    if (BUILDINGS.some((b) => x > b.x0 - 90 && x < b.x1 + 90 && z > b.z0 - 90 && z < b.z1 + 90)) return false;
    if (laneClearance(x, z) < 130) return false;
    if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < minGap)) return false;
    return true;
  };
  const tryPlace = (n, x0, x1, z0, z1, gap) => {
    let got = 0;
    for (let k = 0; k < n * 25 && got < n; k++) {
      const x = lerp(x0, x1, rnd()), z = lerp(z0, z1, rnd());
      if (okAt(x, z, gap)) { placed.push({ x, z }); got++; }
    }
  };
  tryPlace(70, mark.mcX - 700, mark.mcX + 900, -3900, -1850, 120); // the woods
  tryPlace(26, GX0, GX1, RIVER.zE + 70, RIVER.zE + 400, 220); // east bank
  tryPlace(20, GX0, GX1, RIVER.zW - 450, RIVER.zW - 70, 220); // west bank
  tryPlace(70, GX0, GX1, GZ0, GZ1, 330); // everywhere else
  placed.forEach((p, i) => actors.push({ Name: i % 3 === 0 ? 'mk:tree_royal_raceway' : 'mk:tree_mario_raceway', Location: { x: Math.round(p.x), y: Math.round(terrainY(p.x, p.z)), z: Math.round(p.z) } }));
}

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
    Name: 'Western',
    DebugName: 'western',
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
    FarPersp: 9000.0,
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
  frames: frames.map((f) => ({ s: f.s, x: f.x, y: f.y, z: f.z, w: f.w, nx: f.nx, nz: f.nz, kind: tagAt(Math.min(f.s, L - 1)).kind, ceil: tagAt(Math.min(f.s, L - 1)).ceil ?? null })),
  actors,
  marks: { L, ...mark, RIVER, G_MAX, BUILDINGS },
  minimap: MM,
}));

const triCount = secList.reduce((a, s) => a + s.tris.length, 0);
const collTris = secList.filter((s) => s.clip !== 0).reduce((a, s) => a + s.tris.length, 0);
console.log(`Western: lap ${Math.round(L)} units, ${pathPts.length} waypoints, ${triCount} triangles (${collTris} with collision), ${secList.length} sections`);
console.log(`  woods grade ${(mark.woodsGrade * 100).toFixed(1)}%, terrain ${NX}x${NZ} cells; actors ${actors.length} (${actors.filter((a) => a.Name === 'mk:item_box').length} item boxes)`);
console.log(`  textures packed: ${[...usedTex].filter((p) => p.startsWith(DIR)).length}; minimap ${MM.w}x${MM.h} scale ${MM.scale} @(${MM.playerX},${MM.playerY})`);
