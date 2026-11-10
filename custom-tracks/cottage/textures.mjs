/**
 * Procedural RGBA16 textures for the Cottage Living Room track.
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

const P = {
  floor: C(122, 54, 30), // cedar plank floor
  floorDark: C(84, 34, 20),
  white: C(238, 234, 222), // painted V-groove
  whiteShade: C(206, 200, 186),
  ceiling: C(242, 238, 228),
  cream: C(232, 222, 198),
  creamShade: C(210, 198, 172),
  jute: C(214, 198, 166),
  rose: C(196, 140, 128),
  roseDark: C(160, 100, 92),
  blueGrey: C(122, 140, 160),
  navy: C(70, 84, 112),
  orange: C(244, 110, 20), // toy-track orange
  orangeDark: C(196, 76, 12),
  orangeLight: C(255, 156, 60),
  walnut: C(70, 36, 22),
  walnutLight: C(98, 56, 34),
  leather: C(102, 56, 32),
  stoneGrey: C(110, 108, 104),
  stoneBrown: C(132, 112, 92),
  mortar: C(176, 170, 158),
  soot: C(34, 30, 28),
  oak: C(176, 110, 60),
  black: C(24, 24, 26),
  chrome: C(196, 198, 204),
  sky: C(150, 196, 236),
  lake: C(64, 110, 150),
  lakeLight: C(120, 160, 196),
  pine: C(38, 70, 44),
  red: C(204, 40, 44),
};

/** fieldstone: irregular rounded stones in grey and brown granite, light mortar */
function fieldstone(img, rnd, n = 26) {
  img.fill(P.mortar);
  const W = img.w, H = img.h, cells = [];
  for (let k = 0; k < n; k++) cells.push([rnd() * W, rnd() * H, rnd()]);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let d1 = 1e9, d2 = 1e9, best = null;
    for (const c of cells) for (const ox of [-W, 0, W]) for (const oy of [-H, 0, H]) {
      const d = Math.hypot(x - c[0] - ox, y - c[1] - oy);
      if (d < d1) { d2 = d1; d1 = d; best = c; } else if (d < d2) d2 = d;
    }
    if (d2 - d1 < 1.6) continue; // mortar joint
    const base = best[2] < 0.55 ? P.stoneGrey : P.stoneBrown;
    const k = 0.75 + 0.45 * best[2] + (rnd() - 0.5) * 0.18 - 0.05 * Math.max(0, 3 - (d2 - d1));
    img.set(x, y, base.map((v) => v * k));
  }
}

export function makeTextures() {
  const T = {};
  const R = rng(2026);

  // wide cedar floor planks, running along the texture's t axis, with knots
  {
    const im = new Img(64, 32, P.floor);
    for (let x = 0; x < 64; x++) {
      const plank = Math.floor(x / 16), tint = [1, 0.9, 1.08, 0.95][plank];
      for (let y = 0; y < 32; y++) {
        const grain = 1 + 0.06 * Math.sin((x * 1.7 + y * 0.15) + plank * 3) + (R() - 0.5) * 0.06;
        im.set(x, y, (x % 16 === 15 ? P.floorDark : P.floor).map((v) => v * tint * grain));
      }
    }
    for (const [kx, ky] of [[6, 9], [27, 22], [44, 5], [56, 26]]) for (let y = -2; y <= 2; y++) for (let x = -1; x <= 1; x++) im.set(kx + x, ky + y, P.floorDark.map((v) => v * (0.8 + 0.1 * Math.abs(y))));
    T.floor = im;
  }
  // the faded Persian runner: rose field, blue-grey border, medallions (t runs along the runner)
  {
    const im = new Img(32, 64, P.rose);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 32; x++) {
      const border = x < 3 || x > 28;
      const inner = x === 3 || x === 28;
      const d = Math.abs(x - 15.5) + Math.abs(((y + 16) % 32) - 15.5) * 0.9; // diamond medallions
      let c = P.rose;
      if (border) c = (y % 4 < 2) ? P.blueGrey : P.navy;
      else if (inner) c = P.cream;
      else if (d < 4) c = P.navy;
      else if (d < 7) c = P.cream;
      else if (d < 11 && d > 9) c = P.blueGrey;
      else if ((x + y) % 7 === 0) c = P.roseDark;
      im.set(x, y, c.map((v) => v * (0.92 + 0.12 * R())));
    }
    T.persian = im;
  }
  // start/finish band on the runner
  {
    const im = new Img(32, 32, P.rose);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      if (x < 3 || x > 28) { im.set(x, y, P.navy); continue; }
      im.set(x, y, ((Math.floor(x / 4) + Math.floor(y / 4)) % 2) ? P.black : P.white);
    }
    T.finish = im;
  }
  // chunky jute rug
  { const im = new Img(32, 32, P.jute); for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) { const w = ((x >> 1) + (y >> 1)) % 2; im.set(x, y, P.jute.map((v) => v * (w ? 0.9 : 1.04) * (0.95 + 0.1 * R()))); } T.jute = im; }
  // grey/tan striped cotton rug by the doors
  { const im = new Img(32, 32); for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) { const c = Math.floor(y / 8) % 2 ? C(120, 116, 108) : C(196, 176, 136); im.set(x, y, c.map((v) => v * (0.9 + 0.15 * R()))); } T.striped = im; }
  // orange toy race track: bright plastic with a lighter centre and connector joints
  {
    const im = new Img(32, 32, P.orange);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      const e = Math.min(x, 31 - x);
      im.set(x, y, e < 2 ? P.orangeDark : (e < 5 ? P.orange : P.orange.map((v, i) => Math.min(1, v * (i === 0 ? 1 : 1.06)))));
    }
    im.rect(0, 0, 32, 1, P.orangeDark);
    for (const x of [9, 22]) im.rect(x, 6, x + 1, 26, P.orangeLight);
    T.orange = im;
  }
  { const im = new Img(32, 32, P.orangeDark); im.rect(0, 0, 32, 4, P.orangeLight); im.noise(0.05, R); T.orangeCurb = im; }
  // dark walnut (coffee table)
  { const im = new Img(32, 32, P.walnut); for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) im.set(x, y, P.walnut.map((v) => v * (1 + 0.12 * Math.sin(y * 0.9 + Math.sin(x * 0.3) * 2) + (R() - 0.5) * 0.08))); T.walnut = im; }
  // magazines lying on the table
  {
    const im = new Img(64, 32, P.white);
    const covers = [[C(30, 60, 120), C(250, 250, 250)], [C(200, 60, 50), C(250, 220, 80)], [C(240, 236, 226), C(40, 40, 40)], [C(40, 110, 90), C(240, 240, 240)]];
    covers.forEach(([bg, fg], i) => {
      const x0 = i * 16;
      im.rect(x0, 0, x0 + 15, 32, bg);
      im.rect(x0 + 2, 3, x0 + 13, 6, fg);
      im.rect(x0 + 3, 10, x0 + 12, 22, bg.map((v) => v * 0.7 + 0.25));
      im.rect(x0 + 2, 25, x0 + 10, 26, fg); im.rect(x0 + 2, 28, x0 + 12, 29, fg);
      im.rect(x0 + 15, 0, x0 + 16, 32, P.whiteShade);
    });
    T.magazines = im;
  }
  // tufted cream ottoman
  { const im = new Img(32, 32, P.cream); im.noise(0.04, R); for (const [x, y] of [[8, 8], [24, 8], [8, 24], [24, 24], [16, 16]]) { im.rect(x - 1, y - 1, x + 1, y + 1, P.creamShade.map((v) => v * 0.8)); } T.ottoman = im; }
  // the long sofa: cream with soft wide stripes
  { const im = new Img(32, 32); for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) im.set(x, y, (Math.floor(x / 8) % 2 ? P.cream : C(222, 214, 192)).map((v) => v * (0.97 + 0.05 * R()))); T.sofa = im; }
  // the loveseat: plain cream leather-look
  { const im = new Img(32, 32, C(234, 226, 206)); im.noise(0.05, R); T.loveseat = im; }
  // red and white striped cushion
  { const im = new Img(32, 32); for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) im.set(x, y, Math.floor(y / 5) % 2 ? P.white : P.red); T.pillow = im; }
  // fieldstone fireplace
  { const im = new Img(64, 32); fieldstone(im, R, 22); T.fieldstone = im; }
  // hearth slabs
  { const im = new Img(32, 32, C(96, 94, 90)); im.noise(0.12, R); im.rect(0, 15, 32, 16, C(60, 58, 56)); im.rect(15, 0, 16, 15, C(60, 58, 56)); im.rect(7, 16, 8, 32, C(60, 58, 56)); T.hearth = im; }
  // inside the firebox: sooty firebrick
  {
    const im = new Img(32, 32, P.soot);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) { const row = Math.floor(y / 4), off = row % 2 ? 4 : 0; im.set(x, y, (y % 4 === 3 || (x + off) % 8 === 7) ? C(20, 18, 16) : C(70, 40, 30).map((v) => v * (0.6 + 0.4 * R()))); }
    T.firebrick = im;
  }
  // rough-hewn mantel beam with peg holes
  {
    const im = new Img(64, 32, P.oak);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) im.set(x, y, P.oak.map((v) => v * (0.85 + 0.12 * Math.sin(y * 0.8 + x * 0.05) + (R() - 0.5) * 0.12)));
    for (const x of [8, 24, 40, 56]) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (dx * dx + dy * dy <= 4) im.set(x + dx, 16 + dy, C(50, 30, 18));
    T.mantel = im;
  }
  // logs
  { const im = new Img(32, 32, C(90, 64, 44)); for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) if ((y + Math.floor(Math.sin(x * 0.5) * 2)) % 6 === 0) im.set(x, y, C(60, 42, 28)); im.noise(0.1, R); T.logs = im; }
  // white V-groove board walls (boards run vertically)
  { const im = new Img(32, 32, P.white); for (let x = 0; x < 32; x++) if (x % 16 === 0) im.rect(x, 0, x + 1, 32, P.whiteShade.map((v) => v * 0.85)); else if (x % 16 === 1) im.rect(x, 0, x + 1, 32, P.whiteShade); im.noise(0.02, R); T.vgroove = im; }
  // white plank ceiling
  { const im = new Img(32, 32, P.ceiling); for (let y = 0; y < 32; y += 8) im.rect(0, y, 32, y + 1, P.whiteShade); T.ceiling = im; }
  // window onto the lake: sky, far shore, water, pines, the deck railing, white mullions
  {
    const im = new Img(32, 64, P.sky);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 32; x++) {
      let c = P.sky.map((v) => v * (0.92 + y * 0.003));
      if (y > 22 && y <= 26) c = C(70, 100, 70); // far shore
      if (y > 26) c = (Math.sin(x * 1.3 + y * 0.9) > 0.85 ? P.lakeLight : P.lake);
      if (y > 50) c = C(150, 140, 126); // deck boards
      if (y > 40 && y <= 50 && x % 4 === 0) c = P.black; // railing pickets
      if (y === 40) c = P.black;
      const trunk = (x === 5 || x === 24) && y < 46;
      if (trunk) c = C(70, 50, 36);
      const crown = (Math.abs(x - 5) < (y < 20 ? (y - 2) / 4 : 0) || Math.abs(x - 24) < (y < 24 ? (y - 4) / 4 : 0)) && y > 2;
      if (crown) c = P.pine;
      im.set(x, y, c);
    }
    im.rect(0, 0, 32, 2, P.white); im.rect(0, 62, 32, 64, P.white); im.rect(0, 0, 2, 64, P.white); im.rect(30, 0, 32, 64, P.white);
    im.rect(0, 14, 32, 15, P.white); // transom bar
    T.window = im;
  }
  // kitchen seen through the doorway
  {
    const im = new Img(64, 32, C(236, 232, 222));
    im.rect(0, 0, 64, 12, C(240, 238, 232)); for (let x = 2; x < 64; x += 12) im.rect(x, 1, x + 10, 11, C(250, 250, 246)); // upper cabinets
    im.rect(0, 18, 64, 20, C(70, 50, 36)); // counter
    for (let x = 2; x < 64; x += 12) im.rect(x, 21, x + 10, 31, C(248, 248, 244)); // lower cabinets
    im.rect(26, 13, 34, 17, C(60, 60, 64)); // range hood
    T.kitchen = im;
  }
  // framed photos on the mantel
  const frame = (fn) => { const im = new Img(32, 32, P.black); im.rect(2, 2, 30, 30, P.white); fn(im); return im; };
  T.photoSail = frame((im) => { im.rect(6, 6, 26, 26, C(150, 150, 150)); im.rect(6, 20, 26, 26, C(90, 90, 90)); for (let y = 8; y < 20; y++) im.rect(16 - Math.floor((y - 8) / 2), y, 16, y + 1, P.white); for (let y = 10; y < 20; y++) im.rect(17, y, 17 + Math.floor((y - 10) / 3), y + 1, C(230, 230, 230)); im.rect(12, 20, 21, 22, C(40, 40, 40)); });
  T.photoCollage = frame((im) => { im.rect(6, 6, 26, 26, C(236, 236, 236)); for (let y = 8; y < 24; y += 5) for (let x = 8; x < 24; x += 5) im.rect(x, y, x + 3, y + 3, C(60, 60, 60)); });
  T.photoSea = frame((im) => { im.rect(6, 6, 26, 26, C(170, 170, 170)); im.rect(6, 17, 26, 26, C(70, 70, 70)); im.rect(10, 16, 22, 17, C(40, 40, 40)); });
  // the big canvas of an outrigger boat over the piano
  {
    const im = new Img(64, 32, C(70, 110, 180));
    for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) {
      let c = y < 14 ? C(60 + y * 4, 110 + y * 3, 190) : C(40, 90, 130).map((v) => v * (0.9 + 0.2 * Math.sin(x * 0.7 + y)));
      if (y >= 8 && y < 14 && x > 38 - (y - 8) * 0 && x > 30 + (14 - y) * 3) c = C(60, 70, 50); // hill
      im.set(x, y, c);
    }
    im.rect(14, 18, 50, 22, P.white); im.rect(18, 22, 46, 24, C(200, 200, 196)); // hull
    im.rect(8, 17, 58, 18, C(230, 230, 220)); im.rect(28, 9, 29, 18, C(90, 90, 90)); im.rect(24, 10, 40, 11, C(120, 120, 120)); // outriggers, mast
    for (const [x, y] of [[10, 4], [30, 3], [48, 5]]) im.rect(x, y, x + 8, y + 2, P.white);
    T.boatCanvas = im;
  }
  // piano: warm wood and the keyboard
  { const im = new Img(32, 32, C(150, 82, 46)); for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) im.set(x, y, C(150, 82, 46).map((v) => v * (0.9 + 0.1 * Math.sin(y * 1.1 + x * 0.1) + (R() - 0.5) * 0.06))); T.pianoWood = im; }
  {
    const im = new Img(64, 32, P.white);
    for (let x = 0; x < 64; x++) if (x % 4 === 3) im.rect(x, 0, x + 1, 32, C(150, 150, 150));
    const blacks = [1, 2, 4, 5, 6]; // in each octave of 7 whites
    for (let k = 0; k < 16; k++) if (blacks.includes(k % 7)) im.rect(k * 4 - 1, 0, k * 4 + 1, 19, P.black);
    T.keys = im;
  }
  // brown leather armchair
  { const im = new Img(32, 32, P.leather); im.noise(0.1, R); for (let k = 0; k < 20; k++) { const x = Math.floor(R() * 32), y = Math.floor(R() * 32); im.rect(x, y, x + 2, y + 1, P.leather.map((v) => v * 1.25)); } T.leather = im; }
  // chrome / brushed nickel
  { const im = new Img(32, 32); for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) im.set(x, y, P.chrome.map((v) => v * (0.7 + 0.3 * Math.abs(Math.sin(x * 0.2))))); T.chrome = im; }
  // white lamp shades
  { const im = new Img(32, 32, C(246, 244, 236)); im.noise(0.02, R); im.rect(0, 0, 32, 2, C(220, 218, 210)); T.shade = im; }
  // stacked books (the toy track's supports)
  {
    const im = new Img(64, 32);
    const cols = [C(160, 40, 40), C(40, 70, 130), C(220, 180, 60), C(40, 110, 70), C(110, 60, 120), C(230, 230, 220), C(200, 100, 40), C(60, 60, 64)];
    for (let y = 0; y < 32; y++) {
      const book = Math.floor(y / 8), c = cols[(book * 3 + 1) % cols.length];
      for (let x = 0; x < 64; x++) im.set(x, y, (y % 8 === 7 ? c.map((v) => v * 0.6) : c).map((v) => v * (0.95 + 0.08 * R())));
      if (y % 8 === 3) im.rect(10, y, 54, y + 1, C(240, 220, 120));
    }
    T.books = im;
  }
  // wooden toy blocks (the runner's barriers)
  {
    const im = new Img(32, 32);
    const cols = [C(220, 50, 50), C(250, 200, 40), C(50, 120, 220), C(60, 170, 80)];
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      const b = Math.floor(x / 16) + 2 * Math.floor(y / 16), c = cols[b];
      const edge = x % 16 === 0 || y % 16 === 0 || x % 16 === 15 || y % 16 === 15;
      im.set(x, y, edge ? C(236, 210, 160) : c);
    }
    const glyph = { A: ['010', '101', '111', '101', '101'], B: ['110', '101', '110', '101', '110'], C: ['011', '100', '100', '100', '011'], D: ['110', '101', '101', '101', '110'] };
    ['A', 'B', 'C', 'D'].forEach((ch, i) => { const x0 = (i % 2) * 16 + 5, y0 = Math.floor(i / 2) * 16 + 4; glyph[ch].forEach((row, r) => [...row].forEach((v, c) => { if (v === '1') im.rect(x0 + c * 2, y0 + r * 2, x0 + c * 2 + 2, y0 + r * 2 + 2, P.white); })); });
    T.blocks = im;
  }
  // crocs
  { const im = new Img(32, 32, C(236, 240, 246)); for (let k = 0; k < 40; k++) { const x = Math.floor(R() * 30), y = Math.floor(R() * 30); im.rect(x, y, x + 3, y + 2, C(90, 150, 220)); } T.crocWhite = im; }
  { const im = new Img(32, 32, C(40, 150, 90)); im.noise(0.08, R); for (let y = 4; y < 32; y += 8) for (let x = 4; x < 32; x += 8) im.rect(x, y, x + 2, y + 2, C(20, 100, 60)); T.crocGreen = im; }
  // plain colours
  { const im = new Img(32, 32, P.black); im.noise(0.1, R); T.black = im; }
  { const im = new Img(32, 32, P.white); im.noise(0.02, R); T.paint = im; }
  { const im = new Img(32, 32, C(150, 100, 56)); for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) im.set(x, y, C(150, 100, 56).map((v) => v * (0.9 + 0.1 * Math.sin(y * 0.7) + (R() - 0.5) * 0.08))); T.pine = im; }
  // the start gate's chequered flag
  { const im = new Img(32, 32); for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) im.set(x, y, ((x >> 2) + (y >> 2)) % 2 ? P.black : P.white); T.checker = im; }
  // fire glow on the logs
  { const im = new Img(32, 32, C(250, 140, 30)); for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) im.set(x, y, y < 12 + 4 * Math.sin(x * 0.8) ? C(250, 210, 80) : C(240, 110, 30)); T.flame = im; }
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
