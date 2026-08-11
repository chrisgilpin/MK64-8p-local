import type { TrackDoc, ValidationIssue, ValidationTarget } from '../model/types';
import { COORD_LIMIT, PATH_MAX_POINTS, SPAWN_Z_EXTENT } from '../export/constants';
import { buildPath, loftTrack } from '../geometry/loft';

function applies(issueTarget: ValidationTarget | undefined, mode: ValidationTarget): boolean {
  if (!issueTarget || issueTarget === 'both') return true;
  if (mode === 'both') return true;
  return issueTarget === mode;
}

export function validateTrack(
  doc: TrackDoc,
  mode: ValidationTarget = 'both',
): ValidationIssue[] {
  const raw: ValidationIssue[] = [];
  const knots = doc.spline.knots;

  if (knots.length < 3) {
    raw.push({
      level: 'error',
      code: 'spline_too_short',
      message: 'Track needs at least 3 knots to form a loop.',
    });
  }

  if (!doc.meta.resourceName.includes(':')) {
    raw.push({
      level: 'error',
      code: 'resource_name',
      message: 'Resource name must be "author:track" (e.g. user:my_track).',
    });
  }

  if (!doc.meta.modName.trim()) {
    raw.push({
      level: 'error',
      code: 'mod_name',
      message: 'Mod name is required (used for the .o2r filename).',
    });
  }

  // First knot near origin
  const first = knots[0];
  if (first && (Math.abs(first.x) > 50 || Math.abs(first.z) > 50)) {
    raw.push({
      level: 'warning',
      code: 'start_origin',
      message:
        'First path point is far from the origin. Spawn/progress work best with the start near (0,0,0).',
    });
  }

  // Heading −Z from first to second
  if (knots.length >= 2) {
    const dx = knots[1].x - knots[0].x;
    const dz = knots[1].z - knots[0].z;
    if (dz >= 0 || Math.abs(dz) < Math.abs(dx) * 0.5) {
      raw.push({
        level: 'warning',
        code: 'start_heading',
        message:
          'Start direction should head roughly −Z (negative Z). CPUs may turn off the track otherwise.',
      });
    }
  }

  // Coordinate limits
  for (const k of knots) {
    if (
      Math.abs(k.x) > COORD_LIMIT ||
      Math.abs(k.y) > COORD_LIMIT ||
      Math.abs(k.z) > COORD_LIMIT
    ) {
      raw.push({
        level: 'error',
        code: 'coord_limit',
        message: `Knot (${k.x}, ${k.y}, ${k.z}) exceeds ±${COORD_LIMIT}.`,
      });
      break;
    }
  }

  // Segment count
  if (doc.segments.length !== knots.length && knots.length > 0) {
    raw.push({
      level: 'error',
      code: 'segment_count',
      message: `Need one segment per span (${knots.length} knots → ${knots.length} segments); have ${doc.segments.length}.`,
    });
  }

  // Start width
  const startSeg = doc.segments[0];
  if (startSeg) {
    const width = startSeg.widthLeft + startSeg.widthRight;
    if (width < 400) {
      raw.push({
        level: 'warning',
        code: 'start_width_stock',
        message: `Start width ${width} is narrow (recommend ≥400 game units / ~1.0 Blender unit each side).`,
        target: 'stock',
      });
    }
    if (width < 600) {
      raw.push({
        level: 'warning',
        code: 'start_width_8p',
        message: `Start width ${width} may be tight for 8 karts (recommend ≥600 game units).`,
        target: '8p',
      });
    }
  }

  // Path / loft checks
  try {
    const path = buildPath(doc);
    if (path.length + 1 >= PATH_MAX_POINTS) {
      raw.push({
        level: 'error',
        code: 'path_too_long',
        message: `Path has ${path.length} points; engine limit is ${PATH_MAX_POINTS - 1}.`,
      });
    }

    // Racing −Z: behind the start is +Z. Lap logic requires the *tail* of the
    // path to sit behind the line (export adds these if missing).
    const startZ = first?.z ?? 0;
    const tail = path.slice(Math.max(0, path.length - 15));
    const tailBehind = tail.filter((p) => p.z > startZ + 20).length;
    if (tailBehind < 5) {
      raw.push({
        level: 'warning',
        code: 'behind_start',
        message:
          'Path does not end behind the start line (+Z). Laps may not count when you cross the finish — re-export after updating the editor.',
      });
    }

    // Early path should head −Z
    if (path.length >= 4) {
      let sumDz = 0;
      for (let i = 1; i <= Math.min(8, path.length - 1); i++) {
        sumDz += path[i].z - path[0].z;
      }
      if (sumDz > 0) {
        raw.push({
          level: 'warning',
          code: 'path_heading',
          message:
            'Race path heads +Z from the start. Move knot 1 toward −Z so the first stretch leaves the start line forward.',
        });
      }
    }

    const lofted = loftTrack(doc);
    const triCount = lofted.sections.reduce((n, s) => n + s.tris.length, 0);
    if (triCount > 100_000) {
      raw.push({
        level: 'warning',
        code: 'tri_budget',
        message: `${triCount} triangles — SpaghettiKart may lose FPS past ~100k.`,
        target: 'stock',
      });
    }
    if (triCount > 60_000) {
      raw.push({
        level: 'warning',
        code: 'tri_budget_8p',
        message: `${triCount} triangles may be heavy for 8-player split-screen.`,
        target: '8p',
      });
    }

    // Spawn mesh coverage
    const minZ = lofted.bounds.minZ;
    if (minZ > SPAWN_Z_EXTENT) {
      raw.push({
        level: 'error',
        code: 'spawn_coverage',
        message: `Drivable mesh only extends to z=${Math.round(minZ)}; need mesh to z≈${SPAWN_Z_EXTENT} for spawns.`,
      });
    } else if (minZ > SPAWN_Z_EXTENT - 100) {
      raw.push({
        level: 'warning',
        code: 'spawn_apron_8p',
        message: 'Spawn apron is short; 8 players need clear road behind the start line.',
        target: '8p',
      });
    }
  } catch (e) {
    raw.push({
      level: 'error',
      code: 'loft_failed',
      message: e instanceof Error ? e.message : String(e),
    });
  }

  // Texture power-of-two
  for (let i = 0; i < doc.segments.length; i++) {
    const tex = doc.segments[i].texture;
    if (!isPow2(tex.width) || !isPow2(tex.height)) {
      raw.push({
        level: 'error',
        code: 'texture_pow2',
        message: `Segment ${i} texture ${tex.path} is ${tex.width}×${tex.height}; must be power-of-two.`,
      });
    }
  }

  return raw.filter((issue) => applies(issue.target, mode));
}

function isPow2(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
}

export function canExport(issues: ValidationIssue[]): boolean {
  return !issues.some((i) => i.level === 'error');
}
