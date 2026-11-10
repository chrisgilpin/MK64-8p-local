
/** a straight piece with gentle sine humps (the WaveDeck) */
Path.prototype.waves = function (len, amp, waveLen, tag) {
  const { x, z, psi, y } = this.cur, dx = Math.cos(psi), dz = Math.sin(psi), n = Math.round(len / waveLen);
  return this.push(len, (u) => ({ x: x + dx * u, z: z + dz * u, tx: dx, tz: dz }), (u) => y + (amp / 2) * (1 - Math.cos((2 * Math.PI * n * u) / len)), tag);
};

/* ------------------------------------------------------------ route tags */

const BARRIER = { tex: 'barrier', h: 44, off: 10, top: true };
const RAIL = { tex: 'railing', h: 50, off: 4 };
const STREET = (o = {}) => ({ kind: 'street', hw: 170, floor: 'road', surf: SURF.ASPHALT, walls: [BARRIER, BARRIER], ...o });
const BRIDGE = (o = {}) => ({ ...STREET(o), kind: 'bridge', ...o });
const UNDERPASS = (o = {}) => ({ ...STREET(o), kind: 'underpass', walls: [{ ...BARRIER, retain: true }, { ...BARRIER, retain: true }], ...o });
const GATE = (o = {}) => ({ kind: 'gate', hw: 170, floor: 'dirt', surf: SURF.DIRT, walls: [{ tex: 'stadium', h: 230, off: 20 }, { tex: 'stadium', h: 230, off: 20 }], ceil: 230, ...o });
const WARNING = (o = {}) => ({ kind: 'warning', hw: 170, floor: 'dirt', surf: SURF.DIRT, walls: [{ tex: 'padding', h: 36, off: 6, inner: true }, { tex: 'padding', h: 90, off: 6, outer: true }], ...o });
const QUAY = (o = {}) => ({ kind: 'quay', hw: 170, floor: 'road', surf: SURF.ASPHALT, walls: [BARRIER, RAIL], ...o });
const WAVEDECK = (o = {}) => ({ kind: 'wavedeck', hw: 170, floor: 'deck', surf: SURF.WOOD, walls: [{ tex: 'railing', h: 50, off: 4 }, RAIL], ...o });

/* --------------------------------------------------------------- the lap */

const M = new Path(0, 0, -Q, 0);
const mark = {};
const DIP = -95, BRIDGE_Y = 100;
const RAILS = { x0: -1850, x1: -1350, trench: -100, viaduct: 130, deckUnder: 110 };
// 1. Front Street, west past Union Station and the Royal York
M.line(2400, 0, STREET({ name: 'Front Street' }));
M.arc(400, -Q, 0, STREET());
// 2. John Street, up and over the rail lands
mark.john0 = M.len;
{
  const L = BRIDGE_Y / G_MAX - 150;
  M.gline(150, 0, G_MAX, STREET({ name: 'John Street' })); M.gline(L, G_MAX, G_MAX, STREET()); M.gline(150, G_MAX, 0, STREET());
  mark.bridge0 = M.len;
  M.line(M.cur.x - (RAILS.x0 - 150), BRIDGE_Y, BRIDGE({ name: 'John Street Bridge' }));
  mark.bridge1 = M.len;
  M.gline(150, 0, -G_MAX, STREET()); M.gline(L, -G_MAX, -G_MAX, STREET()); M.gline(150, -G_MAX, 0, STREET());
}
M.arc(300, Q, 0, STREET());
// 3. through the gate under the stands and round the Rogers Centre's outfield warning track
const PARK = { R: 900 };
mark.gate0 = M.len;
M.line(700, 0, GATE({ name: 'Rogers Centre' }));
PARK.cx = M.cur.x - PARK.R; PARK.cz = M.cur.z;
mark.warn0 = M.len;
M.arc(PARK.R, -Math.PI, 0, WARNING({ name: 'Warning Track' }));
mark.warn1 = M.len;
M.line(1250, 0, GATE());
mark.gate1 = M.len;
// 4. along to the CN Tower and round its foot
const TOWER = { r: 500 };
M.line(-1300 - M.cur.z, 0, STREET({ name: 'Bremner Boulevard' }));
mark.cn0 = M.len;
TOWER.cx = M.cur.x - TOWER.r; TOWER.cz = M.cur.z;
M.arc(TOWER.r, Q, 0, STREET({ name: 'CN Tower' }));
mark.cn1 = M.len;
// south past Ripley's, under the Gardiner, down to the lake
const GARDINER = { x: -6050, hw: 200, y: 330 };
M.line(M.cur.x - -6500, 0, STREET({ name: 'Lower Simcoe' }));
M.arc(400, -Q, 0, QUAY());
// 5. Queens Quay along the waterfront, with the WaveDeck in the middle
const QQ_X = M.cur.x;
mark.qq0 = M.len;
M.line(900, 0, QUAY({ name: 'Queens Quay' }));
mark.wave0 = M.len;
M.waves(1200, 14, 400, WAVEDECK({ name: 'WaveDeck' }));
mark.wave1 = M.len;
M.line(2300 - M.cur.z, 0, QUAY());
mark.qq1 = M.len;
M.arc(400, -Q, 0, STREET());
// 6. Bay Street: under the Gardiner, past the arena, down under the rail viaduct
const BAY_Z = M.cur.z;
mark.bay0 = M.len;
{
  const L = -DIP / G_MAX - 150, down0 = RAILS.x0 - 100 - (150 + L + 150);
  M.line(down0 - M.cur.x, 0, STREET({ name: 'Bay Street' }));
  mark.dip0 = M.len;
  M.gline(150, 0, -G_MAX, UNDERPASS()); M.gline(L, -G_MAX, -G_MAX, UNDERPASS()); M.gline(150, -G_MAX, 0, UNDERPASS());
  M.line(RAILS.x1 + 100 - M.cur.x, DIP, UNDERPASS({ name: 'Bay Street Underpass' }));
  M.gline(150, 0, G_MAX, UNDERPASS()); M.gline(L, G_MAX, G_MAX, UNDERPASS()); M.gline(150, G_MAX, 0, UNDERPASS());
  mark.dip1 = M.len;
  if (M.cur.x > -400) throw new Error(`Bay Street underpass runs into Front Street (${M.cur.x.toFixed(0)})`);
  M.line(-400 - M.cur.x, 0, STREET());
}
M.arc(400, -Q, 0, STREET());
mark.front1 = M.len;
M.line(M.cur.z, 0, STREET({ name: 'Front Street' }));
if (Math.hypot(M.cur.x, M.cur.z) > 0.5) throw new Error(`lap does not close: ${M.cur.x.toFixed(1)}, ${M.cur.z.toFixed(1)}`);
const L = M.len;
