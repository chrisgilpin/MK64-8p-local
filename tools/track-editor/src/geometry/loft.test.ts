import { describe, expect, it } from 'vitest';
import { createDefaultOval } from '../model/defaults';
import {
  buildPath,
  buildSmoothFrames,
  finalizeRacePath,
  loftTrack,
} from './loft';

describe('knot height', () => {
  it('blends path Y between elevated knots', () => {
    const doc = createDefaultOval();
    doc.spline.knots[1] = { ...doc.spline.knots[1], y: 200 };
    doc.spline.knots[2] = { ...doc.spline.knots[2], y: 200 };
    const path = buildPath(doc);
    const elevated = path.filter((p) => p.y >= 100);
    expect(elevated.length).toBeGreaterThan(0);
  });

  it('lofts mesh vertices at knot elevation', () => {
    const doc = createDefaultOval();
    doc.spline.knots[1] = { ...doc.spline.knots[1], y: 150 };
    const lofted = loftTrack(doc);
    let maxY = -Infinity;
    for (const sec of lofted.sections) {
      for (const tri of sec.tris) {
        for (const v of tri.v) maxY = Math.max(maxY, v.y);
      }
    }
    expect(maxY).toBeGreaterThanOrEqual(140);
  });

  it('does not bury elevated road under the grass plane', () => {
    const doc = createDefaultOval();
    // Steep climb like the user's y=50 → y=200 knot (Catmull used to overshoot below 0).
    doc.spline.knots[2] = { ...doc.spline.knots[2], y: 50 };
    doc.spline.knots[3] = { ...doc.spline.knots[3], y: 200 };
    doc.spline.knots[4] = { ...doc.spline.knots[4], y: 20 };
    const lofted = loftTrack(doc);
    let minRoadY = Infinity;
    let minSurfaceY = Infinity;
    let groundY = Infinity;
    for (const sec of lofted.sections) {
      for (const tri of sec.tris) {
        for (const v of tri.v) {
          if (sec.name.startsWith('road')) {
            minRoadY = Math.min(minRoadY, v.y);
            minSurfaceY = Math.min(minSurfaceY, v.y);
          }
          if (sec.name === 'apron') {
            minSurfaceY = Math.min(minSurfaceY, v.y);
          }
          if (sec.name === 'ground_fill') {
            groundY = Math.min(groundY, v.y);
          }
        }
      }
    }
    // Catmull-Rom must not overshoot below the lower knot of each span.
    expect(minRoadY).toBeGreaterThanOrEqual(0);
    // Land plane always sits under asphalt + shoulders.
    expect(groundY).toBeLessThan(minSurfaceY);
  });
});

describe('curve smoothing', () => {
  it('samples more frames than control knots', () => {
    const doc = createDefaultOval();
    const frames = buildSmoothFrames(doc);
    expect(frames.length).toBeGreaterThan(doc.spline.knots.length * 2);
  });

  it('keeps consecutive edge directions continuous (no hard 90° flips)', () => {
    const doc = createDefaultOval();
    const frames = buildSmoothFrames(doc);
    let worstDot = 1;
    for (let i = 0; i < frames.length; i++) {
      const a = frames[i];
      const b = frames[(i + 1) % frames.length];
      const dot = a.tx * b.tx + a.tz * b.tz;
      worstDot = Math.min(worstDot, dot);
    }
    // Tangents should never reverse abruptly on a smooth oval.
    expect(worstDot).toBeGreaterThan(0.5);
  });

  it('produces a continuous left-edge polyline without jumps', () => {
    const doc = createDefaultOval();
    const frames = buildSmoothFrames(doc);
    const w = doc.segments[0].widthLeft;
    let maxStep = 0;
    for (let i = 0; i < frames.length; i++) {
      const a = frames[i];
      const b = frames[(i + 1) % frames.length];
      const lx0 = a.pos.x + a.nx * -w;
      const lz0 = a.pos.z + a.nz * -w;
      const lx1 = b.pos.x + b.nx * -w;
      const lz1 = b.pos.z + b.nz * -w;
      const step = Math.hypot(lx1 - lx0, lz1 - lz0);
      maxStep = Math.max(maxStep, step);
    }
    // Spacing is ~36 along centreline; edge steps should stay in the same ballpark.
    expect(maxStep).toBeLessThan(120);
  });
});

describe('race path finalization', () => {
  it('pins path[0] to the start knot and heads −Z', () => {
    const doc = createDefaultOval();
    const path = buildPath(doc);
    expect(path[0].x).toBe(0);
    expect(path[0].z).toBe(0);
    // Early samples should leave toward −Z on average
    let sumDz = 0;
    for (let i = 1; i <= 8; i++) sumDz += path[i].z - path[0].z;
    expect(sumDz).toBeLessThan(0);
  });

  it('ends with waypoints behind the start (+Z) for lap counting', () => {
    const doc = createDefaultOval();
    const path = buildPath(doc);
    const tail = path.slice(-10);
    const behind = tail.filter((p) => p.z > path[0].z + 20);
    expect(behind.length).toBeGreaterThanOrEqual(8);
  });

  it('adds behind-start runway even when the closed seam approaches from −Z', () => {
    // Mimic the user's track: samples return to origin from negative Z only.
    const samples = [];
    for (let i = 0; i < 40; i++) {
      const t = i / 40;
      samples.push({
        x: Math.round(500 * Math.sin(t * Math.PI * 2)),
        y: 0,
        z: Math.round(-400 + 400 * Math.cos(t * Math.PI * 2)),
      });
    }
    // Force first sample at origin heading somewhat +Z first (bad seam)
    samples[0] = { x: 0, y: 0, z: 0 };
    samples[1] = { x: 30, y: 0, z: 20 };
    const path = finalizeRacePath(samples, { x: 0, y: 0, z: 0 });
    expect(path[0]).toEqual({ x: 0, y: 0, z: 0 });
    const tail = path.slice(-8);
    expect(tail.every((p) => p.z > 0)).toBe(true);
  });

  it('covers the starting grid with asphalt (spawn pad if needed)', () => {
    const doc = createDefaultOval();
    const lofted = loftTrack(doc);
    // Spawn slots: (±20, +30…+170)
    const samples: [number, number][] = [
      [20, 30],
      [-20, 50],
      [20, 170],
      [-20, 170],
    ];
    for (const [px, pz] of samples) {
      let hit = false;
      for (const g of lofted.sections) {
        if (g.clip !== 1) continue;
        if (g.name.startsWith('ground_fill')) continue;
        for (const tri of g.tris) {
          const [a, b, c] = tri.v;
          const sign = (p1: { x: number; z: number }, p2: typeof a, p3: typeof a) =>
            (p1.x - p3.x) * (p2.z - p3.z) - (p2.x - p3.x) * (p1.z - p3.z);
          const p = { x: px, z: pz };
          const d1 = sign(p, a, b);
          const d2 = sign(p, b, c);
          const d3 = sign(p, c, a);
          if (!((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))) {
            hit = true;
            break;
          }
        }
        if (hit) break;
      }
      expect(hit, `no asphalt under spawn (${px},${pz})`).toBe(true);
    }
  });
});


