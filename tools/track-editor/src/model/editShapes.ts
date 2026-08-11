import type { Vec3, WallBarrier, WaterRegion } from './types';

const MIN_WALL_POINTS = 2;
const MIN_WATER_POINTS = 3;

export function moveShapePoint(
  points: Vec3[],
  index: number,
  pos: Vec3,
): Vec3[] {
  if (index < 0 || index >= points.length) return points;
  const next = [...points];
  next[index] = {
    x: pos.x,
    y: pos.y !== undefined && !Number.isNaN(pos.y) ? pos.y : points[index].y,
    z: pos.z,
  };
  return next;
}

export function setShapePoint(
  points: Vec3[],
  index: number,
  patch: Partial<Vec3>,
): Vec3[] {
  if (index < 0 || index >= points.length) return points;
  const prev = points[index];
  const next = [...points];
  next[index] = {
    x: patch.x !== undefined ? patch.x : prev.x,
    y: patch.y !== undefined ? patch.y : prev.y,
    z: patch.z !== undefined ? patch.z : prev.z,
  };
  return next;
}

export type DeletePointResult =
  | { ok: true; points: Vec3[]; selectedIndex: number }
  | { ok: false; reason: string };

export function deleteShapePoint(
  points: Vec3[],
  index: number,
  minPoints: number,
): DeletePointResult {
  if (index < 0 || index >= points.length) {
    return { ok: false, reason: 'Invalid point.' };
  }
  if (points.length <= minPoints) {
    return {
      ok: false,
      reason: `Need at least ${minPoints} points. Delete the whole shape instead.`,
    };
  }
  const next = points.filter((_, i) => i !== index);
  const selectedIndex = Math.max(0, Math.min(index - 1, next.length - 1));
  return { ok: true, points: next, selectedIndex };
}

/** Insert a point after `afterIndex` (or at end if -1). */
export function insertShapePoint(
  points: Vec3[],
  afterIndex: number,
  pos: Vec3,
): { points: Vec3[]; selectedIndex: number } {
  const i = Math.max(-1, Math.min(afterIndex, points.length - 1));
  const next = [...points];
  next.splice(i + 1, 0, pos);
  return { points: next, selectedIndex: i + 1 };
}

/** Midpoint between point i and i+1 (wrap for closed polys). */
export function edgeMidpoint(
  points: Vec3[],
  edgeIndex: number,
  closed: boolean,
): Vec3 | null {
  if (points.length < 2) return null;
  const a = points[edgeIndex];
  const b = points[(edgeIndex + 1) % points.length];
  if (!closed && edgeIndex >= points.length - 1) return null;
  if (!a || !b) return null;
  return {
    x: Math.round((a.x + b.x) / 2),
    y: Math.round((a.y + b.y) / 2),
    z: Math.round((a.z + b.z) / 2),
  };
}

export function updateWallPoints(
  wall: WallBarrier,
  points: Vec3[],
): WallBarrier {
  return { ...wall, points };
}

export function updateWaterPoints(
  water: WaterRegion,
  points: Vec3[],
): WaterRegion {
  return { ...water, points };
}

export { MIN_WALL_POINTS, MIN_WATER_POINTS };
