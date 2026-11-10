#!/usr/bin/env node
/**
 * "Downtown Toronto" — a SpaghettiKart street circuit through downtown Toronto.
 * A stylised tribute: the landmarks are real, their sizes and spacing are
 * squeezed into a race lap (the CN Tower stands 5300 units, about 1:10 of its
 * real 553 m against a street 340 wide).
 *
 * Map axes: game -Z is real-world west, +X is real-world north.
 *
 * Lap (the race starts on Front Street outside Union Station, heading west):
 *   1. Front Street past Union Station's colonnade and the Fairmont Royal York.
 *   2. Left down John Street and over the rail lands on the John Street bridge
 *      (GO trains in the cut below).
 *   3. In through a gate under the stands of the Rogers Centre: round the
 *      outfield warning track under the half-open dome, out the far side.
 *   4. Along the base of the CN Tower and round its foot, past Ripley's
 *      Aquarium, under the Gardiner Expressway.
 *   5. East along Queens Quay on the waterfront: the Power Plant, Harbourfront
 *      Centre, the WaveDeck boardwalk, Queens Quay Terminal and its clock,
 *      Sugar Beach's pink umbrellas, the Island ferry out on the lake.
 *   6. North up Bay Street under the Gardiner, past Scotiabank Arena, down
 *      through the underpass beneath the Union Station rail viaduct, and back
 *      onto Front Street at the Royal Bank Plaza's gold towers.
 * Street-circuit concrete barriers line every street (railings on the
 * waterfront, padded walls in the ballpark), so the only way round is the lap.
 *
 * Usage: node make-toronto.mjs [outDir]
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { makeTextures, texResource, toPNG } from './textures.mjs';

const TRACK = 'toronto';
const MOD = 'downtown-toronto';
const RES = 'chris:toronto';
const DIR = `tracks/${TRACK}`;
const OUT = process.argv[2] ?? '.';

const PAINTED = makeTextures();
const TEX = {};
for (const [k, im] of Object.entries(PAINTED)) TEX[k] = { path: `${DIR}/tex_${k}`, w: im.w, h: im.h, custom: true, cutout: !!im.cutout };
TEX.grass = { path: 'textures/other_textures/grass_3', w: 32, h: 32 };

const SURF = { ASPHALT: 1, DIRT: 2, CEMENT: 4, GRASS: 8, WOOD: 17, OOB: 0xfd };
const CLIP = { NONE: 0, DEFAULT: 1, WALL: 4 };
const LAYER = { INVISIBLE: 0, OPAQUE: 1 };

const G_MAX = 0.14;
const SAMPLE = 18;
const PATH_SPACING = 25;
const GROUND = -2;

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


/** a straight piece with gentle sine humps (the WaveDeck) */
Path.prototype.waves = function (len, amp, waveLen, tag) {
  const { x, z, psi, y } = this.cur, dx = Math.cos(psi), dz = Math.sin(psi), n = Math.round(len / waveLen);
  return this.push(len, (u) => ({ x: x + dx * u, z: z + dz * u, tx: dx, tz: dz }), (u) => y + (amp / 2) * (1 - Math.cos((2 * Math.PI * n * u) / len)), tag);
};

/* ------------------------------------------------------------ route tags */

const BARRIER = { tex: 'barrier', h: 44, off: 10, top: true };
const RAIL = { tex: 'railing', h: 50, off: 4 };
const STREET = (o = {}) => ({ kind: 'street', hw: 170, floor: 'road', surf: SURF.ASPHALT, walls: [BARRIER, BARRIER], ...o });
const BRIDGE = (o = {}) => ({ ...STREET(o), kind: 'bridge', ...o });
const UNDERPASS = (o = {}) => ({ ...STREET(o), kind: 'underpass', walls: [{ ...BARRIER, retain: true }, { ...BARRIER, retain: true }], ...o });
const GATE = (o = {}) => ({ kind: 'gate', hw: 170, floor: 'dirt', surf: SURF.DIRT, walls: [{ tex: 'stadium', h: 230, off: 20 }, { tex: 'stadium', h: 230, off: 20 }], ceil: 230, ...o });
const WARNING = (o = {}) => ({ kind: 'warning', hw: 170, floor: 'dirt', surf: SURF.DIRT, walls: [{ tex: 'padding', h: 36, off: 6, inner: true }, { tex: 'padding', h: 90, off: 6, outer: true }], ...o });
const QUAY = (o = {}) => ({ kind: 'quay', hw: 170, floor: 'road', surf: SURF.ASPHALT, walls: [BARRIER, RAIL], ...o });
const WAVEDECK = (o = {}) => ({ kind: 'wavedeck', hw: 170, floor: 'deck', surf: SURF.WOOD, walls: [{ tex: 'railing', h: 50, off: 4 }, RAIL], ...o });

/* --------------------------------------------------------------- the lap */

const M = new Path(0, 0, -Q, 0);
const mark = {};
const DIP = -95, BRIDGE_Y = 100;
const RAILS = { x0: -1850, x1: -1350, trench: -100, viaduct: 130, deckUnder: 110 };
// 1. Front Street, west past Union Station and the Royal York
M.line(2400, 0, STREET({ name: 'Front Street' }));
M.arc(400, -Q, 0, STREET());
// 2. John Street, up and over the rail lands
mark.john0 = M.len;
{
  const L = BRIDGE_Y / G_MAX - 150;
  M.gline(150, 0, G_MAX, STREET({ name: 'John Street' })); M.gline(L, G_MAX, G_MAX, STREET()); M.gline(150, G_MAX, 0, STREET());
  mark.bridge0 = M.len;
  M.line(M.cur.x - (RAILS.x0 - 150), BRIDGE_Y, BRIDGE({ name: 'John Street Bridge' }));
  mark.bridge1 = M.len;
  M.gline(150, 0, -G_MAX, STREET()); M.gline(L, -G_MAX, -G_MAX, STREET()); M.gline(150, -G_MAX, 0, STREET());
}
M.arc(300, Q, 0, STREET());
// 3. through the gate under the stands and round the Rogers Centre's outfield warning track
const PARK = { R: 900 };
mark.gate0 = M.len;
M.line(700, 0, GATE({ name: 'Rogers Centre' }));
PARK.cx = M.cur.x - PARK.R; PARK.cz = M.cur.z;
mark.warn0 = M.len;
M.arc(PARK.R, -Math.PI, 0, WARNING({ name: 'Warning Track' }));
mark.warn1 = M.len;
M.line(1250, 0, GATE());
mark.gate1 = M.len;
// 4. along to the CN Tower and round its foot
const TOWER = { r: 500 };
M.line(-1300 - M.cur.z, 0, STREET({ name: 'Bremner Boulevard' }));
mark.cn0 = M.len;
TOWER.cx = M.cur.x - TOWER.r; TOWER.cz = M.cur.z;
M.arc(TOWER.r, Q, 0, STREET({ name: 'CN Tower' }));
mark.cn1 = M.len;
// south past Ripley's, under the Gardiner, down to the lake
const GARDINER = { x: -6050, hw: 200, y: 330 };
M.line(M.cur.x - -6500, 0, STREET({ name: 'Lower Simcoe' }));
M.arc(400, -Q, 0, QUAY());
// 5. Queens Quay along the waterfront, with the WaveDeck in the middle
const QQ_X = M.cur.x;
mark.qq0 = M.len;
M.line(900, 0, QUAY({ name: 'Queens Quay' }));
mark.wave0 = M.len;
M.waves(1200, 14, 400, WAVEDECK({ name: 'WaveDeck' }));
mark.wave1 = M.len;
M.line(2300 - M.cur.z, 0, QUAY());
mark.qq1 = M.len;
M.arc(400, -Q, 0, STREET());
// 6. Bay Street: under the Gardiner, past the arena, down under the rail viaduct
const BAY_Z = M.cur.z;
mark.bay0 = M.len;
{
  const L = -DIP / G_MAX - 150, down0 = RAILS.x0 - 100 - (150 + L + 150);
  M.line(down0 - M.cur.x, 0, STREET({ name: 'Bay Street' }));
  mark.dip0 = M.len;
  M.gline(150, 0, -G_MAX, UNDERPASS()); M.gline(L, -G_MAX, -G_MAX, UNDERPASS()); M.gline(150, -G_MAX, 0, UNDERPASS());
  M.line(RAILS.x1 + 100 - M.cur.x, DIP, UNDERPASS({ name: 'Bay Street Underpass' }));
  M.gline(150, 0, G_MAX, UNDERPASS()); M.gline(L, G_MAX, G_MAX, UNDERPASS()); M.gline(150, G_MAX, 0, UNDERPASS());
  mark.dip1 = M.len;
  if (M.cur.x > -400) throw new Error(`Bay Street underpass runs into Front Street (${M.cur.x.toFixed(0)})`);
  M.line(-400 - M.cur.x, 0, STREET());
}
M.arc(400, -Q, 0, STREET());
mark.front1 = M.len;
M.line(M.cur.z, 0, STREET({ name: 'Front Street' }));
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

/* ------------------------------------------------------------ more helpers */

const deco = (key, name = key) => section(`deco_${name}`, TEX[key], SURF.CEMENT, CLIP.NONE);
/** vertical-sided prism over a polygon (any winding), faces outward, optional flat top */
function prism(sec, top, pts, y0, y1, tex, uPer, vPer, opts = {}) {
  let area = 0;
  for (let k = 0; k < pts.length; k++) { const [ax, az] = pts[k], [bx, bz] = pts[(k + 1) % pts.length]; area += ax * bz - bx * az; }
  const ring = area < 0 ? pts : [...pts].reverse(); // clockwise in (x, z): right-hand normals point out
  for (let k = 0; k < ring.length; k++) wallRect(sec, ring[k], ring[(k + 1) % ring.length], y0, y1, tex, uPer, vPer, opts);
  if (top) {
    const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cz = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    for (let k = 0; k < pts.length; k++) {
      const a = pts[k], b = pts[(k + 1) % pts.length];
      const A = V(a[0], y1, a[1], TC((a[0] / 100) * 8), TC((a[1] / 100) * 8)), B = V(b[0], y1, b[1], TC((b[0] / 100) * 8), TC((b[1] / 100) * 8)), Cc = V(cx, y1, cz, TC((cx / 100) * 8), TC((cz / 100) * 8));
      for (const vv of [A, B, Cc]) { vv.s = ((vv.s % 4096) + 4096) % 4096; vv.t = ((vv.t % 4096) + 4096) % 4096; }
      top.tris.push([A, B, Cc].map((v) => ({ ...v, n: [0, 1, 0] })));
    }
  }
}
/** n-sided frustum (cylinder / cone) */
function frustum(sec, cx, cz, r0, r1, y0, y1, n, tex, uRep = 1, vRep = 1, rot = 0) {
  for (let k = 0; k < n; k++) {
    const a0 = rot - (2 * Math.PI * k) / n, a1 = rot - (2 * Math.PI * (k + 1)) / n; // decreasing angle: outside on the right
    const P = (r, a, y) => [cx + r * Math.cos(a), y, cz + r * Math.sin(a)];
    const s0 = TC((k / n) * uRep * tex.w), s1 = TC(((k + 1) / n) * uRep * tex.w);
    const [ax, ay, az] = P(r0, a0, y0), [bx, by, bz] = P(r0, a1, y0), [cx2, cy, cz2] = P(r1, a1, y1), [dx, dy, dz] = P(r1, a0, y1);
    const am = (a0 + a1) / 2, slope = (r0 - r1) / Math.max(1, y1 - y0);
    const nn = normalize([Math.cos(am), slope + 0.3, Math.sin(am)]);
    quad(sec, V(ax, ay, az, s0, TC(vRep * tex.h)), V(bx, by, bz, s1, TC(vRep * tex.h)), V(cx2, cy, cz2, s1, 0), V(dx, dy, dz, s0, 0), nn);
  }
}
/** flat disc / annulus facing up */
function disc(sec, cx, cz, r0, r1, y, n, tex, unit, a0 = 0, a1 = 2 * Math.PI) {
  for (let k = 0; k < n; k++) {
    const aa = a0 + ((a1 - a0) * k) / n, ab = a0 + ((a1 - a0) * (k + 1)) / n;
    const P = (r, a) => [cx + r * Math.cos(a), cz + r * Math.sin(a)];
    const mk = ([x, z]) => V(x, y, z, TC((((x - cx) / unit) % 64) * tex.w), TC((((z - cz) / unit) % 64) * tex.h), [0, 1, 0]);
    const A = mk(P(r0, aa)), B = mk(P(r1, aa)), Cc = mk(P(r1, ab)), D = mk(P(r0, ab));
    if (r0 < 1) sec.tris.push([B, D, Cc]); else quad(sec, A, D, Cc, B, [0, 1, 0]);
  }
}
const FEET = []; // footprints (x0, x1, z0, z1) that skyline filler and trees keep out of
const foot = (x0, x1, z0, z1) => FEET.push({ x0: Math.min(x0, x1), x1: Math.max(x0, x1), z0: Math.min(z0, z1), z1: Math.max(z0, z1) });
const inTrench = (x, z) => x > RAILS.x0 && x < RAILS.x1 && z < -1400;

/* ------------------------------------------------- route floors, walls, ceilings */

const FLOOR_U = { road: 160, dirt: 140, deck: 100 };
const floorSec = (key, surf) => section(`floor_${key}`, TEX[key], surf, CLIP.DEFAULT);
const WALL_U = { barrier: 70, railing: 60, stadium: 240, padding: 260, padding375: 260, padding328: 260 };
const wallSec = (key) => section(`wall_${key}`, TEX[key], SURF.CEMENT, CLIP.WALL);
const topSec = section('barrier_tops', TEX.gardiner, SURF.CEMENT, CLIP.NONE);
const skirtSec = section('road_skirts', TEX.gardiner, SURF.CEMENT, CLIP.NONE);
const gateCeil = section('gate_ceiling', TEX.gardiner, SURF.CEMENT, CLIP.NONE);
for (let i = 0; i + 1 < frames.length; i++) {
  const f0 = frames[i], f1 = frames[i + 1];
  const t = tagAt((f0.s + f1.s) / 2);
  let key = t.floor;
  if (f0.s < 30 || f0.s >= L - 30) key = 'finish';
  const sec = key === 'finish' ? floorSec('finish', SURF.ASPHALT) : floorSec(key, t.surf), tex = TEX[key];
  let t0, t1;
  if (key === 'finish') {
    const wrap = (s) => (s > L / 2 ? s - L : s) + 30;
    t0 = TC((wrap(f0.s) / 60) * tex.h); t1 = TC(((f1.s >= L - 1e-6 ? 30 : wrap(f1.s)) / 60) * tex.h);
  } else {
    const u = FLOOR_U[key], base = Math.floor(f0.s / u) * u;
    t0 = TC(((f0.s - base) / u) * tex.h); t1 = TC(((f1.s - base) / u) * tex.h);
  }
  const across = key === 'dirt' ? 3 : key === 'deck' ? 4 : 1;
  for (let k = 0; k < 2; k++) {
    const la = lerp(-1, 1, k / 2), lb = lerp(-1, 1, (k + 1) / 2);
    const P = (f, l) => [f.x + f.nx * f.w * l, f.z + f.nz * f.w * l];
    const sAt = (l) => TC(((l + 1) / 2) * across * tex.w);
    const [ax, az] = P(f0, la), [bx, bz] = P(f0, lb), [cx, cz] = P(f1, lb), [dx, dz] = P(f1, la);
    quad(sec, V(ax, f0.y, az, sAt(la), t0), V(bx, f0.y, bz, sAt(lb), t0), V(cx, f1.y, cz, sAt(lb), t1), V(dx, f1.y, dz, sAt(la), t1), [0, 1, 0]);
  }
  t.walls.forEach((w, idx) => {
    const side = idx === 0 ? -1 : 1;
    const E = (f, extra = 0) => [f.x + side * f.nx * (f.w + w.off + extra), f.z + side * f.nz * (f.w + w.off + extra)];
    const e0 = E(f0), e1 = E(f1);
    let texKey = w.tex;
    if (w.outer) { const ang = Math.abs(((f0.s - mark.warn0) / (mark.warn1 - mark.warn0)) - 0.5); texKey = ang < 0.12 ? 'padding' : ang < 0.32 ? 'padding375' : 'padding328'; }
    const wt = TEX[texKey], uPer = WALL_U[texKey], base = Math.floor(f0.s / uPer) * uPer;
    // on the right-hand wall the driver reads it facing back along the lap, so run the texture the other way
    const su = (s) => (side > 0 ? 1 - (s - base) / uPer : (s - base) / uPer);
    const sA = TC(su(f0.s) * wt.w), sB = TC(su(f1.s) * wt.w);
    const top = (f) => (w.retain ? Math.max(f.y + w.h, 30) : f.y + w.h);
    const vt = (f) => (w.retain ? TC(wt.h * Math.min(4, (top(f) - f.y) / w.h)) : TC(wt.h));
    quad(wallSec(texKey), V(e0[0], f0.y, e0[1], sA, vt(f0)), V(e1[0], f1.y, e1[1], sB, vt(f1)), V(e1[0], top(f1), e1[1], sB, 0), V(e0[0], top(f0), e0[1], sA, 0), normalize([-side * f0.nx, 0.7, -side * f0.nz]));
    if (w.top) {
      const o0 = E(f0, 14), o1 = E(f1, 14);
      quad(topSec, ...[e0, o0, o1, e1].map((p, j) => V(p[0], j < 2 ? top(f0) : top(f1), p[1], TC(j === 1 || j === 2 ? 4 : 0), TC(j >= 2 ? 4 : 0))), [0, 1, 0]);
      // skirts: the outside face of the barrier down to the ground (bridges, ramps)
      const low = (f, p) => (inTrench(p[0], p[1]) ? RAILS.trench : GROUND);
      if (!w.retain && (f0.y > 6 || f1.y > 6)) quad(skirtSec, V(o1[0], low(f1, o1), o1[1], 0, TC(32)), V(o0[0], low(f0, o0), o0[1], TC(32), TC(32)), V(o0[0], top(f0), o0[1], TC(32), 0), V(o1[0], top(f1), o1[1], 0, 0));
    }
  });
  if (t.ceil) {
    const w0 = f0.w + 20, w1 = f1.w + 20;
    quad(gateCeil, V(f0.x - f0.nx * w0, f0.y + t.ceil, f0.z - f0.nz * w0, 0, 0), V(f0.x + f0.nx * w0, f0.y + t.ceil, f0.z + f0.nz * w0, TC(96), 0),
      V(f1.x + f1.nx * w1, f1.y + t.ceil, f1.z + f1.nz * w1, TC(96), TC(8)), V(f1.x - f1.nx * w1, f1.y + t.ceil, f1.z - f1.nz * w1, 0, TC(8)), [0, -1, 0]);
  }
  // underside of the John Street bridge deck over the rail cut
  if (t.kind === 'bridge' || (f0.y > 40 && t.kind === 'street')) {
    const W = (f, s) => [f.x + s * f.nx * (f.w + 24), f.z + s * f.nz * (f.w + 24)];
    const [p, q, r2, s2] = [W(f0, -1), W(f0, 1), W(f1, 1), W(f1, -1)];
    quad(skirtSec, V(p[0], f0.y - 15, p[1], 0, 0), V(s2[0], f1.y - 15, s2[1], 0, TC(8)), V(r2[0], f1.y - 15, r2[1], TC(32), TC(8)), V(q[0], f0.y - 15, q[1], TC(32), 0), [0, -1, 0]);
  }
}

/* ------------------------------------------------------------ ground, lake, rails */

const SHORE = -7300;
const WORLD = { x0: SHORE, x1: 5600, z0: -7600, z1: 7200 };
const DIPCUT = { x0: RAILS.x0 - 100 - (-DIP / G_MAX) - 150 + 140, x1: -421, z0: BAY_Z - 194, z1: BAY_Z + 194 };
{
  // ground: the world rectangle minus the rail cut and the Bay Street dip
  const cuts = [{ x0: RAILS.x0, x1: RAILS.x1, z0: WORLD.z0, z1: -1400 }, DIPCUT];
  let rects = [{ ...WORLD }];
  for (const c of cuts) rects = rects.flatMap((r) => {
    if (c.x1 <= r.x0 || c.x0 >= r.x1 || c.z1 <= r.z0 || c.z0 >= r.z1) return [r];
    const out = [];
    if (c.x0 > r.x0) out.push({ ...r, x1: c.x0 });
    if (c.x1 < r.x1) out.push({ ...r, x0: c.x1 });
    const mx0 = Math.max(r.x0, c.x0), mx1 = Math.min(r.x1, c.x1);
    if (c.z0 > r.z0) out.push({ x0: mx0, x1: mx1, z0: r.z0, z1: c.z0 });
    if (c.z1 < r.z1) out.push({ x0: mx0, x1: mx1, z0: c.z1, z1: r.z1 });
    return out;
  });
  const g = section('ground', TEX.sidewalk, SURF.CEMENT, CLIP.NONE);
  for (const r of rects) floorRect(g, r.x0, r.x1, r.z0, r.z1, GROUND, TEX.sidewalk, 120, 600);
  // the lake (out of bounds) and the dock wall along the shore
  floorRect(section('lake', TEX.water, SURF.OOB, CLIP.DEFAULT), -13000, SHORE, -14000, 14000, -40, TEX.water, 200, 1500);
  wallRect(deco('gardiner', 'dock_wall'), [SHORE, WORLD.z0], [SHORE, WORLD.z1], -40, GROUND, TEX.gardiner, 120, 60);
  // the rail cut: ballast floor and concrete walls
  const bal = deco('ballast', 'rail_ballast'), cw = deco('gardiner', 'rail_walls');
  floorRect(bal, RAILS.x0, RAILS.x1, WORLD.z0, -1400, RAILS.trench, TEX.ballast, 100, 500);
  wallRect(cw, [RAILS.x0, WORLD.z0], [RAILS.x0, -1400], RAILS.trench, GROUND, TEX.gardiner, 120, 100);
  wallRect(cw, [RAILS.x1, -1400], [RAILS.x1, WORLD.z0], RAILS.trench, GROUND, TEX.gardiner, 120, 100);
  // ramp up out of the cut, then the viaduct into Union Station and on east
  const rampZ0 = -1400, rampZ1 = -400;
  for (let z = rampZ0; z < rampZ1; z += 100) {
    const ya = lerp(RAILS.trench, RAILS.viaduct, (z - rampZ0) / (rampZ1 - rampZ0)), yb = lerp(RAILS.trench, RAILS.viaduct, (z + 100 - rampZ0) / (rampZ1 - rampZ0));
    quad(bal, V(RAILS.x0, ya, z, 0, 0), V(RAILS.x0, yb, z + 100, 0, TC(32)), V(RAILS.x1, yb, z + 100, TC(160), TC(32)), V(RAILS.x1, ya, z, TC(160), 0), [0, 1, 0]);
    for (const [x, s] of [[RAILS.x0, -1], [RAILS.x1, 1]]) quad(cw, V(x, Math.min(ya, GROUND), z, 0, TC(32)), V(x, Math.min(yb, GROUND), z + 100, TC(32), TC(32)), V(x, yb, z + 100, TC(32), 0), V(x, ya, z, 0, 0), [s, 0.5, 0]);
  }
  const vz0 = rampZ1, vz1 = WORLD.z1;
  floorRect(bal, RAILS.x0, RAILS.x1, vz0, vz1, RAILS.viaduct, TEX.ballast, 100, 500);
  const bayGap = [BAY_Z - 260, BAY_Z + 260];
  for (const [x, s] of [[RAILS.x0, -1], [RAILS.x1, 1]]) {
    const seg = (za, zb, y0) => (s < 0 ? wallRect(deco('stadium', 'viaduct'), [x, za], [x, zb], y0, RAILS.viaduct, TEX.stadium, 300, 140) : wallRect(deco('stadium', 'viaduct'), [x, zb], [x, za], y0, RAILS.viaduct, TEX.stadium, 300, 140));
    seg(vz0, bayGap[0], GROUND); seg(bayGap[1], vz1, GROUND); seg(bayGap[0], bayGap[1], RAILS.deckUnder);
  }
  floorRect(section('viaduct_underside', TEX.gardiner, SURF.CEMENT, CLIP.NONE), RAILS.x0, RAILS.x1, bayGap[0], bayGap[1], RAILS.deckUnder, TEX.gardiner, 120, 300);
  // GO trains: one in the cut under the John Street bridge, one on the viaduct
  const train = (z0, cars, y) => {
    for (let k = 0; k < cars; k++) {
      const za = z0 + k * 320, zb = za + 300, x0 = (RAILS.x0 + RAILS.x1) / 2 - 60, x1 = x0 + 120;
      box(deco('goTrain', 'go_trains'), deco('gardiner', 'go_roofs'), x0, x1, za, zb, y, y + 150, TEX.goTrain, 300, 150);
    }
  };
  train(-4200, 7, RAILS.trench + 6);
  train(600, 6, RAILS.viaduct + 6);
  sign(deco('signGo'), [RAILS.x1 + 2, -3300], [1, 0], 220, 110, RAILS.trench + 170, TEX.signGo);
}

/* ------------------------------------------------------------ Front Street */

// Union Station: limestone block, the long Doric colonnade on Front Street, the great hall rising behind
{
  const x0 = -900, x1 = -262, z0 = -950, z1 = 950;
  const ls = deco('limestone', 'union');
  box(ls, deco('copperRoof', 'union_roof'), x0, x1, z0, z1, GROUND, 340, TEX.limestone, 120, 120, TEX.copperRoof);
  wallRect(deco('union', 'union_colonnade'), [x1 + 1, z1], [x1 + 1, z0], GROUND, 300, TEX.union, 160, 302, { vAnchor: GROUND, maxH: 302 });
  box(ls, deco('copperRoof', 'union_roof'), x0 + 120, x1 - 160, -420, 420, 340, 560, TEX.limestone, 120, 120, TEX.copperRoof);
  sign(deco('signUnion'), [x1 + 3, 0], [1, 0], 360, 90, 310, TEX.signUnion);
  // the train shed's glass roof over the platforms behind
  floorRect(deco('glassBlue', 'train_shed'), RAILS.x1 - 450, x0, -1400, 1400, 300, TEX.glassBlue, 200, 400);
  for (let z = -1300; z <= 1300; z += 520) for (const x of [RAILS.x1 - 420, x0 - 30]) box(deco('gardiner', 'shed_posts'), null, x - 10, x + 10, z - 10, z + 10, RAILS.viaduct, 300, TEX.gardiner, 20, 60);
  foot(x0, x1, z0, z1);
}
// the Fairmont Royal York: stepped brick-and-stone tower with green copper roofs
{
  const ry = deco('royalYork', 'royal_york'), cu = deco('copperRoof', 'royal_york_roofs');
  box(ry, null, 262, 1100, -1000, 500, GROUND, 520, TEX.royalYork, 120, 120);
  box(ry, null, 380, 1000, -800, 300, 520, 1150, TEX.royalYork, 120, 120);
  box(ry, null, 520, 860, -460, -40, 1150, 1500, TEX.royalYork, 120, 120);
  pyramid(cu, 262, 1100, -1000, 500, 520, 620, TEX.copperRoof);
  pyramid(cu, 380, 1000, -800, 300, 1150, 1260, TEX.copperRoof);
  pyramid(cu, 520, 860, -460, -40, 1500, 1820, TEX.copperRoof);
  sign(deco('signRoyalYork'), [260, -250], [-1, 0], 340, 90, 400, TEX.signRoyalYork);
  foot(262, 1100, -1000, 500);
}
// Royal Bank Plaza: two gold glass towers at Front and Bay
{
  const gg = deco('goldGlass', 'royal_bank'), z0 = BAY_Z + 260;
  prism(gg, gg, [[300, z0], [300, z0 + 700], [900, z0 + 200]], GROUND, 1700, TEX.goldGlass, 120, 120);
  prism(gg, gg, [[1000, z0 + 300], [1500, z0 + 900], [1500, z0 + 250]], GROUND, 1250, TEX.goldGlass, 120, 120);
  foot(300, 1500, z0, z0 + 900);
}
// Metro Toronto Convention Centre and the CBC
{
  box(deco('glassGreen', 'mtcc'), deco('gardiner', 'mtcc_roof'), -1250, -300, -2600, -1150, GROUND, 260, TEX.glassGreen, 120, 130, TEX.gardiner);
  foot(-1250, -300, -2600, -1150);
  box(deco('office', 'cbc'), deco('gardiner', 'cbc_roof'), 300, 1100, -3400, -1300, GROUND, 700, TEX.office, 120, 120, TEX.gardiner);
  foot(300, 1100, -3400, -1300);
}
// the financial district beyond, and City Hall with the TORONTO sign up at Queen Street
{
  box(deco('whiteTower', 'fcp'), deco('gardiner', 'tower_roofs'), 1500, 2200, -400, 300, GROUND, 3300, TEX.whiteTower, 120, 120, TEX.gardiner); foot(1500, 2200, -400, 300);
  box(deco('blackTower', 'td_centre'), deco('gardiner', 'tower_roofs'), 1500, 2100, 800, 1400, GROUND, 2600, TEX.blackTower, 120, 120, TEX.gardiner); foot(1500, 2100, 800, 1400);
  box(deco('blackTower', 'td_centre'), deco('gardiner', 'tower_roofs'), 2500, 3000, 1000, 1600, GROUND, 2000, TEX.blackTower, 120, 120, TEX.gardiner); foot(2500, 3000, 1000, 1600);
  // City Hall: two curved towers round the council chamber's saucer
  const ch = deco('cityHall', 'city_hall'), cx = 4700, cz = 500;
  for (const [s, h, r] of [[-1, 1800, 700], [1, 1400, 600]]) {
    const pts = [];
    for (let k = 0; k <= 10; k++) { const a = Math.PI / 2 + s * (0.25 + (0.9 * k) / 10); pts.push([cx + r * Math.cos(a) - 300, cz + s * 200 + r * Math.sin(a) * 0.6]); }
    for (let k = 10; k >= 0; k--) { const a = Math.PI / 2 + s * (0.25 + (0.9 * k) / 10); pts.push([cx + (r - 140) * Math.cos(a) - 300, cz + s * 200 + (r - 140) * Math.sin(a) * 0.6]); }
    prism(ch, deco('gardiner', 'tower_roofs'), pts, GROUND, h, TEX.cityHall, 100, 100);
  }
  frustum(ch, cx - 300, cz, 120, 120, GROUND, 200, 12, TEX.cityHall, 2, 1);
  frustum(deco('dome', 'saucer'), cx - 300, cz, 300, 160, 200, 320, 16, TEX.dome, 4, 1);
  disc(deco('dome', 'saucer'), cx - 300, cz, 0, 160, 320, 16, TEX.dome, 100);
  foot(cx - 1200, cx + 400, cz - 900, cz + 900);
  // the 3D TORONTO sign in the square, facing the lake
  sign(deco('torontoSign'), [3900, 500], [-1, 0], 900, 220, GROUND, TEX.torontoSign);
  foot(3850, 3950, 0, 1000);
}

/* ------------------------------------------------------------ the Rogers Centre */
{
  const { cx, cz } = PARK, N = 72;
  const nearRoute = (x, z, pad) => framesNear(x, z, 700).some((f) => tagAt(Math.min(f.s, L - 1)).kind !== 'warning' && Math.hypot(x - f.x, z - f.z) < f.w + pad);
  // field: turf, the rest of the warning track, the infield diamond
  disc(deco('turf', 'field'), cx, cz, 0, 735, 0.5, 48, TEX.turf, 120);
  const routeAng = (a) => Math.cos(a) * 0 + (Math.sin(a) < 0.02); // west half (z < cz) is the route's track
  for (let k = 0; k < N; k++) {
    const a0 = (2 * Math.PI * k) / N, a1 = (2 * Math.PI * (k + 1)) / N;
    if (Math.sin((a0 + a1) / 2) < 0) continue; // the route ribbon covers the west half
    disc(deco('dirt', 'track_east'), cx, cz, 730, 1076, 0.5, 1, TEX.dirt, 140, a0, a1);
  }
  const home = [cx, cz + 600], dia = (dx, dz) => [home[0] + dx, home[1] + dz];
  const dd = deco('dirt', 'infield');
  const diamond = [dia(0, 40), dia(200, -200), dia(0, -440), dia(-200, -200)];
  quad(dd, ...diamond.map(([x, z]) => V(x, 1, z, TC(((x - home[0]) / 100) * 32), TC(((z - home[1]) / 100) * 32))), [0, 1, 0]);
  const inner = [dia(0, -60), dia(120, -200), dia(0, -340), dia(-120, -200)];
  quad(deco('turf', 'infield_grass'), ...inner.map(([x, z]) => V(x, 1.5, z, TC(((x - home[0]) / 100) * 32), TC(((z - home[1]) / 100) * 32))), [0, 1, 0]);
  for (const [dx, dz] of [[0, 0], [200, -200], [0, -400], [-200, -200]]) box(deco('limestone', 'bases'), deco('limestone', 'bases'), home[0] + dx - 14, home[0] + dx + 14, home[1] + dz - 14, home[1] + dz + 14, 0, 6, TEX.limestone, 28, 6);
  // the bowl: blue seats rising to the outer wall, cut away where the route passes through
  const seatsSec = deco('seats', 'stands'), wall = deco('stadium', 'stadium_wall');
  for (let k = 0; k < N; k++) {
    const a0 = (2 * Math.PI * k) / N, a1 = (2 * Math.PI * (k + 1)) / N, am = (a0 + a1) / 2;
    const P = (r, a) => [cx + r * Math.cos(a), cz + r * Math.sin(a)];
    const gap = [1110, 1300, 1500].some((r) => nearRoute(...P(r, am), 160));
    if (gap) continue;
    const rows = [[1110, 100], [1450, 560]];
    const [i0, i1] = rows;
    const A = P(i0[0], a0), B = P(i0[0], a1), Cc = P(i1[0], a1), D = P(i1[0], a0);
    const sw = TC(((i0[0] * (a1 - a0)) / 60) * 32);
    quad(seatsSec, V(A[0], i0[1], A[1], 0, TC(32 * 6)), V(B[0], i0[1], B[1], sw, TC(32 * 6)), V(Cc[0], i1[1], Cc[1], sw, 0), V(D[0], i1[1], D[1], 0, 0));
    // front wall of the stands (behind the padding), and the outer wall
    quad(wall, V(A[0], 0, A[1], 0, TC(32)), V(B[0], 0, B[1], TC(16), TC(32)), V(B[0], i0[1], B[1], TC(16), 0), V(A[0], i0[1], A[1], 0, 0));
    const E0 = P(1500, a0), E1 = P(1500, a1);
    wallRect(wall, E1, E0, GROUND, 620, TEX.stadium, 300, 310, { vAnchor: GROUND, maxH: 310 });
    quad(seatsSec, V(D[0], i1[1], D[1], 0, 0), V(Cc[0], i1[1], Cc[1], sw, 0), V(E1[0], 620, E1[1], sw, TC(32)), V(E0[0], 620, E0[1], 0, TC(32)), [0, 1, 0]);
  }
  // the dome: the closed panels stacked over the north end, open to the sky over the south
  const dome = deco('dome', 'dome');
  const bands = [[1500, 620], [1300, 830], [1000, 980], [650, 1070], [250, 1100]];
  for (let k = 0; k < 48; k++) {
    const a0 = (2 * Math.PI * k) / 48, a1 = (2 * Math.PI * (k + 1)) / 48;
    if (Math.cos((a0 + a1) / 2) < 0.15) continue;
    for (let b = 0; b + 1 < bands.length; b++) {
      const [r0, y0] = bands[b], [r1, y1] = bands[b + 1];
      const P = (r, a, y) => V(cx + r * Math.cos(a), y, cz + r * Math.sin(a), 0, 0);
      const A = P(r0, a0, y0), B = P(r0, a1, y0), Cc = P(r1, a1, y1), D = P(r1, a0, y1);
      A.t = B.t = TC(32 * 2); B.s = Cc.s = TC(32);
      quad(dome, A, B, Cc, D);
    }
  }
  // the video board over centre field, and the names on the outside
  sign(deco('signJays', 'video_board'), [cx, cz - 1440], [0, 1], 900, 420, 700, TEX.signJays);
  sign(deco('signRogers'), [cx + 1520, cz + 900], [1, 0], 600, 300, 300, TEX.signRogers);
  sign(deco('signRogers'), [cx - 400, cz + 1520], [0, 1], 600, 300, 300, TEX.signRogers);
  foot(cx - 1550, cx + 1550, cz - 1550, cz + 1550);
}
// the John Street Roundhouse with its turntable and an old steam engine
{
  const cx = -4000, cz = -1550, br = deco('brick', 'roundhouse');
  for (let k = 0; k < 10; k++) {
    const a0 = Math.PI / 2 + (Math.PI * k) / 10, a1 = Math.PI / 2 + (Math.PI * (k + 1)) / 10;
    const P = (r, a) => [cx + r * Math.cos(a), cz + r * Math.sin(a)];
    wallRect(br, P(560, a1), P(560, a0), GROUND, 180, TEX.brick, 100, 100);
    wallRect(deco('roundhouse', 'roundhouse_doors'), P(380, a0), P(380, a1), GROUND, 180, TEX.roundhouse, 120, 180, { vAnchor: GROUND });
    quad(deco('gardiner', 'roundhouse_roof'), V(...[P(380, a0)[0], 180, P(380, a0)[1]], 0, 0), V(...[P(380, a1)[0], 180, P(380, a1)[1]], TC(32), 0), V(...[P(560, a1)[0], 200, P(560, a1)[1]], TC(32), TC(32)), V(...[P(560, a0)[0], 200, P(560, a0)[1]], 0, TC(32)), [0, 1, 0]);
  }
  disc(deco('gardiner', 'turntable'), cx, cz, 0, 220, 2, 24, TEX.gardiner, 100);
  box(deco('blackTower', 'engine'), deco('blackTower', 'engine'), cx - 30, cx + 30, cz - 200, cz + 200, 2, 80, TEX.blackTower, 60, 60);
  frustum(deco('blackTower', 'engine'), cx, cz - 60, 45, 45, 80, 160, 10, TEX.blackTower);
  foot(cx - 600, cx + 600, cz - 600, cz + 100);
}

/* ------------------------------------------------------------ the CN Tower */
{
  const { cx, cz } = TOWER, cn = deco('cnConcrete', 'cn_tower');
  // the Y of three tapering legs
  for (const a of [Math.PI / 2, Math.PI / 2 + (2 * Math.PI) / 3, Math.PI / 2 + (4 * Math.PI) / 3]) {
    const d = [Math.cos(a), Math.sin(a)], n = [-d[1], d[0]], hw = 45;
    const P = (r, s) => [cx + d[0] * r + n[0] * s * hw, cz + d[1] * r + n[1] * s * hw];
    const outer = 270, inner = 60, yOut = 260, yIn = 1100;
    for (const s of [-1, 1]) {
      const [a0, b0] = [P(inner, s), P(outer, s)];
      quad(cn, V(a0[0], GROUND, a0[1], 0, TC(64)), V(b0[0], GROUND, b0[1], TC(32), TC(64)), V(b0[0], yOut, b0[1], TC(32), TC(48)), V(a0[0], yIn, a0[1], 0, 0), normalize([n[0] * s, 0.3, n[1] * s]));
    }
    const [l, r2] = [P(outer, -1), P(outer, 1)], [li, ri] = [P(inner, -1), P(inner, 1)];
    quad(cn, V(l[0], GROUND, l[1], 0, TC(16)), V(r2[0], GROUND, r2[1], TC(8), TC(16)), V(r2[0], yOut, r2[1], TC(8), 0), V(l[0], yOut, l[1], 0, 0), normalize([d[0], 0.3, d[1]]));
    quad(cn, V(l[0], yOut, l[1], 0, TC(64)), V(r2[0], yOut, r2[1], TC(8), TC(64)), V(ri[0], yIn, ri[1], TC(8), 0), V(li[0], yIn, li[1], 0, 0), normalize([d[0], 1, d[1]]));
  }
  frustum(cn, cx, cz, 120, 103, GROUND, 1500, 6, TEX.cnConcrete, 2, 20);
  frustum(cn, cx, cz, 103, 85, 1500, 3050, 6, TEX.cnConcrete, 2, 20);
  const pod = deco('pod', 'cn_pod');
  frustum(cn, cx, cz, 85, 380, 3050, 3150, 24, TEX.cnConcrete, 6, 2);
  frustum(pod, cx, cz, 380, 380, 3150, 3330, 24, TEX.pod, 6, 1);
  frustum(cn, cx, cz, 380, 120, 3330, 3420, 24, TEX.cnConcrete, 6, 2);
  frustum(cn, cx, cz, 80, 70, 3420, 3900, 6, TEX.cnConcrete, 2, 6);
  frustum(pod, cx, cz, 140, 140, 3900, 4000, 12, TEX.pod, 2, 1);
  frustum(cn, cx, cz, 140, 60, 4000, 4060, 12, TEX.cnConcrete, 2, 1);
  frustum(deco('limestone', 'cn_antenna'), cx, cz, 45, 12, 4060, 5300, 6, TEX.limestone, 1, 12);
  disc(deco('sidewalk', 'cn_plaza'), cx, cz, 0, 320, GROUND + 1, 24, TEX.sidewalk, 120);
  sign(deco('signCN'), [cx + 380, cz + 380], [0.7, 0.7], 300, 150, 60, TEX.signCN);
  foot(cx - 330, cx + 330, cz - 330, cz + 330);
}
// Ripley's Aquarium of Canada beside it
{
  box(deco('aquarium', 'aquarium'), null, -5800, -5250, -560, 300, GROUND, 240, TEX.aquarium, 160, 120);
  for (let k = 0; k < 6; k++) { const z0 = -560 + k * 143; quad(deco('dome', 'aquarium_roof'), V(-5800, 240, z0, 0, 0), V(-5800, 240, z0 + 143, TC(32), 0), V(-5250, 240 + 60 * (k % 2), z0 + 143, TC(32), TC(32)), V(-5250, 240 + 60 * ((k + 1) % 2), z0, 0, TC(32)), [0, 1, 0]); }
  sign(deco('signAquarium'), [-5520, -562], [0, -1], 360, 180, 120, TEX.signAquarium);
  foot(-5800, -5250, -560, 300);
}
// the Gardiner Expressway, high overhead on its columns
{
  const { x, hw, y } = GARDINER, g = deco('gardiner', 'gardiner');
  floorRect(g, x - hw, x + hw, WORLD.z0, WORLD.z1, y + 40, TEX.gardiner, 140, 600);
  floorRect(section('gardiner_underside', TEX.gardiner, SURF.CEMENT, CLIP.NONE), x - hw, x + hw, WORLD.z0, WORLD.z1, y, TEX.gardiner, 140, 600);
  wallRect(g, [x - hw, WORLD.z1], [x - hw, WORLD.z0], y, y + 80, TEX.gardiner, 140, 80);
  wallRect(g, [x + hw, WORLD.z0], [x + hw, WORLD.z1], y, y + 80, TEX.gardiner, 140, 80);
  for (let z = WORLD.z0 + 300; z < WORLD.z1; z += 600) {
    if (laneClearance(x, z) < 120 || laneClearance(x - 140, z) < 60 || laneClearance(x + 140, z) < 60) continue;
    for (const px of [x - 120, x + 120]) box(g, null, px - 30, px + 30, z - 30, z + 30, GROUND, y, TEX.gardiner, 60, 100);
    box(g, null, x - hw + 20, x + hw - 20, z - 40, z + 40, y - 40, y, TEX.gardiner, 120, 40);
  }
  // cars on the expressway, and the big green sign over Bay Street
  const cols = ['streetcar', 'glassBlue', 'whiteTower', 'goldGlass'];
  for (let k = 0; k < 18; k++) { const z = WORLD.z0 + 500 + k * 800, lane = (k % 4) - 1.5; box(deco(cols[k % 4], 'gardiner_cars'), deco(cols[k % 4], 'gardiner_cars'), x + lane * 90 - 30, x + lane * 90 + 30, z, z + 110, y + 40, y + 90, TEX[cols[k % 4]], 60, 50); }
  sign(deco('signGardiner'), [x + hw + 2, BAY_Z], [1, 0], 400, 200, y + 90, TEX.signGardiner);
  sign(deco('signGardiner'), [x + hw + 2, -800], [1, 0], 400, 200, y + 90, TEX.signGardiner);
  sign(deco('flag', 'flags'), [x + hw + 2, BAY_Z - 700], [1, 0], 300, 150, y + 100, TEX.flag);
}
// Scotiabank Arena and Maple Leaf Square on Bay Street
{
  box(deco('arena'), deco('gardiner', 'arena_roof'), -3400, -2300, BAY_Z + 260, BAY_Z + 1400, GROUND, 380, TEX.arena, 120, 130, TEX.gardiner);
  sign(deco('signArena'), [-2850, BAY_Z + 258], [0, -1], 520, 260, 120, TEX.signArena);
  foot(-3400, -2300, BAY_Z + 260, BAY_Z + 1400);
  box(deco('condo', 'mls'), deco('gardiner', 'tower_roofs'), -4000, -3550, BAY_Z + 300, BAY_Z + 800, GROUND, 1700, TEX.condo, 100, 100, TEX.gardiner); foot(-4000, -3550, BAY_Z + 300, BAY_Z + 800);
}

/* ------------------------------------------------------------ the waterfront */
{
  // promenade along the water, and the piers the waterfront buildings sit on
  const pr = deco('promenade', 'promenade');
  floorRect(pr, SHORE, QQ_X - 180, -1400, BAY_Z + 600, GROUND + 1, TEX.promenade, 140, 600);
  floorRect(pr, -7850, SHORE, -900, 1700, GROUND + 1, TEX.promenade, 140, 600);
  wallRect(deco('gardiner', 'dock_wall'), [-7850, 1700], [-7850, -900], -40, GROUND + 1, TEX.gardiner, 120, 60);
  wallRect(deco('gardiner', 'dock_wall'), [-7850, -900], [SHORE, -900], -40, GROUND + 1, TEX.gardiner, 120, 60);
  wallRect(deco('gardiner', 'dock_wall'), [SHORE, 1700], [-7850, 1700], -40, GROUND + 1, TEX.gardiner, 120, 60);
  // the Power Plant (old brick power house and its chimney)
  box(deco('brick', 'power_plant'), deco('gardiner', 'pp_roof'), -7750, -7400, -850, -450, GROUND, 280, TEX.brick, 100, 100, TEX.gardiner);
  frustum(deco('brick', 'power_plant'), -7650, -520, 50, 40, 280, 720, 8, TEX.brick, 2, 4);
  sign(deco('signPowerPlant'), [-7398, -650], [1, 0], 220, 110, 160, TEX.signPowerPlant);
  // Harbourfront Centre
  box(deco('terminal', 'harbourfront'), deco('gardiner', 'hf_roof'), -7750, -7400, -350, 350, GROUND, 200, TEX.terminal, 100, 100, TEX.gardiner);
  sign(deco('signHarbour'), [-7398, 0], [1, 0], 360, 180, 120, TEX.signHarbour);
  // Queens Quay Terminal and its clock tower
  box(deco('terminal', 'qq_terminal'), deco('gardiner', 'qqt_roof'), -7800, -7380, 600, 1550, GROUND, 340, TEX.terminal, 100, 100, TEX.gardiner);
  box(deco('terminal', 'qq_terminal'), null, -7480, -7360, 1000, 1120, 340, 560, TEX.terminal, 120, 110);
  pyramid(deco('copperRoof', 'qqt_clock_roof'), -7490, -7350, 990, 1130, 560, 640, TEX.copperRoof);
  sign(deco('clock'), [-7358, 1060], [1, 0], 100, 100, 430, TEX.clock);
  // Sugar Beach: pink umbrellas on the sand
  floorRect(deco('sand'), SHORE, QQ_X - 180, BAY_Z - 900, BAY_Z - 250, GROUND + 2, TEX.sand, 120, 400);
  for (let k = 0; k < 8; k++) {
    const x = SHORE + 55 + (k % 2) * 95, z = BAY_Z - 850 + Math.floor(k / 2) * 160 + (k % 2) * 80;
    box(deco('limestone', 'umbrella_poles'), null, x - 4, x + 4, z - 4, z + 4, GROUND, 150, TEX.limestone, 8, 60);
    pyramid(deco('pink', 'umbrellas'), x - 42, x + 42, z - 42, z + 42, 130, 170, TEX.pink);
  }
  // the streetcar tracks up the middle of Queens Quay, with a red TTC streetcar
  floorRect(deco('ballast', 'streetcar_tracks'), QQ_X + 200, QQ_X + 360, -400, BAY_Z - 400, GROUND + 1, TEX.ballast, 80, 600);
  box(deco('streetcar'), deco('gardiner', 'streetcar_roof'), QQ_X + 220, QQ_X + 340, 500, 1300, GROUND + 1, 160, TEX.streetcar, 400, 160, TEX.gardiner);
  // out on the lake: the Island ferry and the Toronto Islands
  box(deco('limestone', 'ferry'), deco('terminal', 'ferry_deck'), -8800, -8600, -400, 300, -40, 40, TEX.limestone, 120, 80, TEX.terminal);
  box(deco('terminal', 'ferry'), deco('copperRoof', 'ferry_roof'), -8780, -8620, -250, 150, 40, 140, TEX.terminal, 100, 100, TEX.copperRoof);
  floorRect(section('islands', TEX.grass, SURF.GRASS, CLIP.NONE), -11200, -10000, -6000, 5000, -20, TEX.grass, 160, 800);
}

/* ------------------------------------------------------------ the skyline */
{
  let seed = 1834; // the year Toronto became a city
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const looks = ['glassBlue', 'glassGreen', 'condo', 'office', 'glassBlue', 'condo', 'blackTower'];
  const clear = (x0, x1, z0, z1) => {
    if (x0 < QQ_X + 400 || x1 > WORLD.x1 - 200 || z0 < WORLD.z0 + 200 || z1 > WORLD.z1 - 200) return false;
    if (x1 > RAILS.x0 - 60 && x0 < RAILS.x1 + 60) return false;
    if (x1 > GARDINER.x - GARDINER.hw - 60 && x0 < GARDINER.x + GARDINER.hw + 60) return false;
    if (FEET.some((f) => x1 > f.x0 - 80 && x0 < f.x1 + 80 && z1 > f.z0 - 80 && z0 < f.z1 + 80)) return false;
    for (const [x, z] of [[x0, z0], [x1, z0], [x1, z1], [x0, z1], [(x0 + x1) / 2, (z0 + z1) / 2]]) if (laneClearance(x, z) < 230) return false;
    return true;
  };
  for (let x = QQ_X + 450; x < WORLD.x1 - 400; x += 520) for (let z = WORLD.z0 + 300; z < WORLD.z1 - 400; z += 520) {
    const w = 260 + rnd() * 160, d = 260 + rnd() * 160, ox = rnd() * (500 - w), oz = rnd() * (500 - d);
    const x0 = x + ox, x1 = x0 + w, z0 = z + oz, z1 = z0 + d;
    if (!clear(x0, x1, z0, z1)) continue;
    // taller near the core (Bay and Front), lower towards the edges
    const core = Math.exp(-((x - 800) ** 2 + (z - 1200) ** 2) / (2 * 3500 ** 2));
    const h = 500 + rnd() * 900 + 1300 * core * rnd() + (x < -2000 && z < -3000 ? 700 * rnd() : 0); // CityPlace condos
    const look = looks[Math.floor(rnd() * looks.length)];
    box(deco(look, `towers_${look}`), deco('gardiner', 'tower_roofs'), x0, x1, z0, z1, GROUND, h, TEX[look], 120, 120, TEX.gardiner);
    foot(x0, x1, z0, z1);
  }
}

// street signs at the corners
{
  const post = deco('limestone', 'posts');
  const signAt = (s, side, key) => {
    const f = frame(s), w = f.w + 70, c = [f.x + side * f.nx * w, f.z + side * f.nz * w];
    sign(deco(key), c, [-f.tx, -f.tz], 180, 90, 160, TEX[key]);
    box(post, null, c[0] - 5, c[0] + 5, c[1] - 5, c[1] + 5, GROUND, 160, TEX.limestone, 16, 64);
  };
  signAt(300, 1, 'signFront');
  signAt(mark.john0 + 60, -1, 'signJohn');
  signAt(mark.qq0 + 100, -1, 'signQQ');
  signAt(mark.bay0 + 80, -1, 'signBay');
  signAt(mark.gate0 - 150, 1, 'signJays');
}

/* ------------------------------------------------------------ path, actors */

const pathPts = [], pathS = [];
for (let s = 0; s < L - PATH_SPACING / 2; s += PATH_SPACING) { const f = M.pose(s); pathPts.push({ x: Math.round(f.x), y: Math.round(f.y), z: Math.round(f.z) }); pathS.push(s); }
pathPts[0] = { x: 0, y: 0, z: 0 };

const actors = [];
const ITEM_GAP = 34, ROW_GAP = 40;
function itemCluster(s, n) {
  for (let row = 0; row < 2; row++) {
    const f = frame(s + row * ROW_GAP), m = n - row;
    for (let k = 0; k < m; k++) { const lat = (k - (m - 1) / 2) * ITEM_GAP; actors.push({ Name: 'mk:item_box', Location: { x: Math.round(f.x + f.nx * lat), y: Math.round(f.y + 5), z: Math.round(f.z + f.nz * lat) } }); }
  }
}
itemCluster(800, 7); // Front Street
itemCluster((mark.bridge0 + mark.bridge1) / 2, 7); // John Street bridge
itemCluster(mark.warn0 + 1400, 7); // the warning track
itemCluster(mark.gate1 + 500, 7); // Bremner, towards the CN Tower
itemCluster(mark.qq0 + 450, 7); // Queens Quay
itemCluster(mark.wave1 + 500, 7); // past the WaveDeck
itemCluster(mark.bay0 + 1600, 7); // Bay Street
itemCluster(mark.front1 + 900, 7); // Front Street east of Union

// trees: along the promenade, round the Roundhouse and the CN Tower, in Nathan Phillips Square
{
  const spots = [];
  for (let z = -1300; z < BAY_Z - 1000; z += 280) spots.push([SHORE + 60, z]);
  for (let k = 0; k < 12; k++) spots.push([-4000 + 700 * Math.cos(Math.PI * (0.55 + 0.9 * k / 11)), -1550 + 700 * Math.sin(Math.PI * (0.55 + 0.9 * k / 11))]);
  for (let k = 0; k < 10; k++) spots.push([TOWER.cx + 900 * Math.cos((k / 10) * 2 * Math.PI), TOWER.cz + 900 * Math.sin((k / 10) * 2 * Math.PI)]);
  for (let k = 0; k < 8; k++) spots.push([3600 + (k % 2) * 200, -300 + k * 220]);
  for (const [x, z] of spots) {
    if (laneClearance(x, z) < 110 || inTrench(x, z) || FEET.some((f) => x > f.x0 - 40 && x < f.x1 + 40 && z > f.z0 - 40 && z < f.z1 + 40)) continue;
    actors.push({ Name: 'mk:tree_mario_raceway', Location: { x: Math.round(x), y: GROUND, z: Math.round(z) } });
  }
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
