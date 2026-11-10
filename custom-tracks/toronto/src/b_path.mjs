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

