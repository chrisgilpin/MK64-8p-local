/**
 * Procedural RGBA16 textures for the Downtown Toronto track.
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

Object.assign(FONT, {
  J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  0: ['01110', '10011', '10101', '10101', '10101', '11001', '01110'],
  1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  2: ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  3: ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  5: ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  6: ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  9: ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
});

const P = {
  asphalt: C(70, 72, 76),
  white: C(238, 238, 234),
  yellow: C(236, 196, 40),
  concrete: C(178, 176, 170),
  concreteDark: C(128, 126, 120),
  sidewalk: C(190, 186, 178),
  red: C(214, 34, 40), // TTC / maple-leaf red
  jays: C(19, 74, 142), // Blue Jays blue
  jaysLight: C(70, 130, 200),
  green: C(30, 120, 70),
  goGreen: C(40, 120, 60),
  gold: C(214, 170, 60),
  black: C(26, 26, 30),
  glass: C(80, 120, 160),
  glassDark: C(40, 60, 84),
  copper: C(100, 160, 136),
  brick: C(150, 70, 50),
  mortar: C(196, 188, 174),
  stone: C(206, 196, 172),
  turf: C(52, 140, 60),
  dirt: C(170, 112, 70),
  water: C(50, 100, 140),
  waterLight: C(100, 150, 190),
  wood: C(160, 112, 70),
  pink: C(240, 110, 170),
  sand: C(226, 206, 160),
};

/** windows grid on a facade colour */
function windows(im, base, glass, cols, rows, mx = 1, my = 1, rnd = null) {
  im.fill(base);
  const cw = im.w / cols, ch = im.h / rows;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const lit = rnd && rnd() < 0.18;
    im.rect(Math.round(c * cw + mx), Math.round(r * ch + my), Math.round((c + 1) * cw - mx), Math.round((r + 1) * ch - my), lit ? C(250, 230, 160) : glass);
  }
}

export function makeTextures() {
  const T = {};
  const R = rng(416);

  // streets: asphalt, white edge lines, dashed white lane lines
  { const im = new Img(64, 32, P.asphalt); im.noise(0.1, R); im.rect(3, 0, 5, 32, P.white); im.rect(59, 0, 61, 32, P.white); im.rect(21, 0, 22, 14, P.white); im.rect(42, 0, 43, 14, P.white); T.road = im; }
  { const im = new Img(64, 32, P.asphalt); im.noise(0.08, R); im.rect(3, 0, 5, 32, P.white); im.rect(59, 0, 61, 32, P.white); for (let x = 5; x < 59; x += 4) for (let y = 8; y < 24; y += 4) im.rect(x, y, x + 4, y + 4, ((x - 5) / 4 + y / 4) % 2 ? P.black : P.white); T.finish = im; }
  // street-circuit concrete barrier, Toronto-blue band and red pinstripe
  { const im = new Img(32, 32, P.white); im.noise(0.03, R); im.rect(0, 10, 32, 20, P.jays); im.rect(0, 21, 32, 23, P.red); im.rect(0, 30, 32, 32, P.concreteDark); im.rect(31, 0, 32, 32, P.concreteDark); T.barrier = im; }
  // sidewalks / plazas
  { const im = new Img(32, 32, P.sidewalk); im.noise(0.05, R); im.rect(0, 0, 32, 1, P.concreteDark); im.rect(0, 0, 1, 32, P.concreteDark); im.rect(0, 16, 32, 17, C(160, 156, 148)); im.rect(16, 0, 17, 32, C(160, 156, 148)); T.sidewalk = im; }
  // the lake
  { const im = new Img(32, 32, P.water); for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) { const w = Math.sin((x + 2 * Math.sin(y * 0.6)) * 0.7) + Math.sin(y * 0.45 + x * 0.25); if (w > 1.4) im.set(x, y, P.waterLight); else if (w < -1.3) im.set(x, y, P.water.map((v) => v * 0.85)); } T.water = im; }
  // the WaveDeck: warm boardwalk planks
  { const im = new Img(32, 32, P.wood); for (let y = 0; y < 32; y++) { const k = [1, 0.9, 1.06, 0.95][Math.floor(y / 8)]; for (let x = 0; x < 32; x++) im.set(x, y, P.wood.map((v) => v * k * (0.95 + 0.08 * R()))); if (y % 8 === 7) im.rect(0, y, 32, y + 1, C(96, 64, 40)); } T.deck = im; }
  // promenade granite with a maple-leaf red stripe
  { const im = new Img(32, 32, C(150, 146, 140)); im.noise(0.12, R); im.rect(0, 14, 32, 18, C(170, 60, 60)); T.promenade = im; }
  // black metal railing (see-through)
  { const im = new Img(32, 32, P.black); im.clearAlpha(); im.rect(0, 0, 32, 3, P.black); im.rect(0, 28, 32, 30, P.black); for (let x = 0; x < 32; x += 4) im.rect(x, 0, x + 1, 30, P.black); T.railing = im; }
  // CN Tower: board-formed concrete with vertical flutes
  { const im = new Img(32, 32, C(196, 192, 184)); for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) im.set(x, y, C(196, 192, 184).map((v) => v * ((x % 8 === 0) ? 0.82 : 0.95 + 0.06 * R()))); T.cnConcrete = im; }
  // main pod: white bands round a dark ring of windows
  { const im = new Img(64, 32, C(226, 226, 222)); im.rect(0, 9, 64, 23, P.glassDark); for (let x = 0; x < 64; x += 4) im.rect(x, 9, x + 1, 23, C(150, 150, 150)); im.rect(0, 15, 64, 16, C(120, 120, 120)); im.rect(0, 26, 64, 28, C(160, 160, 160)); T.pod = im; }
  // Rogers Centre: white ribbed dome shell panels
  { const im = new Img(32, 32, C(232, 232, 228)); for (let x = 0; x < 32; x += 8) im.rect(x, 0, x + 1, 32, C(170, 172, 176)); for (let y = 0; y < 32; y += 16) im.rect(0, y, 32, y + 1, C(190, 192, 196)); T.dome = im; }
  // stadium outer wall: concrete with arched openings and a blue band
  { const im = new Img(64, 32, P.concrete); im.noise(0.04, R); for (let x = 4; x < 64; x += 16) for (let y = 12; y < 30; y++) for (let dx = 0; dx < 9; dx++) { const cx = dx - 4; if (y > 16 || cx * cx + (y - 16) ** 2 < 20) im.set(x + dx, y, C(60, 64, 70)); } im.rect(0, 3, 64, 7, P.jays); T.stadium = im; }
  // blue seats in rows
  { const im = new Img(32, 32, P.jays); for (let y = 0; y < 32; y++) { if (y % 4 === 3) im.rect(0, y, 32, y + 1, C(40, 40, 50)); } for (let x = 0; x < 32; x += 3) im.rect(x, 0, x + 1, 32, P.jays.map((v) => v * 0.8)); T.seats = im; }
  // turf with mowing stripes
  { const im = new Img(32, 32); for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) im.set(x, y, (Math.floor(x / 8) % 2 ? P.turf : P.turf.map((v) => v * 0.85)).map((v) => v * (0.96 + 0.06 * R()))); T.turf = im; }
  // warning track / infield dirt
  { const im = new Img(32, 32, P.dirt); im.noise(0.12, R); im.speckle(30, [C(140, 92, 58), C(196, 140, 96)], R); T.dirt = im; }
  // padded outfield wall with distance markers
  { const im = new Img(64, 32, P.jays); im.rect(0, 0, 64, 3, C(240, 200, 40)); im.rect(0, 0, 64, 1, P.white); text(im, '400', 32, 17, P.white, 2); T.padding = im; }
  { const im = new Img(64, 32, P.jays); im.rect(0, 0, 64, 3, C(240, 200, 40)); text(im, '375', 32, 17, P.white, 2); T.padding375 = im; }
  { const im = new Img(64, 32, P.jays); im.rect(0, 0, 64, 3, C(240, 200, 40)); text(im, '328', 32, 17, P.white, 2); T.padding328 = im; }
  // Union Station: Beaux-Arts limestone with the long Doric colonnade
  {
    const im = new Img(64, 32, P.stone); im.noise(0.04, R);
    im.rect(0, 0, 64, 6, C(190, 180, 156)); // entablature
    for (let x = 2; x < 64; x += 8) { im.rect(x, 7, x + 4, 30, C(226, 218, 196)); im.rect(x + 4, 7, x + 5, 30, C(160, 150, 130)); } // columns
    for (let x = 6; x < 64; x += 8) im.rect(x, 9, x + 2, 28, C(70, 64, 56)); // shadow between
    im.rect(0, 30, 64, 32, C(160, 150, 130));
    T.union = im;
  }
  { const im = new Img(32, 32, P.stone); im.noise(0.05, R); for (let y = 0; y < 32; y += 8) im.rect(0, y, 32, y + 1, C(170, 160, 136)); T.limestone = im; }
  // Royal York: brick and stone with rows of hotel windows
  { const im = new Img(32, 32); windows(im, C(176, 150, 120), P.glassDark, 4, 4, 2, 2, R); T.royalYork = im; }
  { const im = new Img(32, 32, P.copper); for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) im.set(x, y, P.copper.map((v) => v * ((x % 6 === 0) ? 0.8 : 0.95 + 0.1 * R()))); T.copperRoof = im; }
  // towers
  { const im = new Img(32, 32, P.gold); for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) im.set(x, y, P.gold.map((v) => v * (0.85 + 0.25 * ((x + y) % 16) / 16))); for (let y = 0; y < 32; y += 4) im.rect(0, y, 32, y + 1, C(150, 110, 40)); for (let x = 0; x < 32; x += 8) im.rect(x, 0, x + 1, 32, C(150, 110, 40)); T.goldGlass = im; }
  { const im = new Img(32, 32); windows(im, C(20, 20, 24), C(54, 50, 44), 4, 8, 1, 1); T.blackTower = im; }
  { const im = new Img(32, 32); windows(im, C(232, 232, 228), C(110, 130, 150), 4, 8, 1, 1); T.whiteTower = im; }
  { const im = new Img(32, 32); windows(im, C(60, 90, 120), P.glass, 2, 8, 0, 1, R); T.glassBlue = im; }
  { const im = new Img(32, 32); windows(im, C(70, 110, 110), C(110, 160, 160), 2, 8, 0, 1, R); T.glassGreen = im; }
  { const im = new Img(32, 32); windows(im, C(210, 210, 206), C(90, 120, 150), 4, 8, 1, 1, R); for (let y = 3; y < 32; y += 4) im.rect(0, y, 32, y + 1, C(240, 240, 240)); T.condo = im; }
  { const im = new Img(32, 32); windows(im, C(160, 150, 140), C(70, 80, 96), 4, 6, 1, 1, R); T.office = im; }
  // red brick (Roundhouse, Power Plant)
  { const im = new Img(32, 32); for (let y = 0; y < 32; y++) { const row = Math.floor(y / 4); for (let x = 0; x < 32; x++) { const off = row % 2 ? 4 : 0; im.set(x, y, (y % 4 === 3 || (x + off) % 8 === 7) ? P.mortar : P.brick.map((v) => v * (0.88 + 0.2 * R()))); } } T.brick = im; }
  // roundhouse stall doors
  { const im = new Img(32, 32, P.brick); im.noise(0.08, R); for (let y = 8; y < 32; y++) for (let x = 6; x < 26; x++) { const cx = x - 15.5; if (y > 14 || cx * cx + (y - 14) ** 2 < 100) im.set(x, y, (x % 4 === 0) ? C(40, 60, 50) : C(60, 90, 70)); } T.roundhouse = im; }
  // Scotiabank Arena glass
  { const im = new Img(32, 32); windows(im, C(40, 50, 60), C(90, 140, 190), 4, 4, 1, 1); T.arena = im; }
  // Gardiner Expressway concrete
  { const im = new Img(32, 32, C(150, 148, 140)); im.noise(0.1, R); for (let k = 0; k < 6; k++) { const x = Math.floor(R() * 32); im.rect(x, 10, x + 1, 32, C(110, 106, 98)); } T.gardiner = im; }
  // rail ballast and tracks
  { const im = new Img(32, 32, C(110, 104, 96)); im.speckle(200, [C(80, 76, 70), C(140, 134, 126)], R); for (let y = 0; y < 32; y += 6) im.rect(0, y, 32, y + 2, C(90, 66, 44)); for (const x of [6, 12, 20, 26]) im.rect(x, 0, x + 1, 32, C(70, 70, 76)); T.ballast = im; }
  // GO train: green and white double-deckers
  { const im = new Img(64, 32, P.white); im.rect(0, 22, 64, 30, P.goGreen); for (let x = 2; x < 64; x += 8) { im.rect(x, 5, x + 6, 10, P.glassDark); im.rect(x, 13, x + 6, 18, P.glassDark); } im.rect(0, 30, 64, 32, P.black); T.goTrain = im; }
  // TTC streetcar
  { const im = new Img(64, 32, P.red); im.rect(0, 14, 64, 16, P.white); for (let x = 3; x < 64; x += 10) im.rect(x, 4, x + 8, 13, P.glassDark); im.rect(0, 28, 64, 32, P.black); text(im, 'TTC', 50, 22, P.white); T.streetcar = im; }
  // white 1920s warehouse (Queens Quay Terminal)
  { const im = new Img(32, 32); windows(im, C(236, 232, 222), C(90, 110, 130), 4, 4, 2, 2); T.terminal = im; }
  // clock face
  { const im = new Img(32, 32, C(236, 232, 222)); for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) { const d = Math.hypot(x - 15.5, y - 15.5); if (d < 13 && d > 11.5) im.set(x, y, P.black); } for (let k = 0; k < 9; k++) im.set(15, 15 - k, P.black); for (let k = 0; k < 6; k++) im.set(16 + k, 16, P.black); T.clock = im; }
  // aquarium: teal glass with a wave band
  { const im = new Img(32, 32, C(40, 130, 160)); for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) if (y > 18 + 3 * Math.sin(x * 0.4)) im.set(x, y, C(20, 70, 110)); im.noise(0.05, R); T.aquarium = im; }
  // pink umbrella canopy and sand (Sugar Beach)
  { const im = new Img(32, 32, P.pink); for (let k = 0; k < 8; k++) { const a = (k / 8) * 2 * Math.PI; for (let r = 0; r < 16; r++) im.set(15.5 + r * Math.cos(a), 15.5 + r * Math.sin(a), C(250, 170, 210)); } T.pink = im; }
  { const im = new Img(32, 32, P.sand); im.noise(0.06, R); T.sand = im; }
  // City Hall: ribbed white concrete with dark glass
  { const im = new Img(32, 32, C(224, 222, 216)); for (let x = 0; x < 32; x += 4) im.rect(x + 1, 0, x + 3, 32, C(70, 90, 110)); T.cityHall = im; }
  // Canadian flag
  {
    const im = new Img(64, 32, P.white); im.rect(0, 0, 16, 32, P.red); im.rect(48, 0, 64, 32, P.red);
    const leaf = ['0000010000', '0001111000', '1001111001', '1111111111', '0111111110', '0011111100', '0111111110', '0000110000', '0000110000'];
    leaf.forEach((row, r) => [...row].forEach((v, c) => { if (v === '1') im.rect(22 + c * 2, 7 + r * 2, 24 + c * 2, 9 + r * 2, P.red); }));
    T.flag = im;
  }
  // the TORONTO sign: big multicolour letters
  {
    const im = new Img(64, 32, C(20, 20, 24));
    const cols = [C(240, 240, 240), C(60, 140, 220), C(240, 240, 240), C(220, 40, 50), C(240, 240, 240), C(60, 140, 220), C(240, 240, 240)];
    const word = 'TORONTO';
    [...word].forEach((ch, i) => text(im, ch, 5 + i * 9, 16, cols[i], 1));
    T.torontoSign = im;
  }
  // signs
  const sign = (str, bg, fg, rim, scale = 1, w = 64, h = 32) => {
    const im = new Img(w, h, bg);
    im.rect(0, 0, w, 2, rim); im.rect(0, h - 2, w, h, rim); im.rect(0, 0, 2, h, rim); im.rect(w - 2, 0, w, h, rim);
    const lines = str.split('|');
    lines.forEach((ln, i) => text(im, ln, w / 2, h / 2 + (i - (lines.length - 1) / 2) * 9 * scale, fg, scale));
    return im;
  };
  T.signUnion = sign('UNION|STATION', C(206, 196, 172), C(60, 54, 44), C(170, 160, 136));
  T.signRoyalYork = sign('ROYAL YORK', C(30, 40, 60), C(230, 200, 120), C(230, 200, 120));
  T.signRogers = sign('ROGERS|CENTRE', P.jays, P.white, P.white);
  T.signJays = sign('BLUE JAYS', P.white, P.jays, P.jays);
  T.signArena = sign('SCOTIABANK|ARENA', C(220, 30, 40), P.white, P.white);
  T.signHarbour = sign('HARBOUR|FRONT', C(20, 60, 110), P.white, P.white);
  T.signAquarium = sign('AQUARIUM', C(20, 90, 130), P.white, P.white);
  T.signCN = sign('CN TOWER', C(200, 30, 40), P.white, P.white);
  T.signFront = sign('FRONT|ST W', P.white, P.black, C(30, 80, 160));
  T.signJohn = sign('JOHN ST', P.white, P.black, C(30, 80, 160));
  T.signQQ = sign('QUEENS|QUAY W', P.white, P.black, C(30, 80, 160));
  T.signBay = sign('BAY ST', P.white, P.black, C(30, 80, 160));
  T.signGardiner = sign('GARDINER|EXPY EAST', P.green, P.white, P.white);
  T.signGo = sign('GO TRANSIT', P.goGreen, P.white, P.white);
  T.signPowerPlant = sign('POWER|PLANT', P.white, P.black, P.black);
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
