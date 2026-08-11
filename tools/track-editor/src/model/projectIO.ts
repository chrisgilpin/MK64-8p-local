/**
 * Work-in-progress project save/load.
 *
 * File format: JSON TrackDoc with a small envelope so we can version it.
 * Extension: .mk64track.json (also accepts plain .json that looks like a TrackDoc).
 */

import {
  DEFAULT_APRON_TEXTURE,
  DEFAULT_TEXTURE,
  DEFAULT_WATER_TEXTURE,
  type ActorPlacement,
  type GroundFill,
  type Segment,
  type SurfaceType,
  type TrackDoc,
  type TrackMeta,
  type Vec3,
  type WallBarrier,
  type WallMode,
  type WaterRegion,
} from './types';
import {
  deriveStyleBreaksFromValues,
  healAllManualStyleFlags,
} from './segmentStyle';

export const PROJECT_FORMAT = 'mk64track';
export const PROJECT_FORMAT_VERSION = 1;
export const PROJECT_EXTENSION = '.mk64track.json';

export type ProjectFile = {
  format: typeof PROJECT_FORMAT;
  formatVersion: number;
  savedAt: string;
  doc: TrackDoc;
};

export type LoadResult =
  | { ok: true; doc: TrackDoc; warnings: string[] }
  | { ok: false; error: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asNumber(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function asString(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}

function asVec3(v: unknown, fallback: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
  if (!isRecord(v)) return { ...fallback };
  return {
    x: asNumber(v.x, fallback.x),
    y: asNumber(v.y, fallback.y),
    z: asNumber(v.z, fallback.z),
  };
}

function asTexture(v: unknown) {
  if (!isRecord(v)) return { ...DEFAULT_TEXTURE };
  return {
    path: asString(v.path, DEFAULT_TEXTURE.path),
    width: asNumber(v.width, DEFAULT_TEXTURE.width),
    height: asNumber(v.height, DEFAULT_TEXTURE.height),
    bpp: asNumber(v.bpp, DEFAULT_TEXTURE.bpp),
  };
}

function asSurface(v: unknown, fallback: SurfaceType = 'asphalt'): SurfaceType {
  return typeof v === 'string' ? (v as SurfaceType) : fallback;
}

function asWallMode(v: unknown): WallMode {
  if (v === 'left' || v === 'right' || v === 'both' || v === 'none') return v;
  return 'none';
}

function defaultGroundFill(): GroundFill {
  return {
    enabled: true,
    padding: 1200,
    y: 0,
    surface: 'grass',
    texture: { ...DEFAULT_APRON_TEXTURE },
    cellSize: 200,
    perimeterWalls: true,
    perimeterWallHeight: 120,
  };
}

function normalizeSegment(raw: unknown, i: number): Segment {
  const r = isRecord(raw) ? raw : {};
  // Flags may be missing on legacy projects; filled in after the full array
  // is known (derive from value changes / heal all-manual).
  const hasManualFlags =
    typeof r.textureManual === 'boolean' || typeof r.wallManual === 'boolean';
  const seg: Segment = {
    widthLeft: asNumber(r.widthLeft, 250),
    widthRight: asNumber(r.widthRight, 250),
    bank: asNumber(r.bank, 0),
    surface: asSurface(r.surface, 'asphalt'),
    texture: asTexture(r.texture),
    textureManual: hasManualFlags
      ? Boolean(r.textureManual) || i === 0
      : i === 0,
    wall: asWallMode(r.wall),
    wallHeight: asNumber(r.wallHeight, 80),
    wallManual: hasManualFlags ? Boolean(r.wallManual) || i === 0 : i === 0,
  };
  if (isRecord(r.rampKick)) {
    seg.rampKick = {
      liftHeight: asNumber(r.rampKick.liftHeight, 120),
      lipLength: asNumber(r.rampKick.lipLength, 300),
    };
  }
  return seg;
}

/**
 * Coerce arbitrary JSON into a valid TrackDoc, filling missing fields.
 */
export function normalizeTrackDoc(raw: unknown): {
  doc: TrackDoc;
  warnings: string[];
} {
  const warnings: string[] = [];
  const root = isRecord(raw) ? raw : {};

  // Accept either { doc: TrackDoc } envelope or bare TrackDoc
  const body = isRecord(root.doc) ? root.doc : root;

  if (!isRecord(body.meta) && !isRecord(body.spline)) {
    throw new Error(
      'Not a track project: expected TrackDoc fields (meta, spline, segments).',
    );
  }

  const metaRaw = isRecord(body.meta) ? body.meta : {};
  const meta: TrackMeta = {
    name: asString(metaRaw.name, 'Untitled Track'),
    resourceName: asString(metaRaw.resourceName, 'user:untitled'),
    debugName: asString(metaRaw.debugName, 'untitled'),
    trackLength: asString(metaRaw.trackLength, '100m'),
    modName: asString(metaRaw.modName, 'untitled-track'),
  };

  const splineRaw = isRecord(body.spline) ? body.spline : {};
  let knots: Vec3[] = Array.isArray(splineRaw.knots)
    ? splineRaw.knots.map((k) => asVec3(k))
    : [];
  if (knots.length < 3) {
    warnings.push('Project had fewer than 3 knots; padded to a minimal triangle.');
    while (knots.length < 3) {
      knots.push({
        x: knots.length * 200,
        y: 0,
        z: -knots.length * 200,
      });
    }
  }
  // Pin start
  knots[0] = { x: 0, y: knots[0]?.y ?? 0, z: 0 };

  const rawSegList = Array.isArray(body.segments) ? body.segments : [];
  const hadAnyStyleFlags = rawSegList.some(
    (s) =>
      isRecord(s) &&
      (typeof s.textureManual === 'boolean' ||
        typeof s.wallManual === 'boolean'),
  );

  let segments: Segment[] = rawSegList.map((s, i) => normalizeSegment(s, i));
  while (segments.length < knots.length) {
    segments.push(normalizeSegment({}, segments.length));
    warnings.push('Added missing segment(s) to match knot count.');
  }
  if (segments.length > knots.length) {
    segments = segments.slice(0, knots.length);
    warnings.push('Trimmed extra segments to match knot count.');
  }

  // Legacy files without textureManual/wallManual: treat value changes as breaks
  // so distinct textures stay distinct, but identical runs inherit.
  if (!hadAnyStyleFlags && segments.length > 0) {
    segments = deriveStyleBreaksFromValues(segments);
  } else {
    // Autosaves that marked every segment manual (old normalize) — heal.
    segments = healAllManualStyleFlags(segments);
  }

  const decorRaw = isRecord(body.decor) ? body.decor : {};
  const gfRaw = isRecord(decorRaw.groundFill)
    ? decorRaw.groundFill
    : defaultGroundFill();
  const groundFill: GroundFill = {
    enabled: typeof gfRaw.enabled === 'boolean' ? gfRaw.enabled : true,
    padding: asNumber(gfRaw.padding, 1200),
    y: asNumber(gfRaw.y, 0),
    surface: asSurface(gfRaw.surface, 'grass'),
    texture: asTexture(gfRaw.texture ?? DEFAULT_APRON_TEXTURE),
    cellSize: Math.max(40, asNumber(gfRaw.cellSize, 200)),
    perimeterWalls:
      typeof gfRaw.perimeterWalls === 'boolean' ? gfRaw.perimeterWalls : true,
    perimeterWallHeight: asNumber(gfRaw.perimeterWallHeight, 120),
  };

  const envRaw = isRecord(body.env) ? body.env : {};
  const skybox = Array.isArray(envRaw.skybox)
    ? (envRaw.skybox as number[]).map((n) => asNumber(n, 0))
    : [
        66, 179, 246, 255, 118, 118, 0, 198, 255, 0, 180, 255, 0, 96, 255, 0, 96,
        255, 0, 96, 255, 0, 96, 255,
      ];
  const minimapColour = Array.isArray(envRaw.minimapColour)
    ? ([
        asNumber((envRaw.minimapColour as number[])[0], 255),
        asNumber((envRaw.minimapColour as number[])[1], 255),
        asNumber((envRaw.minimapColour as number[])[2], 255),
      ] as [number, number, number])
    : ([255, 255, 255] as [number, number, number]);

  const actors: ActorPlacement[] = Array.isArray(body.actors)
    ? body.actors
        .filter(isRecord)
        .map((a, i) => ({
          id: asString(a.id, `a_${i}`),
          name: asString(a.name, 'mk:item_box'),
          location: asVec3(a.location),
        }))
    : [];

  const walls: WallBarrier[] = Array.isArray(body.walls)
    ? body.walls
        .filter(isRecord)
        .map((w, i) => ({
          id: asString(w.id, `w_${i}`),
          height: asNumber(w.height, 100),
          points: Array.isArray(w.points)
            ? w.points.map((p) => asVec3(p))
            : [],
        }))
        .filter((w) => w.points.length >= 2)
    : [];

  const water: WaterRegion[] = Array.isArray(body.water)
    ? body.water
        .filter(isRecord)
        .map((w, i) => ({
          id: asString(w.id, `water_${i}`),
          y: asNumber(w.y, -20),
          texture: asTexture(w.texture ?? DEFAULT_WATER_TEXTURE),
          points: Array.isArray(w.points)
            ? w.points.map((p) => asVec3(p))
            : [],
        }))
        .filter((w) => w.points.length >= 3)
    : [];

  const version = body.version === 1 ? 1 : 1;
  if (body.version != null && body.version !== 1) {
    warnings.push(
      `Unknown doc.version ${String(body.version)}; loaded as version 1.`,
    );
  }

  const doc: TrackDoc = {
    version,
    meta,
    spline: { knots, closed: true },
    segments,
    decor: {
      apronWidth: asNumber(decorRaw.apronWidth, 100),
      apronSurface: asSurface(decorRaw.apronSurface, 'grass'),
      apronTexture: asTexture(decorRaw.apronTexture ?? DEFAULT_APRON_TEXTURE),
      groundFill,
    },
    env: {
      waterLevel: asNumber(envRaw.waterLevel, -10000),
      sequence: asNumber(envRaw.sequence, 6),
      skybox,
      minimapColour,
    },
    actors,
    walls,
    water,
  };

  return { doc, warnings };
}

export function serializeProject(doc: TrackDoc): ProjectFile {
  return {
    format: PROJECT_FORMAT,
    formatVersion: PROJECT_FORMAT_VERSION,
    savedAt: new Date().toISOString(),
    doc: structuredClone(doc),
  };
}

export function projectToJson(doc: TrackDoc): string {
  return JSON.stringify(serializeProject(doc), null, 2);
}

export function parseProjectJson(text: string): LoadResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: 'File is not valid JSON.' };
  }

  try {
    if (isRecord(data) && data.format != null && data.format !== PROJECT_FORMAT) {
      return {
        ok: false,
        error: `Unknown format "${String(data.format)}" (expected "${PROJECT_FORMAT}").`,
      };
    }
    const { doc, warnings } = normalizeTrackDoc(data);
    return { ok: true, doc, warnings };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export function projectFilename(doc: TrackDoc): string {
  const base = (doc.meta.debugName || doc.meta.modName || 'track')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 48);
  return `${base || 'track'}${PROJECT_EXTENSION}`;
}

export function downloadProject(doc: TrackDoc): string {
  const json = projectToJson(doc);
  const name = projectFilename(doc);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
  return name;
}

export async function readProjectFile(file: File): Promise<LoadResult> {
  const text = await file.text();
  return parseProjectJson(text);
}

/** Optional browser autosave key. */
export const AUTOSAVE_KEY = 'mk64-track-editor:autosave';

export function writeAutosave(doc: TrackDoc): void {
  try {
    localStorage.setItem(AUTOSAVE_KEY, projectToJson(doc));
  } catch {
    /* quota / private mode */
  }
}

export function readAutosave(): LoadResult | null {
  try {
    const text = localStorage.getItem(AUTOSAVE_KEY);
    if (!text) return null;
    return parseProjectJson(text);
  } catch {
    return null;
  }
}

export function clearAutosave(): void {
  try {
    localStorage.removeItem(AUTOSAVE_KEY);
  } catch {
    /* ignore */
  }
}
