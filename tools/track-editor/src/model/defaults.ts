import type { GroundFill, Segment, TrackDoc, TextureRef, Vec3 } from './types';
import { markInitialStyleBreaks } from './segmentStyle';

const DEFAULT_WIDTH = 250;

/** Prefer real MK64 grass when the game o2r is present; export only needs the path. */
const DEFAULT_GRASS: TextureRef = {
  path: 'textures/other_textures/grass_1',
  width: 32,
  height: 32,
  bpp: 16,
};

const DEFAULT_ROAD: TextureRef = {
  path: 'textures/other_textures/gray_cobblestone',
  width: 32,
  height: 32,
  bpp: 16,
};

function defaultGroundFill(): GroundFill {
  return {
    enabled: true,
    padding: 1200,
    y: 0,
    surface: 'grass',
    texture: { ...DEFAULT_GRASS },
    cellSize: 200,
    perimeterWalls: true,
    perimeterWallHeight: 120,
  };
}

function segment(partial?: Partial<Segment>): Segment {
  return {
    widthLeft: DEFAULT_WIDTH,
    widthRight: DEFAULT_WIDTH,
    bank: 0,
    surface: 'asphalt',
    texture: { ...DEFAULT_ROAD },
    textureManual: false,
    wall: 'none',
    wallHeight: 80,
    wallManual: false,
    ...partial,
  };
}

function baseDecor() {
  return {
    apronWidth: 100,
    apronSurface: 'grass' as const,
    apronTexture: { ...DEFAULT_GRASS },
    groundFill: defaultGroundFill(),
  };
}

/** Rectangle circuit matching the M0 spike geometry (game units). */
export function createSpikeLikeDoc(): TrackDoc {
  // Circuit corners: start at origin heading −Z, then +X, +Z, −X.
  const knots: Vec3[] = [
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: -1500 },
    { x: 1800, y: 0, z: -1500 },
    { x: 1800, y: 0, z: 600 },
    { x: 0, y: 0, z: 600 },
  ];

  let segments: Segment[] = knots.map(() => segment());

  // Boost ramp on the +X straight (between knot 1→2, far side of the rectangle).
  // Author as a rampKick on segment index 1 (z=-1500 → x=1800).
  segments[1] = segment({
    surface: 'boost_ramp_asphalt',
    rampKick: { liftHeight: 120, lipLength: 300 },
    textureManual: true,
  });
  segments = markInitialStyleBreaks(segments);

  return {
    version: 1,
    meta: {
      name: 'Spike Test',
      resourceName: 'spike:spike',
      debugName: 'spike',
      trackLength: '100m',
      modName: 'spike-track',
    },
    spline: { knots, closed: true },
    segments,
    decor: { ...baseDecor(), apronWidth: 80 },
    env: {
      waterLevel: -10000,
      sequence: 6,
      skybox: [
        66, 179, 246, 255, 118, 118, 0, 198, 255, 0, 180, 255, 0, 96, 255, 0, 96,
        255, 0, 96, 255, 0, 96, 255,
      ],
      minimapColour: [255, 255, 255],
    },
    actors: [],
    walls: [],
    water: [],
  };
}

/** Simple oval suitable as the default new-track template. */
export function createDefaultOval(): TrackDoc {
  const knots: Vec3[] = [];
  const n = 16;
  const rx = 1400;
  const rz = 900;
  // First knot near origin, path initially heading −Z (clockwise from top-down).
  // Parametric: start at (0,0) side — place first knot at south and go west→north→east.
  // Better: place knots so index 0 is at (0,0,0) and the next is further −Z.
  // Oval centred on (0, -200) so start area has room behind the line.
  const cx = 0;
  const cz = -200;
  for (let i = 0; i < n; i++) {
    // θ=0 → (0, cz-rz) which we shift so first point is origin-ish
    const theta = (i / n) * Math.PI * 2 - Math.PI / 2; // start at bottom (−Z)
    const x = Math.round(cx + rx * Math.cos(theta));
    const z = Math.round(cz + rz * Math.sin(theta));
    knots.push({ x, y: 0, z });
  }
  // Snap first knot to origin for spawn rules.
  knots[0] = { x: 0, y: 0, z: 0 };
  // Ensure second knot is clearly −Z of first.
  if (knots[1].z >= 0) {
    knots[1] = { x: 0, y: 0, z: -400 };
  }

  return {
    version: 1,
    meta: {
      name: 'New Track',
      resourceName: 'user:new_track',
      debugName: 'newtrack',
      trackLength: '100m',
      modName: 'new-track',
    },
    spline: { knots, closed: true },
    segments: markInitialStyleBreaks(knots.map(() => segment())),
    decor: baseDecor(),
    env: {
      waterLevel: -10000,
      sequence: 6,
      skybox: [
        66, 179, 246, 255, 118, 118, 0, 198, 255, 0, 180, 255, 0, 96, 255, 0, 96,
        255, 0, 96, 255, 0, 96, 255,
      ],
      minimapColour: [255, 255, 255],
    },
    actors: [],
    walls: [],
    water: [],
  };
}

export function cloneDoc(doc: TrackDoc): TrackDoc {
  return structuredClone(doc);
}

export function newActorId(): string {
  return `a_${Math.random().toString(36).slice(2, 10)}`;
}
