/** Procedural RGBA16 textures for Sky Islands (painted in code, packed into the mod). */
import { Img, rng, text } from './texlib.mjs';
export { texResource, toPNG } from './texlib.mjs';

const C = (r, g, b) => [r / 255, g / 255, b / 255];

export function makeTextures() {
  const T = {};
  const R = rng(4242);

  // Island grass with little flowers
  { const im = new Img(32, 32, C(86, 170, 64)); im.noise(0.12, R); im.speckle(40, [C(70, 140, 52), C(110, 190, 80)], R); im.speckle(6, [C(250, 230, 90), C(250, 250, 250)], R); T.grass = im; }

  // Cliff: grass fringe on top, layered sandstone/rock strata below
  {
    const im = new Img(32, 64);
    const strata = [C(150, 112, 78), C(132, 96, 66), C(164, 128, 92), C(118, 88, 62), C(146, 108, 74)];
    for (let y = 0; y < 64; y++) {
      const band = strata[Math.floor((y + Math.sin(y * 0.7) * 2) / 9) % strata.length];
      for (let x = 0; x < 32; x++) im.set(x, y, band);
    }
    im.noise(0.1, R);
    for (let x = 0; x < 32; x++) { const d = 3 + Math.round(2 * Math.sin(x * 1.3)); im.rect(x, 0, x + 1, d, C(86, 170, 64)); }
    for (let k = 0; k < 6; k++) { const x = Math.floor(R() * 32), y = 10 + Math.floor(R() * 50); im.rect(x, y, x + 1, y + 6, C(96, 70, 48)); }
    T.cliff = im;
  }
  // Rock underside (dark, mossy)
  { const im = new Img(32, 32, C(104, 82, 64)); im.noise(0.16, R); im.speckle(30, [C(80, 62, 48), C(90, 110, 70)], R); T.under = im; }

  // Sky road: asphalt, white edge lines, yellow dashes (s runs across)
  {
    const im = new Img(64, 32, C(84, 84, 90)); im.noise(0.1, R);
    im.rect(2, 0, 4, 32, C(240, 240, 240)); im.rect(60, 0, 62, 32, C(240, 240, 240));
    im.rect(31, 0, 33, 16, C(240, 200, 40));
    T.road = im;
  }
  // Dirt shortcut path
  { const im = new Img(32, 32, C(156, 116, 74)); im.noise(0.14, R); im.speckle(26, [C(120, 90, 60), C(186, 156, 116)], R); T.dirt = im; }
  // Wooden planks (boards run across the deck)
  {
    const im = new Img(32, 32, C(164, 118, 70));
    for (let y = 0; y < 32; y++) {
      const board = Math.floor(y / 8);
      const k = [1, 0.92, 1.05, 0.96][board];
      for (let x = 0; x < 32; x++) im.set(x, y, C(164 * k, 118 * k, 70 * k));
      if (y % 8 === 7) im.rect(0, y, 32, y + 1, C(90, 60, 36));
    }
    im.noise(0.07, R);
    for (let b = 0; b < 4; b++) { im.rect(3, b * 8 + 3, 5, b * 8 + 5, C(70, 60, 50)); im.rect(27, b * 8 + 3, 29, b * 8 + 5, C(70, 60, 50)); }
    T.planks = im;
  }
  // Rope-and-post railing
  {
    const im = new Img(32, 32, [0, 0, 0]);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) im.set(x, y, C(150, 205, 245)); // sky behind (opaque)
    im.rect(0, 4, 32, 7, C(200, 170, 110)); im.rect(0, 16, 32, 19, C(200, 170, 110));
    im.rect(13, 0, 19, 32, C(120, 80, 46)); im.noise(0.05, R);
    T.rail = im;
  }
  // Kicker ramp: yellow/black chevrons pointing forward (t runs along travel)
  {
    const im = new Img(32, 32, C(20, 20, 20));
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      const v = (y + Math.abs(x - 15.5)) % 16;
      if (v < 8) im.set(x, y, C(250, 200, 30));
    }
    T.kicker = im;
  }
  // Boost ramp: red/orange chevrons
  {
    const im = new Img(32, 32, C(230, 60, 40));
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) if ((y + Math.abs(x - 15.5)) % 16 < 8) im.set(x, y, C(255, 190, 40));
    T.boost = im;
  }
  // Dash pad: asphalt with white edges and bright chevrons (boost surface)
  {
    const im = new Img(64, 32, C(84, 84, 90)); im.noise(0.06, R);
    im.rect(2, 0, 4, 32, C(240, 240, 240)); im.rect(60, 0, 62, 32, C(240, 240, 240));
    for (let y = 0; y < 32; y++) for (let x = 8; x < 56; x++) {
      const v = (y + Math.abs(x - 31.5) * 0.6) % 16;
      if (v < 6) im.set(x, y, C(255, 210, 40)); else if (v < 8) im.set(x, y, C(240, 90, 30));
    }
    T.pad = im;
  }
  // Cloud sea far below
  {
    const im = new Img(64, 32, C(205, 225, 245));
    const blobs = [];
    for (let k = 0; k < 14; k++) blobs.push([R() * 64, R() * 32, 4 + R() * 7]);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) {
      let v = 0;
      for (const [bx, by, r] of blobs) for (const ox of [-64, 0, 64]) for (const oy of [-32, 0, 32]) {
        const d = Math.hypot(x - bx - ox, y - by - oy);
        v = Math.max(v, 1 - d / r);
      }
      const w = Math.min(1, v * 1.6);
      im.set(x, y, [0.80 + 0.2 * w, 0.88 + 0.12 * w, 0.96 + 0.04 * w]);
    }
    T.clouds = im;
  }
  // Signs
  const sign = (str, bg, fg, scale = 1) => {
    const im = new Img(64, 32, bg);
    im.rect(0, 0, 64, 2, C(30, 30, 30)); im.rect(0, 30, 64, 32, C(30, 30, 30)); im.rect(0, 0, 2, 32, C(30, 30, 30)); im.rect(62, 0, 64, 32, C(30, 30, 30));
    text(im, str, 32, 16, fg, scale);
    return im;
  };
  T.signDanger = sign('DANGER!', C(250, 200, 30), C(20, 20, 20));
  T.signShortcut = sign('SHORTCUT', C(40, 120, 220), C(255, 255, 255));
  T.signJump = sign('JUMP!', C(230, 60, 40), C(255, 255, 255), 2);
  T.signFinish = sign('FINISH', C(255, 255, 255), C(20, 20, 20));
  T.signBoost = sign('BOOST!', C(240, 90, 30), C(255, 255, 255));
  // Start/finish road strip: road with a checker band across
  {
    const im = new Img(64, 32, C(84, 84, 90)); im.noise(0.08, R);
    im.rect(2, 0, 4, 32, C(240, 240, 240)); im.rect(60, 0, 62, 32, C(240, 240, 240));
    for (let x = 4; x < 60; x += 4) for (let y = 8; y < 24; y += 4) if (((x / 4) + (y / 4)) % 2) im.rect(x, y, x + 4, y + 4, C(20, 20, 20)); else im.rect(x, y, x + 4, y + 4, C(245, 245, 245));
    T.finish = im;
  }
  // Sign post (wood)
  { const im = new Img(32, 32, C(120, 84, 50)); im.noise(0.1, R); T.post = im; }
  return T;
}
