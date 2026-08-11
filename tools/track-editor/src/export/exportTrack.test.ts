import { describe, expect, it } from 'vitest';
import { createDefaultOval, createSpikeLikeDoc } from '../model/defaults';
import { exportTrack } from './exportTrack';
import { validateTrack, canExport } from '../validate/validate';
import { VTX_BATCH, CLIP } from './constants';
import { meshToResources } from './xml';
import { DEFAULT_TEXTURE } from '../model/types';
import { unzipSync } from 'fflate';

describe('mesh batching', () => {
  it('keeps every LoadVertices Count ≤ 32', () => {
    const tris = Array.from({ length: 50 }, (_, i) => {
      const x = i * 10;
      return {
        v: [
          { x, y: 0, z: 0, s: 0, t: 0 },
          { x: x + 10, y: 0, z: 0, s: 1, t: 0 },
          { x, y: 0, z: 10, s: 0, t: 1 },
        ] as [
          { x: number; y: number; z: number; s: number; t: number },
          { x: number; y: number; z: number; s: number; t: number },
          { x: number; y: number; z: number; s: number; t: number },
        ],
      };
    });
    const mesh = meshToResources('tracks/t', 'road', tris, DEFAULT_TEXTURE);
    const triXml = mesh.files.find(([n]) => n.endsWith('_tri_0'))![1];
    const counts = [...triXml.matchAll(/Count="(\d+)"/g)].map((m) => Number(m[1]));
    expect(counts.length).toBeGreaterThan(0);
    for (const c of counts) expect(c).toBeLessThanOrEqual(VTX_BATCH);
  });

  it('uses Triangle1 V00/V01/V02 attributes', () => {
    const tris = [
      {
        v: [
          { x: 0, y: 0, z: 0, s: 0, t: 0 },
          { x: 1, y: 0, z: 0, s: 1, t: 0 },
          { x: 0, y: 0, z: 1, s: 0, t: 1 },
        ] as [
          { x: number; y: number; z: number; s: number; t: number },
          { x: number; y: number; z: number; s: number; t: number },
          { x: number; y: number; z: number; s: number; t: number },
        ],
      },
    ];
    const mesh = meshToResources('tracks/t', 'road', tris, DEFAULT_TEXTURE);
    const triXml = mesh.files.find(([n]) => n.endsWith('_tri_0'))![1];
    expect(triXml).toContain('Triangle1 V00=');
    expect(triXml).not.toMatch(/Triangle1 V0="/);
  });
});

describe('exportTrack', () => {
  it('exports a valid o2r structure for the default oval', () => {
    const doc = createDefaultOval();
    const result = exportTrack(doc);
    expect(result.filename).toBe('new-track.o2r');
    expect(result.bytes.byteLength).toBeGreaterThan(100);

    const files = unzipSync(result.bytes);
    const names = Object.keys(files);
    expect(names).toContain('mods.toml');
    expect(names.some((n) => n.endsWith('data_track_sections'))).toBe(true);
    expect(names.some((n) => n.endsWith('data_paths'))).toBe(true);
    expect(names.some((n) => n.endsWith('scene.json'))).toBe(true);

    const pathName = names.find((n) => n.endsWith('data_paths'))!;
    const pathText = new TextDecoder().decode(files[pathName]);
    expect(pathText).toContain('X="-32768"');
    expect(pathText).toContain('TrackWaypoint');

    const secName = names.find((n) => n.endsWith('data_track_sections'))!;
    const secText = new TextDecoder().decode(files[secName]);
    expect(secText).toContain(`flags="${CLIP.DEFAULT}"`);
  });

  it('spike-like doc exports without errors', () => {
    const doc = createSpikeLikeDoc();
    const issues = validateTrack(doc, 'both');
    const errors = issues.filter((i) => i.level === 'error');
    expect(errors).toEqual([]);
    expect(canExport(issues)).toBe(true);
    const result = exportTrack(doc);
    expect(result.stats.pathPoints).toBeGreaterThan(10);
    expect(result.stats.triangles).toBeGreaterThan(0);
  });

  it('includes path sentinel and stays under point limit', () => {
    const doc = createDefaultOval();
    const result = exportTrack(doc);
    const files = unzipSync(result.bytes);
    const pathName = Object.keys(files).find((n) => n.endsWith('data_paths'))!;
    const text = new TextDecoder().decode(files[pathName]);
    const points = (text.match(/<Point /g) || []).length;
    // includes sentinel
    expect(points).toBe(result.stats.pathPoints + 1);
    expect(points).toBeLessThan(0x7d0);
  });

  it('writes Actors into scene.json', () => {
    const doc = createDefaultOval();
    doc.actors = [
      {
        id: 't1',
        name: 'mk:tree_mario_raceway',
        location: { x: 100, y: 0, z: -200 },
      },
      {
        id: 'b1',
        name: 'mk:item_box',
        location: { x: 50, y: 10, z: -100 },
      },
    ];
    const result = exportTrack(doc);
    const files = unzipSync(result.bytes);
    const sceneName = Object.keys(files).find((n) => n.endsWith('scene.json'))!;
    const scene = JSON.parse(new TextDecoder().decode(files[sceneName]));
    expect(scene.Actors).toHaveLength(2);
    expect(scene.Actors[0].Name).toBe('mk:tree_mario_raceway');
    expect(scene.Actors[0].Location).toEqual({ x: 100, y: 0, z: -200 });
    expect(scene.Actors[1].Name).toBe('mk:item_box');
  });

  it('emits double-sided wall clip for wall segments', () => {
    const doc = createDefaultOval();
    doc.segments[0] = { ...doc.segments[0], wall: 'both', wallHeight: 100 };
    const result = exportTrack(doc);
    const files = unzipSync(result.bytes);
    const secName = Object.keys(files).find((n) => n.endsWith('data_track_sections'))!;
    const text = new TextDecoder().decode(files[secName]);
    expect(text).toContain(`flags="${CLIP.DOUBLE_SIDED_WALL}"`);
  });

  it('emits ground fill and freehand walls by default', () => {
    const doc = createDefaultOval();
    doc.walls = [
      {
        id: 'w1',
        height: 90,
        points: [
          { x: 0, y: 0, z: 0 },
          { x: 200, y: 0, z: -100 },
          { x: 400, y: 0, z: 0 },
        ],
      },
    ];
    const result = exportTrack(doc);
    expect(result.stats.sections).toBeGreaterThan(1);
    const files = unzipSync(result.bytes);
    const secName = Object.keys(files).find((n) => n.endsWith('data_track_sections'))!;
    const text = new TextDecoder().decode(files[secName]);
    expect(text).toContain('ground_fill');
    expect(text).toContain('barrier_walls');
    expect(text).toContain(`flags="${CLIP.DOUBLE_SIDED_WALL}"`);
  });
});

describe('validateTrack', () => {
  it('flags bad resource name', () => {
    const doc = createDefaultOval();
    doc.meta.resourceName = 'badname';
    const issues = validateTrack(doc);
    expect(issues.some((i) => i.code === 'resource_name')).toBe(true);
  });

  it('8p mode surfaces start-width warnings when narrow', () => {
    const doc = createDefaultOval();
    doc.segments.forEach((s) => {
      s.widthLeft = 100;
      s.widthRight = 100;
    });
    const stock = validateTrack(doc, 'stock');
    const eight = validateTrack(doc, '8p');
    expect(eight.some((i) => i.code === 'start_width_8p')).toBe(true);
    // stock warning threshold is lower
    expect(
      stock.some((i) => i.code === 'start_width_stock') ||
        eight.some((i) => i.code === 'start_width_8p'),
    ).toBe(true);
  });
});
