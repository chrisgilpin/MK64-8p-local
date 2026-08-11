import type { TrackDoc } from '../model/types';
import { loftTrack } from '../geometry/loft';
import type { MeshVertex } from '../export/xml';

export type GroundHit = {
  y: number;
  /** Approximate up-component of the surface normal (1 = flat). */
  ny: number;
};

type Tri = {
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  cx: number;
  cy: number;
  cz: number;
  /** AABB for quick reject. */
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

/**
 * Build a raycast-friendly triangle soup from driveable loft meshes
 * (road, apron, ground fill — not walls).
 */
export function buildGroundTris(doc: TrackDoc): Tri[] {
  const lofted = loftTrack(doc);
  const tris: Tri[] = [];
  for (const sec of lofted.sections) {
    // Skip pure wall collision meshes
    if (sec.clip === 2 || sec.clip === 4) continue;
    if (sec.name === 'perimeter_walls' || sec.name === 'barrier_walls') continue;
    // Water is "ground" for height but we'll flag via surface if needed
    for (const t of sec.tris) {
      const [a, b, c] = t.v;
      tris.push(makeTri(a, b, c));
    }
  }
  return tris;
}

function makeTri(a: MeshVertex, b: MeshVertex, c: MeshVertex): Tri {
  return {
    ax: a.x,
    ay: a.y,
    az: a.z,
    bx: b.x,
    by: b.y,
    bz: b.z,
    cx: c.x,
    cy: c.y,
    cz: c.z,
    minX: Math.min(a.x, b.x, c.x),
    maxX: Math.max(a.x, b.x, c.x),
    minZ: Math.min(a.z, b.z, c.z),
    maxZ: Math.max(a.z, b.z, c.z),
  };
}

/**
 * Vertical ray from +Y: highest hit under (x,z).
 * Returns null if nothing is under the point.
 */
export function queryGround(
  tris: Tri[],
  x: number,
  z: number,
): GroundHit | null {
  let bestY = -Infinity;
  let bestNy = 1;
  let hit = false;

  for (const t of tris) {
    if (x < t.minX - 1 || x > t.maxX + 1 || z < t.minZ - 1 || z > t.maxZ + 1) {
      continue;
    }
    const y = rayTriY(t, x, z);
    if (y == null) continue;
    if (y > bestY) {
      bestY = y;
      bestNy = normalY(t);
      hit = true;
    }
  }
  if (!hit) return null;
  return { y: bestY, ny: bestNy };
}

function rayTriY(t: Tri, x: number, z: number): number | null {
  // Barycentric in XZ plane
  const v0x = t.cx - t.ax;
  const v0z = t.cz - t.az;
  const v1x = t.bx - t.ax;
  const v1z = t.bz - t.az;
  const v2x = x - t.ax;
  const v2z = z - t.az;
  const dot00 = v0x * v0x + v0z * v0z;
  const dot01 = v0x * v1x + v0z * v1z;
  const dot02 = v0x * v2x + v0z * v2z;
  const dot11 = v1x * v1x + v1z * v1z;
  const dot12 = v1x * v2x + v1z * v2z;
  const inv = 1 / (dot00 * dot11 - dot01 * dot01 + 1e-12);
  const u = (dot11 * dot02 - dot01 * dot12) * inv;
  const v = (dot00 * dot12 - dot01 * dot02) * inv;
  if (u < -0.001 || v < -0.001 || u + v > 1.001) return null;
  // Interpolate Y
  return t.ay + v * (t.by - t.ay) + u * (t.cy - t.ay);
}

function normalY(t: Tri): number {
  const e1x = t.bx - t.ax;
  const e1y = t.by - t.ay;
  const e1z = t.bz - t.az;
  const e2x = t.cx - t.ax;
  const e2y = t.cy - t.ay;
  const e2z = t.cz - t.az;
  const nx = e1y * e2z - e1z * e2y;
  const ny = e1z * e2x - e1x * e2z;
  const nz = e1x * e2y - e1y * e2x;
  const len = Math.hypot(nx, ny, nz) || 1;
  return Math.abs(ny / len);
}
