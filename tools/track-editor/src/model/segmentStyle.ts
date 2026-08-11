import type { Segment, TextureRef, TrackDoc, WallMode } from './types';

export function texturesEqual(a: TextureRef, b: TextureRef): boolean {
  return (
    a.path === b.path &&
    a.width === b.width &&
    a.height === b.height &&
    a.bpp === b.bpp
  );
}

function wallsEqual(a: Segment, b: Segment): boolean {
  return (
    a.wall === b.wall && (a.wallHeight ?? 80) === (b.wallHeight ?? 80)
  );
}

/**
 * Apply a manual texture at `index` and paint every following segment that
 * currently shares the same texture (the open run). Stops at the first
 * segment with a *different* texture — that is treated as the next break.
 *
 * Using texture values (not textureManual alone) means legacy projects that
 * marked every knot manual still propagate when you edit a knot in a run.
 */
export function applyTextureRun(
  segments: Segment[],
  index: number,
  tex: TextureRef,
): Segment[] {
  if (index < 0 || index >= segments.length) return segments;
  const next = segments.map((s) => ({ ...s, texture: { ...s.texture } }));
  const oldTex = next[index].texture;

  let end = index + 1;
  while (end < next.length && texturesEqual(next[end].texture, oldTex)) {
    end++;
  }

  next[index] = {
    ...next[index],
    texture: { ...tex },
    textureManual: true,
  };
  for (let j = index + 1; j < end; j++) {
    next[j] = {
      ...next[j],
      texture: { ...tex },
      textureManual: false,
    };
  }
  // Next different texture is an authoring break.
  if (end < next.length && !texturesEqual(next[end].texture, tex)) {
    next[end] = { ...next[end], textureManual: true };
  }
  return next;
}

/**
 * Apply manual wall settings at `index` and propagate through the contiguous
 * run of segments that share the same wall / wallHeight values.
 */
export function applyWallRun(
  segments: Segment[],
  index: number,
  patch: { wall?: WallMode; wallHeight?: number },
): Segment[] {
  if (index < 0 || index >= segments.length) return segments;
  const next = segments.map((s) => ({ ...s }));
  const old = next[index];

  let end = index + 1;
  while (end < next.length && wallsEqual(next[end], old)) {
    end++;
  }

  const wall = patch.wall ?? next[index].wall;
  const wallHeight = patch.wallHeight ?? next[index].wallHeight ?? 80;
  next[index] = {
    ...next[index],
    wall,
    wallHeight,
    wallManual: true,
  };
  for (let j = index + 1; j < end; j++) {
    next[j] = {
      ...next[j],
      wall,
      wallHeight,
      wallManual: false,
    };
  }
  if (
    end < next.length &&
    (next[end].wall !== wall ||
      (next[end].wallHeight ?? 80) !== wallHeight)
  ) {
    next[end] = { ...next[end], wallManual: true };
  }
  return next;
}

/** Resolve inherited appearance (for UI badges / future tools). */
export function resolveSegmentStyles(doc: TrackDoc): Segment[] {
  const segs = doc.segments;
  if (segs.length === 0) return [];
  const out: Segment[] = [];
  let tex = segs[0].texture;
  let wall = segs[0].wall;
  let wallHeight = segs[0].wallHeight;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (i === 0 || s.textureManual) tex = s.texture;
    if (i === 0 || s.wallManual) {
      wall = s.wall;
      wallHeight = s.wallHeight;
    }
    out.push({
      ...s,
      texture: { ...tex },
      wall,
      wallHeight,
    });
  }
  return out;
}

/**
 * When inserting a segment after `afterIndex`, new segment inherits and is
 * not a manual break unless the user later overrides it.
 */
export function newInheritedSegment(template: Segment): Segment {
  return {
    ...structuredClone(template),
    textureManual: false,
    wallManual: false,
  };
}

/**
 * Mark first segment as the style source for a fresh track; later segments
 * inherit until the user sets a break.
 */
export function markInitialStyleBreaks(segments: Segment[]): Segment[] {
  if (segments.length === 0) return segments;
  return segments.map((s, i) => ({
    ...s,
    textureManual: i === 0 ? true : (s.textureManual ?? false),
    wallManual: i === 0 ? true : (s.wallManual ?? false),
  }));
}

/**
 * Derive textureManual / wallManual from value changes vs previous segment.
 * Used for legacy projects that lacked flags (or had every segment marked manual).
 */
export function deriveStyleBreaksFromValues(segments: Segment[]): Segment[] {
  if (segments.length === 0) return segments;
  return segments.map((s, i) => {
    if (i === 0) {
      return { ...s, textureManual: true, wallManual: true };
    }
    const prev = segments[i - 1];
    return {
      ...s,
      textureManual: !texturesEqual(s.texture, prev.texture),
      wallManual:
        s.wall !== prev.wall ||
        (s.wallHeight ?? 80) !== (prev.wallHeight ?? 80),
    };
  });
}

/**
 * If every segment is flagged manual (typical after a bad legacy normalize),
 * re-derive breaks from actual texture/wall value changes so inheritance works.
 */
export function healAllManualStyleFlags(segments: Segment[]): Segment[] {
  if (segments.length <= 1) return segments;
  const allTex = segments.every((s) => s.textureManual);
  const allWall = segments.every((s) => s.wallManual);
  if (!allTex && !allWall) return segments;

  return segments.map((s, i) => {
    if (i === 0) {
      return {
        ...s,
        textureManual: true,
        wallManual: true,
      };
    }
    const prev = segments[i - 1];
    return {
      ...s,
      textureManual: allTex
        ? !texturesEqual(s.texture, prev.texture)
        : Boolean(s.textureManual),
      wallManual: allWall
        ? s.wall !== prev.wall ||
          (s.wallHeight ?? 80) !== (prev.wallHeight ?? 80)
        : Boolean(s.wallManual),
    };
  });
}
