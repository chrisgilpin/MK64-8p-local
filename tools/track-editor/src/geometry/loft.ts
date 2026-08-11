import type {
  GroundFill,
  Segment,
  TrackDoc,
  TextureRef,
  Vec3,
  WallBarrier,
  WallMode,
  WaterRegion,
} from '../model/types';
import { DEFAULT_APRON_TEXTURE, SURFACE_IDS } from '../model/types';
import type { MeshVertex, Triangle } from '../export/xml';
import { CELL, CLIP, LAYER, PATH_SPACING } from '../export/constants';

export type LoftedSection = {
  name: string;
  surface: number;
  /** SurfaceClip flags value for data_track_sections. */
  clip: number;
  /** Draw layer (opaque / translucent). */
  layer: number;
  tris: Triangle[];
  texturePath: string;
  texture: TextureRef;
};

export type LoftResult = {
  sections: LoftedSection[];
  path: Vec3[];
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
};

const UV_UNIT = 32 << 5; // one texture repeat per cell, 1/32-texel units
/** Sample spacing along the smoothed centreline (game units). Smaller = smoother. */
const SMOOTH_SPACING = 36;

function dist3(a: Vec3, b: Vec3): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  return Math.hypot(dx, dy, dz);
}

/** Uniform Catmull-Rom through p1→p2 (closed-loop friendly). */
function catmullRom(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, t: number): Vec3 {
  const t2 = t * t;
  const t3 = t2 * t;
  const f0 = -0.5 * t3 + t2 - 0.5 * t;
  const f1 = 1.5 * t3 - 2.5 * t2 + 1;
  const f2 = -1.5 * t3 + 2 * t2 + 0.5 * t;
  const f3 = 0.5 * t3 - 0.5 * t2;
  return {
    x: f0 * p0.x + f1 * p1.x + f2 * p2.x + f3 * p3.x,
    y: f0 * p0.y + f1 * p1.y + f2 * p2.y + f3 * p3.y,
    z: f0 * p0.z + f1 * p1.z + f2 * p2.z + f3 * p3.z,
  };
}

/** Derivative of Catmull-Rom (tangent). */
function catmullRomTangent(
  p0: Vec3,
  p1: Vec3,
  p2: Vec3,
  p3: Vec3,
  t: number,
): Vec3 {
  const t2 = t * t;
  const f0 = -1.5 * t2 + 2 * t - 0.5;
  const f1 = 4.5 * t2 - 5 * t;
  const f2 = -4.5 * t2 + 4 * t + 0.5;
  const f3 = 1.5 * t2 - t;
  return {
    x: f0 * p0.x + f1 * p1.x + f2 * p2.x + f3 * p3.x,
    y: f0 * p0.y + f1 * p1.y + f2 * p2.y + f3 * p3.y,
    z: f0 * p0.z + f1 * p1.z + f2 * p2.z + f3 * p3.z,
  };
}

type RoadFrame = {
  pos: Vec3;
  tx: number;
  tz: number;
  nx: number;
  nz: number;
  segIndex: number;
  u: number;
  dist: number;
};

function rampLift(seg: Segment, u: number, _len: number): number {
  if (!seg.rampKick) return 0;
  const { liftHeight, lipLength } = seg.rampKick;
  void lipLength;
  return liftHeight * u * u;
}

/**
 * Dense C1-smooth frames along a closed Catmull-Rom through the knots.
 * Consecutive loft strips share frame endpoints so road edges stay continuous.
 */
export function buildSmoothFrames(
  doc: TrackDoc,
  spacing = SMOOTH_SPACING,
): RoadFrame[] {
  const knots = doc.spline.knots;
  const n = knots.length;
  if (n < 2) return [];

  const frames: RoadFrame[] = [];
  let cumDist = 0;

  for (let i = 0; i < n; i++) {
    const p0 = knots[(i - 1 + n) % n];
    const p1 = knots[i];
    const p2 = knots[(i + 1) % n];
    const p3 = knots[(i + 2) % n];
    const seg = doc.segments[i] ?? doc.segments[0];

    let len = 0;
    let prev = catmullRom(p0, p1, p2, p3, 0);
    const est = 20;
    for (let s = 1; s <= est; s++) {
      const p = catmullRom(p0, p1, p2, p3, s / est);
      len += dist3(prev, p);
      prev = p;
    }

    const steps = Math.max(2, Math.round(len / spacing));
    // Clamp Y to this span's endpoints so Catmull-Rom overshoot can't drive
    // the ribbon under the land plane (visible as "road under grass").
    const yLo = Math.min(p1.y, p2.y);
    const yHi = Math.max(p1.y, p2.y);
    for (let s = 0; s < steps; s++) {
      const u = s / steps;
      const pos = catmullRom(p0, p1, p2, p3, u);
      pos.y = Math.min(yHi, Math.max(yLo, pos.y));
      pos.y += rampLift(seg, u, len);
      const tan = catmullRomTangent(p0, p1, p2, p3, u);
      let tx = tan.x;
      let tz = tan.z;
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl;
      tz /= tl;
      let nx = -tz;
      let nz = tx;
      if (frames.length > 0) {
        const pf = frames[frames.length - 1];
        if (nx * pf.nx + nz * pf.nz < 0) {
          nx = -nx;
          nz = -nz;
          tx = -tx;
          tz = -tz;
        }
        nx = nx + pf.nx;
        nz = nz + pf.nz;
        const nl = Math.hypot(nx, nz) || 1;
        nx /= nl;
        nz /= nl;
        cumDist += dist3(pf.pos, pos);
      }
      frames.push({
        pos: { x: pos.x, y: pos.y, z: pos.z },
        tx,
        tz,
        nx,
        nz,
        segIndex: i,
        u,
        dist: cumDist,
      });
    }
  }

  if (frames.length >= 2) {
    const f0 = frames[0];
    const fl = frames[frames.length - 1];
    let nx = f0.nx + fl.nx;
    let nz = f0.nz + fl.nz;
    const nl = Math.hypot(nx, nz) || 1;
    nx /= nl;
    nz /= nl;
    f0.nx = fl.nx = nx;
    f0.nz = fl.nz = nz;
  }

  return frames;
}

/**
 * How far behind the start line (positive Z when racing −Z) the path must
 * extend. Stock tracks end their waypoint list in this apron so laps count
 * when the player crosses path[0].z from behind.
 */
export const PATH_BEHIND_START = 420;
/** Number of synthetic waypoints placed in the behind-start apron. */
const BEHIND_PATH_POINTS = 12;

/** Resample closed spline into evenly spaced path points (AI / lap progress). */
export function buildPath(doc: TrackDoc, spacing = PATH_SPACING): Vec3[] {
  const frames = buildSmoothFrames(doc, spacing);
  const raw = frames.map((f) => ({
    x: Math.round(f.pos.x),
    y: Math.round(f.pos.y),
    z: Math.round(f.pos.z),
  }));
  return finalizeRacePath(raw, doc.spline.knots[0] ?? { x: 0, y: 0, z: 0 });
}

/**
 * Make a closed centreline sample list valid for MK64 race logic:
 * - path[0] at the start knot
 * - early points head roughly −Z (race direction)
 * - last points sit *behind* the start (+Z) so finish-line Z crossings count laps
 *
 * Spawns use path[0] + (x±20, z+30…+170). Lap increments when the player
 * crosses path[0].z from greater Z to lesser Z while near path ends.
 */
export function finalizeRacePath(samples: Vec3[], startKnot: Vec3): Vec3[] {
  if (samples.length < 4) return samples;

  // Rotate so index 0 is nearest the authored start knot.
  let bestI = 0;
  let bestD = Infinity;
  for (let i = 0; i < samples.length; i++) {
    const d = dist3(samples[i], startKnot);
    if (d < bestD) {
      bestD = d;
      bestI = i;
    }
  }
  let path = samples
    .slice(bestI)
    .concat(samples.slice(0, bestI))
    .map((p) => ({ ...p }));

  // Pin path[0] exactly to the start knot (spawns + finish Z use this).
  path[0] = {
    x: Math.round(startKnot.x),
    y: Math.round(startKnot.y),
    z: Math.round(startKnot.z),
  };

  // Prefer race direction −Z from the start (average of early samples).
  if (path.length >= 4) {
    let sumDz = 0;
    const n = Math.min(12, path.length - 1);
    for (let i = 1; i <= n; i++) sumDz += path[i].z - path[0].z;
    if (sumDz > 0) {
      // Reverse interior; keep index 0 fixed.
      const mid = path.slice(1).reverse();
      path = [path[0], ...mid];
    }
  }

  // Drop samples that hug the start (they are the closed-loop seam) from the
  // tail — we replace them with an explicit behind-start runway.
  const start = path[0];
  const seamR = 280;
  while (path.length > 8) {
    const last = path[path.length - 1];
    if (dist3(last, start) < seamR) {
      path.pop();
    } else {
      break;
    }
  }

  // Also drop any remaining tail points that are already "behind" in a messy
  // way — we'll rebuild a clean runway.
  while (path.length > 8) {
    const last = path[path.length - 1];
    if (last.z > start.z + 40 && Math.abs(last.x - start.x) < 400) {
      path.pop();
    } else {
      break;
    }
  }

  // Append waypoints behind the start: far (+Z) → near, ending just behind path[0].
  // Harbour-style: last points have z > path[0].z and approach the finish.
  const behind: Vec3[] = [];
  for (let i = BEHIND_PATH_POINTS; i >= 1; i--) {
    const t = i / BEHIND_PATH_POINTS;
    behind.push({
      x: Math.round(start.x),
      y: Math.round(start.y),
      z: Math.round(start.z + PATH_BEHIND_START * t),
    });
  }
  path = path.concat(behind);

  // Deduplicate consecutive identical points.
  const out: Vec3[] = [];
  for (const p of path) {
    const prev = out[out.length - 1];
    if (prev && prev.x === p.x && prev.y === p.y && prev.z === p.z) continue;
    out.push(p);
  }
  return out;
}

/**
 * Loft the road as a ribbon along the centreline.
 * Groups consecutive spans that share surface+texture into named sections.
 */
function ensureGroup(
  groups: Map<string, LoftedSection>,
  key: string,
  name: string,
  surface: number,
  clip: number,
  texture: TextureRef,
  layer: number = LAYER.OPAQUE,
): LoftedSection {
  let group = groups.get(key);
  if (!group) {
    group = {
      name,
      surface,
      clip,
      layer,
      tris: [],
      texturePath: texture.path,
      texture,
    };
    groups.set(key, group);
  }
  return group;
}

export function loftTrack(doc: TrackDoc): LoftResult {
  const groups = new Map<string, LoftedSection>();
  let minX = Infinity,
    maxX = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;

  const apronW = Math.max(0, doc.decor.apronWidth);
  const apronTex = doc.decor.apronTexture;
  const apronSurf = SURFACE_IDS[doc.decor.apronSurface];

  const frames = buildSmoothFrames(doc, SMOOTH_SPACING);
  const nf = frames.length;

  for (let i = 0; i < nf; i++) {
    const f0 = frames[i];
    const f1 = frames[(i + 1) % nf];
    const seg = doc.segments[f0.segIndex] ?? doc.segments[0];
    const seg1 = doc.segments[f1.segIndex] ?? seg;
    const key = `road|${seg.surface}|${seg.texture.path}|${seg.rampKick ? 'r' : 'f'}`;
    const group = ensureGroup(
      groups,
      key,
      `road_${groups.size}`,
      SURFACE_IDS[seg.surface],
      CLIP.DEFAULT,
      seg.texture,
    );

    const wL0 = seg.widthLeft;
    const wR0 = seg.widthRight;
    const wL1 = seg1.widthLeft;
    const wR1 = seg1.widthRight;

    // Per-frame normals keep left/right edges continuous across samples.
    const uv0 = f0.dist * 0.25;
    const uv1 = f1.dist * 0.25;
    const L0 = vert(f0.pos, -wL0, f0.nx, f0.nz, 0, uv0);
    const R0 = vert(f0.pos, wR0, f0.nx, f0.nz, UV_UNIT, uv0);
    const R1 = vert(f1.pos, wR1, f1.nx, f1.nz, UV_UNIT, uv1);
    const L1 = vert(f1.pos, -wL1, f1.nx, f1.nz, 0, uv1);

    for (const c of [L0, R0, R1, L1]) {
      minX = Math.min(minX, c.x);
      maxX = Math.max(maxX, c.x);
      minZ = Math.min(minZ, c.z);
      maxZ = Math.max(maxZ, c.z);
    }

    group.tris.push({ v: [L0, R0, R1] });
    group.tris.push({ v: [L0, R1, L1] });

    if (apronW > 0) {
      const apron = ensureGroup(
        groups,
        `apron|${doc.decor.apronSurface}|${apronTex.path}`,
        'apron',
        apronSurf,
        CLIP.DEFAULT,
        apronTex,
      );
      // Slightly under the road so grass shoulders don't z-fight the asphalt edge.
      const apronDrop = 2;
      const la0 = vert(f0.pos, -wL0 - apronW, f0.nx, f0.nz, 0, uv0);
      const la1 = vert(f0.pos, -wL0, f0.nx, f0.nz, UV_UNIT, uv0);
      const la2 = vert(f1.pos, -wL1, f1.nx, f1.nz, UV_UNIT, uv1);
      const la3 = vert(f1.pos, -wL1 - apronW, f1.nx, f1.nz, 0, uv1);
      const ra0 = vert(f0.pos, wR0, f0.nx, f0.nz, 0, uv0);
      const ra1 = vert(f0.pos, wR0 + apronW, f0.nx, f0.nz, UV_UNIT, uv0);
      const ra2 = vert(f1.pos, wR1 + apronW, f1.nx, f1.nz, UV_UNIT, uv1);
      const ra3 = vert(f1.pos, wR1, f1.nx, f1.nz, 0, uv1);
      for (const strip of [
        [la0, la1, la2, la3],
        [ra0, ra1, ra2, ra3],
      ]) {
        for (const c of strip) {
          c.y -= apronDrop;
          minX = Math.min(minX, c.x);
          maxX = Math.max(maxX, c.x);
          minZ = Math.min(minZ, c.z);
          maxZ = Math.max(maxZ, c.z);
        }
        apron.tris.push({ v: [strip[0], strip[1], strip[2]] });
        apron.tris.push({ v: [strip[0], strip[2], strip[3]] });
      }
    }

    // Walls follow the smooth edge with continuous per-frame normals.
    if (seg.wall && seg.wall !== 'none') {
      addWallsSmooth(
        groups,
        seg,
        f0,
        f1,
        wL0,
        wR0,
        wL1,
        wR1,
      );
    }
  }

  // Ensure spawn apron: if road doesn't cover z=-420 near origin, extend a pad.
  ensureSpawnCoverage(groups, doc);

  // Freehand barrier walls (user-drawn, undriveable).
  addFreehandWalls(
    groups,
    doc.walls ?? [],
    resolveGroundFill(doc).texture,
  );

  // Water polygons (drawn shapes filled with WATER_SURFACE).
  addWaterRegions(groups, doc.water ?? [], (bx) => {
    minX = Math.min(minX, bx.minX);
    maxX = Math.max(maxX, bx.maxX);
    minZ = Math.min(minZ, bx.minZ);
    maxZ = Math.max(maxZ, bx.maxZ);
  });

  // World ground fill so blank areas are driveable land (no infinite fall).
  if (Number.isFinite(minX) && Number.isFinite(maxX)) {
    addGroundFill(groups, doc, { minX, maxX, minZ, maxZ });
  }

  const path = buildPath(doc);
  for (const p of path) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }

  // Expand bounds for fill padding so previews show the full land.
  const fill = resolveGroundFill(doc);
  if (fill.enabled) {
    minX -= fill.padding;
    maxX += fill.padding;
    minZ -= fill.padding;
    maxZ += fill.padding;
  }

  return {
    sections: [...groups.values()],
    path,
    bounds: { minX, maxX, minZ, maxZ },
  };
}

export function resolveGroundFill(doc: TrackDoc): GroundFill {
  const g = doc.decor?.groundFill;
  return {
    enabled: g?.enabled ?? true,
    padding: g?.padding ?? 1200,
    y: g?.y ?? 0,
    surface: g?.surface ?? 'grass',
    texture: g?.texture ?? { ...DEFAULT_APRON_TEXTURE },
    cellSize: Math.max(40, g?.cellSize ?? 200),
    perimeterWalls: g?.perimeterWalls ?? true,
    perimeterWallHeight: g?.perimeterWallHeight ?? 120,
  };
}

function addGroundFill(
  groups: Map<string, LoftedSection>,
  doc: TrackDoc,
  roadBounds: { minX: number; maxX: number; minZ: number; maxZ: number },
): void {
  const fill = resolveGroundFill(doc);
  if (!fill.enabled) return;

  // Always place land under the lowest asphalt/apron vertex. Steep elevation
  // changes used to make Catmull-Rom dip the road below a fixed fill.y plane,
  // so the ribbon looked buried in the grass (your y=50→y=200 climb).
  let minSurfaceY = fill.y;
  for (const g of groups.values()) {
    if (
      !g.name.startsWith('road') &&
      g.name !== 'apron' &&
      g.name !== 'spawn_pad'
    ) {
      continue;
    }
    for (const tri of g.tris) {
      for (const v of tri.v) minSurfaceY = Math.min(minSurfaceY, v.y);
    }
  }
  const y = Math.min(fill.y, minSurfaceY) - 4;
  const pad = fill.padding;
  const x0 = roadBounds.minX - pad;
  const x1 = roadBounds.maxX + pad;
  const z0 = roadBounds.minZ - pad;
  const z1 = roadBounds.maxZ + pad;
  const cell = fill.cellSize;

  // Always cover spawn zone.
  const gx0 = Math.min(x0, -800);
  const gx1 = Math.max(x1, 800);
  const gz0 = Math.min(z0, -800);
  const gz1 = Math.max(z1, 200);

  const land = ensureGroup(
    groups,
    `fill|${fill.surface}|${fill.texture.path}|${fill.y}`,
    'ground_fill',
    SURFACE_IDS[fill.surface],
    CLIP.DEFAULT,
    fill.texture,
  );

  const stepsX = Math.max(1, Math.ceil((gx1 - gx0) / cell));
  const stepsZ = Math.max(1, Math.ceil((gz1 - gz0) / cell));
  for (let ix = 0; ix < stepsX; ix++) {
    for (let iz = 0; iz < stepsZ; iz++) {
      const xa = gx0 + ((gx1 - gx0) * ix) / stepsX;
      const xb = gx0 + ((gx1 - gx0) * (ix + 1)) / stepsX;
      const za = gz0 + ((gz1 - gz0) * iz) / stepsZ;
      const zb = gz0 + ((gz1 - gz0) * (iz + 1)) / stepsZ;
      const a: MeshVertex = { x: xa, y, z: za, s: 0, t: 0 };
      const b: MeshVertex = { x: xb, y, z: za, s: UV_UNIT, t: 0 };
      const c: MeshVertex = { x: xb, y, z: zb, s: UV_UNIT, t: UV_UNIT };
      const d: MeshVertex = { x: xa, y, z: zb, s: 0, t: UV_UNIT };
      land.tris.push({ v: [a, b, c] }, { v: [a, c, d] });
    }
  }

  if (fill.perimeterWalls) {
    addPerimeterWalls(groups, fill, gx0, gx1, gz0, gz1, y);
  }
}

function addPerimeterWalls(
  groups: Map<string, LoftedSection>,
  fill: GroundFill,
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  baseY: number,
): void {
  const h = Math.max(10, fill.perimeterWallHeight);
  const wall = ensureGroup(
    groups,
    `perimeter_wall|${fill.texture.path}`,
    'perimeter_walls',
    SURFACE_IDS.asphalt,
    CLIP.DOUBLE_SIDED_WALL,
    fill.texture,
  );

  const edges: [Vec3, Vec3][] = [
    [
      { x: x0, y: baseY, z: z0 },
      { x: x1, y: baseY, z: z0 },
    ],
    [
      { x: x1, y: baseY, z: z0 },
      { x: x1, y: baseY, z: z1 },
    ],
    [
      { x: x1, y: baseY, z: z1 },
      { x: x0, y: baseY, z: z1 },
    ],
    [
      { x: x0, y: baseY, z: z1 },
      { x: x0, y: baseY, z: z0 },
    ],
  ];

  for (const [p0, p1] of edges) {
    pushWallQuad(wall, p0, p1, h);
  }
}

function addFreehandWalls(
  groups: Map<string, LoftedSection>,
  walls: WallBarrier[],
  texture?: TextureRef,
): void {
  if (!walls.length) return;
  const tex = texture ?? DEFAULT_APRON_TEXTURE;
  const wall = ensureGroup(
    groups,
    `freehand_walls|${tex.path}`,
    'barrier_walls',
    SURFACE_IDS.asphalt,
    CLIP.DOUBLE_SIDED_WALL,
    tex,
  );

  for (const barrier of walls) {
    const h = Math.max(10, barrier.height);
    const pts = barrier.points;
    for (let i = 0; i < pts.length - 1; i++) {
      pushWallQuad(wall, pts[i], pts[i + 1], h);
    }
  }
}

function addWaterRegions(
  groups: Map<string, LoftedSection>,
  regions: WaterRegion[],
  expand: (b: { minX: number; maxX: number; minZ: number; maxZ: number }) => void,
): void {
  for (let ri = 0; ri < regions.length; ri++) {
    const region = regions[ri];
    if (region.points.length < 3) continue;
    const y = region.y;
    const tris = triangulatePolygonXZ(region.points, y);
    if (tris.length === 0) continue;

    const water = ensureGroup(
      groups,
      `water|${region.id}|${region.texture.path}`,
      `water_${ri}`,
      SURFACE_IDS.water,
      CLIP.DEFAULT,
      region.texture,
      LAYER.TRANSLUCENT,
    );
    water.tris.push(...tris);

    let minX = Infinity,
      maxX = -Infinity,
      minZ = Infinity,
      maxZ = -Infinity;
    for (const p of region.points) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
    expand({ minX, maxX, minZ, maxZ });
  }
}

/**
 * Fan-triangulate a closed polygon in XZ at constant Y.
 * Works well for simple lakes drawn as convex / mildly concave shapes.
 */
export function triangulatePolygonXZ(points: Vec3[], y: number): Triangle[] {
  if (points.length < 3) return [];
  // Ensure CCW in XZ for consistent normals (up).
  const pts = ensureCcwXZ([...points]);
  let cx = 0;
  let cz = 0;
  for (const p of pts) {
    cx += p.x;
    cz += p.z;
  }
  cx /= pts.length;
  cz /= pts.length;

  const uvScale = 0.02; // ~1 UV unit per 50 game units
  const toV = (x: number, z: number): MeshVertex => ({
    x,
    y,
    z,
    s: Math.round(x * uvScale * 32),
    t: Math.round(z * uvScale * 32),
  });

  const c = toV(cx, cz);
  const tris: Triangle[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    // Winding: a → b → center should face up if pts are CCW
    tris.push({ v: [toV(a.x, a.z), toV(b.x, b.z), c] });
  }
  return tris;
}

function ensureCcwXZ(points: Vec3[]): Vec3[] {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a.x * b.z - b.x * a.z;
  }
  // area > 0 → CCW in XZ with Y-up right-handed? For screen map Z down visually,
  // engine: we want top face normal +Y. Cross product of edges in XZ:
  // (bx-ax, 0, bz-az) × (cx-ax, 0, cz-az) = (0, (bx-ax)(cz-az)-(bz-az)(cx-ax), 0)
  // Positive Y when signed area of (a,b,c) is positive for CCW when looking down -Y...
  // Looking from +Y down, CCW is standard. Signed area 2A = sum(x_i z_{i+1} - x_{i+1} z_i).
  // Positive area = CCW when Z is up on paper; in our game Z is forward. Either way
  // flip if clockwise so lighting/cull is stable.
  if (area < 0) return points.reverse();
  return points;
}

function pushWallQuad(
  wall: LoftedSection,
  p0: Vec3,
  p1: Vec3,
  height: number,
): void {
  const b0: MeshVertex = {
    x: p0.x,
    y: p0.y,
    z: p0.z,
    s: 0,
    t: 0,
  };
  const b1: MeshVertex = {
    x: p1.x,
    y: p1.y,
    z: p1.z,
    s: UV_UNIT,
    t: 0,
  };
  const t0: MeshVertex = { ...b0, y: b0.y + height, t: UV_UNIT };
  const t1: MeshVertex = { ...b1, y: b1.y + height, t: UV_UNIT };
  wall.tris.push({ v: [b0, b1, t1] }, { v: [b0, t1, t0] });
}

function addWallsSmooth(
  groups: Map<string, LoftedSection>,
  seg: Segment,
  f0: RoadFrame,
  f1: RoadFrame,
  wL0: number,
  wR0: number,
  wL1: number,
  wR1: number,
): void {
  const mode: WallMode = seg.wall ?? 'none';
  if (mode === 'none') return;
  const h = Math.max(10, seg.wallHeight ?? 80);
  const wall = ensureGroup(
    groups,
    `wall|${seg.texture.path}`,
    'walls',
    SURFACE_IDS.asphalt,
    CLIP.DOUBLE_SIDED_WALL,
    seg.texture,
  );

  const sides0: number[] = [];
  const sides1: number[] = [];
  if (mode === 'left' || mode === 'both') {
    sides0.push(-wL0);
    sides1.push(-wL1);
  }
  if (mode === 'right' || mode === 'both') {
    sides0.push(wR0);
    sides1.push(wR1);
  }

  for (let si = 0; si < sides0.length; si++) {
    const b0 = vert(f0.pos, sides0[si], f0.nx, f0.nz, 0, f0.u * UV_UNIT);
    const b1 = vert(f1.pos, sides1[si], f1.nx, f1.nz, UV_UNIT, f1.u * UV_UNIT);
    const t0: MeshVertex = { ...b0, y: b0.y + h, t: f0.u * UV_UNIT + UV_UNIT };
    const t1: MeshVertex = { ...b1, y: b1.y + h, t: f1.u * UV_UNIT + UV_UNIT };
    wall.tris.push({ v: [b0, b1, t1] });
    wall.tris.push({ v: [b0, t1, t0] });
  }
}

/**
 * Approximate ground height under (x,z) by nearest path sample.
 * Used when placing props so they sit on the road surface.
 */
export function sampleHeightAt(doc: TrackDoc, x: number, z: number): number {
  const path = buildPath(doc, Math.max(PATH_SPACING, 60));
  if (path.length === 0) {
    return resolveGroundFill(doc).y;
  }
  let best = path[0];
  let bestD = Infinity;
  for (const p of path) {
    const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  // Far from the road centreline → use ground fill height.
  const roadHalf =
    Math.max(
      doc.segments[0]?.widthLeft ?? 250,
      doc.segments[0]?.widthRight ?? 250,
    ) + (doc.decor?.apronWidth ?? 0);
  if (Math.sqrt(bestD) > roadHalf * 1.5) {
    return resolveGroundFill(doc).y;
  }
  return best.y;
}


function vert(
  center: Vec3,
  lateral: number,
  nx: number,
  nz: number,
  s: number,
  t: number,
): MeshVertex {
  return {
    x: center.x + nx * lateral,
    y: center.y,
    z: center.z + nz * lateral,
    s,
    t,
  };
}

/**
 * Guarantee a flat pad covering the starting grid.
 *
 * Game spawns (spawn_and_set_player_spawns): X = path[0].x ± 20,
 * Z = path[0].z + 30 … +170, facing −Z. Need asphalt under that apron
 * (positive Z behind the start when path[0] is at the origin).
 */
function ensureSpawnCoverage(
  groups: Map<string, LoftedSection>,
  doc: TrackDoc,
): void {
  const padKey = `spawn_pad`;
  const tex = doc.segments[0]?.texture;
  if (!tex) return;

  const start = doc.spline.knots[0] ?? { x: 0, y: 0, z: 0 };
  // Always lay a dedicated asphalt pad under the starting grid. Relying on the
  // lofted ribbon alone often leaves z=+30…+170 (where karts actually spawn)
  // on ground-fill only, which is a common “spawn then fall” failure mode.
  if (groups.has(padKey)) return;

  const halfW = Math.max(
    doc.segments[0]?.widthLeft ?? 250,
    doc.segments[0]?.widthRight ?? 250,
    300,
  );
  const z0 = start.z - 500;
  const z1 = start.z + 250;
  const x0 = start.x - halfW;
  const x1 = start.x + halfW;
  const y = start.y;
  const stepsX = Math.max(2, Math.ceil((x1 - x0) / CELL));
  const stepsZ = Math.max(2, Math.ceil((z1 - z0) / CELL));
  const tris: Triangle[] = [];
  for (let ix = 0; ix < stepsX; ix++) {
    for (let iz = 0; iz < stepsZ; iz++) {
      const xa = x0 + ((x1 - x0) * ix) / stepsX;
      const xb = x0 + ((x1 - x0) * (ix + 1)) / stepsX;
      const za = z0 + ((z1 - z0) * iz) / stepsZ;
      const zb = z0 + ((z1 - z0) * (iz + 1)) / stepsZ;
      const a: MeshVertex = { x: xa, y, z: za, s: 0, t: 0 };
      const b: MeshVertex = { x: xb, y, z: za, s: UV_UNIT, t: 0 };
      const c: MeshVertex = { x: xb, y, z: zb, s: UV_UNIT, t: UV_UNIT };
      const d: MeshVertex = { x: xa, y, z: zb, s: 0, t: UV_UNIT };
      tris.push({ v: [a, b, c] }, { v: [a, c, d] });
    }
  }
  groups.set(padKey, {
    name: 'spawn_pad',
    surface: SURFACE_IDS.asphalt,
    clip: CLIP.DEFAULT,
    layer: LAYER.OPAQUE,
    tris,
    texturePath: tex.path,
    texture: tex,
  });
}

function pointInTriXZ(px: number, pz: number, tri: Triangle): boolean {
  const [a, b, c] = tri.v;
  const sign = (p1: MeshVertex, p2: MeshVertex, p3: MeshVertex) =>
    (p1.x - p3.x) * (p2.z - p3.z) - (p2.x - p3.x) * (p1.z - p3.z);
  const d1 = sign({ x: px, y: 0, z: pz, s: 0, t: 0 }, a, b);
  const d2 = sign({ x: px, y: 0, z: pz, s: 0, t: 0 }, b, c);
  const d3 = sign({ x: px, y: 0, z: pz, s: 0, t: 0 }, c, a);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}
