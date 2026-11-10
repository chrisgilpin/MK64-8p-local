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
