/**
 * Procedural RGBA16 textures for the Western University track.
 * Everything is painted here in code (no photos), sized to fit N64 TMEM
 * (<= 2048 texels), and packed as binary OTEX resources like mk64.o2r's.
 */

export class Img {
  constructor(w, h, c = [0, 0, 0]) {
    this.w = w;
    this.h = h;
    this.p = new Float32Array(w * h * 3);
    this.a = new Uint8Array(w * h).fill(1); // 1-bit alpha (0 = see-through)
    this.fill(c);
  }
  set(x, y, c) {
    x = Math.floor(x); y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 3;
    this.p[i] = c[0]; this.p[i + 1] = c[1]; this.p[i + 2] = c[2];
    this.a[y * this.w + x] = 1;
  }
  /** make every pixel see-through (paint opaque pixels back with set) */
  clearAlpha() { this.a.fill(0); this.cutout = true; }
  get(x, y) {
    x = ((x % this.w) + this.w) % this.w; y = ((y % this.h) + this.h) % this.h;
    const i = (y * this.w + x) * 3;
    return [this.p[i], this.p[i + 1], this.p[i + 2]];
  }
  fill(c) { for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) this.set(x, y, c); }
  rect(x0, y0, x1, y1, c) { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) this.set(x, y, c); }
  /** multiply every pixel by (1 + amt * noise) */
  noise(amt, rnd, x0 = 0, y0 = 0, x1 = this.w, y1 = this.h) {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const c = this.get(x, y); const k = 1 + amt * (rnd() * 2 - 1);
      this.set(x, y, c.map((v) => v * k));
    }
  }
  speckle(n, colors, rnd) {
    for (let k = 0; k < n; k++) this.set(rnd() * this.w, rnd() * this.h, colors[Math.floor(rnd() * colors.length)]);
  }
}

export function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

const C = (r, g, b) => [r / 255, g / 255, b / 255];
export const PAL = {
  purple: C(79, 38, 131), // Western purple
  purpleDark: C(52, 24, 90),
  purpleLight: C(140, 110, 190),
  sand: C(196, 176, 136), // collegiate-gothic sandstone
  sandDark: C(160, 140, 104),
  sandLight: C(218, 202, 166),
  lime: C(222, 218, 202), // Indiana limestone trim
  limeDark: C(184, 180, 166),
  slate: C(70, 76, 86),
  copper: C(92, 160, 136),
  copperDark: C(62, 118, 100),
  glass: C(92, 118, 140),
  glassLight: C(150, 182, 200),
  lead: C(60, 64, 70),
  concrete: C(170, 168, 160),
  concreteDark: C(132, 130, 124),
  asphalt: C(78, 80, 84),
  white: C(240, 240, 236),
  yellow: C(232, 196, 40),
  black: C(28, 28, 30),
  hedge: C(46, 96, 44),
  hedgeDark: C(30, 70, 32),
  water: C(54, 96, 104),
  waterLight: C(96, 140, 146),
  brick: C(146, 72, 52),
  mortar: C(190, 182, 168),
  wood: C(120, 84, 52),
  green: C(30, 110, 60),
};

// 5x7 bitmap font
const FONT = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01111', '10000', '10000', '10111', '10001', '10001', '01111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '01010', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  '!': ['00100', '00100', '00100', '00100', '00100', '00000', '00100'],
  '.': ['00000', '00000', '00000', '00000', '00000', '00000', '00100'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};
export function text(img, str, cx, cy, color, scale = 1) {
  const w = str.length * 6 * scale - scale;
  let x0 = Math.round(cx - w / 2);
  const y0 = Math.round(cy - (7 * scale) / 2);
  for (const ch of str) {
    const g = FONT[ch];
    if (!g) throw new Error(`font has no glyph for "${ch}"`);
    for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++)
      if (g[r][c] === '1') img.rect(x0 + c * scale, y0 + r * scale, x0 + (c + 1) * scale, y0 + (r + 1) * scale, color);
    x0 += 6 * scale;
  }
}

/** ashlar: coursed stone blocks with per-block tint */
function ashlar(img, rnd, x0, y0, x1, y1, base, course = 6, len = 12, jitter = 0.08) {
  for (let y = y0; y < y1; y++) {
    const row = Math.floor((y - y0) / course);
    for (let x = x0; x < x1; x++) {
      const off = row % 2 ? len / 2 : 0;
      const bx = Math.floor((x - x0 + off) / len);
      const joint = (y - y0) % course === course - 1 || (x - x0 + off) % len === len - 1;
      const h = Math.sin(bx * 12.9898 + row * 78.233) * 43758.5453;
      const t = h - Math.floor(h);
      const k = joint ? 0.78 : 1 + (t - 0.5) * 2 * jitter + (rnd() - 0.5) * 0.06;
      img.set(x, y, base.map((v) => v * k));
    }
  }
}
/** pointed (gothic) arch test: inside an arch of half-width hw whose springline is at ys, apex above */
function inPointed(x, y, cx, ys, hw, yBottom) {
  if (y > yBottom || Math.abs(x - cx) > hw) return false;
  if (y >= ys) return true;
  // two circles of radius 2*hw centred on the opposite springing points
  const r = 2 * hw, dy = ys - y;
  const dxL = x - (cx - hw), dxR = (cx + hw) - x;
  return Math.hypot(r - dxL, dy) <= r && Math.hypot(r - dxR, dy) <= r;
}

export function makeTextures() {
  const T = {};
  const R = rng(1878); // Western's founding year

  // University Drive: asphalt, white edge lines, double yellow centre line
  {
    const im = new Img(64, 32, PAL.asphalt); im.noise(0.1, R);
    im.rect(3, 0, 5, 32, PAL.white); im.rect(59, 0, 61, 32, PAL.white);
    im.rect(30, 0, 31, 32, PAL.yellow); im.rect(33, 0, 34, 32, PAL.yellow);
    T.road = im;
  }
  // start/finish: the road with a checker band
  {
    const im = new Img(64, 32, PAL.asphalt); im.noise(0.08, R);
    im.rect(3, 0, 5, 32, PAL.white); im.rect(59, 0, 61, 32, PAL.white);
    for (let x = 5; x < 59; x += 4) for (let y = 8; y < 24; y += 4) im.rect(x, y, x + 4, y + 4, ((x - 5) / 4 + y / 4) % 2 ? PAL.black : PAL.white);
    T.finish = im;
  }
  // Thames Valley Parkway: a narrow path, white edge lines, dashed centre
  {
    const im = new Img(32, 32, C(92, 92, 96)); im.noise(0.12, R);
    im.rect(1, 0, 2, 32, PAL.white); im.rect(30, 0, 31, 32, PAL.white); im.rect(15, 0, 17, 16, PAL.yellow);
    T.path = im;
  }
  // brick pavers (Kent Drive, the walk up to UC): herringbone
  {
    const im = new Img(32, 32, PAL.mortar);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      const u = (x + y) % 16, v = (x - y + 64) % 16;
      const horiz = Math.floor((x + y) / 8) % 2 === 0;
      const joint = horiz ? u === 0 || (v % 8) === 0 : v === 0 || (u % 8) === 0;
      if (!joint) { const k = 0.9 + 0.2 * R(); im.set(x, y, PAL.brick.map((c) => c * k)); }
    }
    T.pavers = im;
  }
  // Concrete Beach: big pale slabs
  {
    const im = new Img(32, 32, C(196, 194, 186)); im.noise(0.06, R);
    im.rect(0, 0, 32, 1, C(140, 138, 132)); im.rect(0, 0, 1, 32, C(140, 138, 132)); im.rect(0, 16, 32, 17, C(160, 158, 152)); im.rect(16, 0, 17, 32, C(160, 158, 152));
    im.speckle(20, [C(176, 174, 166), C(210, 208, 200)], R);
    T.slabs = im;
  }
  // footbridge planks
  {
    const im = new Img(32, 32, PAL.wood);
    for (let y = 0; y < 32; y++) { const k = [1, 0.9, 1.06, 0.95][Math.floor(y / 8)]; for (let x = 0; x < 32; x++) im.set(x, y, PAL.wood.map((c) => c * k)); if (y % 8 === 7) im.rect(0, y, 32, y + 1, C(70, 48, 30)); }
    im.noise(0.06, R);
    T.planks = im;
  }
  // collegiate-gothic bay: sandstone ashlar round a leaded lancet window with a limestone surround
  {
    const im = new Img(32, 64);
    ashlar(im, R, 0, 0, 32, 64, PAL.sand, 6, 12);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 32; x++) {
      if (inPointed(x, y, 15.5, 22, 9, 54)) im.set(x, y, PAL.lime);
      if (inPointed(x, y, 15.5, 23, 7, 52)) {
        const mull = Math.abs(x - 15.5) < 1 || y === 38;
        const lead = (x + y) % 4 === 0 || (x - y + 64) % 4 === 0;
        im.set(x, y, mull ? PAL.lime : lead ? PAL.lead : (y < 30 ? PAL.glassLight : PAL.glass));
      }
    }
    im.rect(4, 55, 28, 58, PAL.lime); // sill
    T.gothic = im;
  }
  // plain sandstone (tower, walls, parapets)
  { const im = new Img(32, 32); ashlar(im, R, 0, 0, 32, 32, PAL.sand, 6, 12); T.sandstone = im; }
  // limestone trim
  { const im = new Img(32, 32); ashlar(im, R, 0, 0, 32, 32, PAL.lime, 8, 16, 0.04); T.limestone = im; }
  // belfry: tall louvred lancet openings
  {
    const im = new Img(32, 64);
    ashlar(im, R, 0, 0, 32, 64, PAL.sand, 6, 12);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 32; x++) {
      if (inPointed(x, y, 15.5, 16, 10, 60)) im.set(x, y, PAL.lime);
      if (inPointed(x, y, 15.5, 17, 8, 58)) im.set(x, y, (y % 4 < 2) ? C(40, 38, 36) : C(90, 84, 76));
    }
    T.belfry = im;
  }
  // vaulted ceiling of the tower passage: stone with ribs
  {
    const im = new Img(32, 32); ashlar(im, R, 0, 0, 32, 32, PAL.sandLight, 8, 16, 0.05);
    for (let k = 0; k < 32; k++) { im.set(k, k, PAL.limeDark); im.set(31 - k, k, PAL.limeDark); im.set(k, 15, PAL.limeDark); }
    T.vault = im;
  }
  // passage walls: blind gothic arcade
  {
    const im = new Img(32, 64);
    ashlar(im, R, 0, 0, 32, 64, PAL.sandLight, 6, 12);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 32; x++) {
      if (inPointed(x, y, 15.5, 20, 11, 60) && !inPointed(x, y, 15.5, 21, 9, 60)) im.set(x, y, PAL.lime);
      else if (inPointed(x, y, 15.5, 21, 9, 60)) im.set(x, y, PAL.sand.map((c) => c * 0.82));
    }
    T.arcade = im;
  }
  // the pointed arch head over the tower archway: stone with a see-through pointed opening
  {
    const im = new Img(64, 32, PAL.lime);
    ashlar(im, R, 0, 0, 64, 32, PAL.lime, 8, 16, 0.04);
    im.clearAlpha();
    for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) {
      if (!inPointed(x, y * 2, 31.5, 64, 32, 64)) { const c = im.get(x, y); im.set(x, y, c); }
    }
    // a voussoir band just inside the arch
    for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) if (im.a[y * 64 + x] && inPointed(x, y * 2, 31.5, 64, 35, 64)) im.set(x, y, PAL.sand);
    T.archHead = im;
  }
  // slate roof
  {
    const im = new Img(32, 32, PAL.slate);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      const row = Math.floor(y / 4), off = row % 2 ? 4 : 0;
      const k = (y % 4 === 3 || (x + off) % 8 === 7) ? 0.7 : 0.92 + 0.16 * R();
      im.set(x, y, PAL.slate.map((c) => c * k));
    }
    T.slate = im;
  }
  // verdigris copper (Middlesex College spire)
  { const im = new Img(32, 32, PAL.copper); im.noise(0.12, R); for (let x = 0; x < 32; x += 8) im.rect(x, 0, x + 1, 32, PAL.copperDark); T.copper = im; }
  // clock face
  {
    const im = new Img(32, 32); ashlar(im, R, 0, 0, 32, 32, PAL.sand, 6, 12);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      const d = Math.hypot(x - 15.5, y - 15.5);
      if (d < 14) im.set(x, y, PAL.lime);
      if (d < 12.5) im.set(x, y, C(236, 232, 214));
    }
    for (let h = 0; h < 12; h++) { const a = (h / 12) * 2 * Math.PI; im.rect(Math.round(15.5 + 10.5 * Math.sin(a)) - (h % 3 ? 0 : 1), Math.round(15.5 - 10.5 * Math.cos(a)) - (h % 3 ? 0 : 1), Math.round(15.5 + 10.5 * Math.sin(a)) + 1, Math.round(15.5 - 10.5 * Math.cos(a)) + 1, PAL.black); }
    for (let k = 0; k < 8; k++) im.set(15 + k * 0.0, 15 - k, PAL.black); // minute hand (12)
    for (let k = 0; k < 6; k++) im.set(16 + k, 16, PAL.black); // hour hand (3)
    T.clock = im;
  }
  // University Drive Bridge: stone spandrel face
  { const im = new Img(32, 32); ashlar(im, R, 0, 0, 32, 32, C(170, 160, 140), 8, 14, 0.1); T.bridgeStone = im; }
  // arch spandrel over each bridge opening: stone with a see-through round arch
  {
    const im = new Img(64, 32);
    ashlar(im, R, 0, 0, 64, 32, C(170, 160, 140), 8, 14, 0.1);
    im.clearAlpha();
    for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) {
      const d = Math.hypot((x - 31.5) / 32, (y - 32) / 32);
      if (d >= 1) im.set(x, y, im.get(x, y));
      else if (d >= 0.9) im.set(x, y, C(200, 192, 172)); // voussoirs
    }
    T.spandrel = im;
  }
  // stone balustrade: rails and vase balusters, see-through between
  {
    const im = new Img(32, 32, PAL.lime);
    im.clearAlpha();
    im.rect(0, 0, 32, 5, PAL.lime); im.rect(0, 27, 32, 32, PAL.limeDark);
    for (let y = 5; y < 27; y++) for (let x = 0; x < 32; x++) {
      const cx = (x % 8) - 3.5, t = (y - 5) / 22;
      const hw = 1.2 + 1.6 * Math.sin(Math.PI * Math.min(1, t * 1.4));
      if (Math.abs(cx) < hw) im.set(x, y, Math.abs(cx) < hw - 0.8 ? PAL.lime : PAL.limeDark);
    }
    T.balustrade = im;
  }
  // the Thames
  {
    const im = new Img(32, 32, PAL.water);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      const w = Math.sin((x + 2 * Math.sin(y * 0.6)) * 0.8) + Math.sin(y * 0.4 + x * 0.2);
      if (w > 1.4) im.set(x, y, PAL.waterLight);
      else if (w < -1.3) im.set(x, y, PAL.water.map((c) => c * 0.85));
    }
    T.water = im;
  }
  // clipped hedge
  {
    const im = new Img(32, 32, PAL.hedge); im.speckle(260, [PAL.hedgeDark, C(70, 128, 60), C(56, 112, 50)], R);
    im.rect(0, 0, 32, 2, C(78, 136, 66));
    T.hedge = im;
  }
  // split-rail fence through the woods (see-through)
  {
    const im = new Img(32, 32, PAL.wood);
    im.clearAlpha();
    im.rect(0, 6, 32, 10, PAL.wood); im.rect(0, 19, 32, 23, PAL.wood.map((c) => c * 0.9)); im.rect(13, 3, 19, 32, C(100, 70, 44));
    T.rail = im;
  }
  // purple steel truss for the footbridge (see-through)
  {
    const im = new Img(32, 32, PAL.purple);
    im.clearAlpha();
    im.rect(0, 0, 32, 3, PAL.purple); im.rect(0, 29, 32, 32, PAL.purpleDark); im.rect(0, 0, 3, 32, PAL.purple);
    for (let k = 0; k < 32; k++) { im.rect(k, k, k + 2, k + 1, PAL.purpleLight); im.rect(31 - k, k, 33 - k, k + 1, PAL.purple); }
    T.truss = im;
  }
  // rubble-stone river and retaining walls
  {
    const im = new Img(32, 32, C(120, 116, 106));
    for (let k = 0; k < 40; k++) {
      const cx = R() * 32, cy = R() * 32, rx = 3 + R() * 4, ry = 2 + R() * 3, sh = 0.85 + R() * 0.35;
      for (let y = Math.floor(cy - ry); y <= cy + ry; y++) for (let x = Math.floor(cx - rx); x <= cx + rx; x++)
        if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 < 1) im.set(((x % 32) + 32) % 32, ((y % 32) + 32) % 32, C(150 * sh, 144 * sh, 130 * sh));
    }
    T.rubble = im;
  }
  // concrete seat walls / planters
  { const im = new Img(32, 32, PAL.concrete); im.noise(0.08, R); im.rect(0, 0, 32, 3, PAL.concreteDark); T.concrete = im; }
  // Weldon Library: board-formed brutalist concrete with deep window slots
  {
    const im = new Img(64, 32, PAL.concrete);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) im.set(x, y, PAL.concrete.map((c) => c * (y % 4 === 0 ? 0.88 : 0.97 + 0.06 * R())));
    for (let x = 4; x < 64; x += 12) im.rect(x, 6, x + 5, 26, C(40, 44, 50));
    T.brutal = im;
  }
  // UCC / modern buildings: brick piers with glass curtain wall
  {
    const im = new Img(64, 32, PAL.glass);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) im.set(x, y, (y < 14 ? PAL.glassLight : PAL.glass).map((c) => c * (0.95 + 0.1 * R())));
    for (let x = 0; x < 64; x += 16) im.rect(x, 0, x + 1, 32, C(50, 52, 58));
    im.rect(0, 15, 64, 16, C(50, 52, 58));
    for (let y = 0; y < 32; y++) for (let x = 0; x < 6; x++) { const row = Math.floor(y / 3); im.set(x, y, (y % 3 === 2 || (x + row) % 6 === 5) ? PAL.mortar : PAL.brick); im.set(x + 32, y, (y % 3 === 2 || (x + row) % 6 === 5) ? PAL.mortar : PAL.brick); }
    T.modern = im;
  }
  // residence hall (Medway-Sydenham): stone with paired sash windows
  {
    const im = new Img(32, 32); ashlar(im, R, 0, 0, 32, 32, PAL.sandDark, 4, 10);
    for (const x of [5, 18]) { im.rect(x - 1, 7, x + 10, 25, PAL.lime); im.rect(x, 8, x + 9, 24, PAL.glass); im.rect(x, 15, x + 9, 16, PAL.white); im.rect(x + 4, 8, x + 5, 24, PAL.white); }
    T.residence = im;
  }
  // signs
  const sign = (str, bg, fg, rim, scale = 1, w = 64, h = 32) => {
    const im = new Img(w, h, bg);
    im.rect(0, 0, w, 2, rim); im.rect(0, h - 2, w, h, rim); im.rect(0, 0, 2, h, rim); im.rect(w - 2, 0, w, h, rim);
    const lines = str.split('|');
    lines.forEach((ln, i) => text(im, ln, w / 2, h / 2 + (i - (lines.length - 1) / 2) * 9 * scale, fg, scale));
    return im;
  };
  T.signWestern = sign('WESTERN', PAL.purple, PAL.white, PAL.lime, 1);
  T.signUC = sign('UNIVERSITY|COLLEGE', PAL.lime, PAL.purpleDark, PAL.sandDark);
  T.signMC = sign('MIDDLESEX|COLLEGE', PAL.lime, PAL.purpleDark, PAL.sandDark);
  T.signBeach = sign('CONCRETE|BEACH', PAL.purple, PAL.white, PAL.white);
  T.signUDr = sign('UNIVERSITY|DRIVE', PAL.green, PAL.white, PAL.white);
  T.signRichmond = sign('RICHMOND|STREET', PAL.green, PAL.white, PAL.white);
  T.signTVP = sign('THAMES|PATHWAY', C(120, 84, 52), PAL.white, C(80, 56, 34));
  T.signWeldon = sign('WELDON|LIBRARY', PAL.concreteDark, PAL.white, PAL.black);
  T.signUCC = sign('UCC', PAL.purple, PAL.white, PAL.white, 2);
  T.signMustangs = sign('GO|MUSTANGS!', PAL.purple, PAL.white, PAL.lime);
  // purple light-pole banner with a big W
  {
    const im = new Img(32, 64, PAL.purple);
    im.rect(0, 0, 32, 3, PAL.white); im.rect(0, 61, 32, 64, PAL.white);
    text(im, 'W', 16, 24, PAL.white, 3);
    im.rect(4, 44, 28, 46, PAL.white); im.rect(4, 50, 28, 52, PAL.purpleLight);
    T.banner = im;
  }
  return T;
}
export function texResource(img) {
  const body = Buffer.alloc(img.w * img.h * 2);
  for (let i = 0; i < img.w * img.h; i++) {
    const q = (v) => Math.max(0, Math.min(31, Math.round(v * 31)));
    const v = (q(img.p[i * 3]) << 11) | (q(img.p[i * 3 + 1]) << 6) | (q(img.p[i * 3 + 2]) << 1) | img.a[i];
    body.writeUInt16BE(v, i * 2);
  }
  const head = Buffer.alloc(0x40);
  head.write('XETO', 4, 'ascii'); // resource type 'OTEX'
  head.writeUInt32LE(0, 8); // version 0
  head.writeUInt32LE(0xdeadbeef, 12);
  head.writeUInt32LE(0xdeadbeef, 16);
  const meta = Buffer.alloc(16);
  meta.writeUInt32LE(2, 0); // TextureType::RGBA16bpp
  meta.writeUInt32LE(img.w, 4);
  meta.writeUInt32LE(img.h, 8);
  meta.writeUInt32LE(body.length, 12);
  return Buffer.concat([head, meta, body]);
}

/** 8-bit RGB PNG for previews. */
export function toPNG(img, deflateSync) {
  const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = (buf) => { let c = -1; for (const b of buf) c = crcT[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (type, data) => { const o = Buffer.alloc(12 + data.length); o.writeUInt32BE(data.length, 0); o.write(type, 4, 'ascii'); data.copy(o, 8); o.writeUInt32BE(crc(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length); return o; };
  // RGBA only when the texture has see-through pixels (minimap etc. stay RGB)
  const alpha = !!img.a && img.a.some((v) => !v), C = alpha ? 4 : 3;
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(img.w, 0); ihdr.writeUInt32BE(img.h, 4); ihdr[8] = 8; ihdr[9] = alpha ? 6 : 2;
  const raw = Buffer.alloc((img.w * C + 1) * img.h);
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
    for (let k = 0; k < 3; k++) {
      // quantise exactly as the game will see it (5 bits per channel)
      raw[y * (img.w * C + 1) + 1 + x * C + k] = Math.round(Math.max(0, Math.min(31, Math.round(img.p[(y * img.w + x) * 3 + k] * 31))) * 255 / 31);
    }
    if (alpha) raw[y * (img.w * C + 1) + 1 + x * C + 3] = img.a[y * img.w + x] ? 255 : 0;
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
