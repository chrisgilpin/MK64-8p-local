#!/usr/bin/env node
/**
 * "South C.I." — a SpaghettiKart track themed on London South Collegiate
 * Institute (London, Ontario): garnet & grey, red-brown brick, three floors.
 *
 * Lap (top-down, game units, Y up, race starts at the origin heading -Z):
 *   1. Start on the school's running track (west straight, heading north).
 *   2. Leave the oval and drop down a walled ramp into the basement doors.
 *   3. Inside: a short basement corridor (painted block), then stair tower A
 *      (a round rotunda at the south-west corner): one full turn of a spiral
 *      ramp up to the ground floor. A straight locker hallway up the west
 *      wing leads to stair tower B at the north-west corner: one more turn up
 *      to the top floor. Both spirals are 15% even on their inside edge.
 *      Then a long upper corridor (classroom doors) runs east.
 *   4. The upper corridor leads into a classroom: weave between the desks,
 *      hit the ramp and fly out of the window onto the parking garage's top
 *      deck (miss it and you land in the flower bed; Lakitu sets you on the
 *      deck), then swing down the garage ramp to street level.
 *   5. Sweep back to the track and run the back straight and final bend to
 *      the line (with the bleachers and a GO SOUTH! scoreboard).
 *   Every outdoor stretch is fenced on both sides, so the only way round is
 *   through the school (the oval's top bend is closed off).
 *
 * All textures are painted procedurally (textures.mjs) and packed into the
 * mod as RGBA16 resources; grass is referenced from the base game.
 *
 * Usage: node make-south-ci.mjs [outDir]
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { makeTextures, texResource, toPNG } from './textures.mjs';

const TRACK = 'south_ci';
const MOD = 'south-collegiate';
const RES = 'chris:south_ci';
const DIR = `tracks/${TRACK}`;
const OUT = process.argv[2] ?? '.';

/* ------------------------------------------------------------- textures */

const PAINTED = makeTextures();
const TEX = {};
for (const [k, im] of Object.entries(PAINTED)) TEX[k] = { path: `${DIR}/tex_${k}`, w: im.w, h: im.h, custom: true, cutout: !!im.cutout };
TEX.grass = { path: 'textures/other_textures/grass_3', w: 32, h: 32 };

const SURF = { ASPHALT: 1, CEMENT: 4, GRASS: 8 };
const CLIP = { NONE: 0, DEFAULT: 1, WALL: 4 };
const LAYER = { INVISIBLE: 0, OPAQUE: 1 };

/* ------------------------------------------------------------ dimensions */

const FH = 300; // floor-to-floor height (one full turn of a stair tower)
const LV = { B: -FH, G: 0, U: FH };
const CEIL = 200; // corridor ceiling above its floor
const HW = 150; // corridor half-width
// Two round stair towers, each a single 360-degree spiral ramp climbing one
// storey. One full turn per storey keeps a full storey of headroom between
// the passes, and the 425 radius keeps even the inside edge at 15%.
const SPIRAL = { R: 425, hw: 100, wall: 545 }; // centreline radius, lane half-width, tower outer wall radius
const Z_ROOM = -3400; // the upper corridor, classroom and window all run along this line
const BLD = { x0: -1650, x1: 1400, zN: -3600, zS: -2300, roof: 640 };
const OVAL = { r: 450, hw: 200, z0: -500, z1: 500, xw: 0, xe: 900 };
const TRENCH = { z0: -1200, z1: BLD.zS, x0: -200, x1: 200 };
const GAR = { wx: 1900, ex: 2700, nz: Z_ROOM, sz: Z_ROOM + 1100, r: 300, hw: 180, deck: 200 };
// upper-floor classroom at the NE corner; you jump out of its east window
const ROOM = { x0: 400, x1: BLD.x1 - 20, zN: BLD.zN + 10, zS: Z_ROOM + 290 };
const GAR_FOOT = { x0: GAR.wx - 350, x1: GAR.ex + 200, zN: GAR.nz - 200, zS: GAR.sz + 200 };
const LOT = { x0: 1600, x1: 3000, zN: -3800, zS: -1900 };
const FIELD = { x0: OVAL.xw + OVAL.hw, x1: OVAL.xe - OVAL.hw, zN: -400, zS: 400 };
const GROUND = -5;
const PATH_SPACING = 25;
const SAMPLE = 18;

/* -------------------------------------------------------------- helpers */

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const normalize = (v) => { const l = Math.hypot(...v) || 1; return v.map((c) => c / l); };
const TC = (texels) => texels * 32;
const V = (x, y, z, s, t, n) => ({ x, y, z, s, t, n });

/* ------------------------------------------------------- route builder */

// Primitives carry a planar curve plus elevation (y0 -> y1, or a custom fn)
// and a tag describing what kind of space the kart is in.
const prims = [];
let cur = { x: 0, z: 0, psi: -Math.PI / 2 }; // heading angle: dir = (cos, sin) in (x, z)
function line(len, tag, y0, y1 = y0, yfn = null) {
  const { x, z, psi } = cur;
  const dx = Math.cos(psi), dz = Math.sin(psi);
  prims.push({ len, tag, y0, y1, yfn, at: (u) => ({ x: x + dx * u, z: z + dz * u, tx: dx, tz: dz }) });
  cur = { x: x + dx * len, z: z + dz * len, psi };
}
function arc(R, sweep, tag, y0, y1 = y0) {
  const { x: x0, z: z0, psi: p0 } = cur;
  const sg = Math.sign(sweep);
  const at = (u) => {
    const p = p0 + (sg * u) / R;
    return { x: x0 + (R / sg) * (Math.sin(p) - Math.sin(p0)), z: z0 - (R / sg) * (Math.cos(p) - Math.cos(p0)), tx: Math.cos(p), tz: Math.sin(p) };
  };
  const len = R * Math.abs(sweep);
  prims.push({ len, tag, y0, y1, at });
  const e = at(len);
  cur = { x: e.x, z: e.z, psi: p0 + sweep };
}
const Q = Math.PI / 2;

// 1. start straight on the running track
line(-OVAL.z0, { kind: 'track' }, 0);
// 2. path off the top of the oval to the basement ramp
line(OVAL.z0 - TRENCH.z0, { kind: 'path' }, 0);
// 3. walled ramp down to the basement doors
const TRENCH_LEN = TRENCH.z0 - TRENCH.z1;
line(TRENCH_LEN, { kind: 'trench' }, 0, LV.B, (u) => {
  const t = clamp((u - 60) / (TRENCH_LEN - 160), 0, 1);
  return LV.B * t;
});
// 4. basement: swing west along a short block-walled corridor ...
arc(200, -Q, { kind: 'hall', floor: 'B', entry: true }, LV.B);
line(750, { kind: 'hall', floor: 'B' }, LV.B);
// 5. ... into stair tower A at the south-west corner: one full turn of a
//    spiral ramp up to the ground floor (it pokes out of the front lawn as a
//    round rotunda) ...
const TOWERS = [];
function spiral(name, floor, y0, y1, outer) {
  const sweep = -2 * Math.PI; // left-hand (counter-clockwise) turn
  const c = { x: cur.x + SPIRAL.R * Math.sin(cur.psi), z: cur.z - SPIRAL.R * Math.cos(cur.psi) };
  TOWERS.push({ name, cx: c.x, cz: c.z, y0, y1, outer });
  arc(SPIRAL.R, sweep, { kind: 'stairs', floor, spiral: name, outer }, y0, y1);
}
spiral('A', 'B', LV.B, LV.G, 'block');
// 6. ... out along the ground floor, up the west wing's locker hallway ...
line(250, { kind: 'hall', floor: 'G' }, LV.G);
arc(250, Q, { kind: 'hall', floor: 'G' }, LV.G);
line(400, { kind: 'hall', floor: 'G', lockers: true }, LV.G);
// 7. ... into stair tower B at the north-west corner, one more turn up to the
//    top floor ...
spiral('B', 'G', LV.G, LV.U, 'windows');
// 8. ... and east along the upper corridor to the classroom
arc(cur.z - Z_ROOM, Q, { kind: 'hall', floor: 'U' }, LV.U);
line(ROOM.x0 - cur.x, { kind: 'hall', floor: 'U' }, LV.U);
const Y_ROOM = LV.U;
// ... weaves between the desks ...
function curve(fn, tag, y) {
  const N = 500, pts = [], cum = [0];
  for (let i = 0; i <= N; i++) pts.push(fn(i / N));
  for (let i = 1; i <= N; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const len = cum[N];
  const at = (u) => {
    let lo = 0, hi = N;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= u) lo = m; else hi = m; }
    const f = (u - cum[lo]) / Math.max(1e-9, cum[hi] - cum[lo]);
    const tx = pts[hi][0] - pts[lo][0], tz = pts[hi][1] - pts[lo][1], tl = Math.hypot(tx, tz) || 1;
    return { x: lerp(pts[lo][0], pts[hi][0], f), z: lerp(pts[lo][1], pts[hi][1], f), tx: tx / tl, tz: tz / tl };
  };
  prims.push({ len, tag, y0: y, y1: y, at });
  // end pose taken analytically (the weave leaves exactly heading east)
  const end = fn(1), pre = fn(1 - 1e-6);
  cur = { x: end[0], z: end[1], psi: Math.atan2(end[1] - pre[1], end[0] - pre[0]) };
}
const WEAVE = { x0: ROOM.x0, x1: ROOM.x1 - 220, amp: 80 };
curve((u) => [lerp(WEAVE.x0, WEAVE.x1, u), Z_ROOM - WEAVE.amp * Math.sin(2 * Math.PI * u) * Math.sin(Math.PI * u)], { kind: 'classroom' }, Y_ROOM);
// ... and launches off a ramp straight out of the east window
const KICK_LEN = 120, KICK_SLOPE = 0.35;
line(ROOM.x1 - KICK_LEN - cur.x, { kind: 'classroom' }, Y_ROOM);
line(KICK_LEN, { kind: 'kicker', raw: true }, Y_ROOM, Y_ROOM, (u) => Y_ROOM + (KICK_SLOPE / (2 * KICK_LEN)) * u * u);
const LIP_Y = Y_ROOM + (KICK_SLOPE * KICK_LEN) / 2;
line(GAR_FOOT.x0 - ROOM.x1, { kind: 'gap', raw: true }, LIP_Y, GAR.deck);
// 7. onto the garage top deck, then down its ramp
line(GAR.ex - GAR.r - GAR_FOOT.x0, { kind: 'garage', level: 'top', raw: true }, GAR.deck);
{
  const side = GAR.sz - GAR.nz - 2 * GAR.r;
  const total = 2 * GAR.r * Q + side;
  const ya = lerp(GAR.deck, 0, (GAR.r * Q) / total);
  const yb = lerp(GAR.deck, 0, (GAR.r * Q + side) / total);
  arc(GAR.r, Q, { kind: 'garage', level: 'ramp' }, GAR.deck, ya);
  line(side, { kind: 'garage', level: 'ramp' }, ya, yb);
  arc(GAR.r, Q, { kind: 'garage', level: 'ramp' }, yb, 0);
}
// 8. ground-level aisle west, then out of the garage heading south
line(GAR.ex - GAR.r - (GAR.wx + GAR.r), { kind: 'garage', level: 'ground' }, 0);
arc(GAR.r, -Q, { kind: 'road' }, 0);
// 9. S-bend back to the top of the oval's back straight
{
  const dx = cur.x - OVAL.xe;
  const dz = OVAL.z0 - cur.z;
  const alpha = 2 * Math.atan(dx / dz);
  const R = dz / (2 * Math.sin(alpha));
  arc(R, alpha, { kind: 'road' }, 0);
  arc(R, -alpha, { kind: 'road' }, 0);
}
// 10. back straight, final bend, and home to the line
line(OVAL.z1 - OVAL.z0, { kind: 'track' }, 0);
arc(OVAL.r, Math.PI, { kind: 'track' }, 0);
line(OVAL.z1, { kind: 'track' }, 0);
if (Math.hypot(cur.x, cur.z) > 0.5) throw new Error(`route does not close: ends at ${cur.x.toFixed(1)},${cur.z.toFixed(1)}`);

const starts = [];
let acc = 0;
for (const p of prims) { starts.push(acc); acc += p.len; }
const L = acc;
function primAt(s) {
  s = ((s % L) + L) % L;
  let lo = 0, hi = prims.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (starts[m] <= s) lo = m; else hi = m - 1; }
  return { p: prims[lo], i: lo, u: clamp(s - starts[lo], 0, prims[lo].len) };
}
function rawY(s) {
  const { p, u } = primAt(s);
  return p.yfn ? p.yfn(u) : lerp(p.y0, p.y1, u / p.len);
}
// soften grade changes (ramp tops/bottoms) with a short moving average
const yCache = new Map();
function roadY(s) {
  const key = Math.round(s * 2);
  if (yCache.has(key)) return yCache.get(key);
  // no smoothing across the kicker, the gap or the landing (keeps the lip sharp)
  const raw = [-60, -30, 0, 30, 60].some((q) => primAt(s + q).p.tag.raw);
  let sum = 0, n = 0;
  for (let q = -60; q <= 60; q += 5) { sum += rawY(s + q); n++; }
  const y = raw ? rawY(s) : sum / n;
  yCache.set(key, y);
  return y;
}
const tagAt = (s) => primAt(s).p.tag;

function halfWidth(s) {
  const t = tagAt(s);
  if (t.kind === 'track') return OVAL.hw;
  if (t.kind === 'garage') return GAR.hw;
  if (t.kind === 'road') return 170;
  if (t.kind === 'classroom') return 60;
  if (t.kind === 'stairs') return SPIRAL.hw;
  if (t.kind === 'kicker' || t.kind === 'gap') return 140;
  return HW;
}

/* ------------------------------------------------------------ sections */

const sections = new Map();
function section(name, tex, surface, clip, layer = LAYER.OPAQUE) {
  if (!sections.has(name)) sections.set(name, { name, tex, surface, clip, layer, tris: [] });
  return sections.get(name);
}
function triNormal(a, b, c) {
  const u = [b.x - a.x, b.y - a.y, b.z - a.z], v = [c.x - a.x, c.y - a.y, c.z - a.z];
  return normalize([u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]);
}
function quad(sec, a, b, c, d, n) {
  const nn = n ?? triNormal(a, b, c);
  for (const v of [a, b, c, d]) if (!v.n) v.n = nn;
  sec.tris.push([a, b, c], [a, c, d]);
}
/** Upward-facing horizontal rectangle (x0<x1, z0<z1) split into cells. */
function floorRect(sec, x0, x1, z0, z1, y, tex, unit, cell = 200) {
  const nx = Math.max(1, Math.ceil((x1 - x0) / cell)), nz = Math.max(1, Math.ceil((z1 - z0) / cell));
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const xa = lerp(x0, x1, i / nx), xb = lerp(x0, x1, (i + 1) / nx);
    const za = lerp(z0, z1, j / nz), zb = lerp(z0, z1, (j + 1) / nz);
    const bx = Math.floor(xa / unit) * unit, bz = Math.floor(za / unit) * unit;
    const st = (x, z) => [TC(((x - bx) / unit) * tex.w), TC(((z - bz) / unit) * tex.h)];
    const mk = (x, z) => V(x, y, z, ...st(x, z), [0, 1, 0]);
    // (x0,z0) (x0,z1) (x1,z1) (x1,z0) faces up in this engine
    quad(sec, mk(xa, za), mk(xa, zb), mk(xb, zb), mk(xb, za), [0, 1, 0]);
  }
}
/**
 * Vertical wall from p0 to p1 (XZ) between y0 and y1, textured with `tex`
 * repeating every `uPer` units horizontally and `vPer` units vertically.
 * `front` is the side the texture reads correctly from (+1 = left of p0->p1).
 */
function wallRect(sec, p0, p1, y0, y1, tex, uPer, vPer, opts = {}) {
  const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
  const dir = [(p1[0] - p0[0]) / len, (p1[1] - p0[1]) / len];
  const nOut = [-dir[1], dir[0]]; // right-hand normal of p0->p1: the side the texture reads correctly from
  const n = normalize([nOut[0], 0.7, nOut[1]]);
  const nu = Math.max(1, Math.ceil(len / (opts.maxW ?? 200)));
  const nv = Math.max(1, Math.ceil((y1 - y0) / (opts.maxH ?? 200)));
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const ua = (len * i) / nu, ub = (len * (i + 1)) / nu;
    const ya = lerp(y0, y1, j / nv), yb = lerp(y0, y1, (j + 1) / nv);
    const baseU = Math.floor(ua / uPer) * uPer;
    const baseV = opts.vAnchor ?? Math.floor(ya / vPer) * vPer;
    const sA = TC(((ua - baseU) / uPer) * tex.w), sB = TC(((ub - baseU) / uPer) * tex.w);
    // texture rows run top -> bottom
    const tTop = (y) => TC(((baseV + vPer - y) / vPer) * tex.h);
    const P = (u) => [p0[0] + dir[0] * u, p0[1] + dir[1] * u];
    const [xa, za] = P(ua), [xb, zb] = P(ub);
    quad(sec, V(xa, ya, za, sA, tTop(ya)), V(xb, ya, zb, sB, tTop(ya)), V(xb, yb, zb, sB, tTop(yb)), V(xa, yb, za, sA, tTop(yb)), n);
  }
}
/** A single textured panel facing `normal` (XZ), centred at c, w x h. */
function panel(sec, c, normal, w, h, y0, tex) {
  // viewer looks along -normal; their right-hand side is (nz, -nx)
  const r = [normal[1], -normal[0]];
  const a = [c[0] - (r[0] * w) / 2, c[1] - (r[1] * w) / 2];
  const b = [c[0] + (r[0] * w) / 2, c[1] + (r[1] * w) / 2];
  const n = normalize([normal[0], 0.5, normal[1]]);
  quad(sec, V(a[0], y0, a[1], 0, TC(tex.h)), V(b[0], y0, b[1], TC(tex.w), TC(tex.h)), V(b[0], y0 + h, b[1], TC(tex.w), 0), V(a[0], y0 + h, a[1], 0, 0), n);
}
/** Axis-aligned box walls (+ optional top). */
function box(secWalls, secTop, x0, x1, z0, z1, y0, y1, tex, uPer, vPer, topTex) {
  wallRect(secWalls, [x0, z1], [x1, z1], y0, y1, tex, uPer, vPer);
  wallRect(secWalls, [x1, z1], [x1, z0], y0, y1, tex, uPer, vPer);
  wallRect(secWalls, [x1, z0], [x0, z0], y0, y1, tex, uPer, vPer);
  wallRect(secWalls, [x0, z0], [x0, z1], y0, y1, tex, uPer, vPer);
  if (secTop) floorRect(secTop, x0, x1, z0, z1, y1, topTex ?? tex, 100, 400);
}

/* ------------------------------------------------------------ route frames */

const breaks = [...starts, L - 30, 30];
let sampleS = [];
for (let s = 0; s < L; s += SAMPLE) sampleS.push(s);
sampleS.push(...breaks);
sampleS = [...new Set(sampleS.map((v) => Math.round(v * 1000) / 1000))].filter((v) => v >= 0 && v < L - 0.5).sort((a, b) => a - b);
// drop uniform samples that crowd a breakpoint (rounded to integers they'd make slivers)
sampleS = sampleS.filter((v) => breaks.some((b) => Math.abs(b - v) < 1e-3) || !breaks.some((b) => Math.abs(b - v) < 8));
function frame(s) {
  const p = primAt(s).p.at(primAt(s).u);
  return { s, x: p.x, z: p.z, y: roadY(s), tx: p.tx, tz: p.tz, nx: -p.tz, nz: p.tx, w: halfWidth(s) };
}
const frames = sampleS.map(frame);
frames.push({ ...frame(0), s: L });

/* ---- oval geometry (independent of the race line so all 4 sides exist) */

function ovalDist(x, z) {
  if (z < OVAL.z0) return Math.abs(Math.hypot(x - (OVAL.xw + OVAL.xe) / 2, z - OVAL.z0) - OVAL.r);
  if (z > OVAL.z1) return Math.abs(Math.hypot(x - (OVAL.xw + OVAL.xe) / 2, z - OVAL.z1) - OVAL.r);
  return Math.min(Math.abs(x - OVAL.xw), Math.abs(x - OVAL.xe));
}
const inOvalBand = (x, z) => ovalDist(x, z) < OVAL.hw - 1;

/* ---- floors, walls and ceilings along the route ---- */

const floorSecs = {
  path: section('path', TEX.asphalt, SURF.ASPHALT, CLIP.DEFAULT),
  road: section('road', TEX.asphalt, SURF.ASPHALT, CLIP.DEFAULT),
  trench: section('trench_floor', TEX.concrete, SURF.CEMENT, CLIP.DEFAULT),
  B: section('floor_basement', TEX.vct, SURF.ASPHALT, CLIP.DEFAULT),
  G: section('floor_ground', TEX.terrazzo, SURF.ASPHALT, CLIP.DEFAULT),
  U: section('floor_upper', TEX.vct, SURF.ASPHALT, CLIP.DEFAULT),
  stairs: section('floor_stairs', TEX.stairs, SURF.CEMENT, CLIP.DEFAULT),
  skywalk: section('floor_skywalk', TEX.terrazzo, SURF.ASPHALT, CLIP.DEFAULT),
  garage: section('floor_garage', TEX.garageFloor, SURF.CEMENT, CLIP.DEFAULT),
  kicker: section('floor_kicker', TEX.kicker, SURF.ASPHALT, CLIP.DEFAULT),
};
const floorUnit = { path: 128, road: 128, trench: 128, B: 160, G: 128, U: 160, stairs: 80, skywalk: 128, garage: 180, kicker: 90 };

function floorKey(t) {
  if (t.kind === 'hall') return t.floor;
  return t.kind;
}
for (let i = 0; i + 1 < frames.length; i++) {
  const f0 = frames[i], f1 = frames[i + 1];
  const t = tagAt((f0.s + f1.s) / 2);
  if (t.kind === 'track' || t.kind === 'classroom' || t.kind === 'gap') continue; // oval / room floors are built separately
  const key = floorKey(t);
  const sec = floorSecs[key];
  const tex = sec.tex;
  const unit = floorUnit[key];
  const base = Math.floor(f0.s / unit) * unit;
  const t0 = TC(((f0.s - base) / unit) * tex.h), t1 = TC(((f1.s - base) / unit) * tex.h);
  // lateral subdivision so clipping against the oval leaves small notches only
  const LAT = t.kind === 'path' || t.kind === 'road' ? 10 : 1;
  const across = key === 'garage' ? 1 : key === 'kicker' ? 3 : (2 * f0.w) / unit; // repeats across
  for (let k = 0; k < LAT; k++) {
    const la = lerp(-1, 1, k / LAT), lb = lerp(-1, 1, (k + 1) / LAT);
    const P = (f, l) => [f.x + f.nx * f.w * l, f.z + f.nz * f.w * l];
    const sAt = (l) => TC(((l + 1) / 2) * across * tex.w);
    const [ax, az] = P(f0, la), [bx, bz] = P(f0, lb), [cx, cz] = P(f1, lb), [dx, dz] = P(f1, la);
    let dy = 0;
    if (t.kind === 'path' || t.kind === 'road') {
      // where the path merges into the running track, let the track's own
      // surface show: skip pieces it fully covers, tuck partly covered ones under
      const inside = [[ax, az], [bx, bz], [cx, cz], [dx, dz]].filter(([x, z]) => inOvalBand(x, z)).length;
      if (inside === 4) continue;
      if (inside > 0) dy = -1.5;
    }
    quad(sec, V(ax, f0.y + dy, az, sAt(la), t0), V(bx, f0.y + dy, bz, sAt(lb), t0), V(cx, f1.y + dy, cz, sAt(lb), t1), V(dx, f1.y + dy, dz, sAt(la), t1), [0, 1, 0]);
  }
}

const wallSecs = {
  block: section('walls_block', TEX.block, SURF.CEMENT, CLIP.WALL),
  lockers: section('walls_lockers', TEX.lockers, SURF.CEMENT, CLIP.WALL),
  classroom: section('walls_classroom', TEX.classroom, SURF.CEMENT, CLIP.WALL),
  windows: section('walls_windows', TEX.windows, SURF.CEMENT, CLIP.WALL),
  glass: section('walls_glass', TEX.glass, SURF.CEMENT, CLIP.WALL),
  concrete: section('walls_concrete', TEX.concrete, SURF.CEMENT, CLIP.WALL),
  parapet: section('walls_parapet', TEX.parapet, SURF.CEMENT, CLIP.WALL),
  fence: section('fences', TEX.fence, SURF.CEMENT, CLIP.WALL),
};
const ceilingSec = section('ceilings', TEX.ceiling, SURF.CEMENT, CLIP.NONE);

/** Wall spec for one side: left (-n, outer wall on the ring) or right (+n, courtyard side). */
function wallSpec(t, side, x, z) {
  switch (t.kind) {
    case 'trench':
      return { tex: 'concrete', top: 'abs', h: 30 };
    case 'hall': {
      if (t.floor === 'B') return { tex: 'block', top: 'ceil' };
      if (t.floor === 'G') return { tex: 'lockers', top: 'ceil' };
      // upper corridor heading east: outside windows on the left (north),
      // classroom doors on the right
      return { tex: side < 0 ? 'windows' : 'classroom', top: 'ceil' };
    }
    case 'stairs':
      // spiral ramps turn left: the tower's core is on the left
      return { tex: side < 0 ? 'block' : t.outer, top: 'ceil' };
    case 'skywalk':
      return { tex: 'glass', top: 'ceil' };
    case 'garage':
      return { tex: 'parapet', top: 'rel', h: 60 };
    // Outdoors the race line is fenced on both sides, so the only way round is
    // through the school (no lapping the oval, no cutting across the lawn).
    case 'track':
      return { tex: 'fence', top: 'rel', h: 60, off: 14 };
    case 'path':
    case 'road':
      return { tex: 'fence', top: 'rel', h: 60, off: 4 };
    default:
      return null;
  }
}
const WALL_UPER = { block: 80, lockers: 80, classroom: 120, windows: 120, glass: 100, concrete: 128, parapet: 128, fence: 60 };
for (let i = 0; i + 1 < frames.length; i++) {
  const f0 = frames[i], f1 = frames[i + 1];
  const mid = (f0.s + f1.s) / 2;
  const t = tagAt(mid);
  for (const side of [-1, 1]) {
    let e0 = [f0.x + side * f0.nx * f0.w, f0.z + side * f0.nz * f0.w];
    let e1 = [f1.x + side * f1.nx * f1.w, f1.z + side * f1.nz * f1.w];
    const spec = wallSpec(t, side, (e0[0] + e1[0]) / 2, (e0[1] + e1[1]) / 2);
    if (!spec) continue;
    if (spec.off) {
      e0 = [f0.x + side * f0.nx * (f0.w + spec.off), f0.z + side * f0.nz * (f0.w + spec.off)];
      e1 = [f1.x + side * f1.nx * (f1.w + spec.off), f1.z + side * f1.nz * (f1.w + spec.off)];
    }
    const sec = wallSecs[spec.tex];
    const tex = sec.tex;
    const top = (f) => (spec.top === 'abs' ? Math.max(spec.h, f.y + 10) : spec.top === 'rel' ? f.y + spec.h : f.y + CEIL);
    const uPer = WALL_UPER[spec.tex];
    const base = Math.floor(f0.s / uPer) * uPer;
    const sA = TC(((f0.s - base) / uPer) * tex.w), sB = TC(((f1.s - base) / uPer) * tex.w);
    const nIn = normalize([-side * f0.nx, 0.7, -side * f0.nz]);
    // full texture height spans floor -> top (ceilinged rooms) or repeats every 128 (outdoors)
    const tFor = (f, y) => {
      if (spec.top === 'ceil') return TC(((f.y + CEIL - y) / CEIL) * tex.h);
      return TC(((top(f) - y) / (spec.tex === 'fence' ? 60 : 128)) * tex.h);
    };
    quad(sec,
      V(e0[0], f0.y, e0[1], sA, tFor(f0, f0.y)),
      V(e1[0], f1.y, e1[1], sB, tFor(f1, f1.y)),
      V(e1[0], top(f1), e1[1], sB, tFor(f1, top(f1))),
      V(e0[0], top(f0), e0[1], sA, tFor(f0, top(f0))),
      nIn);
  }
  if (spec_hasCeiling(t)) {
    const unit = 128;
    const base = Math.floor(f0.s / unit) * unit;
    const t0 = TC(((f0.s - base) / unit) * 32), t1 = TC(((f1.s - base) / unit) * 32);
    const w0 = f0.w, w1 = f1.w;
    const sW = TC(((2 * w0) / unit) * 32);
    quad(ceilingSec,
      V(f0.x - f0.nx * w0, f0.y + CEIL, f0.z - f0.nz * w0, 0, t0),
      V(f0.x + f0.nx * w0, f0.y + CEIL, f0.z + f0.nz * w0, sW, t0),
      V(f1.x + f1.nx * w1, f1.y + CEIL, f1.z + f1.nz * w1, sW, t1),
      V(f1.x - f1.nx * w1, f1.y + CEIL, f1.z - f1.nz * w1, 0, t1),
      [0, 1, 0]);
  }
}
function spec_hasCeiling(t) {
  return t.kind === 'hall' || t.kind === 'stairs' || t.kind === 'skywalk';
}

/* ---- the running track and football field ---- */

const trackSec = section('running_track', TEX.track, SURF.ASPHALT, CLIP.DEFAULT);
const finishSec = section('running_finish', TEX.trackFinish, SURF.ASPHALT, CLIP.DEFAULT);
{
  // centreline: west straight north, top bend, east straight south, bottom bend
  const pts = [];
  const cx = (OVAL.xw + OVAL.xe) / 2;
  const step = 18;
  for (let z = OVAL.z1; z > 30; z -= 20) pts.push([OVAL.xw, z, 0, -1]);
  pts.push([OVAL.xw, 30, 0, -1], [OVAL.xw, -30, 0, -1]);
  for (let z = -50; z > OVAL.z0; z -= 20) pts.push([OVAL.xw, z, 0, -1]);
  for (let a = 0; a < Math.PI; a += step / OVAL.r) {
    const th = Math.PI + a; // from west point round the north
    pts.push([cx + OVAL.r * Math.cos(th), OVAL.z0 + OVAL.r * Math.sin(th), -Math.sin(th), Math.cos(th)]);
  }
  for (let z = OVAL.z0; z < OVAL.z1; z += step) pts.push([OVAL.xe, z, 0, 1]);
  for (let a = 0; a < Math.PI; a += step / OVAL.r) {
    const th = a;
    pts.push([cx + OVAL.r * Math.cos(th), OVAL.z1 + OVAL.r * Math.sin(th), -Math.sin(th), Math.cos(th)]);
  }
  // make sure the finish line has clean edges at z = +-30 on the west straight
  let dist = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const onFinish = a[0] === OVAL.xw && b[0] === OVAL.xw && a[1] === 30 && b[1] === -30;
    const sec = onFinish ? finishSec : trackSec;
    const nA = [-a[3], a[2]], nB = [-b[3], b[2]];
    const unit = 400 / 2; // texture (64 px = 4 lanes) spans the 400-wide track; 32 px along = 200
    const base = Math.floor(dist / unit) * unit;
    let t0 = TC(((dist - base) / unit) * 32), t1 = TC(((dist + seg - base) / unit) * 32);
    if (onFinish) { t0 = 0; t1 = TC(32); }
    const hw = OVAL.hw;
    quad(sec,
      V(a[0] - nA[0] * hw, 0, a[1] - nA[1] * hw, 0, t0),
      V(a[0] + nA[0] * hw, 0, a[1] + nA[1] * hw, TC(64), t0),
      V(b[0] + nB[0] * hw, 0, b[1] + nB[1] * hw, TC(64), t1),
      V(b[0] - nB[0] * hw, 0, b[1] - nB[1] * hw, 0, t1),
      [0, 1, 0]);
    dist += seg;
  }
}

/* ---- terrain: flat lawn with holes for the building and the basement ramp */

const terrainSecs = {
  grass: section('terrain_grass', TEX.grass, SURF.GRASS, CLIP.DEFAULT),
  turf: section('terrain_turf', TEX.turf, SURF.GRASS, CLIP.DEFAULT),
  lot: section('terrain_lot', TEX.asphalt, SURF.ASPHALT, CLIP.DEFAULT),
  // the flower bed between the school and the garage: miss the window jump
  // and you land here (out-of-bounds) and Lakitu sets you on the garage deck
  pit: section('terrain_flowerbed', TEX.grass, 0xfd, CLIP.DEFAULT),
};
const APRON = 700; // paved ring round a sunken tower
const PIT = { x0: BLD.x1, x1: GAR_FOOT.x0, zN: Z_ROOM - 300, zS: Z_ROOM + 300 };
const inRect = (x, z, r) => x > r.x0 && x < r.x1 && z > r.zN && z < r.zS;
let mnX = Infinity, mxX = -Infinity, mnZ = Infinity, mxZ = -Infinity;
for (const f of frames) { mnX = Math.min(mnX, f.x); mxX = Math.max(mxX, f.x); mnZ = Math.min(mnZ, f.z); mxZ = Math.max(mxZ, f.z); }
const PAD = 1400;
const TX0 = Math.floor((Math.min(mnX, LOT.x0) - PAD) / 100) * 100, TX1 = Math.ceil((Math.max(mxX, LOT.x1) + PAD) / 100) * 100;
const TZ0 = Math.floor((Math.min(mnZ, LOT.zN) - PAD) / 100) * 100, TZ1 = Math.ceil((mxZ + PAD) / 100) * 100;
function terrainKind(cx, cz) {
  if (inRect(cx, cz, { x0: BLD.x0, x1: BLD.x1, zN: BLD.zN, zS: BLD.zS })) return null;
  // the sunken stair tower A: the lawn stops at its paved apron
  for (const t of TOWERS) if (t.y0 < GROUND && Math.hypot(cx - t.cx, cz - t.cz) < APRON - 80) return null;
  if (inRect(cx, cz, { x0: TRENCH.x0, x1: TRENCH.x1, zN: TRENCH.z1, zS: TRENCH.z0 })) return null;
  if (inRect(cx, cz, PIT)) return 'pit';
  if (inRect(cx, cz, FIELD)) return 'turf';
  if (inRect(cx, cz, LOT)) return 'lot';
  return 'grass';
}
for (let x = TX0; x < TX1; x += 100) for (let z = TZ0; z < TZ1; z += 100) {
  const kind = terrainKind(x + 50, z + 50);
  if (!kind) continue;
  const sec = terrainSecs[kind];
  const unit = kind === 'turf' ? 100 : 128;
  floorRect(sec, x, x + 100, z, z + 100, GROUND, sec.tex, unit, 100);
}
// concrete coping between the ramp walls and the lawn
{
  const cop = section('coping', TEX.concrete, SURF.CEMENT, CLIP.DEFAULT);
  floorRect(cop, TRENCH.x0, -HW, TRENCH.z1, TRENCH.z0, GROUND, TEX.concrete, 128, 100);
  floorRect(cop, HW, TRENCH.x1, TRENCH.z1, TRENCH.z0, GROUND, TEX.concrete, 128, 100);
}

/* ---- the school building ---- */

const facadeSec = section('facade', TEX.facade, SURF.CEMENT, CLIP.WALL);
const stoneSec = section('stone_trim', TEX.stone, SURF.CEMENT, CLIP.WALL);
const brickSec = section('brick', TEX.brick, SURF.CEMENT, CLIP.WALL);
const decorSec = (tex, name) => section(name, TEX[tex], SURF.CEMENT, CLIP.NONE);
const roofSec = section('roof', TEX.roof, SURF.CEMENT, CLIP.NONE);
// the classroom window you jump through (east wall)
const WIN = { z0: Z_ROOM - 150, z1: Z_ROOM + 150, y0: Y_ROOM + 12, y1: Y_ROOM + 190 };
/** wallRect with one rectangular hole (u measured from p0 along the wall). */
function wallHole(sec, p0, p1, y0, y1, tex, uPer, vPer, hole, opts = {}) {
  const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
  const P = (u) => [lerp(p0[0], p1[0], u / len), lerp(p0[1], p1[1], u / len)];
  const hu0 = clamp(hole.u0, 0, len), hu1 = clamp(hole.u1, 0, len);
  const hy0 = clamp(hole.y0, y0, y1), hy1 = clamp(hole.y1, y0, y1);
  if (hu1 <= hu0 || hy1 <= hy0) return wallRect(sec, p0, p1, y0, y1, tex, uPer, vPer, opts);
  if (hu0 > 0) wallRect(sec, p0, P(hu0), y0, y1, tex, uPer, vPer, opts);
  if (hu1 < len) wallRect(sec, P(hu1), p1, y0, y1, tex, uPer, vPer, opts);
  if (hy0 > y0) wallRect(sec, P(hu0), P(hu1), y0, hy0, tex, uPer, vPer, opts);
  if (hy1 < y1) wallRect(sec, P(hu0), P(hu1), hy1, y1, tex, uPer, vPer, opts);
}
{
  // outer walls, counter-clockwise seen from above so the right-hand normal
  // faces out; where a round stair tower stands across a wall, the wall stops
  // at the tower
  const corners = [[BLD.x0, BLD.zS], [BLD.x1, BLD.zS], [BLD.x1, BLD.zN], [BLD.x0, BLD.zN]];
  const outerEdges = [[corners[0], corners[1]], [corners[1], corners[2]], [corners[2], corners[3]], [corners[3], corners[0]]];
  // parts of p0->p1 (as [u0, u1] distances) outside every tower
  const outsideTowers = (p0, p1) => {
    const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    const d = [(p1[0] - p0[0]) / len, (p1[1] - p0[1]) / len];
    let parts = [[0, len]];
    for (const t of TOWERS) {
      const fx = p0[0] - t.cx, fz = p0[1] - t.cz;
      const bq = fx * d[0] + fz * d[1], cq = fx * fx + fz * fz - SPIRAL.wall ** 2;
      const disc = bq * bq - cq;
      if (disc <= 0) continue;
      const a0 = -bq - Math.sqrt(disc), a1 = -bq + Math.sqrt(disc);
      parts = parts.flatMap(([u0, u1]) => [[u0, Math.min(u1, a0)], [Math.max(u0, a1), u1]]).filter(([u0, u1]) => u1 - u0 > 1);
    }
    return parts.map(([u0, u1]) => [[p0[0] + d[0] * u0, p0[1] + d[1] * u0], [p0[0] + d[0] * u1, p0[1] + d[1] * u1], u0]);
  };
  for (const [a, b] of outerEdges) {
    const isEast = a[0] === BLD.x1 && b[0] === BLD.x1;
    for (const [p0, p1, u0] of outsideTowers(a, b)) {
      // east wall runs zS -> zN; the classroom window is a hole in it
      const hole = isEast ? { u0: BLD.zS - WIN.z1 - u0, u1: BLD.zS - WIN.z0 - u0, y0: WIN.y0, y1: WIN.y1 } : { u0: 0, u1: 0, y0: 0, y1: 0 };
      wallRect(stoneSec, p0, p1, GROUND, 40, TEX.stone, 64, 64);
      for (const [y0, y1] of [[40, 280], [280, 520], [520, 600]]) wallHole(facadeSec, p0, p1, y0, y1, TEX.facade, 100, 240, hole, { vAnchor: y0 });
      wallRect(stoneSec, p0, p1, 600, BLD.roof, TEX.stone, 64, 64);
    }
  }
  floorRect(roofSec, BLD.x0, BLD.x1, BLD.zN, BLD.zS, BLD.roof, TEX.roof, 128, 400);
  // the round stair towers: brick-and-window drum, stone cornice, slate cone
  for (const t of TOWERS) {
    const N = 40, rw = SPIRAL.wall;
    const top = t.y1 + CEIL + (t.y0 < GROUND ? 120 : 220);
    const yb = t.y0 < GROUND ? -3 : GROUND;
    const P = (k) => [t.cx + rw * Math.cos(-2 * Math.PI * k / N), t.cz + rw * Math.sin(-2 * Math.PI * k / N)];
    const drum = decorSec('facade', `tower_${t.name}`), trim = decorSec('stone', `tower_${t.name}_trim`);
    // doorways: wherever a corridor (not this tower's own ramp) passes through
    // the drum, leave the drum open from its floor to its ceiling
    const doorFrames = frames.filter((f) => { const tg = tagAt(f.s); return !(tg.kind === 'stairs' && tg.spiral === t.name); });
    const doorsAt = (p0, p1) => {
      const ivs = [];
      for (let q = 0; q <= 4; q++) {
        const x = lerp(p0[0], p1[0], q / 4), z = lerp(p0[1], p1[1], q / 4);
        for (const f of doorFrames) if (Math.hypot(x - f.x, z - f.z) < f.w + 40) ivs.push([f.y - 8, f.y + CEIL + 4]);
      }
      return ivs;
    };
    // draw [y0, y1] minus the doorway intervals
    const piece = (sec, p0, p1, y0, y1, ivs, tex, uP, vP, opts) => {
      let parts = [[y0, y1]];
      for (const [a, b] of ivs) parts = parts.flatMap(([u, v]) => [[u, Math.min(v, a)], [Math.max(u, b), v]]).filter(([u, v]) => v - u > 1);
      for (const [u, v] of parts) wallRect(sec, p0, p1, u, v, tex, uP, vP, opts);
    };
    for (let k = 0; k < N; k++) {
      // going round with the outside on the right (decreasing angle)
      const p0 = P(k), p1 = P(k + 1), ivs = doorsAt(p0, p1);
      piece(trim, p0, p1, yb, 40, ivs, TEX.stone, 64, 64);
      piece(drum, p0, p1, 40, top - 40, ivs, TEX.facade, 100, 240, { vAnchor: 40 });
      wallRect(trim, p0, p1, top - 40, top, TEX.stone, 64, 64);
    }
    const cone = decorSec('roof', `tower_${t.name}_roof`), apex = top + 260;
    for (let k = 0; k < N; k++) {
      const a = P(k), b = P(k + 1);
      const A = V(a[0], top, a[1], 0, TC(32)), B = V(b[0], top, b[1], TC(16), TC(32)), C = V(t.cx, apex, t.cz, TC(8), 0);
      cone.tris.push([A, C, B].map((v) => ({ ...v, n: v.n ?? triNormal(A, C, B) })));
    }
    if (t.y0 < GROUND) {
      // paved apron round the sunken tower, covering the lawn's cut edge
      const ap = section(`apron_${t.name}`, TEX.concrete, SURF.CEMENT, CLIP.DEFAULT);
      for (let k = 0; k < N; k++) {
        const a = P(k), b = P(k + 1);
        const q = (p, r) => [t.cx + (p[0] - t.cx) * r / rw, t.cz + (p[1] - t.cz) * r / rw];
        const [ax, az] = a, [bx, bz] = b, [cx2, cz2] = q(b, APRON), [dx2, dz2] = q(a, APRON);
        const v = (x, z) => V(x, -3, z, TC((x / 128) * 32), TC((z / 128) * 32), [0, 1, 0]);
        // a -> d -> c -> b winds up (outer ring goes the other way round)
        quad(ap, v(ax, az), v(dx2, dz2), v(cx2, cz2), v(bx, bz), [0, 1, 0]);
      }
    }
  }
  // the famous brick chimney
  box(decorSec('brick', 'chimney'), roofSec, 980, 1080, BLD.zN + 60, BLD.zN + 160, BLD.roof, BLD.roof + 220, TEX.brick, 100, 50, TEX.roof);

  // Main entrance tower on the south front, with the school's name
  const ex0 = 380, ex1 = 820, ez = BLD.zS + 110, top = 800;
  wallRect(brickSec, [ex0, BLD.zS], [ex0, ez], GROUND, top, TEX.brick, 100, 50); // faces west
  wallRect(brickSec, [ex1, ez], [ex1, BLD.zS], GROUND, top, TEX.brick, 100, 50); // faces east
  // front face (facing south) built from tiles left -> right (west -> east)
  const front = (x0, x1, y0, y1, tex, uPer, vPer, sec) => wallRect(sec, [x0, ez], [x1, ez], y0, y1, tex, uPer, vPer, { vAnchor: y0 });
  front(ex0, 500, GROUND, 260, TEX.brick, 100, 50, brickSec);
  front(700, ex1, GROUND, 260, TEX.brick, 100, 50, brickSec);
  front(500, 700, GROUND, 260, TEX.doors, 200, 265, decorSec('doors', 'entrance_doors'));
  front(ex0, ex1, 260, 300, TEX.stone, 64, 64, stoneSec);
  const signs = decorSec('signSouth', 'sign_south');
  const sc = decorSec('signCollegiate', 'sign_collegiate');
  const si = decorSec('signInstitute', 'sign_institute');
  const third = (ex1 - ex0) / 3;
  front(ex0, ex0 + third, 300, 380, TEX.signSouth, third, 80, signs);
  front(ex0 + third, ex0 + 2 * third, 300, 380, TEX.signCollegiate, third, 80, sc);
  front(ex0 + 2 * third, ex1, 300, 380, TEX.signInstitute, third, 80, si);
  front(ex0, ex1, 380, 420, TEX.stone, 64, 64, stoneSec);
  front(ex0, ex1, 420, 660, TEX.facade, 110, 240, facadeSec);
  front(ex0, ex1, 660, 740, TEX.facade, 110, 240, facadeSec);
  front(ex0, ex1, 740, top, TEX.stone, 64, 64, stoneSec);
  floorRect(roofSec, ex0, ex1, BLD.zS, ez, top, TEX.roof, 128, 400);
  panel(decorSec('signLondon', 'sign_london'), [600, ez + 2], [0, 1], 120, 50, 205, TEX.signLondon);

  // Basement doorway at the bottom of the ramp: stone lintel + SOUTH sign over it
  const lint = decorSec('stone', 'lintel');
  wallRect(lint, [TRENCH.x0, BLD.zS], [TRENCH.x1, BLD.zS], LV.B + CEIL, GROUND, TEX.stone, 64, 64);
  panel(decorSec('signSouth', 'sign_basement'), [0, BLD.zS + 3], [0, 1], 200, 100, 90, TEX.signSouth);
}

/* ---- the classroom: desks to weave through, a ramp out the window ---- */
{
  const R = ROOM, y = Y_ROOM;
  const kickFrames = frames.filter((f) => tagAt(f.s).kind === 'kicker');
  const underKicker = (x, z) => kickFrames.some((f) => Math.abs((x - f.x) * f.tx + (z - f.z) * f.tz) <= 10 && Math.abs((x - f.x) * f.nx + (z - f.z) * f.nz) <= f.w);
  // floor (open room, drivable anywhere between the desks), skipping the ramp
  const fl = section('floor_classroom', TEX.vct, SURF.ASPHALT, CLIP.DEFAULT);
  const C = 20;
  for (let x = R.x0; x < R.x1; x += C) for (let z = R.zN; z < R.zS; z += C) {
    if (underKicker(x + C / 2, z + C / 2)) continue;
    floorRect(fl, x, Math.min(x + C, R.x1), z, Math.min(z + C, R.zS), y, TEX.vct, 160, C);
  }
  // ceiling
  floorRect(section('ceiling_classroom', TEX.ceiling, SURF.CEMENT, CLIP.NONE), R.x0, R.x1, R.zN, R.zS, y + CEIL, TEX.ceiling, 128, 200);
  // walls (collision); door from the corridor on the west, window on the east
  const wb = wallSecs.block, wc = wallSecs.classroom, ww = wallSecs.windows;
  const H = { u0: 0, u1: 0, y0: 0, y1: 0 };
  // west wall (faces east into the room), door opening matches the corridor
  wallHole(wb, [R.x0, R.zS], [R.x0, R.zN], y, y + CEIL, TEX.block, 80, CEIL, { u0: R.zS - (Z_ROOM + HW), u1: R.zS - (Z_ROOM - HW), y0: y, y1: y + CEIL }, { vAnchor: y });
  // north wall (faces south) with the chalkboard
  wallRect(wb, [R.x1, R.zN], [R.x0, R.zN], y, y + CEIL, TEX.block, 80, CEIL, { vAnchor: y });
  panel(section('chalkboard', TEX.chalkboard, SURF.CEMENT, CLIP.NONE), [(R.x0 + R.x1) / 2 - 120, R.zN + 3], [0, 1], 420, 105, y + 60, TEX.chalkboard);
  // south wall (faces north): classroom doors and corkboards
  wallHole(wc, [R.x0, R.zS], [R.x1, R.zS], y, y + CEIL, TEX.classroom, 120, CEIL, H, { vAnchor: y });
  // east wall (faces west): windows, one of them knocked out for the jump
  wallHole(ww, [R.x1, R.zS], [R.x1, R.zN], y, y + CEIL, TEX.windows, 120, CEIL, { u0: R.zS - WIN.z1, u1: R.zS - WIN.z0, y0: WIN.y0, y1: WIN.y1 }, { vAnchor: y });
  // student desks in a grid, cleared along the racing line so there is always
  // a lane; the gaps between desks are wide enough to cut your own way through
  const deskWalls = section('desks', TEX.desk, SURF.CEMENT, CLIP.WALL);
  const deskTops = section('desk_tops', TEX.desk, SURF.CEMENT, CLIP.NONE);
  const lane = frames.filter((f) => ['classroom', 'kicker'].includes(tagAt(f.s).kind) || (tagAt(f.s).kind === 'hall' && f.x > R.x0 - 60 && f.y > LV.U - 1));
  const DW = 56, DD = 44, DH = 40;
  ROOM.desks = [];
  // desks line both sides of the aisle the racing line snakes along, then the
  // rest of the room fills with staggered rows; a desk is only dropped if one
  // of its corners would poke into the lane or crowd another desk
  const clear = (cx, cz) => [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]].every(([a, b]) =>
    lane.every((f) => Math.hypot(cx + a * DW / 2 - f.x, cz + b * DD / 2 - f.z) > f.w + 8)) &&
    ROOM.desks.every(([dx, dz]) => Math.abs(dx - cx) > DW + 18 || Math.abs(dz - cz) > DD + 18) &&
    cx - DW / 2 > R.x0 + 15 && cx + DW / 2 < R.x1 - 15 && cz - DD / 2 > R.zN + 15 && cz + DD / 2 < R.zS - 15 &&
    !(cx > R.x0 + 290 && cx < R.x0 + 490 && cz < R.zN + 110); // teacher's desk
  const put = (x, z) => { if (!clear(x, z)) return; box(deskWalls, deskTops, x - DW / 2, x + DW / 2, z - DD / 2, z + DD / 2, y, y + DH, TEX.desk, 56, 40, TEX.desk); ROOM.desks.push([x, z]); };
  const aisle = frames.filter((f) => tagAt(f.s).kind === 'classroom');
  for (const off of [92, 100, 110]) for (const f of aisle) for (const side of [-1, 1]) put(f.x + f.nx * side * off, f.z + f.nz * side * off);
  for (let row = 0, z = R.zN + 45; z <= R.zS - 45; z += 80, row++) for (let x = R.x0 + 60 + (row % 2) * 45; x <= R.x1 - 60; x += 90) put(x, z);
  // teacher's desk by the board
  box(deskWalls, deskTops, R.x0 + 330, R.x0 + 450, R.zN + 15, R.zN + 60, y, y + 46, TEX.desk, 120, 46, TEX.desk);
}

/* ---- parking garage structure ---- */

const garageFrames = frames.filter((f) => tagAt(f.s).kind !== 'track');
const nearGarageRoute = (x, z, pad, levels) =>
  garageFrames.some((f) => (!levels || levels.includes(tagAt(f.s).level)) && Math.hypot(x - f.x, z - f.z) < f.w + pad);
{
  const deck = section('garage_deck', TEX.concrete, SURF.CEMENT, CLIP.NONE);
  const C = 50;
  for (let x = GAR_FOOT.x0; x < GAR_FOOT.x1; x += C) for (let z = GAR_FOOT.zN; z < GAR_FOOT.zS; z += C) {
    if (nearGarageRoute(x + C / 2, z + C / 2, 8, ['top', 'ramp'])) continue;
    floorRect(deck, x, x + C, z, z + C, GAR.deck - 1, TEX.concrete, 128, C);
  }
  // deck edge fascia (visual) with a gap where the skywalk comes in
  const fas = decorSec('parapet', 'garage_fascia');
  const y0 = GAR.deck - 50, y1 = GAR.deck + 60;
  wallRect(fas, [GAR_FOOT.x0, GAR_FOOT.zS], [GAR_FOOT.x1, GAR_FOOT.zS], y0, y1, TEX.parapet, 128, 110);
  wallRect(fas, [GAR_FOOT.x1, GAR_FOOT.zS], [GAR_FOOT.x1, GAR_FOOT.zN], y0, y1, TEX.parapet, 128, 110);
  wallRect(fas, [GAR_FOOT.x1, GAR_FOOT.zN], [GAR_FOOT.x0, GAR_FOOT.zN], y0, y1, TEX.parapet, 128, 110);
  wallRect(fas, [GAR_FOOT.x0, GAR_FOOT.zN], [GAR_FOOT.x0, GAR.nz - GAR.hw], y0, y1, TEX.parapet, 128, 110);
  wallRect(fas, [GAR_FOOT.x0, GAR.nz + GAR.hw], [GAR_FOOT.x0, GAR_FOOT.zS], y0, y1, TEX.parapet, 128, 110);
  panel(decorSec('signP', 'sign_p'), [GAR_FOOT.x0 - 3, GAR.nz + GAR.hw + 140], [-1, 0], 90, 90, GAR.deck + 70, TEX.signP);
  panel(decorSec('signP', 'sign_p2'), [GAR_FOOT.x0 + 300, GAR_FOOT.zS + 3], [0, 1], 90, 90, GAR.deck + 70, TEX.signP);
  // columns, kept clear of every aisle on both levels
  const col = section('garage_columns', TEX.concrete, SURF.CEMENT, CLIP.WALL);
  for (let x = GAR_FOOT.x0 + 60; x <= GAR_FOOT.x1 - 60; x += 270) for (let z = GAR_FOOT.zN + 60; z <= GAR_FOOT.zS - 60; z += 270) {
    if (nearGarageRoute(x, z, 50)) continue;
    box(col, null, x - 20, x + 20, z - 20, z + 20, GROUND, GAR.deck - 1, TEX.concrete, 64, 64);
  }
  // parked cars (solid boxes) in the stall areas on both levels
  const carTex = ['carRed', 'carBlue', 'carWhite', 'carGrey'];
  const carSecs = carTex.map((k) => section(`cars_${k}`, TEX[k], SURF.CEMENT, CLIP.WALL));
  const carTop = section('car_roofs', TEX.concrete, SURF.CEMENT, CLIP.NONE);
  let ci = 0;
  for (const level of [0, GAR.deck]) {
    for (let x = GAR_FOOT.x0 + 90; x <= GAR_FOOT.x1 - 90; x += 120) for (let z = GAR_FOOT.zN + 130; z <= GAR_FOOT.zS - 130; z += 300) {
      if (nearGarageRoute(x, z, 140)) continue;
      if (level === GAR.deck && nearGarageRoute(x, z, 200, ['ramp'])) continue;
      if (level === 0) {
        // keep cars out from under the deck edge columns
        if (((x - GAR_FOOT.x0 - 60) % 270 + 270) % 270 < 60) continue;
      }
      ci++;
      if (ci % 5 === 0) continue; // a few empty stalls
      const sec = carSecs[ci % carSecs.length];
      box(sec, carTop, x - 40, x + 40, z - 90, z + 90, level + (level ? 0 : GROUND), level + 65, sec.tex, 180, 65, TEX.concrete);
    }
  }
}

/* ---- bleachers and scoreboard by the running track ---- */
{
  const bl = section('bleachers', TEX.bleacher, SURF.CEMENT, CLIP.WALL);
  const blTop = section('bleacher_seats', TEX.bleacher, SURF.CEMENT, CLIP.NONE);
  const X0 = OVAL.xw - OVAL.hw - 70, Z0 = -380, Z1 = 380, ROWS = 6, D = 55, H = 32;
  for (let i = 0; i < ROWS; i++) {
    const xa = X0 - D * (i + 1), xb = X0 - D * i, yTop = GROUND + H * (i + 1);
    wallRect(bl, [xb, Z1], [xb, Z0], yTop - H, yTop, TEX.bleacher, 64, 32);  // riser facing the track
    floorRect(blTop, xa, xb, Z0, Z1, yTop, TEX.bleacher, 64, 200);
    wallRect(bl, [xa, Z0], [xb, Z0], GROUND, yTop, TEX.bleacher, 64, 64);
    wallRect(bl, [xb, Z1], [xa, Z1], GROUND, yTop, TEX.bleacher, 64, 64);
  }
  wallRect(bl, [X0 - D * ROWS, Z1], [X0 - D * ROWS, Z0], GROUND, GROUND + H * ROWS, TEX.bleacher, 64, 64);
  // scoreboard south of the oval, facing the final bend
  const sbz = OVAL.z1 + OVAL.r + OVAL.hw + 260, cx = (OVAL.xw + OVAL.xe) / 2;
  panel(decorSec('signGo', 'scoreboard'), [cx, sbz - 2], [0, -1], 420, 210, 170, TEX.signGo);
  wallRect(decorSec('parapet', 'scoreboard_back'), [cx + 210, sbz], [cx - 210, sbz], 170, 380, TEX.parapet, 128, 210);
  const ps = section('posts', TEX.concrete, SURF.CEMENT, CLIP.WALL);
  for (const px of [cx - 150, cx + 150]) box(ps, null, px - 12, px + 12, sbz - 12, sbz + 12, GROUND, 170, TEX.concrete, 64, 64);
}

/* ---- signs at the fork where the race leaves the running track ---- */
// on posts, high enough to read over the fences
for (const [sx, key, name] of [[OVAL.xw + OVAL.hw + 120, 'signClosed', 'sign_closed'], [OVAL.xw - OVAL.hw - 120, 'signSchool', 'sign_school']]) {
  const sz = OVAL.z0 - 60;
  panel(decorSec(key, name), [sx, sz], [0, 1], 170, 85, 75, TEX[key]);
  const ps = section('posts', TEX.concrete, SURF.CEMENT, CLIP.WALL);
  for (const px of [sx - 70, sx + 70]) box(ps, null, px - 5, px + 5, sz - 8, sz - 2, GROUND, 75, TEX.concrete, 64, 64);
}

/* ---- invisible perimeter ---- */
{
  const per = section('perimeter', TEX.concrete, SURF.CEMENT, CLIP.WALL, LAYER.INVISIBLE);
  const c = [[TX0, TZ0], [TX1, TZ0], [TX1, TZ1], [TX0, TZ1]];
  for (let k = 0; k < 4; k++) wallRect(per, c[k], c[(k + 1) % 4], -20, 220, TEX.concrete, 128, 128);
}

/* ---------------------------------------------------------------- path */

const pathPts = [], pathS = [];
const S_LIP = starts[prims.findIndex((p) => p.tag.kind === 'gap')];
for (let s = 0; s < L - PATH_SPACING / 2; s += PATH_SPACING) {
  const f = frame(s);
  // no waypoints over the gap, nor on the 150 before the window, so Lakitu
  // never drops anyone mid-air or right on the ramp with no run-up
  if (tagAt(s).kind === 'gap' || (s > S_LIP - 150 && s <= S_LIP)) continue;
  pathPts.push({ x: Math.round(f.x), y: Math.round(f.y), z: Math.round(f.z) }); pathS.push(s);
}
pathPts[0] = { x: 0, y: 0, z: 0 };

/* -------------------------------------------------------------- actors */

const actors = [];
// Item boxes come in tight clusters: two staggered rows, boxes 34 apart
// across the lane and the rows 40 apart, so a pack of karts can all grab one.
const ITEM_GAP = 34, ROW_GAP = 40;
function itemCluster(s, n) {
  for (let row = 0; row < 2; row++) {
    const f = frame(s + row * ROW_GAP), m = n - row; // second row is one box shorter, offset half a gap
    for (let k = 0; k < m; k++) {
      const lat = (k - (m - 1) / 2) * ITEM_GAP;
      actors.push({ Name: 'mk:item_box', Location: { x: Math.round(f.x + f.nx * lat), y: Math.round(f.y + 5), z: Math.round(f.z + f.nz * lat) } });
    }
  }
}
const sOf = (pred) => { for (let i = 0; i < prims.length; i++) if (pred(prims[i].tag, i)) return [starts[i], prims[i].len]; return null; };
const sOfAll = (pred) => prims.map((p, i) => [p, i]).filter(([p, i]) => pred(p.tag, i)).map(([p, i]) => [starts[i], p.len]);
{
  const [s1, l1] = sOf((t) => t.kind === 'path'); itemCluster(s1 + l1 * 0.5, 6);
  // basement corridor before tower A
  const halls = sOfAll((t) => t.kind === 'hall' && !t.entry);
  const longest = (fl) => sOfAll((t) => t.kind === 'hall' && t.floor === fl && !t.entry).sort((x, y) => y[1] - x[1])[0];
  const [sb, lb] = longest('B'); itemCluster(sb + lb * 0.55, 5);
  // the ground-floor locker hallway between the two towers
  const [sgh, lgh] = longest('G'); itemCluster(sgh + lgh * 0.5, 5);
  // the long upper corridor
  const [su, lu] = longest('U'); itemCluster(su + lu * 0.5, 5);
  const [sg, lg] = sOf((t) => t.kind === 'garage' && t.level === 'top'); itemCluster(sg + lg * 0.55, 6);
  const [sc] = sOf((t) => t.kind === 'classroom'); itemCluster(sc + 110, 3);
  const trackIdx = prims.map((p, i) => [p, i]).filter(([p]) => p.tag.kind === 'track');
  const back = trackIdx[1]; itemCluster(starts[back[1]] + back[0].len * 0.5, 7);
}
// Trees on open lawn
{
  let seed = 22;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const placed = [];
  const keepOut = [
    { x0: BLD.x0 - 150, x1: BLD.x1 + 150, zN: BLD.zN - 150, zS: BLD.zS + 450 }, // keep the front lawn clear
    { x0: LOT.x0 - 100, x1: LOT.x1 + 100, zN: LOT.zN - 100, zS: LOT.zS + 100 },
    { x0: -900, x1: -200, zN: -500, zS: 500 }, // bleachers
  ];
  for (let k = 0; k < 2000 && placed.length < 46; k++) {
    const x = lerp(TX0 + 300, TX1 - 300, rnd()), z = lerp(TZ0 + 300, TZ1 - 300, rnd());
    if (keepOut.some((r) => inRect(x, z, r))) continue;
    if (ovalDist(x, z) < OVAL.hw + 120 || inRect(x, z, { x0: OVAL.xw, x1: OVAL.xe, zN: OVAL.z0 - OVAL.r, zS: OVAL.z1 + OVAL.r })) continue;
    if (Math.abs(z - (OVAL.z1 + OVAL.r + OVAL.hw + 260)) < 150 && Math.abs(x - 450) < 400) continue;
    if (frames.some((f) => Math.hypot(x - f.x, z - f.z) < f.w + 230)) continue;
    if (placed.some((p) => Math.hypot(x - p.x, z - p.z) < 260)) continue;
    placed.push({ x, z });
  }
  placed.forEach((p, i) => actors.push({ Name: i % 3 === 0 ? 'mk:tree_mario_raceway' : 'mk:tree_royal_raceway', Location: { x: Math.round(p.x), y: GROUND, z: Math.round(p.z) } }));
}

/* -------------------------------------------------------------- minimap */

const MM = { w: 96, h: 128 };
let pminX = Infinity, pmaxX = -Infinity, pminZ = Infinity, pmaxZ = -Infinity;
for (const p of pathPts) { pminX = Math.min(pminX, p.x); pmaxX = Math.max(pmaxX, p.x); pminZ = Math.min(pminZ, p.z); pmaxZ = Math.max(pmaxZ, p.z); }
MM.scale = Math.min((MM.w - 10) / (pmaxX - pminX + 400), (MM.h - 10) / (pmaxZ - pminZ + 400));
MM.scale = Math.floor(MM.scale * 1000) / 1000;
MM.playerX = Math.round(MM.w / 2 - ((pminX + pmaxX) / 2) * MM.scale);
MM.playerY = Math.round(MM.h / 2 - ((pminZ + pmaxZ) / 2) * MM.scale);
const mmPix = new Uint8Array(MM.w * MM.h);
const plot = (px, py, rr) => {
  for (let dy = -rr; dy <= rr; dy++) for (let dx = -rr; dx <= rr; dx++) {
    const x = Math.round(px + dx), y = Math.round(py + dy);
    if (x >= 0 && y >= 0 && x < MM.w && y < MM.h && dx * dx + dy * dy <= rr * rr + 0.5) mmPix[y * MM.w + x] = 255;
  }
};
for (let s = 0; s < L; s += 4) { const p = primAt(s).p.at(primAt(s).u); plot(MM.playerX + p.x * MM.scale, MM.playerY + p.z * MM.scale, 1); }
function pngGray(w, h, pix) {
  const img = { w, h, p: new Float32Array(w * h * 3) };
  for (let i = 0; i < w * h; i++) img.p[i * 3] = img.p[i * 3 + 1] = img.p[i * 3 + 2] = pix[i] / 255;
  return toPNG(img, deflateSync);
}
const minimapPng = pngGray(MM.w, MM.h, mmPix);

/* --------------------------------------------------------- XML emitters */

const VTX_BATCH = 32;
const r = Math.round;
const nb = (v) => clamp(r(v * 127), -128, 127);
function materialXml(tex) {
  const line = (tex.w * 16) / 8 / 8;
  const lrs = tex.w * tex.h - 1;
  const words = Math.max(1, (tex.w * 2) / 8);
  const dxt = Math.floor((2048 + words - 1) / words);
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
  const name = sec.name;
  const verts = [], batches = [];
  const per = Math.floor(VTX_BATCH / 3);
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
  return [
    [`${DIR}/${name}_vtx_0`, vtx.join('\n')],
    [`${DIR}/${name}_tri_0`, tri.join('\n')],
    [`${DIR}/${name}_mesh`, root],
    [`${DIR}/mat_${name}`, materialXml(sec.tex)],
    [`${DIR}/mat_revert_${name}`, materialRevertXml],
  ];
}

// floors first, then walls, then visual-only (the double-sided-wall flag is sticky)
const all = [...sections.values()].filter((s) => s.tris.length);
const rank = (s) => (s.clip === CLIP.DEFAULT ? 0 : s.clip === CLIP.WALL ? 1 : 2);
const secList = all.sort((a, b) => rank(a) - rank(b));

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
    Name: 'South C.I.',
    DebugName: 'southci',
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
    FarPersp: 7000.0,
    LakituTowType: 0,
    Sequence: 31, // MUSIC_SEQ_MARIO_RACEWAY
    WaterLevel: -600.0,
    // TopRight, BottomRight, BottomLeft, TopLeft, then floor colours: a hazy Ontario sky
    Skybox: [70, 130, 205, 190, 215, 235, 190, 215, 235, 70, 130, 205, 110, 140, 100, 110, 140, 100, 110, 140, 100, 110, 140, 100],
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
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
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
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
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
  frames: frames.map((f) => ({ s: f.s, x: f.x, y: f.y, z: f.z, w: f.w, nx: f.nx, nz: f.nz, kind: tagAt(Math.min(f.s, L - 1)).kind, floor: tagAt(Math.min(f.s, L - 1)).floor ?? null })),
  actors,
  marks: { L, BLD, OVAL, GAR, TRENCH, TOWERS, SPIRAL },
  minimap: MM,
}));

const triCount = secList.reduce((a, s) => a + s.tris.length, 0);
const collTris = secList.filter((s) => s.clip !== 0).reduce((a, s) => a + s.tris.length, 0);
console.log(`South C.I.: lap ${Math.round(L)} units, ${pathPts.length} waypoints, ${triCount} triangles (${collTris} with collision), ${secList.length} sections`);
console.log(`  textures packed: ${[...usedTex].filter((p) => p.startsWith(DIR)).length}; actors ${actors.length} (${actors.filter((a) => a.Name === 'mk:item_box').length} item boxes)`);
console.log(`  minimap ${MM.w}x${MM.h} scale ${MM.scale} @(${MM.playerX},${MM.playerY})`);
