#!/usr/bin/env node
/**
 * Sky Islands — a high-risk / high-reward SpaghettiKart track.
 *
 * Floating islands over a bottomless cloud sea. Miss a jump and you fall off
 * the map; Lakitu fishes you out (the track's water level sits far below the
 * islands, the same trick Rainbow Road uses).
 *
 * Main lap (always rejoinable, every waypoint on solid ground):
 *   A  Start island -> big Hill 1 -> kicker JUMP over the void to island B.
 *   B  Landing straight, camel humps, a huge horseshoe U-turn round a void bay.
 *   ~  Long railed rope-and-plank bridge up to island C.
 *   C  Climbing loop round the mountain, a notch JUMP, then a boost-ramp LAUNCH
 *      across the void onto island D's rising hillside.
 *   D  Summit crest, then the Spine: a narrow railless plank bridge diving back
 *      toward the start island, an S-bend, and the home straight.
 *
 * Shortcuts (off the waypoint path; fall and Lakitu returns you to the fork):
 *   S1 Bay Leap     — off the horseshoe's north arm, a kicker straight across
 *                      the void bay; you need ~85% of top speed to clear it.
 *   S2 Island Hops  — off island D's crest: kicker -> tiny floating rock ->
 *                      kicker -> land on the home stretch. Two chances to fall.
 *
 * Rescue logic: waypoints and floor meshes carry track-section IDs (like the
 * stock courses). A kart's waypoint is searched within the section of the
 * last floor it touched, and shortcut floors carry the section of their fork,
 * so a failed shortcut rescues you back at the fork, while a successful one
 * picks up progress where you land.
 *
 * Usage: node make-sky-islands.mjs [outDir]
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { makeTextures, texResource, toPNG } from './textures.mjs';

const TRACK = 'sky_islands';
const MOD = 'sky-islands';
const RES = 'chris:sky_islands';
const DIR = `tracks/${TRACK}`;
const OUT = process.argv[2] ?? '.';

const PAINTED = makeTextures();
const TEX = {};
for (const [k, im] of Object.entries(PAINTED)) TEX[k] = { path: `${DIR}/tex_${k}`, w: im.w, h: im.h };

const SURF = { ASPHALT: 1, DIRT: 2, GRASS: 8, WOOD: 17, BOOST: 0xfe };
const CLIP = { NONE: 0, DEFAULT: 1, WALL: 4 };
const LAYER = { INVISIBLE: 0, OPAQUE: 1 };
const WATER_LEVEL = -450; // fall below this with nothing underneath -> Lakitu
const CLOUD_Y = -1700;
const SAMPLE = 18;
const PATH_SPACING = 25;
const KICK = 0.35; // kicker lip slope
const NO_WP_BEFORE_LIP = 300; // keep rescue points back from mandatory lips

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const cosEase = (t) => 0.5 - 0.5 * Math.cos(Math.PI * clamp(t, 0, 1));
const normalize = (v) => { const l = Math.hypot(...v) || 1; return v.map((c) => c / l); };
const TC = (texels) => texels * 32;
const V = (x, y, z, s, t, n) => ({ x, y, z, s, t, n });
const Q = Math.PI / 2;

/* ------------------------------------------------------------ path builder */

class Path {
  constructor(name, x, z, psi, y) {
    this.name = name;
    this.pieces = [];
    this.cur = { x, z, psi, y };
    this.len = 0;
  }
  push(len, at, yAt, tag) {
    const p = { s0: this.len, len, at, yAt, tag };
    this.pieces.push(p);
    this.len += len;
    const e = at(len);
    this.cur = { x: e.x, z: e.z, psi: Math.atan2(e.tz, e.tx), y: yAt(len) };
    return this;
  }
  /** y profile: cosine ease y0->y1 plus optional smooth humps */
  prof(y0, y1, len, o = {}) {
    const humps = o.humps ?? 0, amp = o.amp ?? 0;
    if (o.g) { const [g0, g1] = o.g; return (u) => y0 + g0 * u + ((g1 - g0) * u * u) / (2 * len); }
    if (o.rise) return (u) => y0 + (y1 - y0) * (1 - (1 - u / len) ** 2);
    return (u) => lerp(y0, y1, cosEase(u / len)) + (humps ? (amp * (1 - Math.cos((2 * Math.PI * humps * u) / len))) / 2 : 0);
  }
  line(len, y1, tag, o = {}) {
    const { x, z, psi, y } = this.cur;
    const dx = Math.cos(psi), dz = Math.sin(psi);
    return this.push(len, (u) => ({ x: x + dx * u, z: z + dz * u, tx: dx, tz: dz }), this.prof(y, y1, len, o), tag);
  }
  arc(R, sweep, y1, tag, o = {}) {
    const { x: x0, z: z0, psi: p0, y } = this.cur;
    const sg = Math.sign(sweep);
    const len = R * Math.abs(sweep);
    return this.push(len, (u) => {
      const p = p0 + (sg * u) / R;
      return { x: x0 + (R / sg) * (Math.sin(p) - Math.sin(p0)), z: z0 - (R / sg) * (Math.cos(p) - Math.cos(p0)), tx: Math.cos(p), tz: Math.sin(p) };
    }, this.prof(y, y1, len, o), tag);
  }
  /** constant-curvature climb: the grade changes linearly from g0 to g1 */
  gline(len, g0, g1, tag) {
    const { y } = this.cur;
    return this.line(len, y + (len * (g0 + g1)) / 2, tag, { g: [g0, g1] });
  }
  garc(R, sweep, g0, g1, tag) {
    const len = R * Math.abs(sweep), { y } = this.cur;
    return this.arc(R, sweep, y + (len * (g0 + g1)) / 2, tag, { g: [g0, g1] });
  }
  /** kicker: quadratic up-curve ending at `slope` */
  kicker(len, slope, tag) {
    const { x, z, psi, y } = this.cur;
    const dx = Math.cos(psi), dz = Math.sin(psi);
    const a = slope / (2 * len);
    return this.push(len, (u) => ({ x: x + dx * u, z: z + dz * u, tx: dx, tz: dz }), (u) => y + a * u * u, tag);
  }
  /** empty air: no road; landing height = lip - drop */
  gap(len, drop, tag) {
    const { x, z, psi, y } = this.cur;
    const dx = Math.cos(psi), dz = Math.sin(psi);
    return this.push(len, (u) => ({ x: x + dx * u, z: z + dz * u, tx: dx, tz: dz }), (u) => y - drop * (u / len), { ...tag, gap: true });
  }
  /** cubic Bezier to a target pose */
  bez(tx, tz, tpsi, y1, tag, o = {}) {
    const { x, z, psi, y } = this.cur;
    const d = Math.hypot(tx - x, tz - z);
    const k = (o.k ?? 0.4) * d;
    const P = [[x, z], [x + Math.cos(psi) * k, z + Math.sin(psi) * k], [tx - Math.cos(tpsi) * k, tz - Math.sin(tpsi) * k], [tx, tz]];
    const B = (t) => {
      const m = 1 - t;
      return [0, 1].map((i) => m * m * m * P[0][i] + 3 * m * m * t * P[1][i] + 3 * m * t * t * P[2][i] + t * t * t * P[3][i]);
    };
    const N = 600, cum = [0], pts = [B(0)];
    for (let i = 1; i <= N; i++) { pts.push(B(i / N)); cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])); }
    const len = cum[N];
    const at = (u) => {
      let lo = 0, hi = N;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= u) lo = m; else hi = m; }
      const f = (u - cum[lo]) / Math.max(1e-9, cum[hi] - cum[lo]);
      const px = lerp(pts[lo][0], pts[hi][0], f), pz = lerp(pts[lo][1], pts[hi][1], f);
      const tx_ = pts[hi][0] - pts[lo][0], tz_ = pts[hi][1] - pts[lo][1];
      const tl = Math.hypot(tx_, tz_) || 1;
      return { x: px, z: pz, tx: tx_ / tl, tz: tz_ / tl };
    };
    return this.push(len, at, this.prof(y, y1, len, o), tag);
  }
  piece(s) {
    s = clamp(s, 0, this.len);
    let lo = 0, hi = this.pieces.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (this.pieces[m].s0 <= s) lo = m; else hi = m - 1; }
    return this.pieces[lo];
  }
  pose(s) {
    const p = this.piece(s);
    const u = clamp(s - p.s0, 0, p.len);
    const a = p.at(u);
    return { ...a, y: p.yAt(u), psi: Math.atan2(a.tz, a.tx), tag: p.tag, s };
  }
  /** the s at which this path's planar position is nearest to (x, z) inside [s0, s1] */
  nearestS(x, z, s0 = 0, s1 = this.len) {
    let best = s0, bd = Infinity;
    for (let s = s0; s <= s1; s += 2) { const p = this.pose(s); const d = Math.hypot(p.x - x, p.z - z); if (d < bd) { bd = d; best = s; } }
    return best;
  }
}

const ROAD = (o = {}) => ({ kind: 'road', land: true, hw: 170, ...o });
const PAD = (o = {}) => ({ kind: 'pad', land: true, hw: 170, ...o });
const G_MAX = 0.15;
let HILL1_G = 0;
const BRIDGE = (o = {}) => ({ kind: 'bridge', land: false, hw: 160, rails: true, ...o });

/* --------------------------------------------------------------- main lap */

const M = new Path('main', 0, 0, -Q, 0);
// Grades: karts bog down on long climbs much over ~15%, so every normal climb
// is held to G_MAX (and to G_MAX on the inner edge of curves, which is steeper
// than the centreline by R / (R - half-width)). Hill 1 is steeper and is paved
// with dash pads (boost surface), which hold every kart at top speed.
// A: start island, then Hill 1 up a dash-pad strip
M.line(300, 0, ROAD({ landPad: 420, area: 'A' }));
{
  const TOP = 290, g = G_MAX;
  // total rise for a pad grade G: ramp in (0->g, g->G), arc at G, ramp out (G->g, g->0)
  const rise = (G) => 500 * g / 2 + 175 * (g + G) / 2 - 325 * g / 2 + 707 * G + (520 * (1 - g / G)) * (G + g) / 2 + (520 * g / G) * g / 2;
  let lo = g, hi = 1;
  for (let k = 0; k < 60; k++) { const m = (lo + hi) / 2; if (rise(m) < TOP) lo = m; else hi = m; }
  const G = lo;
  M.gline(325, 0, g, ROAD({ area: 'A', landPad: 100 }));
  M.gline(175, g, G, PAD({ area: 'A', landPad: 100 }));
  M.garc(450, Q, G, G, PAD({ area: 'A', hill: 'Hill 1', landPad: 110 }));
  M.gline(520 * (1 - g / G), G, g, PAD({ area: 'A' }));
  M.gline(520 * g / G, g, 0, ROAD({ area: 'A' }));
  HILL1_G = G;
}
M.line(280, 215, ROAD({ area: 'A' }));
M.kicker(120, KICK, { kind: 'kicker', land: true, hw: 170, mandatory: true });
M.gap(220, 150, { kind: 'gap', hw: 170, jump: 'Jump 1' });
// B: horseshoe island
const B_LAND = M.len;
M.line(450, M.cur.y - 10, ROAD({ area: 'B', landPad: 200 }));
const B_ARM = M.len;
M.line(450, M.cur.y - 5, ROAD({ area: 'B' }), { humps: 2, amp: 10 });
M.arc(600, Math.PI, M.cur.y - 110, ROAD({ area: 'B' }));
M.line(500, M.cur.y - 50, ROAD({ area: 'B' }));
M.arc(400, -Q, M.cur.y - 25, ROAD({ area: 'B' }));
M.line(250, M.cur.y, ROAD({ area: 'B' }));
// rope bridge climbing to C: a steady grade with eased ends
{
  const d = -M.cur.y, ge = d / 800; // 150 ease + 650 steady + 150 ease
  M.gline(150, 0, ge, BRIDGE());
  M.gline(650, ge, ge, BRIDGE({ name: 'Rope Bridge' }));
  M.gline(150, ge, 0, BRIDGE());
}
// C: the mountain loop. Straights climb at G_MAX; the curves climb at the
// grade that keeps their inner edge at G_MAX.
{
  const ga = G_MAX * (450 - 170) / 450;
  M.gline(150, 0, G_MAX, ROAD({ area: 'C' }));
  M.gline(150, G_MAX, ga, ROAD({ area: 'C' }));
  M.garc(450, -Q, ga, ga, ROAD({ area: 'C' }));
  M.gline(100, ga, G_MAX, ROAD({ area: 'C' }));
  M.gline(200, G_MAX, G_MAX, ROAD({ area: 'C' }));
  M.gline(100, G_MAX, ga, ROAD({ area: 'C' }));
  M.garc(450, Math.PI, ga, ga, ROAD({ area: 'C' }));
  M.gline(300, ga, 0, ROAD({ area: 'C' }));
}
M.kicker(100, KICK, { kind: 'kicker', land: true, hw: 170, mandatory: true });
M.gap(160, 70, { kind: 'gap', hw: 170, jump: 'Notch Jump' });
M.gline(150, 0, G_MAX, ROAD({ area: 'C', landPad: 150 }));
M.gline(270, G_MAX, G_MAX, ROAD({ area: 'C', landPad: 150 }));
M.gline(150, G_MAX, 0, ROAD({ area: 'C' }));
M.kicker(250, 0.04, { kind: 'boost', land: true, hw: 170, mandatory: true });
const BOOST_LIP = M.len;
M.gap(300, 25, { kind: 'gap', hw: 170, jump: 'Boost Launch' });
// D: rising landing hillside, crest, then the Spine
M.line(550, M.cur.y + 41, ROAD({ area: 'D', landPad: 220 }), { rise: true });
// crest runs west to x = -500 so the S-bend at the end lands exactly on x = 0
const D_CREST = M.len;
M.line(M.cur.x + 500, M.cur.y - 5, ROAD({ area: 'D' }));
M.arc(400, Q, M.cur.y - 60, ROAD({ area: 'D' }));
M.line(600, M.cur.y - 110, { kind: 'spine', land: false, hw: 110, rails: false, name: 'The Spine' });
M.arc(300, Q, M.cur.y - 70, ROAD({ area: 'D2', landPad: 60 }));
M.line(300, -15, ROAD({ area: 'D2', landPad: 60 }));
M.arc(300, -Q, -25, ROAD({ area: 'A', landPad: 40 }));
// home straight: narrow verge at first (so the Island Hops landing is a real
// gap), then the wide start island
M.line(300, -30, ROAD({ area: 'A', landPad: 60 }));
const HOME_WIDE_Z = M.cur.z; // the wide start island begins here
M.line(M.cur.z - 600, M.cur.y, ROAD({ area: 'A', landPad: 420 })); // flat where the Island Hops strip merges
M.line(600, 0, ROAD({ area: 'A', landPad: 420 }));
if (Math.hypot(M.cur.x, M.cur.z) > 1) throw new Error(`main lap does not close: ${M.cur.x.toFixed(1)}, ${M.cur.z.toFixed(1)}`);
const L = M.len;

/* --------------------------------------------------------------- shortcuts */

function forkPose(s) { const p = M.pose(s); return p; }

// S1 Bay Leap: off the horseshoe's north arm, south across the void bay
const S1 = (() => {
  const f = forkPose(B_LAND + 170);
  const P = new Path('Bay Leap', f.x, f.z, f.psi, f.y);
  const tag = { kind: 'dirt', land: true, hw: 120, phase: 'out' };
  const tx = f.x + 300, tz = f.z + 120;
  P.bez(tx, tz, Q, f.y - 8, tag);
  P.line(60, P.cur.y, tag);
  P.kicker(120, KICK, { ...tag, kind: 'kicker' });
  return P;
})();
// S2 Island Hops: off island D's crest, north over two voids via a tiny rock
const HOP_X = 270;
const S2 = (() => {
  // fork on the climb onto D's crest so the hop line runs at x = HOP_X, east
  // of the S-bend's island, straight at the wide part of the start island
  const zc = M.pose(D_CREST).z;
  const f = forkPose(M.nearestS(HOP_X + 160, zc, BOOST_LIP, D_CREST + 600));
  const P = new Path('Island Hops', f.x, f.z, f.psi, f.y);
  const tag = { kind: 'dirt', land: true, hw: 120, phase: 'out' };
  P.bez(HOP_X, f.z - 230, -Q, f.y - 10, tag);
  P.kicker(120, KICK, { ...tag, kind: 'kicker' });
  return P;
})();

/* ------------------------------------------- jump analysis (engine physics) */

// Air physics from player_controller.c (see project notes): normal flight
// gravity 2600 with DAC 2 high above ground (1 near it), boost-ramp flight
// gravity 3500 / 20. Horizontal speed holds.
function flight(v, slope, boost, groundAt) {
  // groundAt(dist) -> ground height under the flight line (or -Infinity)
  let x = 0, y = 0, vy = slope * v;
  for (let t = 1; t < 2000; t++) {
    const g = groundAt(x);
    const dac = boost ? 20 : y - g > 50 ? 2 : 1;
    vy += ((boost ? -3500 : -2600) - vy * 696) / 6000 / dac;
    const yPrev = y;
    x += v; y += vy;
    const g2 = groundAt(x);
    // touching down needs the kart above the surface a moment ago; arriving
    // from below means it hit the island's cliff face and drops away
    if (y <= g2) return { dist: x, landed: Number.isFinite(g2) && yPrev >= g2 - 12 };
    if (y < WATER_LEVEL) return { dist: x, landed: false };
  }
  return { dist: Infinity, landed: false };
}

/* ---------------------------------------------------- frames and sections */

const NSEC = 26;
const secOfMain = (s) => 1 + Math.min(NSEC - 1, Math.floor((((s % L) + L) % L) / (L / NSEC)));

function framesOf(P, secFn) {
  const breaks = P.pieces.map((p) => p.s0).concat([P.len]);
  let ss = [];
  for (let s = 0; s < P.len; s += SAMPLE) ss.push(s);
  ss.push(...breaks);
  ss = [...new Set(ss.map((v) => Math.round(v * 1000) / 1000))].filter((v) => v >= 0 && v <= P.len).sort((a, b) => a - b);
  ss = ss.filter((v) => breaks.some((b) => Math.abs(b - v) < 1e-3) || !breaks.some((b) => Math.abs(b - v) < 8));
  return ss.map((s) => {
    const p = P.pose(s);
    // the tag of the piece we are entering (at a boundary, take the next piece)
    const tag = P.piece(Math.min(P.len, s + 0.01)).tag;
    const w = tag.hw ?? 170;
    return { path: P.name, s, x: p.x, z: p.z, y: p.y, tx: p.tx, tz: p.tz, nx: -p.tz, nz: p.tx, w, tag, sec: secFn(s, tag) };
  });
}
const mainFrames = framesOf(M, (s) => secOfMain(s));
// main path is closed: drop the duplicate end sample
if (Math.abs(mainFrames.at(-1).s - L) < 1e-6) mainFrames.pop();
const s1Fork = M.nearestS(S1.pieces[0].at(0).x, S1.pieces[0].at(0).z, B_LAND, B_LAND + 500);
const s2Fork = M.nearestS(S2.pieces[0].at(0).x, S2.pieces[0].at(0).z, BOOST_LIP, D_CREST + 600);
const s1Frames = framesOf(S1, () => secOfMain(s1Fork));
const s2Frames = framesOf(S2, () => secOfMain(s2Fork));

/* ----------------------------------------------- landings for the shortcuts */

// S1 lands straight onto the main road (the horseshoe exit). S2 lands on a tiny
// floating rock first, then on the home stretch. Both are built as their own
// small paths so the flights can be checked against real geometry.
const S2b = (() => {
  // the rock: placed on the line of flight from S2's lip
  const lip = S2.cur;
  const G1 = 380, DROP1 = 105;
  const sx = lip.x + Math.cos(lip.psi) * G1, sz = lip.z + Math.sin(lip.psi) * G1;
  const P = new Path('Hop Rock', sx, sz, lip.psi, lip.y - DROP1);
  const tag = { kind: 'dirt', land: true, hw: 115, landPad: 30, phase: 'out' };
  P.line(230, P.cur.y - 4, tag);
  P.kicker(110, KICK, { ...tag, kind: 'kicker' });
  return P;
})();
const s2bFrames = framesOf(S2b, () => secOfMain(s2Fork));

// landing strip after the second hop, merging into the home straight
const S2c = (() => {
  const lip = S2b.cur;
  const zStart = HOME_WIDE_Z + 190;
  const target = M.pose(M.nearestS(0, zStart - 650, 0, L));
  // start just above the home road beside it, so the strip tucks under it
  const P = new Path('Hop Landing', lip.x, zStart, lip.psi, M.pose(M.nearestS(lip.x, zStart, 0, L)).y + 6);
  P.bez(target.x, target.z, target.psi, target.y, { kind: 'dirt', land: true, hw: 130, landPad: 40, phase: 'in' });
  P.mergeS = target.s;
  return P;
})();
const s2cFrames = framesOf(S2c, () => secOfMain(S2c.mergeS));

const allFrames = [...mainFrames, ...s1Frames, ...s2Frames, ...s2bFrames, ...s2cFrames];

/* ------------------------------------------------------------ sections out */

const sections = new Map();
function section(name, tex, surface, clip, sec = 0xff, layer = LAYER.OPAQUE) {
  const key = `${name}#${sec}`;
  if (!sections.has(key)) sections.set(key, { name: sec === 0xff ? name : `${name}_s${sec}`, tex, surface, clip, sec, layer, tris: [] });
  return sections.get(key);
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

/* ---- road ribbons ---- */

const FLOOR = {
  road: { tex: 'road', surf: SURF.ASPHALT, unit: 160, across: 1 },
  kicker: { tex: 'kicker', surf: SURF.ASPHALT, unit: 90, across: 2 },
  boost: { tex: 'boost', surf: SURF.BOOST, unit: 90, across: 2 },
  pad: { tex: 'pad', surf: SURF.BOOST, unit: 64, across: 1 },
  bridge: { tex: 'planks', surf: SURF.WOOD, unit: 80, across: 3 },
  spine: { tex: 'planks', surf: SURF.WOOD, unit: 80, across: 2 },
  dirt: { tex: 'dirt', surf: SURF.DIRT, unit: 128, across: 2 },
};
// does (x,z,y) lie on the main ribbon? (to tuck shortcut surfaces under it)
function onMain(x, z, y) {
  for (const f of mainFrames) {
    const dx = x - f.x, dz = z - f.z;
    if (Math.abs(dx) > 400 || Math.abs(dz) > 400) continue;
    if (Math.abs(dx * f.tx + dz * f.tz) <= SAMPLE / 2 + 1 && Math.abs(dx * f.nx + dz * f.nz) <= f.w - 1 && Math.abs(y - f.y) < 8) return true;
  }
  return false;
}
function ribbon(frames, closed) {
  const n = frames.length;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const f0 = frames[i], f1 = frames[(i + 1) % n];
    const s1 = closed && i === n - 1 ? L : f1.s;
    const tag = f0.tag;
    if (tag.gap) continue;
    let kind = tag.kind;
    if (closed && (f0.s < 30 || f0.s > L - 30)) kind = 'finish';
    const spec = kind === 'finish' ? { tex: 'finish', surf: SURF.ASPHALT, unit: 60, across: 1 } : FLOOR[kind];
    const tex = TEX[spec.tex];
    const sec = section(`floor_${spec.tex}`, tex, spec.surf, CLIP.DEFAULT, f0.sec);
    let t0, t1;
    if (kind === 'finish') {
      const wrap = (s) => (s > L / 2 ? s - L : s) + 30;
      t0 = TC((wrap(f0.s) / 60) * tex.h); t1 = TC(((s1 >= L - 1e-6 ? 30 : wrap(s1)) / 60) * tex.h);
    } else {
      const base = Math.floor(f0.s / spec.unit) * spec.unit;
      t0 = TC(((f0.s - base) / spec.unit) * tex.h); t1 = TC(((s1 - base) / spec.unit) * tex.h);
    }
    const LAT = frames === mainFrames ? 1 : 8;
    for (let k = 0; k < LAT; k++) {
      const la = lerp(-1, 1, k / LAT), lb = lerp(-1, 1, (k + 1) / LAT);
      const P = (f, l) => [f.x + f.nx * f.w * l, f.z + f.nz * f.w * l];
      const sAt = (l) => TC(((l + 1) / 2) * spec.across * tex.w);
      const c = [P(f0, la), P(f0, lb), P(f1, lb), P(f1, la)];
      const ys = [f0.y, f0.y, f1.y, f1.y];
      let dy = 0;
      if (frames !== mainFrames) {
        const inside = c.filter(([x, z], j) => onMain(x, z, ys[j])).length;
        if (inside === 4) continue;
        if (inside > 0) dy = -1.5;
      }
      quad(sec, V(c[0][0], ys[0] + dy, c[0][1], sAt(la), t0), V(c[1][0], ys[1] + dy, c[1][1], sAt(lb), t0), V(c[2][0], ys[2] + dy, c[2][1], sAt(lb), t1), V(c[3][0], ys[3] + dy, c[3][1], sAt(la), t1), [0, 1, 0]);
    }
    // railings
    if (tag.rails) {
      const rs = section('rails', TEX.rail, SURF.WOOD, CLIP.WALL);
      for (const side of [-1, 1]) {
        const e0 = [f0.x + side * f0.nx * f0.w, f0.z + side * f0.nz * f0.w], e1 = [f1.x + side * f1.nx * f1.w, f1.z + side * f1.nz * f1.w];
        const base = Math.floor(f0.s / 64) * 64;
        const sA = TC(((f0.s - base) / 64) * 32), sB = TC(((s1 - base) / 64) * 32);
        quad(rs, V(e0[0], f0.y, e0[1], sA, TC(32)), V(e1[0], f1.y, e1[1], sB, TC(32)), V(e1[0], f1.y + 45, e1[1], sB, 0), V(e0[0], f0.y + 45, e0[1], sA, 0), normalize([-side * f0.nx, 0.7, -side * f0.nz]));
      }
    }
    // a plank bridge reads better with a thin deck edge underneath
    if (tag.kind === 'bridge' || tag.kind === 'spine') {
      const ds = section('deck_edges', TEX.post, SURF.WOOD, CLIP.NONE);
      for (const side of [-1, 1]) {
        const e0 = [f0.x + side * f0.nx * f0.w, f0.z + side * f0.nz * f0.w], e1 = [f1.x + side * f1.nx * f1.w, f1.z + side * f1.nz * f1.w];
        quad(ds, V(e0[0], f0.y - 18, e0[1], 0, TC(8)), V(e1[0], f1.y - 18, e1[1], TC(32), TC(8)), V(e1[0], f1.y, e1[1], TC(32), 0), V(e0[0], f0.y, e0[1], 0, 0));
      }
    }
  }
}
ribbon(mainFrames, true);
ribbon(s1Frames, false);
ribbon(s2Frames, false);
ribbon(s2bFrames, false);
ribbon(s2cFrames, false);

/* ---- islands: land cells under landed frames ---- */

const CELL = 100;
const landFrames = allFrames.filter((f) => f.tag.land && !f.tag.gap);
let bx0 = Infinity, bx1 = -Infinity, bz0 = Infinity, bz1 = -Infinity;
for (const f of allFrames) { bx0 = Math.min(bx0, f.x); bx1 = Math.max(bx1, f.x); bz0 = Math.min(bz0, f.z); bz1 = Math.max(bz1, f.z); }
const GX0 = Math.floor((bx0 - 800) / CELL) * CELL, GX1 = Math.ceil((bx1 + 800) / CELL) * CELL;
const GZ0 = Math.floor((bz0 - 800) / CELL) * CELL, GZ1 = Math.ceil((bz1 + 800) / CELL) * CELL;
const NX = (GX1 - GX0) / CELL, NZ = (GZ1 - GZ0) / CELL;
const landPad = (f) => f.tag.landPad ?? 170;
function landFrameAt(x, z) {
  // strip test (no end caps, so islands stop cleanly at gaps)
  let best = null, bd = Infinity;
  for (const f of landFrames) {
    const dx = x - f.x, dz = z - f.z;
    if (Math.abs(dx) > 700 || Math.abs(dz) > 700) continue;
    const along = dx * f.tx + dz * f.tz, lat = Math.abs(dx * f.nx + dz * f.nz);
    if (Math.abs(along) <= SAMPLE / 2 + 1 && lat <= f.w + landPad(f) && lat < bd) { bd = lat; best = f; }
  }
  return best;
}
const land = new Array(NX * NZ).fill(null);
for (let i = 0; i < NX; i++) for (let j = 0; j < NZ; j++) land[j * NX + i] = landFrameAt(GX0 + (i + 0.5) * CELL, GZ0 + (j + 0.5) * CELL);
const isLand = (i, j) => i >= 0 && j >= 0 && i < NX && j < NZ && land[j * NX + i] !== null;
// vertex heights: a smooth inverse-distance blend of the nearby roads'
// heights (dropping gently away from each road), capped by a 29-degree "cone"
// under every road so the ground never pokes up through a lower road nearby.
function heightAt(x, z, owners = []) {
  let num = 0, den = 0, cap = Infinity;
  const base = (f, lat) => f.y - 5 - 0.3 * Math.max(0, lat - f.w - 40);
  for (const f of landFrames) {
    const dx = x - f.x, dz = z - f.z;
    if (Math.abs(dx) > 700 || Math.abs(dz) > 700) continue;
    const along = Math.abs(dx * f.tx + dz * f.tz);
    const lat = Math.abs(dx * f.nx + dz * f.nz);
    // never let the ground rise above any road within a cell's reach of here
    // (keeps grass under the dips of camel humps and beside forks)
    if (along <= CELL + 10) cap = Math.min(cap, f.y - 5 + 0.55 * Math.max(0, lat - f.w - 25));
    // blend the roads this point sits beside (one frame per road)
    if (along > SAMPLE / 2 + 1 || lat > f.w + landPad(f) + CELL) continue;
    const wgt = 1 / (lat * lat + 2500);
    num += wgt * base(f, lat); den += wgt;
  }
  if (!den) {
    // beyond a road's end (gap edges): use the roads that own the touching cells
    for (const f of owners) {
      const lat = Math.abs((x - f.x) * f.nx + (z - f.z) * f.nz);
      num += base(f, lat); den += 1;
    }
  }
  if (!den) return -100;
  return Math.min(num / den, cap);
}
const VH = new Map();
const vkey = (i, j) => `${i},${j}`;
function vh(i, j) {
  const k = vkey(i, j);
  if (!VH.has(k)) {
    const owners = [[i - 1, j - 1], [i, j - 1], [i - 1, j], [i, j]].filter(([a, b]) => isLand(a, b)).map(([a, b]) => land[b * NX + a]);
    VH.set(k, heightAt(GX0 + i * CELL, GZ0 + j * CELL, owners));
  }
  return VH.get(k);
}
// edge distance (in vertex steps) for the rocky undersides
const vertLand = (i, j) => isLand(i - 1, j - 1) || isLand(i, j - 1) || isLand(i - 1, j) || isLand(i, j);
const vertEdge = (i, j) => vertLand(i, j) && !(isLand(i - 1, j - 1) && isLand(i, j - 1) && isLand(i - 1, j) && isLand(i, j));
const edgeDist = new Map();
{
  let frontier = [];
  for (let i = 0; i <= NX; i++) for (let j = 0; j <= NZ; j++) if (vertEdge(i, j)) { edgeDist.set(vkey(i, j), 0); frontier.push([i, j]); }
  while (frontier.length) {
    const next = [];
    for (const [i, j] of frontier) for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = i + di, b = j + dj, k = vkey(a, b);
      if (!edgeDist.has(k) && vertLand(a, b)) { edgeDist.set(k, edgeDist.get(vkey(i, j)) + 1); next.push([a, b]); }
    }
    frontier = next;
  }
}
const bottomAt = (i, j) => vh(i, j) - 140 - 80 * Math.min(edgeDist.get(vkey(i, j)) ?? 0, 7) - ((i * 7 + j * 13) % 5) * 12;

const underSec = section('undersides', TEX.under, SURF.GRASS, CLIP.NONE);
const cliffSec = section('cliffs', TEX.cliff, SURF.GRASS, CLIP.WALL);
const GP = 128;
for (let i = 0; i < NX; i++) for (let j = 0; j < NZ; j++) {
  const f = land[j * NX + i];
  if (!f) continue;
  const x0 = GX0 + i * CELL, z0 = GZ0 + j * CELL, x1 = x0 + CELL, z1 = z0 + CELL;
  const sec = section('island_grass', TEX.grass, SURF.GRASS, CLIP.DEFAULT, f.sec);
  const bx = Math.floor(x0 / GP) * GP, bz = Math.floor(z0 / GP) * GP;
  const st = (x, z) => [TC(((x - bx) / GP) * 32), TC(((z - bz) / GP) * 32)];
  const mk = (ii, jj) => { const x = GX0 + ii * CELL, z = GZ0 + jj * CELL; return V(x, vh(ii, jj), z, ...st(x, z)); };
  const a = mk(i, j), b = mk(i, j + 1), c = mk(i + 1, j + 1), d = mk(i + 1, j);
  sec.tris.push([a, b, c], [a, c, d]);
  for (const v of [a, b, c, d]) v.n = [0, 1, 0];
  // underside (visual)
  const ub = (ii, jj) => { const x = GX0 + ii * CELL, z = GZ0 + jj * CELL; return V(x, bottomAt(ii, jj), z, ...st(x, z), [0, -1, 0]); };
  underSec.tris.push([ub(i, j), ub(i + 1, j + 1), ub(i, j + 1)], [ub(i, j), ub(i + 1, j), ub(i + 1, j + 1)]);
  // cliff faces where the island ends (collision, so flights slam into rock)
  const sides = [[i, j - 1, [i, j], [i + 1, j]], [i + 1, j, [i + 1, j], [i + 1, j + 1]], [i, j + 1, [i + 1, j + 1], [i, j + 1]], [i - 1, j, [i, j + 1], [i, j]]];
  for (const [ni, nj, pA, pB] of sides) {
    if (isLand(ni, nj)) continue;
    const [ia, ja] = pA, [ib, jb] = pB;
    const xa = GX0 + ia * CELL, za = GZ0 + ja * CELL, xb = GX0 + ib * CELL, zb = GZ0 + jb * CELL;
    const ta = vh(ia, ja), tb = vh(ib, jb), da = bottomAt(ia, ja), db = bottomAt(ib, jb);
    const out = normalize([(xa + xb) / 2 - (x0 + x1) / 2, 0.4, (za + zb) / 2 - (z0 + z1) / 2]);
    const tS = (y, top) => TC(((top - y) / 160) * 64);
    quad(cliffSec, V(xa, da, za, 0, tS(da, ta)), V(xb, db, zb, TC(32), tS(db, tb)), V(xb, tb, zb, TC(32), 0), V(xa, ta, za, 0, 0), out);
  }
}

/* ---- cloud sea far below (visual only) ---- */
{
  const cs = section('cloud_sea', TEX.clouds, SURF.GRASS, CLIP.NONE);
  const S = 2400, cx = (GX0 + GX1) / 2, cz = (GZ0 + GZ1) / 2;
  for (let i = -6; i < 6; i++) for (let j = -6; j < 6; j++) {
    const x0 = cx + i * S, z0 = cz + j * S;
    quad(cs, V(x0, CLOUD_Y, z0, 0, 0), V(x0, CLOUD_Y, z0 + S, 0, TC(64)), V(x0 + S, CLOUD_Y, z0 + S, TC(128), TC(64)), V(x0 + S, CLOUD_Y, z0, TC(128), 0), [0, 1, 0]);
  }
}

/* ---- signs ---- */
function signAt(P, s, side, texKey, name) {
  const f = P.pose(s);
  const nx = -f.tz, nz = f.tx;
  const w = (P === M ? 170 : 120) + 70;
  const c = [f.x + side * nx * w, f.z + side * nz * w];
  const normal = [-f.tx, -f.tz]; // faces the oncoming kart
  const r = [normal[1], -normal[0]];
  const sec = section(`sign_${name}`, TEX[texKey], SURF.GRASS, CLIP.NONE);
  const W = 130, H = 65, y0 = f.y + 55;
  const a = [c[0] - (r[0] * W) / 2, c[1] - (r[1] * W) / 2], b = [c[0] + (r[0] * W) / 2, c[1] + (r[1] * W) / 2];
  const n = normalize([normal[0], 0.5, normal[1]]);
  quad(sec, V(a[0], y0, a[1], 0, TC(32)), V(b[0], y0, b[1], TC(64), TC(32)), V(b[0], y0 + H, b[1], TC(64), 0), V(a[0], y0 + H, a[1], 0, 0), n);
  const ps = section('sign_posts', TEX.post, SURF.GRASS, CLIP.NONE);
  for (const k of [-0.35, 0.35]) {
    const px = c[0] + r[0] * W * k, pz = c[1] + r[1] * W * k;
    quad(ps, V(px - 4 * r[0], f.y - 10, pz - 4 * r[1], 0, TC(32)), V(px + 4 * r[0], f.y - 10, pz + 4 * r[1], TC(8), TC(32)), V(px + 4 * r[0], y0, pz + 4 * r[1], TC(8), 0), V(px - 4 * r[0], y0, pz - 4 * r[1], 0, 0), n);
  }
}
for (const p of M.pieces) if (p.tag.kind === 'kicker' || p.tag.kind === 'boost') signAt(M, p.s0 - 160, 1, 'signJump', `jump_${Math.round(p.s0)}`);
for (const p of M.pieces) if (p.tag.kind === 'spine') { signAt(M, p.s0 - 120, 1, 'signDanger', 'spine_a'); signAt(M, p.s0 - 120, -1, 'signDanger', 'spine_b'); }
{ const p0 = M.pieces.find((p) => p.tag.kind === 'pad'); signAt(M, p0.s0 - 60, 1, 'signBoost', 'boost_a'); signAt(M, p0.s0 - 60, -1, 'signBoost', 'boost_b'); }
signAt(M, s1Fork - 150, 1, 'signShortcut', 's1');
signAt(M, s2Fork - 150, 1, 'signShortcut', 's2');
signAt(S1, S1.len - 130, -1, 'signDanger', 's1_lip');
signAt(S2, S2.len - 130, -1, 'signDanger', 's2_lip');

/* --------------------------------------------------------------- waypoints */

const lips = M.pieces.filter((p) => p.tag.mandatory).map((p) => p.s0 + p.len);
const pathPts = [];
for (let s = 0; s < L - PATH_SPACING / 2; s += PATH_SPACING) {
  const p = M.pose(s);
  if (p.tag.gap) continue;
  if (lips.some((lp) => s > lp - NO_WP_BEFORE_LIP && s <= lp)) continue;
  pathPts.push({ x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z), ID: secOfMain(s), s });
}
pathPts[0] = { ...pathPts[0], x: 0, y: 0, z: 0 };

/* ------------------------------------------------------------------ actors */

const actors = [];
function itemRow(P, s, count = 4) {
  const f = P.pose(s);
  const w = (P.piece(s).tag.hw ?? 170) * 0.65;
  for (let k = 0; k < count; k++) {
    const lat = lerp(-w, w, k / (count - 1));
    actors.push({ Name: 'mk:item_box', Location: { x: Math.round(f.x - f.tz * lat), y: Math.round(f.y + 5), z: Math.round(f.z + f.tx * lat) } });
  }
}
itemRow(M, 450);
itemRow(M, B_ARM + 380); // after the camel humps begin
for (const p of M.pieces) if (p.tag.name === 'Rope Bridge') itemRow(M, p.s0 + p.len / 2, 3);
itemRow(M, BOOST_LIP - 600);
itemRow(M, D_CREST + 400);
itemRow(S1, S1.len - 300, 3); // bait on the shortcut
itemRow(S2b, 120, 3); // reward on the floating rock
// trees on island grass away from the roads
{
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const placed = [];
  for (let k = 0; k < 6000 && placed.length < 40; k++) {
    const i = Math.floor(rnd() * NX), j = Math.floor(rnd() * NZ);
    if (!isLand(i, j) || !isLand(i - 1, j) || !isLand(i + 1, j) || !isLand(i, j - 1) || !isLand(i, j + 1)) continue;
    const x = GX0 + (i + 0.5) * CELL, z = GZ0 + (j + 0.5) * CELL;
    if (allFrames.some((f) => Math.hypot(f.x - x, f.z - z) < f.w + 110)) continue;
    if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < 250)) continue;
    placed.push({ x, z, y: (vh(i, j) + vh(i + 1, j + 1)) / 2 });
  }
  placed.forEach((p, k) => actors.push({ Name: k % 2 ? 'mk:tree_royal_raceway' : 'mk:tree_yoshi_valley', Location: { x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z) } }));
}

/* ---------------------------------------------------------- jump report */

function groundUnder(x, z) {
  // highest floor below (roads, then land) — used for flight analysis
  let best = -Infinity;
  for (const f of allFrames) {
    if (f.tag.gap) continue;
    const dx = x - f.x, dz = z - f.z;
    if (Math.abs(dx * f.tx + dz * f.tz) <= SAMPLE / 2 + 1 && Math.abs(dx * f.nx + dz * f.nz) <= f.w) best = Math.max(best, f.y);
  }
  const i = Math.floor((x - GX0) / CELL), j = Math.floor((z - GZ0) / CELL);
  if (isLand(i, j)) {
    // same triangle split as the island mesh: (i,j)-(i,j+1)-(i+1,j+1) and (i,j)-(i+1,j+1)-(i+1,j)
    const u = (x - GX0) / CELL - i, w = (z - GZ0) / CELL - j;
    const h00 = vh(i, j), h01 = vh(i, j + 1), h11 = vh(i + 1, j + 1), h10 = vh(i + 1, j);
    const h = w >= u ? h00 + (h11 - h01) * u + (h01 - h00) * w : h00 + (h10 - h00) * u + (h11 - h10) * w;
    best = Math.max(best, h);
  }
  return best;
}
function jumpReport(name, P, lipS, boost) {
  const lip = P.pose(lipS);
  const slope = boost ? 0.04 : KICK;
  const g = (d) => groundUnder(lip.x + lip.tx * (d + 1), lip.z + lip.tz * (d + 1)) - lip.y;
  const rows = [];
  let need = null;
  for (let v = 3; v <= 9.01; v += 0.25) {
    const r = flight(v, slope, boost, g);
    rows.push({ v, ...r });
    if (r.landed && need === null) need = v;
  }
  const at = (v) => rows.find((r) => Math.abs(r.v - v) < 0.01);
  console.log(`  ${name.padEnd(14)} lip y=${lip.y.toFixed(0)}  min speed to land: ${need ?? 'never'}  ` +
    [4, 5, 6, 7, 7.5, 8, 8.5, 9].map((v) => `v${v}:${at(v).landed ? Math.round(at(v).dist) : 'FALL'}`).join(' '));
  return { name, need, rows };
}

/* --------------------------------------------------------------- minimap */

const MM = { w: 128, h: 128 };
{
  const xs = pathPts.map((p) => p.x), zs = pathPts.map((p) => p.z);
  const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  MM.scale = Math.floor(Math.min((MM.w - 12) / (x1 - x0), (MM.h - 12) / (z1 - z0)) * 1000) / 1000;
  MM.playerX = Math.round(MM.w / 2 - ((x0 + x1) / 2) * MM.scale);
  MM.playerY = Math.round(MM.h / 2 - ((z0 + z1) / 2) * MM.scale);
}
const mmPix = new Uint8Array(MM.w * MM.h);
const plot = (px, py, v = 255) => { const x = Math.round(px), y = Math.round(py); if (x >= 0 && y >= 0 && x < MM.w && y < MM.h) mmPix[y * MM.w + x] = Math.max(mmPix[y * MM.w + x], v); };
for (let s = 0; s < L; s += 3) {
  const p = M.pose(s);
  if (p.tag.gap) continue;
  for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1]]) plot(MM.playerX + p.x * MM.scale + dx, MM.playerY + p.z * MM.scale + dy);
}
for (const P of [S1, S2, S2b, S2c]) for (let s = 0; s < P.len; s += 3) { const p = P.pose(s); plot(MM.playerX + p.x * MM.scale, MM.playerY + p.z * MM.scale, 150); }
const minimapPng = toPNG({ w: MM.w, h: MM.h, p: Float32Array.from({ length: MM.w * MM.h * 3 }, (_, k) => mmPix[Math.floor(k / 3)] / 255) }, deflateSync);

/* ------------------------------------------------------------- XML out */

const VTX_BATCH = 32;
const r = Math.round;
const nb = (v) => clamp(r(v * 127), -128, 127);
function materialXml(tex) {
  const line = (tex.w * 16) / 8 / 8, lrs = tex.w * tex.h - 1;
  const words = Math.max(1, (tex.w * 2) / 8), dxt = Math.floor((2048 + words - 1) / words);
  return `<DisplayList Version="0">
\t<SetGeometryMode G_FOG="1" />
\t<ClearGeometryMode G_CLIPPING="1" />
\t<ClearGeometryMode G_CULL_BOTH="1" />
\t<PipeSync/>
\t<SetCombineLERP A0="G_CCMUX_TEXEL0" B0="G_CCMUX_0" C0="G_CCMUX_SHADE" D0="G_CCMUX_0" Aa0="G_ACMUX_0" Ab0="G_ACMUX_0" Ac0="G_ACMUX_0" Ad0="G_ACMUX_1" A1="G_CCMUX_COMBINED" B1="G_CCMUX_0" C1="G_CCMUX_PRIMITIVE" D1="G_CCMUX_0" Aa1="G_ACMUX_0" Ab1="G_ACMUX_0" Ac1="G_ACMUX_0" Ad1="G_ACMUX_COMBINED"/>
\t<SetRenderMode Mode1="G_RM_PASS" Mode2="G_RM_AA_ZB_OPA_SURF2" />
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
  for (const v of verts) { const n = v.n ?? [0, 1, 0]; vtx.push(`\t<Vtx X="${r(v.x)}" Y="${r(v.y)}" Z="${r(v.z)}" S="${r(v.s)}" T="${r(v.t)}" R="${nb(n[0])}" G="${nb(n[1])}" B="${nb(n[2])}" A="255"/>`); }
  vtx.push('</Vertex>');
  const tri = ['<DisplayList Version="0">'];
  for (const b of batches) {
    tri.push(`\t<LoadVertices Path="${DIR}/${name}_vtx_0" VertexBufferIndex="0" VertexOffset="${b.offset}" Count="${b.count}"/>`);
    let t = 0;
    while (t + 1 < b.tris) { const a0 = t * 3, c0 = (t + 1) * 3; tri.push(`\t<Triangles2 V00="${a0}" V01="${a0 + 1}" V02="${a0 + 2}" Flag0="0" V10="${c0}" V11="${c0 + 1}" V12="${c0 + 2}" Flag1="0"/>`); t += 2; }
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

const all = [...sections.values()].filter((s) => s.tris.length);
const rank = (s) => (s.clip === CLIP.DEFAULT ? 0 : s.clip === CLIP.WALL ? 1 : 2);
const secList = all.sort((a, b) => rank(a) - rank(b));
const files = [];
for (const sec of secList) files.push(...meshFiles(sec));
files.push([`${DIR}/data_track_sections`, ['<TrackSections XMLSucks="1">',
  ...secList.map((s) => `\t<Section gfx_path="${DIR}/${s.name}_mesh" surface="${s.surface}" section="${s.sec}" flags="${s.clip}" drawlayer="${s.layer}" x="0" y="0" z="0" />`),
  '</TrackSections>'].join('\n')]);
files.push([`${DIR}/data_paths`, ['<Paths XMLSucks="1">', '\t<TrackWaypoint>',
  ...pathPts.map((p) => `\t\t<Point X="${p.x}" Y="${p.y}" Z="${p.z}" ID="${p.ID}"/>`),
  '\t\t<Point X="-32768" Y="-32768" Z="-32768" ID="0"/>', '\t</TrackWaypoint>', '</Paths>'].join('\n')]);
const scene = {
  Props: {
    ResourceName: RES, Name: 'Sky Islands', DebugName: 'skyisle', TrackLength: `${Math.round(L / 10)}m`,
    AIDistance: [20, 5, 10, 15, 20, 25, 30, 35, 30, 25, 45, 65, 90, 115, 140, 165, 40, 3, 6, 16, 46, 49, 59, 89, 50, 30, 60, 63, 73, 78, 108, 138],
    AIMaximumSeparation: 50.0, AIMinimumSeparation: 0.30000001192092896, AISteeringSensitivity: 48,
    CurveTargetSpeed: [4.166666507720947, 5.583333492279053, 6.166666507720947, 6.75],
    NormalTargetSpeed: [3.75, 5.166666507720947, 5.75, 6.333333492279053],
    D_0D0096B8: [3.3333332538604736, 3.9166667461395264, 4.5, 5.083333492279053],
    OffTrackTargetSpeed: [3.75, 5.166666507720947, 5.75, 6.333333492279053],
    NearPersp: 3.0, FarPersp: 9000.0, LakituTowType: 0,
    Sequence: 18, // MUSIC_SEQ_RAINBOW_ROAD
    WaterLevel: WATER_LEVEL,
    // bright sky above, a pale cloud-white "floor" below the horizon
    Skybox: [40, 120, 230, 170, 215, 250, 170, 215, 250, 40, 120, 230, 220, 232, 245, 220, 232, 245, 220, 232, 245, 220, 232, 245],
    MinimapColour: [255, 255, 255], MinimapPosition: [262, 170], MinimapPosition2P: [5, 0],
    MinimapPlayerX: MM.playerX, MinimapPlayerY: MM.playerY, MinimapPlayerScaleFactor: MM.scale,
    MinimapFinishlineX: 0.0, MinimapFinishlineY: 0.0,
  },
  Actors: actors, StaticMeshActors: null,
};
files.push([`${DIR}/scene.json`, JSON.stringify(scene, null, 2)]);
files.push(['mods.toml', `[mod]\nname = "${MOD}"\nversion = "1.0.0"\n`]);

const CRC_T = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = (buf) => { let c = -1; for (let i = 0; i < buf.length; i++) c = CRC_T[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function zipStore(entries) {
  const locals = [], central = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8'), crc = crc32(data);
    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26); nameBuf.copy(local, 30);
    locals.push(local, data);
    const cen = Buffer.alloc(46 + nameBuf.length);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x21, 14);
    cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(data.length, 20); cen.writeUInt32LE(data.length, 24); cen.writeUInt16LE(nameBuf.length, 28); cen.writeUInt32LE(offset, 42); nameBuf.copy(cen, 46);
    central.push(cen);
    offset += local.length + data.length;
  }
  const cb = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cb.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cb, end]);
}
const entries = files.map(([name, text]) => ({ name, data: Buffer.from(text, 'utf8') }));
const usedTex = new Set(secList.map((s) => s.tex.path));
for (const [k, im] of Object.entries(PAINTED)) if (usedTex.has(TEX[k].path)) entries.push({ name: TEX[k].path, data: texResource(im) });
entries.push({ name: `${DIR}/minimap.png`, data: minimapPng });
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, `${MOD}.o2r`), zipStore(entries));

/* ------------------------------------------------------------ reports */

console.log(`Sky Islands: lap ${Math.round(L)} units, ${pathPts.length} waypoints in ${NSEC} sections, ${secList.reduce((a, s) => a + s.tris.length, 0)} tris (${secList.filter((s) => s.clip).reduce((a, s) => a + s.tris.length, 0)} collision), ${secList.length} meshes`);
console.log(`  Hill 1 dash-pad grade ${(HILL1_G * 100).toFixed(1)}%, every other climb <= ${G_MAX * 100}%`);
console.log(`  shortcuts: Bay Leap fork s=${Math.round(s1Fork)} (sec ${secOfMain(s1Fork)}), Island Hops fork s=${Math.round(s2Fork)} (sec ${secOfMain(s2Fork)})`);
console.log('  jumps (engine air physics; v in units/tick, top speed ~9):');
const reports = [];
for (const p of M.pieces) if (p.tag.mandatory) reports.push(jumpReport(M.piece(p.s0 + p.len + 1).tag.jump ?? 'jump', M, p.s0 + p.len, p.tag.kind === 'boost'));
reports.push(jumpReport('S1 Bay Leap', S1, S1.len, false));
reports.push(jumpReport('S2 hop 1', S2, S2.len, false));
reports.push(jumpReport('S2 hop 2', S2b, S2b.len, false));

mkdirSync(join(OUT, 'preview', 'tex'), { recursive: true });
for (const [k, im] of Object.entries(PAINTED)) writeFileSync(join(OUT, 'preview', 'tex', `tex_${k}.png`), toPNG(im, deflateSync));
writeFileSync(join(OUT, 'preview', 'minimap.png'), minimapPng);
const fr = (f) => ({ path: f.path, s: f.s, x: f.x, y: f.y, z: f.z, w: f.w, nx: f.nx, nz: f.nz, tx: f.tx, tz: f.tz, kind: f.tag.kind, gap: !!f.tag.gap, sec: f.sec });
writeFileSync(join(OUT, 'preview', 'geometry.json'), JSON.stringify({
  sections: secList.map((s) => ({ name: s.name, tex: s.tex, surface: s.surface, clip: s.clip, layer: s.layer, sec: s.sec, tris: s.tris.map((t) => t.map((v) => [r(v.x), r(v.y), r(v.z), r(v.s), r(v.t)])) })),
  path: pathPts, frames: allFrames.map(fr), actors, minimap: MM,
  marks: { L, WATER_LEVEL, lips, forks: { s1: s1Fork, s2: s2Fork } },
  jumps: reports,
}));

