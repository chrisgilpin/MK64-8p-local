/** Engine / F3DEX exporter constants verified by the M0 spike. */

export const VTX_BATCH = 32;
export const PATH_MAX_POINTS = 0x7d0;
export const PATH_TERMINATOR = { x: -32768, y: -32768, z: -32768 } as const;
export const SPAWN_Z_EXTENT = -420;
export const COORD_LIMIT = 32767;

/** SurfaceClip — includes CLIP_DEFAULT which the docs omit. */
export const CLIP = {
  NONE: 0,
  DEFAULT: 1,
  SINGLE_SIDED_WALL: 2,
  SURFACE: 3,
  DOUBLE_SIDED_WALL: 4,
} as const;

export const LAYER = {
  INVISIBLE: 0,
  OPAQUE: 1,
  TRANSLUCENT: 2,
  TRANSLUCENT_NO_Z: 3,
} as const;

/** Vertex normal for lit upward-facing surfaces (harbour convention). */
export const UP_NORMAL = { r: 0, g: 127, b: 0, a: 255 } as const;

/** Default path sample spacing in game units. */
export const PATH_SPACING = 40;

/** Road mesh cell size for ground subdivision. */
export const CELL = 80;
