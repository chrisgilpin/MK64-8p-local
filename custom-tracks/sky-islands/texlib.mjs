/**
 * Shared texture helpers: tiny raster, 5x7 font, RGBA16 packing.
 * Everything is painted here in code (no photos), sized to fit N64 TMEM
 * (<= 2048 texels), and packed as binary OTEX resources like mk64.o2r's.
 */

export class Img {
  constructor(w, h, c = [0, 0, 0]) {
    this.w = w;
    this.h = h;
    this.p = new Float32Array(w * h * 3);
    this.fill(c);
  }
  set(x, y, c) {
    x = Math.floor(x); y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 3;
    this.p[i] = c[0]; this.p[i + 1] = c[1]; this.p[i + 2] = c[2];
  }
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
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
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

/** N64 RGBA5551 big-endian + OTEX v0 header, like textures in mk64.o2r. */
export function texResource(img) {
  const body = Buffer.alloc(img.w * img.h * 2);
  for (let i = 0; i < img.w * img.h; i++) {
    const q = (v) => Math.max(0, Math.min(31, Math.round(v * 31)));
    const v = (q(img.p[i * 3]) << 11) | (q(img.p[i * 3 + 1]) << 6) | (q(img.p[i * 3 + 2]) << 1) | 1;
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
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(img.w, 0); ihdr.writeUInt32BE(img.h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((img.w * 3 + 1) * img.h);
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) for (let k = 0; k < 3; k++) {
    // quantise exactly as the game will see it (5 bits per channel)
    raw[y * (img.w * 3 + 1) + 1 + x * 3 + k] = Math.round(Math.max(0, Math.min(31, Math.round(img.p[(y * img.w + x) * 3 + k] * 31))) * 255 / 31);
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
