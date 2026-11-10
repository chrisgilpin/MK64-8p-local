#!/usr/bin/env node
/**
 * "Cottage Living Room" — a SpaghettiKart track where the karts are toy cars
 * racing round a lakeside cottage living room (built from the owner's photos).
 *
 * Scale: 6 game units to the centimetre, so a kart is a ~3 cm toy car, the
 * coffee table stands 270 tall and the stone chimney rises out of sight.
 *
 * Lap (the race starts at the origin heading -Z, towards the lake windows):
 *   1. Down the faded Persian runner between the striped sofa and the piano,
 *      walled in by wooden toy blocks.
 *   2. Onto an orange toy race track: past the armchair (under the arm of the
 *      chrome floor lamp), west along the lake windows past the boot tray and
 *      the crocs, climbing on stacks of books.
 *   3. A hairpin high above the floor, then along and round onto the walnut
 *      coffee table. Drive the table top past the magazines (no rails: fall
 *      off and Lakitu fishes you off the floor), jump off a magazine stack
 *      onto the tufted ottoman, then off a cushion down onto the stone hearth.
 *   4. Straight through the fireplace, out the back of the chimney, and round
 *      on the orange track to the start.
 * The floor is lava: touch the bare floorboards (or the rugs off the course)
 * and Lakitu puts you back.
 *
 * Usage: node make-cottage.mjs [outDir]
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { makeTextures, texResource, toPNG } from './textures.mjs';

const TRACK = 'cottage';
const MOD = 'cottage-living-room';
const RES = 'chris:cottage';
const DIR = `tracks/${TRACK}`;
const OUT = process.argv[2] ?? '.';

const PAINTED = makeTextures();
const TEX = {};
for (const [k, im] of Object.entries(PAINTED)) TEX[k] = { path: `${DIR}/tex_${k}`, w: im.w, h: im.h, custom: true, cutout: !!im.cutout };

const SURF = { ASPHALT: 1, CEMENT: 4, WOOD: 17, OOB: 0xfd };
const CLIP = { NONE: 0, DEFAULT: 1, WALL: 4 };
const LAYER = { INVISIBLE: 0, OPAQUE: 1 };

const G_MAX = 0.14;
const SAMPLE = 18;
const PATH_SPACING = 25;
const KICK = 0.35;
const RUG_Y = 8, TRACK_Y = 10;
const ROOM = { x0: -3400, x1: 1000, z0: -3300, z1: 2700, wall: 1700, ridge: 2600, ridgeZ: -300 };

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


// Path additions: a kicker (quadratic up-curve to `slope`) and an empty gap
Path.prototype.kicker = function (len, slope, tag) {
  const { x, z, psi, y } = this.cur, dx = Math.cos(psi), dz = Math.sin(psi), a = slope / (2 * len);
  return this.push(len, (u) => ({ x: x + dx * u, z: z + dz * u, tx: dx, tz: dz }), (u) => y + a * u * u, tag);
};
Path.prototype.gap = function (len, yLand, tag) {
  const { x, z, psi, y } = this.cur, dx = Math.cos(psi), dz = Math.sin(psi);
  return this.push(len, (u) => ({ x: x + dx * u, z: z + dz * u, tx: dx, tz: dz }), (u) => lerp(y, yLand, u / len), { ...tag, gap: true });
};

/* ------------------------------------------------------------ route tags */

const BLOCKS = { tex: 'blocks', h: 46, off: 8, top: true };
const CURB = { tex: 'orangeCurb', h: 22, off: 0, top: true };
const RUNNER = (o = {}) => ({ kind: 'runner', hw: 240, floor: 'persian', surf: SURF.ASPHALT, walls: [BLOCKS, BLOCKS], ...o });
const TOYTRACK = (o = {}) => ({ kind: 'track', hw: 130, floor: 'orange', surf: SURF.ASPHALT, walls: [CURB, CURB], ...o });
const TABLE = (o = {}) => ({ kind: 'table', hw: 225, floor: 'walnut', surf: SURF.WOOD, walls: [null, null], ...o });
const OTTOMAN = (o = {}) => ({ kind: 'ottoman', hw: 200, floor: 'ottoman', surf: SURF.CEMENT, walls: [null, null], ...o });
const HEARTH = (o = {}) => ({ kind: 'hearth', hw: 170, floor: 'hearth', surf: SURF.CEMENT, walls: [null, null], ...o });
const FIREBOX = (o = {}) => ({ kind: 'firebox', hw: 170, floor: 'hearth', surf: SURF.CEMENT, walls: [{ tex: 'firebrick', h: 360, off: 70 }, { tex: 'firebrick', h: 360, off: 70 }], ceil: 360, ...o });
const GAP = (o = {}) => ({ kind: 'gap', hw: 170, walls: [null, null], ...o });

/* --------------------------------------------------------------- the lap */

const M = new Path(0, 0, -Q, RUG_Y);
const mark = {};
// 1. the Persian runner, between the sofa's back and the piano
M.line(1400, RUG_Y, RUNNER({ name: 'The Runner' }));
// 2. onto the orange toy track, round past the armchair and the floor lamp
M.line(500, TRACK_Y, TOYTRACK({ name: 'Toy Track' }));
M.arc(450, -Q, TRACK_Y, TOYTRACK());
mark.climb0 = M.len;
const TOP = 270; // coffee-table height (45 cm)
{
  const L = (TOP - TRACK_Y) / G_MAX - 150;
  M.gline(150, 0, G_MAX, TOYTRACK({ name: 'Book Climb' })); M.gline(L, G_MAX, G_MAX, TOYTRACK()); M.gline(150, G_MAX, 0, TOYTRACK());
}
mark.climb1 = M.len;
// 3. hairpin high over the floor, back east, then round onto the coffee table
M.arc(300, -Math.PI, TOP, TOYTRACK({ name: 'Hairpin' }));
mark.high0 = M.len;
M.line(-1850 - M.cur.x, TOP, TOYTRACK());
M.arc(300, Q, TOP, TOYTRACK());
mark.tableX = M.cur.x;
M.line(600, TOP, TOYTRACK());
mark.table0 = M.len; mark.tableZ0 = M.cur.z;
const TABLE_LEN = 780, KICK1 = 120, GAP1 = 150, OTT_TOP = 200, OTT_LEN = 400, KICK2 = 110, GAP2 = 190, HEARTH_Y = 60;
M.line(TABLE_LEN - KICK1, TOP, TABLE({ name: 'Coffee Table' }));
M.kicker(KICK1, KICK, { kind: 'kicker', hw: 225, floor: 'magazines', surf: SURF.WOOD, walls: [null, null], mandatory: true, on: 'table' });
mark.lip1 = M.len; mark.tableZ1 = M.cur.z;
M.gap(GAP1, OTT_TOP, GAP({ jump: 'Magazine Jump' }));
mark.ottZ0 = M.cur.z;
M.line(OTT_LEN - KICK2, OTT_TOP, OTTOMAN({ name: 'Ottoman' }));
M.kicker(KICK2, KICK, { kind: 'kicker', hw: 200, floor: 'pillow', surf: SURF.CEMENT, walls: [null, null], mandatory: true, on: 'ottoman' });
mark.lip2 = M.len; mark.ottZ1 = M.cur.z;
M.gap(GAP2, HEARTH_Y, GAP({ jump: 'Cushion Drop' }));
mark.hearthZ0 = M.cur.z;
M.line(300, HEARTH_Y, HEARTH({ name: 'Hearth' }));
mark.fire0 = M.len; mark.fireZ0 = M.cur.z;
M.line(400, HEARTH_Y, FIREBOX({ name: 'Through the Fireplace' }));
mark.fire1 = M.len; mark.fireZ1 = M.cur.z;
M.line(100, HEARTH_Y, HEARTH());
// 4. down off the back hearth and round the back of the room to the start
M.line(300, TRACK_Y, TOYTRACK());
M.arc(400, -Q, TRACK_Y, TOYTRACK());
mark.back0 = M.len;
M.line(-400 - M.cur.x, TRACK_Y, TOYTRACK({ name: 'Back Room' }));
mark.back1 = M.len;
M.arc(400, -Q, TRACK_Y, TOYTRACK());
mark.final0 = M.len;
M.line(M.cur.z - 550, TRACK_Y, TOYTRACK());
M.line(550, RUG_Y, RUNNER());
if (Math.hypot(M.cur.x, M.cur.z) > 0.5) throw new Error(`lap does not close: ${M.cur.x.toFixed(1)}, ${M.cur.z.toFixed(1)}`);
const L = M.len;

// furniture placed round the route
const TBL = { x0: mark.tableX - 225, x1: mark.tableX + 225, z0: mark.tableZ0, z1: mark.tableZ0 + TABLE_LEN, top: TOP };
const OTT = { x0: mark.tableX - 200, x1: mark.tableX + 200, z0: mark.ottZ0, z1: mark.ottZ1, top: OTT_TOP };
const HRTH = { x0: mark.tableX - 500, x1: mark.tableX + 500, z0: mark.hearthZ0, z1: mark.fireZ0, top: HEARTH_Y };
const CHIM = { x0: mark.tableX - 750, x1: mark.tableX + 750, z0: mark.fireZ0, z1: mark.fireZ1, open: 240, openTop: HEARTH_Y + 360 };
const SOFA = { x0: -850, x1: -280, z0: -1350, z1: -50, seat: 285, arm: 390, back: 540 };
const LOVE = { x0: TBL.x0 - 900, x1: TBL.x0 - 330, z0: TBL.z0 - 70, z1: TBL.z0 + 890, seat: 285, arm: 390, back: 540 };
const PIANO = { x0: 830, x1: 1000, z0: -1250, z1: -250, keys: 450 };

/* ------------------------------------------------- jump analysis (engine physics) */

// normal flight: gravity 2600 with DAC 2 well above the ground (1 near it); horizontal speed holds
function jumpReport(name, lipS) {
  const lip = M.pose(lipS);
  const ground = (d) => { const s = lipS + d; const p = M.piece(Math.min(s, L - 1)); return p.tag.gap ? 0 : M.pose(s).y; };
  let need = null; const rows = [];
  for (let v = 3; v <= 9.01; v += 0.25) {
    let x = 0, y = lip.y, vy = KICK * v, landed = null;
    for (let t = 1; t < 400 && landed === null; t++) {
      const g = ground(x);
      vy += (-2600 - vy * 696) / 6000 / (y - g > 50 ? 2 : 1);
      const yPrev = y; x += v; y += vy;
      const g2 = ground(x);
      if (y <= g2) landed = g2 > 0.5 && yPrev >= g2 - 12 ? x : false;
    }
    rows.push({ v, landed });
    if (landed && need === null) need = v;
  }
  const at = (v) => rows.find((r) => Math.abs(r.v - v) < 0.01);
  console.log(`  ${name.padEnd(14)} lip y=${lip.y.toFixed(0)} min speed ${need ?? 'never'}  ` + [4, 5, 6, 7, 8, 9].map((v) => `v${v}:${at(v).landed ? Math.round(at(v).landed) : 'FALL'}`).join(' '));
  return { name, need, rows: rows.map((r) => ({ v: r.v, landed: r.landed })) };
}
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
  panel(section('deco_sign_backs', TEX.black, SURF.CEMENT, CLIP.NONE), [c[0] - normal[0] * 1.5, c[1] - normal[1] * 1.5], [-normal[0], -normal[1]], w, h, y0, TEX.black);
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

/* ------------------------------------------------- route floors, walls, ceilings */

const FLOOR_U = { persian: 480, orange: 120, walnut: 200, magazines: 120, ottoman: 140, pillow: 80, hearth: 160 };
const floorSecs = new Map();
function routeFloor(key, surf) {
  const name = `floor_${key}`;
  if (!floorSecs.has(name)) floorSecs.set(name, section(name, TEX[key], surf, CLIP.DEFAULT));
  return floorSecs.get(name);
}
const WALL_U = { blocks: 64, orangeCurb: 60, firebrick: 120 };
const wallSec = (key) => section(`wall_${key}`, TEX[key], SURF.CEMENT, CLIP.WALL);
const tops = (key) => section(`walltop_${key}`, TEX[key], SURF.CEMENT, CLIP.NONE);
const fasciaSec = section('track_fascia', TEX.orangeCurb, SURF.ASPHALT, CLIP.NONE);
const undersideSec = section('track_underside', TEX.orangeCurb, SURF.ASPHALT, CLIP.NONE);
const fireCeil = section('firebox_ceiling', TEX.firebrick, SURF.CEMENT, CLIP.NONE);

for (let i = 0; i + 1 < frames.length; i++) {
  const f0 = frames[i], f1 = frames[i + 1];
  const t = tagAt((f0.s + f1.s) / 2);
  if (t.gap) continue;
  // floor ribbon (across the full width of table / ottoman tops)
  let key = t.floor;
  if (t.kind === 'runner' && (f0.s < 30 || f0.s >= L - 30)) key = 'finish';
  const sec = key === 'finish' ? routeFloor('finish', SURF.ASPHALT) : routeFloor(key, t.surf);
  const tex = TEX[key];
  let t0, t1;
  if (key === 'finish') {
    const wrap = (s) => (s > L / 2 ? s - L : s) + 30;
    t0 = TC((wrap(f0.s) / 60) * tex.h); t1 = TC(((f1.s >= L - 1e-6 ? 30 : wrap(f1.s)) / 60) * tex.h);
  } else {
    const unit = FLOOR_U[key], base = Math.floor(f0.s / unit) * unit;
    t0 = TC(((f0.s - base) / unit) * tex.h); t1 = TC(((f1.s - base) / unit) * tex.h);
  }
  const across = key === 'hearth' ? 2 : 1;
  for (let k = 0; k < 2; k++) {
    const la = lerp(-1, 1, k / 2), lb = lerp(-1, 1, (k + 1) / 2);
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
    const e0 = E(f0), e1 = E(f1), wt = TEX[w.tex], uPer = WALL_U[w.tex];
    const base = Math.floor(f0.s / uPer) * uPer;
    const sA = TC(((f0.s - base) / uPer) * wt.w), sB = TC(((f1.s - base) / uPer) * wt.w);
    const vT = w.tex === 'blocks' ? TC(wt.h * (w.h / 64)) : TC(wt.h);
    quad(wallSec(w.tex), V(e0[0], f0.y, e0[1], sA, vT), V(e1[0], f1.y, e1[1], sB, vT), V(e1[0], f1.y + w.h, e1[1], sB, 0), V(e0[0], f0.y + w.h, e0[1], sA, 0), normalize([-side * f0.nx, 0.7, -side * f0.nz]));
    if (w.top) {
      const th = w.tex === 'blocks' ? 30 : 8, o0 = E(f0, th), o1 = E(f1, th);
      quad(tops(w.tex), ...[e0, o0, o1, e1].map((p, j) => V(p[0], (j < 2 ? f0.y : f1.y) + w.h, p[1], TC(j === 1 || j === 2 ? 4 : 0), TC(j >= 2 ? 4 : 0))), [0, 1, 0]);
      // outer face of the block wall / curb
      quad(wallSec(w.tex), V(o1[0], f1.y, o1[1], sB, vT), V(o0[0], f0.y, o0[1], sA, vT), V(o0[0], f0.y + w.h, o0[1], sA, 0), V(o1[0], f1.y + w.h, o1[1], sB, 0), normalize([side * f0.nx, 0.7, side * f0.nz]));
    }
  });
  if (t.ceil) {
    const w0 = f0.w + 70, w1 = f1.w + 70;
    quad(fireCeil, V(f0.x - f0.nx * w0, f0.y + t.ceil, f0.z - f0.nz * w0, 0, 0), V(f0.x + f0.nx * w0, f0.y + t.ceil, f0.z + f0.nz * w0, TC(96), 0),
      V(f1.x + f1.nx * w1, f1.y + t.ceil, f1.z + f1.nz * w1, TC(96), TC(8)), V(f1.x - f1.nx * w1, f1.y + t.ceil, f1.z - f1.nz * w1, 0, TC(8)), [0, -1, 0]);
  }
  // raised toy track: a plastic edge and an underside
  if (t.kind === 'track' && Math.max(f0.y, f1.y) > 16) {
    for (const side of [-1, 1]) {
      const E = (f) => [f.x + side * f.nx * (f.w + 8), f.z + side * f.nz * (f.w + 8)];
      const [a, b] = side < 0 ? [E(f1), E(f0)] : [E(f0), E(f1)];
      const [ya, yb] = side < 0 ? [f1.y, f0.y] : [f0.y, f1.y];
      quad(fasciaSec, V(a[0], ya - 12, a[1], 0, TC(32)), V(b[0], yb - 12, b[1], TC(32), TC(32)), V(b[0], yb, b[1], TC(32), 0), V(a[0], ya, a[1], 0, 0));
    }
    const W = (f, s) => [f.x + s * f.nx * (f.w + 8), f.z + s * f.nz * (f.w + 8)];
    const [p, q, r2, s2] = [W(f0, -1), W(f0, 1), W(f1, 1), W(f1, -1)];
    quad(undersideSec, V(p[0], f0.y - 12, p[1], 0, 0), V(s2[0], f1.y - 12, s2[1], 0, TC(8)), V(r2[0], f1.y - 12, r2[1], TC(32), TC(8)), V(q[0], f0.y - 12, q[1], TC(32), 0), [0, -1, 0]);
  }
}

/* ------------------------------------------------------------ the room */

const deco = (key, name = key) => section(`deco_${name}`, TEX[key], SURF.CEMENT, CLIP.NONE);
/** box rotated to a heading (tx, tz): half-lengths along and across */
function orientedBox(sec, cx, cz, tx, tz, ha, hc, y0, y1, tex, uPer, vPer, top) {
  const nx = -tz, nz = tx;
  const C = (a, c) => [cx + tx * a + nx * c, cz + tz * a + nz * c];
  const pts = [C(-ha, -hc), C(ha, -hc), C(ha, hc), C(-ha, hc)];
  // pick the winding so faces read from outside
  const area = (pts[1][0] - pts[0][0]) * (pts[2][1] - pts[0][1]) - (pts[1][1] - pts[0][1]) * (pts[2][0] - pts[0][0]);
  const ring = area < 0 ? pts : [...pts].reverse();
  for (let k = 0; k < 4; k++) wallRect(sec, ring[k], ring[(k + 1) % 4], y0, y1, tex, uPer, vPer);
  if (top) {
    const [a, b, c, d] = ring.map(([x, z]) => V(x, y1, z, 0, 0));
    a.s = 0; a.t = 0; b.s = TC(tex.w); b.t = 0; c.s = TC(tex.w); c.t = TC(tex.h); d.s = 0; d.t = TC(tex.h);
    quad(top, a, d, c, b, [0, 1, 0]);
  }
}
const ceilingAt = (z) => (z <= ROOM.ridgeZ ? lerp(ROOM.wall, ROOM.ridge, (z - ROOM.z0) / (ROOM.ridgeZ - ROOM.z0)) : lerp(ROOM.ridge, ROOM.wall, (z - ROOM.ridgeZ) / (ROOM.z1 - ROOM.ridgeZ)));
const FEET = []; // footprints of things standing on the floor

// the floor is lava: bare boards and the off-course rugs are out of bounds
{
  floorRect(section('floor_boards', TEX.floor, SURF.OOB, CLIP.DEFAULT), ROOM.x0, ROOM.x1, ROOM.z0, ROOM.z1, 0, TEX.floor, 400, 400);
  floorRect(section('rug_jute', TEX.jute, SURF.OOB, CLIP.DEFAULT), -2350, -950, TBL.z0 - 350, OTT.z1 + 80, 3, TEX.jute, 90, 400);
  floorRect(section('rug_striped', TEX.striped, SURF.OOB, CLIP.DEFAULT), -900, -200, ROOM.z0 + 60, ROOM.z0 + 520, 3, TEX.striped, 180, 400);
}
// walls, windows and the vaulted plank ceiling
{
  const vg = deco('vgroove', 'walls'), win = deco('window', 'windows'), paint = deco('paint', 'trim');
  const { x0, x1, z0, z1, wall } = ROOM;
  // every wall reads from inside the room (wallRect faces its right-hand side)
  const N = (y0, y1, sec, tex, u, v, o) => wallRect(sec, [x0, z0], [x1, z0], y0, y1, tex, u, v, o); // north, faces +z
  const S = (y0, y1, sec, tex, u, v, o) => wallRect(sec, [x1, z1], [x0, z1], y0, y1, tex, u, v, o); // south, faces -z
  const E = (za, zb, y0, y1, sec, tex, u, v, o) => wallRect(sec, [x1, za], [x1, zb], y0, y1, tex, u, v, o); // east (za < zb), faces -x
  const W = (za, zb, y0, y1, sec, tex, u, v, o) => wallRect(sec, [x0, zb], [x0, za], y0, y1, tex, u, v, o); // west (za < zb), faces +x
  // north wall: a run of tall lake windows over a baseboard heater
  N(0, 120, paint, TEX.paint, 100, 100);
  N(120, 1350, win, TEX.window, 380, 1230, { vAnchor: 120, maxH: 1230 });
  N(1350, wall, vg, TEX.vgroove, 100, 100);
  box(paint, paint, x0 + 100, x1 - 100, z0, z0 + 40, 30, 130, TEX.paint, 100, 100);
  S(0, wall, vg, TEX.vgroove, 100, 100);
  // east wall: windows at the lake end, V-groove behind the piano
  E(z0, -1700, 0, 120, paint, TEX.paint, 100, 100);
  E(z0, -1700, 120, 1350, win, TEX.window, 380, 1230, { vAnchor: 120, maxH: 1230 });
  E(z0, -1700, 1350, wall, vg, TEX.vgroove, 100, 100);
  E(-1700, z1, 0, wall, vg, TEX.vgroove, 100, 100);
  // west wall with the kitchen doorway
  W(z0, -1500, 0, wall, vg, TEX.vgroove, 100, 100);
  W(-500, z1, 0, wall, vg, TEX.vgroove, 100, 100);
  W(-1500, -500, 1250, wall, vg, TEX.vgroove, 100, 100);
  wallRect(deco('kitchen'), [x0 - 2, -500], [x0 - 2, -1500], 0, 1250, TEX.kitchen, 1000, 1250, { vAnchor: 0, maxH: 1250 });
  for (const z of [-1500, -500]) box(paint, null, x0, x0 + 30, z - 30, z + 30, 0, 1280, TEX.paint, 100, 100);
  box(paint, null, x0, x0 + 30, -1530, -470, 1250, 1290, TEX.paint, 100, 100);
  // gable ends above the walls, east and west, in slices (keeps UVs small)
  for (const x of [x1, x0]) for (let z = z0; z < z1; z += 500) {
    const za = z, zb = Math.min(z1, z + 500), ya = ceilingAt(za), yb = ceilingAt(zb);
    const pa = [x, za], pb = [x, zb];
    const [p, q] = x === x1 ? [pa, pb] : [pb, pa];
    const yp = x === x1 ? ya : yb, yq = x === x1 ? yb : ya;
    const n = normalize([x === x1 ? -1 : 1, 0.7, 0]);
    quad(vg, V(p[0], wall, p[1], 0, TC(32 * 10)), V(q[0], wall, q[1], TC(32 * 5), TC(32 * 10)), V(q[0], yq, q[1], TC(32 * 5), TC(32 * (10 - (yq - wall) / 100))), V(p[0], yp, p[1], 0, TC(32 * (10 - (yp - wall) / 100))), n);
  }
  // ceiling: two sloping plank planes meeting at a ridge beam
  const ceil = deco('ceiling');
  for (let x = x0; x < x1; x += 400) {
    const xb = Math.min(x1, x + 400);
    for (const [za, zb] of [[z0, ROOM.ridgeZ], [ROOM.ridgeZ, z1]]) {
      const ya = ceilingAt(za), yb = ceilingAt(zb), run = Math.hypot(zb - za, yb - ya);
      quad(ceil, V(x, ya, za, 0, 0), V(xb, ya, za, TC(((xb - x) / 120) * 32), 0), V(xb, yb, zb, TC(((xb - x) / 120) * 32), TC((run / 120) * 32)), V(x, yb, zb, 0, TC((run / 120) * 32)), [0, -1, 0]);
    }
  }
  box(deco('paint', 'ridge_beam'), null, x0, x1, ROOM.ridgeZ - 60, ROOM.ridgeZ + 60, ROOM.ridge - 120, ROOM.ridge, TEX.paint, 100, 100);
}

// the fieldstone chimney with a see-through firebox, mantel, photos and candles
{
  const st = deco('fieldstone', 'chimney'), cx = (CHIM.x0 + CHIM.x1) / 2, top = ceilingAt(CHIM.z0);
  const ox0 = cx - CHIM.open, ox1 = cx + CHIM.open, oy = CHIM.openTop;
  // north face (towards the room, reads from -z) and south face, each with the opening
  for (const [z, s] of [[CHIM.z0, -1], [CHIM.z1, 1]]) {
    const seg = (a, b, y0, y1) => (s < 0 ? wallRect(st, [b, z], [a, z], y0, y1, TEX.fieldstone, 320, 160) : wallRect(st, [a, z], [b, z], y0, y1, TEX.fieldstone, 320, 160));
    seg(CHIM.x0, ox0, 0, top); seg(ox1, CHIM.x1, 0, top); seg(ox0, ox1, oy, top); seg(ox0, ox1, 0, HEARTH_Y);
  }
  wallRect(st, [CHIM.x0, CHIM.z0], [CHIM.x0, CHIM.z1], 0, top, TEX.fieldstone, 320, 160);
  wallRect(st, [CHIM.x1, CHIM.z1], [CHIM.x1, CHIM.z0], 0, top, TEX.fieldstone, 320, 160);
  // hearth slab: stone sides, and walkable strips either side of the lane
  const hs = deco('hearth', 'hearth_sides');
  box(hs, null, HRTH.x0, HRTH.x1, HRTH.z0, HRTH.z1, 0, HEARTH_Y, TEX.hearth, 160, 60);
  const strip = section('floor_hearth_slab', TEX.hearth, SURF.CEMENT, CLIP.DEFAULT);
  floorRect(strip, HRTH.x0, cx - 170, HRTH.z0, HRTH.z1, HEARTH_Y, TEX.hearth, 160, 300);
  floorRect(strip, cx + 170, HRTH.x1, HRTH.z0, HRTH.z1, HEARTH_Y, TEX.hearth, 160, 300);
  box(hs, null, cx - 170, cx + 170, CHIM.z1, CHIM.z1 + 100, 0, HEARTH_Y, TEX.hearth, 160, 60); // back hearth sides
  // mantel beam, framed photos and candles in glass
  box(deco('mantel'), deco('mantel', 'mantel_top'), CHIM.x0 + 60, CHIM.x1 - 60, CHIM.z0 - 150, CHIM.z0, 860, 1000, TEX.mantel, 700, 140, TEX.mantel);
  const ph = [['photoSail', -470], ['photoCollage', 0], ['photoSea', 470]];
  for (const [k, dx] of ph) sign(deco(k), [cx + dx, CHIM.z0 - 60], [0, -1], 300, 300, 1000, TEX[k]);
  for (const dx of [-650, 640]) box(deco('shade', 'candles'), deco('shade', 'candles'), cx + dx - 25, cx + dx + 25, CHIM.z0 - 110, CHIM.z0 - 60, 1000, 1110, TEX.shade, 50, 110);
  // open glass doors (black frames) and the iron tool set
  for (const s of [-1, 1]) box(deco('black', 'fire_doors'), null, cx + s * 250 - 6, cx + s * 250 + 6, CHIM.z0 - 230, CHIM.z0, HEARTH_Y, CHIM.openTop - 30, TEX.black, 60, 60);
  box(deco('black', 'fire_tools'), null, CHIM.x1 - 260, CHIM.x1 - 220, CHIM.z0 - 120, CHIM.z0 - 80, HEARTH_Y, HEARTH_Y + 380, TEX.black, 40, 60);
  // a little fire on log racks along both sides of the firebox, out of the lane
  for (const s of [-1, 1]) {
    const lx = cx + s * 205;
    box(deco('logs'), deco('logs', 'logs_top'), lx - 25, lx + 25, CHIM.z0 + 60, CHIM.z1 - 60, HEARTH_Y, HEARTH_Y + 50, TEX.logs, 80, 50);
    for (let z = CHIM.z0 + 90; z < CHIM.z1 - 80; z += 70) panel(deco('flame'), [lx, z], [-s, 0], 40, 60 + 20 * Math.sin(z), HEARTH_Y + 48, TEX.flame);
  }
  FEET.push({ x0: CHIM.x0, x1: CHIM.x1, z0: HRTH.z0, z1: CHIM.z1 + 100 });
}

// coffee table, magazines, ottoman
{
  const w = deco('walnut', 'coffee_table');
  box(w, null, TBL.x0, TBL.x1, TBL.z0, TBL.z1, TOP - 30, TOP, TEX.walnut, 120, 30);
  for (const [x, z] of [[TBL.x0 + 30, TBL.z0 + 30], [TBL.x1 - 30, TBL.z0 + 30], [TBL.x1 - 30, TBL.z1 - 30], [TBL.x0 + 30, TBL.z1 - 30]]) {
    box(w, null, x - 26, x + 26, z - 26, z + 26, 0, TOP - 30, TEX.walnut, 52, 60);
    box(w, null, x - 34, x + 34, z - 34, z + 34, 0, 30, TEX.walnut, 68, 30); // carved foot
  }
  box(w, null, TBL.x0 + 20, TBL.x1 - 20, TBL.z0 + 20, TBL.z1 - 20, TOP - 75, TOP - 30, TEX.walnut, 120, 45); // apron
  // magazines lying on the top (flat decals) and the stack that makes the ramp
  const mg = deco('magazines', 'magazines_flat');
  for (const [dx, dz, w2, h2] of [[-90, 120, 170, 230], [70, 330, 180, 240], [-60, 520, 160, 220]]) {
    const x0 = mark.tableX + dx - w2 / 2, z0 = TBL.z0 + dz - h2 / 2;
    quad(mg, V(x0, TOP + 1.5, z0, 0, 0), V(x0, TOP + 1.5, z0 + h2, 0, TC(32)), V(x0 + w2, TOP + 1.5, z0 + h2, TC(16), TC(32)), V(x0 + w2, TOP + 1.5, z0, TC(16), 0), [0, 1, 0]);
  }
  // the magazine stack's sides under the kicker
  const lip = M.pose(mark.lip1);
  for (const s of [-1, 1]) {
    const x = mark.tableX + s * 225, pts = [];
    for (let k = 0; k <= 6; k++) { const z = lip.z - KICK1 + (KICK1 * k) / 6; pts.push([z, M.pose(mark.lip1 - KICK1 + (KICK1 * k) / 6).y]); }
    for (let k = 0; k < 6; k++) {
      const [za, ya] = pts[k], [zb, yb] = pts[k + 1];
      quad(deco('magazines', 'mag_stack'), V(x, TOP, za, 0, TC(32)), V(x, TOP, zb, TC(8), TC(32)), V(x, yb, zb, TC(8), 0), V(x, ya, za, 0, 0), [s, 0, 0]);
    }
    quad(deco('magazines', 'mag_stack'), V(mark.tableX - 225, TOP, lip.z, 0, TC(32)), V(mark.tableX + 225, TOP, lip.z, TC(64), TC(32)), V(mark.tableX + 225, lip.y, lip.z, TC(64), 0), V(mark.tableX - 225, lip.y, lip.z, 0, 0), [0, 0, 1]);
  }
  FEET.push({ x0: TBL.x0, x1: TBL.x1, z0: TBL.z0, z1: TBL.z1 });
  // ottoman: tufted cream block with a red striped cushion as the kicker
  box(deco('ottoman', 'ottoman_sides'), null, OTT.x0, OTT.x1, OTT.z0, OTT.z1, 0, OTT_TOP, TEX.ottoman, 140, 100);
  const lip2 = M.pose(mark.lip2);
  for (const s of [-1, 1]) {
    const x = mark.tableX + s * 200;
    for (let k = 0; k < 6; k++) {
      const sa = mark.lip2 - KICK2 + (KICK2 * k) / 6, sb = mark.lip2 - KICK2 + (KICK2 * (k + 1)) / 6;
      const A = M.pose(sa), B = M.pose(sb);
      quad(deco('pillow', 'pillow_sides'), V(x, OTT_TOP, A.z, 0, TC(32)), V(x, OTT_TOP, B.z, TC(8), TC(32)), V(x, B.y, B.z, TC(8), 0), V(x, A.y, A.z, 0, 0), [s, 0, 0]);
    }
  }
  quad(deco('pillow', 'pillow_sides'), V(mark.tableX - 200, OTT_TOP, lip2.z, 0, TC(32)), V(mark.tableX + 200, OTT_TOP, lip2.z, TC(32), TC(32)), V(mark.tableX + 200, lip2.y, lip2.z, TC(32), 0), V(mark.tableX - 200, lip2.y, lip2.z, 0, 0), [0, 0, 1]);
  FEET.push({ x0: OTT.x0, x1: OTT.x1, z0: OTT.z0, z1: OTT.z1 });
}

// the long striped sofa (back to the runner) and the loveseat across the table
function sofa(S, facing, tex, name) {
  const sec = deco(tex, name), D = 180, A = 120;
  // facing -x: back on the east side; facing +x: back on the west side
  const bx0 = facing < 0 ? S.x1 - D : S.x0, bx1 = facing < 0 ? S.x1 : S.x0 + D;
  const sx0 = facing < 0 ? S.x0 : S.x0 + D, sx1 = facing < 0 ? S.x1 - D : S.x1;
  box(sec, null, S.x0, S.x1, S.z0, S.z1, 0, S.seat - 70, TEX[tex], 120, 120); // skirted base
  box(sec, sec, bx0, bx1, S.z0, S.z1, S.seat - 70, S.back, TEX[tex], 120, 120); // back
  for (const [za, zb] of [[S.z0, S.z0 + A], [S.z1 - A, S.z1]]) box(sec, sec, S.x0, S.x1, za, zb, S.seat - 70, S.arm, TEX[tex], 120, 120); // arms
  const n = 3, len = (S.z1 - S.z0 - 2 * A) / n;
  for (let k = 0; k < n; k++) box(sec, sec, sx0, sx1, S.z0 + A + k * len + 3, S.z0 + A + (k + 1) * len - 3, S.seat - 70, S.seat, TEX[tex], 120, 70);
  for (let k = 0; k < n; k++) box(sec, sec, facing < 0 ? bx0 - 90 : bx1, facing < 0 ? bx0 : bx1 + 90, S.z0 + A + k * len + 6, S.z0 + A + (k + 1) * len - 6, S.seat, S.back - 40, TEX[tex], 120, 120); // back cushions
  FEET.push({ x0: S.x0, x1: S.x1, z0: S.z0, z1: S.z1 });
}
sofa(SOFA, -1, 'sofa', 'striped_sofa');
sofa(LOVE, 1, 'loveseat', 'loveseat');
// the red-and-white striped cushion on the loveseat
box(deco('pillow', 'loveseat_pillow'), deco('pillow', 'loveseat_pillow'), LOVE.x0 + 270, LOVE.x0 + 330, (LOVE.z0 + LOVE.z1) / 2 - 140, (LOVE.z0 + LOVE.z1) / 2 + 140, LOVE.seat, LOVE.seat + 240, TEX.pillow, 120, 80);

// brown leather armchair, drop-leaf side table and the chrome arc floor lamp
{
  const lt = deco('leather', 'armchair'), x0 = 380, x1 = 960, z0 = -3180, z1 = -2600;
  box(lt, null, x0, x1, z0, z1, 0, 220, TEX.leather, 120, 120);
  box(lt, lt, x0, x1, z0, z0 + 150, 220, 560, TEX.leather, 120, 120);
  for (const [a, b] of [[x0, x0 + 110], [x1 - 110, x1]]) box(lt, lt, a, b, z0, z1, 220, 400, TEX.leather, 120, 120);
  box(lt, lt, x0 + 110, x1 - 110, z0 + 150, z1, 220, 290, TEX.leather, 120, 70);
  FEET.push({ x0, x1, z0, z1 });
  const pw = deco('pine', 'side_table');
  box(pw, pw, 200, 420, -2560, -2340, 300, 330, TEX.pine, 100, 30);
  for (const [x, z] of [[215, -2545], [405, -2545], [405, -2355], [215, -2355]]) box(pw, null, x - 10, x + 10, z - 10, z + 10, 0, 300, TEX.pine, 20, 60);
  FEET.push({ x0: 200, x1: 420, z0: -2560, z1: -2340 });
  // lamp: base, pole, and an arm reaching out over the toy track
  const ch = deco('chrome', 'floor_lamp'), lx = 330, lz = -2150;
  box(ch, ch, lx - 70, lx + 70, lz - 70, lz + 70, 0, 14, TEX.chrome, 60, 14);
  box(ch, null, lx - 7, lx + 7, lz - 7, lz + 7, 14, 1050, TEX.chrome, 14, 100);
  orientedBox(ch, lx - 220, lz - 30, -0.99, -0.14, 230, 6, 1040, 1052, TEX.chrome, 60, 12);
  box(ch, ch, lx - 500, lx - 380, lz - 140, lz + 40, 930, 1040, TEX.chrome, 60, 60); // lamp head
  FEET.push({ x0: lx - 70, x1: lx + 70, z0: lz - 70, z1: lz + 70 });
}

// the digital piano with its bench, and the canvas of the outrigger boat
{
  const pw = deco('pianoWood', 'piano');
  for (const [x, z] of [[PIANO.x0 + 20, PIANO.z0 + 20], [PIANO.x0 + 20, PIANO.z1 - 20], [PIANO.x1 - 20, PIANO.z0 + 20], [PIANO.x1 - 20, PIANO.z1 - 20]]) box(pw, null, x - 12, x + 12, z - 12, z + 12, 0, PIANO.keys - 40, TEX.pianoWood, 24, 80);
  box(pw, null, PIANO.x0, PIANO.x1, PIANO.z0, PIANO.z1, PIANO.keys - 40, PIANO.keys, TEX.pianoWood, 120, 40);
  // keyboard: 16 white keys (14 units each) per texture repeat, black keys at the back
  for (let z = PIANO.z0 + 20; z < PIANO.z1 - 20; z += 224) {
    const za = z, zb = Math.min(PIANO.z1 - 20, z + 224), sb = TC(((zb - za) / 224) * 64), y = PIANO.keys + 1, xf = PIANO.x0, xb = PIANO.x0 + 95;
    quad(deco('keys'), V(xf, y, za, 0, TC(32)), V(xf, y, zb, sb, TC(32)), V(xb, y, zb, sb, 0), V(xb, y, za, 0, 0), [0, 1, 0]);
  }
  box(pw, pw, PIANO.x0 + 95, PIANO.x1, PIANO.z0, PIANO.z1, PIANO.keys, PIANO.keys + 25, TEX.pianoWood, 120, 25);
  orientedBox(pw, PIANO.x0 + 130, (PIANO.z0 + PIANO.z1) / 2, 0, 1, 230, 6, PIANO.keys + 25, PIANO.keys + 150, TEX.pianoWood, 120, 120); // music rest
  box(deco('black', 'pedals'), null, PIANO.x0 + 40, PIANO.x0 + 110, -800, -700, 0, 20, TEX.black, 40, 20);
  const bk = deco('black', 'bench');
  box(bk, bk, 520, 760, -930, -570, 270, 310, TEX.black, 60, 40);
  for (const [x, z] of [[535, -915], [745, -915], [745, -585], [535, -585]]) box(deco('pianoWood', 'bench_legs'), null, x - 12, x + 12, z - 12, z + 12, 0, 270, TEX.pianoWood, 24, 60);
  FEET.push({ x0: PIANO.x0, x1: PIANO.x1, z0: PIANO.z0, z1: PIANO.z1 }, { x0: 520, x1: 760, z0: -930, z1: -570 });
  sign(deco('boatCanvas'), [ROOM.x1 - 4, -800], [-1, 0], 1400, 700, 760, TEX.boatCanvas);
}

// by the lake doors: the boot tray with green crocs, white crocs on the striped rug
{
  const bt = deco('black', 'boot_tray');
  box(bt, bt, -1600, -1000, ROOM.z0 + 80, ROOM.z0 + 380, 0, 14, TEX.black, 60, 14);
  const croc = (key, x, z, yaw) => {
    const tx = Math.cos(yaw), tz = Math.sin(yaw);
    orientedBox(deco(key, `croc_${key}`), x, z, tx, tz, 85, 34, 14, 34, TEX[key], 60, 30, deco(key, `croc_${key}`));
    orientedBox(deco(key, `croc_${key}`), x + tx * 25, z + tz * 25, tx, tz, 60, 32, 34, 74, TEX[key], 60, 40, deco(key, `croc_${key}`));
  };
  croc('crocGreen', -1420, ROOM.z0 + 220, 0.3); croc('crocGreen', -1200, ROOM.z0 + 260, -0.2);
  croc('crocWhite', -700, ROOM.z0 + 300, 2.6); croc('crocWhite', -420, ROOM.z0 + 380, 2.0);
}

// console table by the kitchen doorway, with a sunset photo
{
  const pw = deco('pine', 'console');
  box(pw, pw, ROOM.x0 + 10, ROOM.x0 + 190, 200, 900, 450, 480, TEX.pine, 100, 30);
  box(pw, null, ROOM.x0 + 10, ROOM.x0 + 190, 220, 880, 380, 450, TEX.pine, 100, 70);
  for (const [x, z] of [[ROOM.x0 + 25, 215], [ROOM.x0 + 175, 215], [ROOM.x0 + 175, 885], [ROOM.x0 + 25, 885]]) box(pw, null, x - 12, x + 12, z - 12, z + 12, 0, 380, TEX.pine, 24, 60);
  sign(deco('photoSea', 'console_photo'), [ROOM.x0 + 60, 550], [1, 0], 220, 220, 480, TEX.photoSea);
}

// the chandelier over the coffee table
{
  const ch = deco('chrome', 'chandelier'), cx = mark.tableX, cz = (TBL.z0 + TBL.z1) / 2, yc = ceilingAt(cz);
  box(ch, null, cx - 6, cx + 6, cz - 6, cz + 6, 1260, yc, TEX.chrome, 12, 100);
  box(ch, ch, cx - 30, cx + 30, cz - 30, cz + 30, 1220, 1260, TEX.chrome, 60, 40);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * 2 * Math.PI, x = cx + 150 * Math.cos(a), z = cz + 150 * Math.sin(a);
    orientedBox(ch, (cx + x) / 2, (cz + z) / 2, Math.cos(a), Math.sin(a), 75, 4, 1236, 1244, TEX.chrome, 60, 8);
    box(deco('shade', 'chandelier_shades'), deco('shade', 'chandelier_shades'), x - 28, x + 28, z - 28, z + 28, 1244, 1340, TEX.shade, 56, 96);
  }
}

// stacks of books holding up the raised toy track
{
  const bs = deco('books', 'book_stacks');
  let next = 0;
  for (const f of frames) {
    const t = tagAt(Math.min(f.s, L - 1));
    if (t.kind !== 'track' || f.y < 60 || f.s < next) continue;
    next = f.s + 380;
    orientedBox(bs, f.x, f.z, f.tx, f.tz, 70, 95, 0, f.y - 12, TEX.books, 190, 64, bs);
  }
}

// the start gate: two towers of toy blocks with a chequered banner across the runner
{
  const tb = deco('blocks', 'gate_blocks'), z = -60;
  for (const s of [-1, 1]) box(tb, tb, s * 290 - 45, s * 290 + 45, z - 45, z + 45, 0, 380, TEX.blocks, 64, 64);
  sign(deco('checker', 'gate_banner'), [0, z], [0, 1], 580, 70, 300, TEX.checker);
}

/* ------------------------------------------------------------ path, actors */

const lips = M.pieces.filter((p) => p.tag.mandatory).map((p) => p.s0 + p.len);
const pathPts = [], pathS = [];
for (let s = 0; s < L - PATH_SPACING / 2; s += PATH_SPACING) {
  if (M.piece(s).tag.gap || lips.some((lp) => s > lp - 150 && s <= lp)) continue;
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
itemCluster(700, 7); // the runner
itemCluster(mark.climb0 + 500, 4); // book climb
itemCluster(mark.high0 + 300, 4); // high above the floor
itemCluster(mark.table0 + 300, 6); // on the coffee table
itemCluster((mark.back0 + mark.back1) / 2, 4); // back of the room
itemCluster(mark.final0 + 600, 4); // last straight
const jumps = M.pieces.filter((p) => p.tag.mandatory).map((p) => jumpReport(M.piece(p.s0 + p.len + 1).tag.jump, p.s0 + p.len));
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
    Name: 'Cottage Living Room',
    DebugName: 'cottage',
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
    Sequence: 31, // MUSIC_SEQ_MARIO_RACEWAY
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
  frames: frames.map((f) => ({ s: f.s, x: f.x, y: f.y, z: f.z, w: f.w, nx: f.nx, nz: f.nz, kind: tagAt(Math.min(f.s, L - 1)).kind, gap: !!tagAt(Math.min(f.s, L - 1)).gap, ceil: tagAt(Math.min(f.s, L - 1)).ceil ?? null })),
  actors,
  marks: { L, ...mark, G_MAX, TBL, OTT, HRTH, CHIM, ROOM }, jumps,
  minimap: MM,
}));

const triCount = secList.reduce((a, s) => a + s.tris.length, 0);
const collTris = secList.filter((s) => s.clip !== 0).reduce((a, s) => a + s.tris.length, 0);
console.log(`Cottage Living Room: lap ${Math.round(L)} units, ${pathPts.length} waypoints, ${triCount} triangles (${collTris} with collision), ${secList.length} sections`);
console.log(`  actors ${actors.length} (${actors.filter((a) => a.Name === 'mk:item_box').length} item boxes)`);
console.log(`  textures packed: ${[...usedTex].filter((p) => p.startsWith(DIR)).length}; minimap ${MM.w}x${MM.h} scale ${MM.scale} @(${MM.playerX},${MM.playerY})`);
