/**
 * Procedural RGBA16 textures for the South Collegiate track.
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
  garnet: C(122, 22, 40),
  garnetDark: C(86, 14, 28),
  grey: C(140, 142, 146),
  greyLight: C(190, 192, 196),
  brick: C(150, 66, 46),
  brickDark: C(118, 50, 36),
  mortar: C(186, 178, 164),
  stone: C(208, 198, 172),
  cream: C(232, 222, 196),
  white: C(245, 245, 240),
  glass: C(120, 150, 170),
  glassLight: C(170, 200, 215),
  wood: C(150, 100, 58),
  black: C(30, 30, 32),
  yellow: C(232, 190, 40),
  rubber: C(176, 62, 44),
};

// 5x7 bitmap font (only the glyphs the signs need)
const FONT = {
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '+': ['00000', '00100', '00100', '11111', '00100', '00100', '00000'],
  '=': ['00000', '00000', '11111', '00000', '11111', '00000', '00000'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  G: ['01111', '10000', '10000', '10111', '10001', '10001', '01111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  '!': ['00100', '00100', '00100', '00100', '00100', '00000', '00100'],
  '.': ['00000', '00000', '00000', '00000', '00000', '00000', '00100'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};
export function text(img, str, cx, cy, color, scale = 1) {
  const w = str.length * 6 * scale - scale;
  let x0 = Math.round(cx - w / 2);
  const y0 = Math.round(cy - (7 * scale) / 2);
  for (const ch of str) {
    const g = FONT[ch] ?? FONT[' '];
    for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++)
      if (g[r][c] === '1') img.rect(x0 + c * scale, y0 + r * scale, x0 + (c + 1) * scale, y0 + (r + 1) * scale, color);
    x0 += 6 * scale;
  }
}

/* --------------------------------------------------------------- painters */

function brickInto(img, rnd, x0, y0, x1, y1, course = 4, len = 8) {
  for (let y = y0; y < y1; y++) {
    const row = Math.floor((y - y0) / course);
    for (let x = x0; x < x1; x++) {
      const off = row % 2 ? len / 2 : 0;
      const bx = Math.floor((x - x0 + off) / len);
      const mortar = (y - y0) % course === course - 1 || (x - x0 + off) % len === len - 1;
      if (mortar) { img.set(x, y, PAL.mortar); continue; }
      // per-brick tint: London red-brown with the odd darker brick
      const h = Math.sin(bx * 12.9898 + row * 78.233) * 43758.5453;
      const t = h - Math.floor(h);
      const base = t < 0.18 ? PAL.brickDark : PAL.brick;
      const k = 0.9 + 0.2 * t;
      img.set(x, y, base.map((v) => v * k));
    }
  }
  img.noise(0.06, rnd, x0, y0, x1, y1);
}

export function makeTextures() {
  const T = {};
  const R = rng(1928);

  // Running-bond red brick
  T.brick = new Img(64, 32); brickInto(T.brick, R, 0, 0, 64, 32);

  // Facade bay: brick with a tall white-framed sash window and stone sill
  {
    const im = new Img(32, 64); brickInto(im, R, 0, 0, 32, 64);
    im.rect(6, 8, 26, 50, PAL.white);               // frame
    im.rect(8, 10, 24, 48, PAL.glass);              // glass
    for (let y = 10; y < 48; y++) for (let x = 8; x < 24; x++) if ((x + y) % 9 === 0) im.set(x, y, PAL.glassLight);
    im.rect(15, 10, 17, 48, PAL.white);             // mullion
    im.rect(8, 28, 24, 30, PAL.white);              // meeting rail
    im.rect(4, 50, 28, 53, PAL.stone);              // sill
    im.rect(5, 5, 27, 8, PAL.stone);                // lintel
    T.facade = im;
  }

  // Limestone trim
  {
    const im = new Img(32, 32, PAL.stone); im.noise(0.07, R);
    im.rect(0, 15, 32, 16, C(170, 160, 138)); im.rect(15, 0, 16, 15, C(170, 160, 138)); im.rect(31, 16, 32, 32, C(170, 160, 138));
    T.stone = im;
  }

  // Garnet lockers (wall above is cream, base is grey) — one tile = 2 lockers
  {
    const im = new Img(32, 64, PAL.cream); im.noise(0.03, R, 0, 0, 32, 14);
    im.rect(0, 12, 32, 14, PAL.garnetDark);
    for (let k = 0; k < 2; k++) {
      const x0 = k * 16;
      im.rect(x0, 14, x0 + 16, 58, PAL.garnet);
      im.rect(x0, 14, x0 + 1, 58, PAL.garnetDark);
      for (let v = 0; v < 4; v++) im.rect(x0 + 4, 17 + v * 2, x0 + 12, 18 + v * 2, PAL.garnetDark); // vents
      im.rect(x0 + 11, 34, x0 + 13, 40, PAL.greyLight);   // handle
      im.rect(x0 + 3, 26, x0 + 6, 28, PAL.white);         // number plate
    }
    im.noise(0.04, R, 0, 14, 32, 58);
    im.rect(0, 58, 32, 64, PAL.grey);
    T.lockers = im;
  }

  // Painted concrete block with a garnet/grey stripe at rail height
  {
    const im = new Img(32, 64, PAL.cream);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 32; x++) {
      const row = Math.floor(y / 8); const off = row % 2 ? 8 : 0;
      if (y % 8 === 7 || (x + off) % 16 === 15) im.set(x, y, C(205, 196, 172));
    }
    im.noise(0.03, R);
    im.rect(0, 34, 32, 39, PAL.garnet); im.rect(0, 39, 32, 41, PAL.grey);
    im.rect(0, 60, 32, 64, PAL.grey);
    T.block = im;
  }

  // Classroom wall: cream wall with a wood door + narrow window, frame grey
  {
    const im = new Img(32, 64, PAL.cream); im.noise(0.03, R);
    im.rect(8, 16, 26, 60, PAL.grey);
    im.rect(10, 18, 24, 60, PAL.wood); im.noise(0.06, R, 10, 18, 24, 60);
    im.rect(13, 22, 17, 36, PAL.glass);
    im.rect(21, 38, 23, 41, PAL.greyLight);
    im.rect(1, 22, 6, 30, C(196, 160, 110));          // cork board
    im.rect(2, 23, 4, 25, PAL.white); im.rect(3, 26, 5, 28, PAL.yellow);
    im.rect(0, 60, 32, 64, PAL.grey);
    T.classroom = im;
  }

  // Courtyard-side wall: low block wall with a big window strip above
  {
    const im = new Img(32, 64, PAL.cream); im.noise(0.03, R);
    im.rect(0, 10, 32, 40, PAL.greyLight);
    im.rect(1, 11, 31, 39, C(150, 185, 150));            // courtyard greenery through glass
    for (let y = 11; y < 25; y++) im.rect(1, y, 31, y + 1, C(150 + y, 190, 215).map((v) => v));
    im.rect(15, 11, 17, 39, PAL.greyLight);
    im.rect(0, 40, 32, 42, PAL.stone);
    im.rect(0, 60, 32, 64, PAL.grey);
    T.windows = im;
  }

  // Acoustic ceiling tiles with a fluorescent panel
  {
    const im = new Img(32, 32, C(236, 236, 230)); im.speckle(60, [C(205, 205, 200)], R);
    im.rect(0, 0, 32, 1, C(180, 180, 176)); im.rect(0, 16, 32, 17, C(180, 180, 176));
    im.rect(0, 0, 1, 32, C(180, 180, 176)); im.rect(16, 0, 17, 32, C(180, 180, 176));
    im.rect(3, 3, 14, 14, C(255, 255, 250)); im.rect(4, 8, 13, 9, C(225, 230, 235));
    T.ceiling = im;
  }

  // Terrazzo (ground floor)
  {
    const im = new Img(32, 32, C(214, 204, 182));
    im.speckle(200, [C(160, 150, 130), C(245, 240, 230), C(110, 110, 110), C(160, 150, 130)], R);
    im.speckle(14, [PAL.garnet], R);
    T.terrazzo = im;
  }

  // Vinyl composite tile (basement + upper): cream with grey and garnet accents
  {
    const im = new Img(32, 32, PAL.cream);
    const pattern = ['ABAA', 'AAAG', 'AABA', 'GAAA'];
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
      const k = pattern[r][c];
      const col = k === 'G' ? PAL.garnet : k === 'B' ? C(176, 176, 170) : PAL.cream;
      im.rect(c * 8, r * 8, c * 8 + 8, r * 8 + 8, col);
    }
    im.noise(0.04, R);
    for (let i = 0; i < 32; i += 8) { im.rect(i, 0, i + 1, 32, C(200, 192, 170)); im.rect(0, i, 32, i + 1, C(200, 192, 170)); }
    T.vct = im;
  }

  // Stairwell ramp: concrete with yellow safety nosing (stripes run across the ramp)
  {
    const im = new Img(32, 32, C(160, 160, 156)); im.noise(0.08, R);
    im.rect(0, 0, 32, 3, PAL.yellow); im.rect(0, 16, 32, 19, PAL.yellow);
    im.rect(0, 3, 32, 4, C(110, 110, 108)); im.rect(0, 19, 32, 20, C(110, 110, 108));
    T.stairs = im;
  }

  // Concrete (garage, trench, coping)
  { const im = new Img(32, 32, C(168, 166, 160)); im.noise(0.07, R); im.speckle(20, [C(140, 138, 132)], R); T.concrete = im; }

  // Garage aisle: concrete with a dashed yellow centre line (s runs across)
  {
    const im = new Img(64, 32, C(158, 156, 150)); im.noise(0.07, R);
    im.rect(31, 0, 33, 18, PAL.yellow);
    im.rect(4, 0, 6, 32, PAL.white); im.rect(58, 0, 60, 32, PAL.white);
    T.garageFloor = im;
  }

  // Garage parapet: concrete with a garnet band
  { const im = new Img(32, 32, C(172, 170, 164)); im.noise(0.06, R); im.rect(0, 12, 32, 18, PAL.garnet); T.parapet = im; }

  // Asphalt (parking lot / paths)
  { const im = new Img(32, 32, C(78, 78, 82)); im.noise(0.12, R); im.speckle(40, [C(110, 110, 112)], R); T.asphalt = im; }

  // Running track: red rubber, white lane lines (4 lanes across 64 px)
  {
    const im = new Img(64, 32, PAL.rubber); im.noise(0.07, R);
    for (const x of [0, 16, 32, 48]) im.rect(x, 0, x + 1, 32, PAL.white);
    im.rect(63, 0, 64, 32, PAL.white);
    T.track = im;
  }
  // Running track finish: lanes + a broad white line with a checker band
  {
    const im = new Img(64, 32, PAL.rubber); im.noise(0.07, R);
    for (const x of [0, 16, 32, 48]) im.rect(x, 0, x + 1, 32, PAL.white);
    im.rect(63, 0, 64, 32, PAL.white);
    im.rect(0, 13, 64, 19, PAL.white);
    for (let x = 0; x < 64; x += 4) for (let y = 7; y < 13; y += 3) if (((x / 4) + (y - 7) / 3) % 2 === 0) im.rect(x, y, x + 4, y + 3, PAL.black);
    T.trackFinish = im;
  }

  // Football field turf with mowing stripes and a white yard line
  { const im = new Img(32, 32); for (let y = 0; y < 32; y++) im.rect(0, y, 32, y + 1, y < 16 ? C(64, 150, 60) : C(54, 132, 52)); im.noise(0.08, R); im.rect(0, 0, 32, 1, PAL.white); T.turf = im; }

  // Flat roof gravel
  { const im = new Img(32, 32, C(128, 124, 118)); im.speckle(260, [C(160, 156, 150), C(96, 94, 90)], R); T.roof = im; }

  // Skywalk glazing
  {
    const im = new Img(32, 64, PAL.glass);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 32; x++) if ((x * 2 + y) % 13 === 0) im.set(x, y, PAL.glassLight);
    im.rect(0, 0, 32, 3, PAL.greyLight); im.rect(0, 61, 32, 64, PAL.grey); im.rect(0, 0, 2, 64, PAL.greyLight); im.rect(0, 30, 32, 32, PAL.greyLight);
    T.glass = im;
  }

  // Aluminium bleacher planks
  { const im = new Img(32, 32, C(180, 184, 188)); for (let y = 0; y < 32; y += 8) im.rect(0, y, 32, y + 1, C(120, 124, 128)); im.noise(0.04, R); T.bleacher = im; }

  // Main entrance double doors
  {
    const im = new Img(32, 64); brickInto(im, R, 0, 0, 32, 64);
    im.rect(2, 14, 30, 64, PAL.stone);
    im.rect(5, 20, 27, 64, PAL.garnetDark);
    im.rect(6, 22, 15, 64, PAL.garnet); im.rect(17, 22, 26, 64, PAL.garnet);
    im.rect(8, 26, 13, 40, PAL.glass); im.rect(19, 26, 24, 40, PAL.glass);
    im.rect(13, 44, 15, 46, PAL.greyLight); im.rect(17, 44, 19, 46, PAL.greyLight);
    im.rect(5, 15, 27, 19, PAL.glassLight);  // transom
    T.doors = im;
  }

  // Signs (garnet & grey school colours)
  const sign = (str, w = 64, h = 32, bg = PAL.garnet, fg = PAL.white, scale = 1) => {
    const im = new Img(w, h, bg); im.noise(0.03, R);
    im.rect(0, 0, w, 2, PAL.grey); im.rect(0, h - 2, w, h, PAL.grey);
    text(im, str, w / 2, h / 2, fg, scale);
    return im;
  };
  T.signSouth = sign('SOUTH', 64, 32, PAL.garnet, PAL.white, 2);
  T.signCollegiate = sign('COLLEGIATE');
  T.signInstitute = sign('INSTITUTE');
  T.signGo = sign('GO SOUTH!', 64, 32, PAL.garnet, PAL.white, 1);
  T.signLondon = sign('LONDON', 64, 32, PAL.stone, PAL.garnet, 1);
  {
    const im = new Img(32, 32, C(30, 80, 160)); text(im, 'P', 16, 16, PAL.white, 3); im.rect(0, 0, 32, 2, PAL.white); im.rect(0, 30, 32, 32, PAL.white);
    T.signP = im;
  }

  // Parked cars: body colour with a dark window band (side view)
  const car = (body) => {
    const im = new Img(32, 32, body); im.noise(0.04, R);
    im.rect(6, 4, 26, 13, C(40, 50, 60)); im.rect(15, 4, 17, 13, body);
    im.rect(3, 22, 9, 28, PAL.black); im.rect(23, 22, 29, 28, PAL.black);
    im.rect(0, 28, 32, 32, C(60, 60, 60));
    return im;
  };
  T.carRed = car(C(170, 30, 30)); T.carBlue = car(C(40, 70, 150)); T.carWhite = car(C(225, 225, 220)); T.carGrey = car(C(120, 124, 128));


  // Chalkboard: dark green slate, wood frame, chalk sums
  {
    const im = new Img(64, 32, C(40, 70, 52)); im.noise(0.05, R);
    im.rect(0, 0, 64, 2, PAL.wood); im.rect(0, 30, 64, 32, PAL.wood); im.rect(0, 0, 2, 32, PAL.wood); im.rect(62, 0, 64, 32, PAL.wood);
    const chalk = C(225, 230, 220);
    text(im, 'MATH', 20, 8, chalk);
    text(im, '2+2=', 22, 19, chalk);
    for (let x = 40; x < 58; x++) im.set(x, 8 + Math.round(3 * Math.sin(x / 2)), chalk);
    for (let x = 40; x < 58; x += 2) im.set(x, 20, chalk);
    im.rect(6, 27, 14, 29, C(240, 240, 240)); // eraser smudge / chalk tray
    T.chalkboard = im;
  }
  // Student desk (laminate top, grey steel sides)
  { const im = new Img(32, 32, C(120, 124, 130)); im.rect(0, 0, 32, 8, C(196, 160, 112)); im.noise(0.05, R); im.rect(2, 12, 30, 14, C(90, 94, 100)); T.desk = im; }
  // Chain-link fence with a garnet top rail and posts: the mesh is see-through
  // (1-bit alpha, drawn as a cut-out), only the wire, rails and post are solid
  {
    const im = new Img(32, 32, C(150, 152, 156));
    im.clearAlpha();
    // open diamond weave: one-texel wires every 8 texels (tiles seamlessly),
    // so roughly three quarters of the fence is see-through
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) if ((x + y) % 8 === 0 || (x - y + 64) % 8 === 0) im.set(x, y, C(196, 198, 204));
    im.rect(0, 0, 32, 2, PAL.garnet); im.rect(0, 0, 2, 32, C(120, 122, 126)); im.rect(0, 30, 32, 32, C(110, 112, 116));
    T.fence = im;
  }
  // Kicker ramp chevrons
  { const im = new Img(32, 32, C(20, 20, 20)); for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) if ((y + Math.abs(x - 15.5)) % 16 < 8) im.set(x, y, C(250, 200, 30)); T.kicker = im; }
  // Signs at the fork by the track
  {
    const im = new Img(64, 32, C(250, 200, 30)); im.rect(0, 0, 64, 2, PAL.black); im.rect(0, 30, 64, 32, PAL.black);
    text(im, 'TRACK', 32, 10, PAL.black); text(im, 'CLOSED', 32, 21, PAL.black);
    T.signClosed = im;
  }
  {
    const im = new Img(64, 32, PAL.garnet); im.rect(0, 0, 64, 2, PAL.grey); im.rect(0, 30, 64, 32, PAL.grey);
    text(im, 'SCHOOL', 26, 16, PAL.white);
    // arrow pointing up (= straight ahead)
    im.rect(54, 11, 58, 26, PAL.white); for (let k = 0; k < 6; k++) im.rect(51 + k, 11 - k, 61 - k, 12 - k, PAL.white);
    T.signSchool = im;
  }
  return T;
}

/** N64 RGBA5551 big-endian + OTEX v0 header, like textures in mk64.o2r. */
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
