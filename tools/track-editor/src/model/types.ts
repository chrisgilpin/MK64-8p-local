/** Authoring document for the browser track editor. Not the shipped scene.json. */

export type SurfaceType =
  | 'asphalt'
  | 'dirt'
  | 'sand'
  | 'cement'
  | 'snow'
  | 'bridge'
  | 'dirt_offroad'
  | 'grass'
  | 'ice'
  | 'wet_sand'
  | 'snow_offroad'
  | 'rock'
  | 'rail_ballast'
  | 'cave'
  | 'rope_bridge'
  | 'wood_bridge'
  | 'boost_ramp_wood'
  | 'out_of_bounds'
  | 'boost_ramp_asphalt'
  | 'ramp'
  | 'water';

/** Engine SURFACE_TYPE values (include/mk64.h / docs). */
export const SURFACE_IDS: Record<SurfaceType, number> = {
  asphalt: 1,
  dirt: 2,
  sand: 3,
  cement: 4,
  snow: 5,
  bridge: 6,
  dirt_offroad: 7,
  grass: 8,
  ice: 9,
  wet_sand: 10,
  snow_offroad: 11,
  rock: 12,
  rail_ballast: 14,
  cave: 15,
  rope_bridge: 16,
  wood_bridge: 17,
  /** Water effect + Lakitu pickup (mk64.h WATER_SURFACE). */
  water: 0xfb,
  boost_ramp_wood: 0xfc,
  out_of_bounds: 0xfd,
  boost_ramp_asphalt: 0xfe,
  ramp: 0xff,
};

export const SURFACE_LABELS: Record<SurfaceType, string> = {
  asphalt: 'Asphalt',
  dirt: 'Dirt',
  sand: 'Sand',
  cement: 'Cement',
  snow: 'Snow',
  bridge: 'Bridge',
  dirt_offroad: 'Dirt (off-road)',
  grass: 'Grass',
  ice: 'Ice',
  wet_sand: 'Wet sand',
  snow_offroad: 'Snow (off-road)',
  rock: 'Rock',
  rail_ballast: 'Rail ballast',
  cave: 'Cave',
  rope_bridge: 'Rope bridge',
  wood_bridge: 'Wood bridge',
  water: 'Water',
  boost_ramp_wood: 'Boost ramp (wood)',
  out_of_bounds: 'Out of bounds',
  boost_ramp_asphalt: 'Boost ramp (asphalt)',
  ramp: 'Ramp',
};

export type WallMode = 'none' | 'left' | 'right' | 'both';

export type TextureRef = {
  /** Resource path inside mk64.o2r, e.g. textures/other_textures/checkerboard_black_white */
  path: string;
  width: number;
  height: number;
  /** Bits per pixel for RGBA16=16, etc. */
  bpp: number;
};

export type Vec3 = { x: number; y: number; z: number };

/** Placeable scene actor exported into scene.json Actors[]. */
export type ActorPlacement = {
  id: string;
  /** Engine resource name, e.g. mk:item_box */
  name: string;
  location: Vec3;
};

/** Freehand barrier polyline — vertical collision walls that cannot be driven through. */
export type WallBarrier = {
  id: string;
  /** Ground-plane points (Y used as wall base height). */
  points: Vec3[];
  height: number;
};

/** Closed polygon filled with water (surface 0xFB). */
export type WaterRegion = {
  id: string;
  /** Polygon vertices in XZ; Y is ignored (use `y` instead). Need ≥3. */
  points: Vec3[];
  /** Water surface height. */
  y: number;
  texture: TextureRef;
};

/** Infinite-style ground under the whole track bounds so players never fall forever. */
export type GroundFill = {
  enabled: boolean;
  /** Extra margin past the track extents (game units). */
  padding: number;
  /** Absolute Y of the fill plane. Road can sit on or above this. */
  y: number;
  surface: SurfaceType;
  texture: TextureRef;
  /** Grid cell size for collision stability. */
  cellSize: number;
  /** Optional walls around the outer edge of the fill. */
  perimeterWalls: boolean;
  perimeterWallHeight: number;
};

export type Segment = {
  widthLeft: number;
  widthRight: number;
  bank: number;
  surface: SurfaceType;
  texture: TextureRef;
  /**
   * When true, this segment's texture is an authoring break-point.
   * Following segments without textureManual inherit it until the next break.
   */
  textureManual?: boolean;
  wall: WallMode;
  /** Wall height in game units when wall !== none. */
  wallHeight: number;
  /**
   * When true, wall / wallHeight are an authoring break-point for inheritance
   * (same rules as textureManual).
   */
  wallManual?: boolean;
  /** Optional jump profile for this span. */
  rampKick?: { liftHeight: number; lipLength: number };
};

export type TrackMeta = {
  name: string;
  /** "author:track" */
  resourceName: string;
  debugName: string;
  trackLength: string;
  modName: string;
};

export type TrackDoc = {
  version: 1;
  meta: TrackMeta;
  /** Closed centreline in game units (Y up, −Z is start heading). */
  spline: { knots: Vec3[]; closed: true };
  /** One segment per span between consecutive knots (length === knots.length when closed). */
  segments: Segment[];
  decor: {
    apronWidth: number;
    apronSurface: SurfaceType;
    apronTexture: TextureRef;
    groundFill: GroundFill;
  };
  env: {
    waterLevel: number;
    sequence: number;
    skybox: number[];
    minimapColour: [number, number, number];
  };
  /** Trees, item boxes, etc. written to scene.json */
  actors: ActorPlacement[];
  /** User-drawn barrier walls (double-sided collision). */
  walls: WallBarrier[];
  /** User-drawn water polygons. */
  water: WaterRegion[];
};

export type ValidationTarget = 'stock' | '8p' | 'both';

export type ValidationIssue = {
  level: 'error' | 'warning';
  code: string;
  message: string;
  /** Applies only when validating this target (or always if omitted). */
  target?: ValidationTarget;
};

export const DEFAULT_TEXTURE: TextureRef = {
  path: 'textures/other_textures/checkerboard_black_white',
  width: 32,
  height: 32,
  bpp: 16,
};

export const DEFAULT_APRON_TEXTURE: TextureRef = {
  path: 'textures/other_textures/checkerboard_black_white',
  width: 32,
  height: 32,
  bpp: 16,
};

/** Harbour water (in spaghetti.o2r). Override via the texture path field if needed. */
export const DEFAULT_WATER_TEXTURE: TextureRef = {
  path: 'tracks/harbour/water3.rgba16',
  width: 32,
  height: 32,
  bpp: 16,
};
