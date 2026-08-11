import type { TrackDoc } from '../model/types';
import { loftTrack } from '../geometry/loft';
import { CLIP, LAYER, PATH_MAX_POINTS } from './constants';
import { meshToResources, pathsXml, sectionsXml, type SectionRow } from './xml';
import { zipStore } from './zip';

export type ExportResult = {
  filename: string;
  bytes: Uint8Array;
  stats: {
    sections: number;
    triangles: number;
    pathPoints: number;
    files: number;
  };
};

/** Default AI distance table cloned from CustomTrack / harbour. */
const AI_DISTANCE = [
  20, 5, 10, 15, 20, 25, 30, 35, 30, 25, 45, 65, 90, 115, 140, 165, 40, 3, 6, 16,
  46, 49, 59, 89, 50, 30, 60, 63, 73, 78, 108, 138,
];

export function exportTrack(doc: TrackDoc): ExportResult {
  const trackFolder = sanitizeName(doc.meta.debugName || doc.meta.name);
  const dir = `tracks/${trackFolder}`;
  const lofted = loftTrack(doc);

  if (lofted.path.length + 1 >= PATH_MAX_POINTS) {
    throw new Error(
      `path has ${lofted.path.length} points; engine scans at most ${PATH_MAX_POINTS}`,
    );
  }

  const files: [string, string][] = [];
  const sectionRows: SectionRow[] = [];
  let totalTris = 0;

  for (const sec of lofted.sections) {
    if (sec.tris.length === 0) continue;
    const mesh = meshToResources(dir, sec.name, sec.tris, sec.texture, {
      translucent: sec.layer === LAYER.TRANSLUCENT,
    });
    files.push(...mesh.files);
    sectionRows.push({
      gfx: mesh.gfxPath,
      surface: sec.surface,
      clip: sec.clip ?? CLIP.DEFAULT,
      layer: sec.layer ?? LAYER.OPAQUE,
    });
    totalTris += mesh.triangleCount;
  }

  if (sectionRows.length === 0) {
    throw new Error('export produced no mesh sections');
  }

  files.push([`${dir}/data_track_sections`, sectionsXml(sectionRows)]);
  const pathXml = pathsXml(lofted.path);
  if (!pathXml.includes('X="-32768"')) {
    throw new Error('path is missing terminating sentinel');
  }
  files.push([`${dir}/data_paths`, pathXml]);
  files.push([`${dir}/scene.json`, buildSceneJson(doc)]);
  files.push([
    'mods.toml',
    `[mod]\nname = "${doc.meta.modName}"\nversion = "1.0.0"\n`,
  ]);

  const enc = new TextEncoder();
  const zip = zipStore(
    files.map(([name, text]) => ({ name, data: enc.encode(text) })),
  );

  return {
    filename: `${doc.meta.modName}.o2r`,
    bytes: zip,
    stats: {
      sections: sectionRows.length,
      triangles: totalTris,
      pathPoints: lofted.path.length,
      files: files.length,
    },
  };
}

function sanitizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 48) || 'track';
}

function buildSceneJson(doc: TrackDoc): string {
  const actors = (doc.actors ?? []).map((a) => ({
    Name: a.name,
    Location: {
      x: a.location.x,
      y: a.location.y,
      z: a.location.z,
    },
  }));

  // Prefer the lowest water region surface as the track WaterLevel (splash / FX).
  let waterLevel = doc.env.waterLevel;
  const waters = doc.water ?? [];
  if (waters.length > 0) {
    waterLevel = Math.min(...waters.map((w) => w.y));
  }

  const scene = {
    Props: {
      ResourceName: doc.meta.resourceName,
      Name: doc.meta.name,
      DebugName: doc.meta.debugName,
      TrackLength: doc.meta.trackLength,
      AIDistance: AI_DISTANCE,
      AIMaximumSeparation: 50.0,
      AIMinimumSeparation: 0.30000001192092896,
      AISteeringSensitivity: 48,
      CurveTargetSpeed: [4.166666507720947, 5.583333492279053, 6.166666507720947, 6.75],
      NormalTargetSpeed: [3.75, 5.166666507720947, 5.75, 6.333333492279053],
      D_0D0096B8: [3.3333332538604736, 3.9166667461395264, 4.5, 5.083333492279053],
      OffTrackTargetSpeed: [3.75, 5.166666507720947, 5.75, 6.333333492279053],
      NearPersp: 3.0,
      FarPersp: 6800.0,
      LakituTowType: 0,
      Sequence: doc.env.sequence,
      WaterLevel: waterLevel,
      Skybox: doc.env.skybox,
      MinimapColour: doc.env.minimapColour,
      MinimapPosition: [257, 170],
      MinimapPosition2P: [5, 0],
      MinimapPlayerX: 0,
      MinimapPlayerY: 0,
      MinimapPlayerScaleFactor: 0.22,
      MinimapFinishlineX: 0.0,
      MinimapFinishlineY: 0.0,
    },
    Actors: actors,
    StaticMeshActors: null,
  };
  return JSON.stringify(scene, null, 2);
}

export function downloadExport(result: ExportResult): void {
  const blob = new Blob([result.bytes], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = result.filename;
  a.click();
  URL.revokeObjectURL(url);
}
