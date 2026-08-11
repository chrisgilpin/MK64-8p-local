import { describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';
import { createDefaultOval } from '../model/defaults';
import { DEFAULT_WATER_TEXTURE, SURFACE_IDS } from '../model/types';
import { exportTrack } from '../export/exportTrack';
import { loftTrack, triangulatePolygonXZ } from './loft';
import { CLIP, LAYER } from '../export/constants';

describe('water regions', () => {
  it('triangulates a simple quad into 4 fan triangles', () => {
    const pts = [
      { x: 0, y: 0, z: 0 },
      { x: 100, y: 0, z: 0 },
      { x: 100, y: 0, z: 100 },
      { x: 0, y: 0, z: 100 },
    ];
    const tris = triangulatePolygonXZ(pts, -10);
    expect(tris.length).toBe(4);
    for (const t of tris) {
      expect(t.v.every((v) => v.y === -10)).toBe(true);
    }
  });

  it('lofts water with WATER_SURFACE and translucent layer', () => {
    const doc = createDefaultOval();
    doc.water = [
      {
        id: 'lake1',
        y: -15,
        texture: { ...DEFAULT_WATER_TEXTURE },
        points: [
          { x: 500, y: 0, z: -500 },
          { x: 900, y: 0, z: -500 },
          { x: 900, y: 0, z: -100 },
          { x: 500, y: 0, z: -100 },
        ],
      },
    ];
    const lofted = loftTrack(doc);
    const water = lofted.sections.find((s) => s.name.startsWith('water_'));
    expect(water).toBeTruthy();
    expect(water!.surface).toBe(SURFACE_IDS.water);
    expect(water!.layer).toBe(LAYER.TRANSLUCENT);
    expect(water!.tris.length).toBeGreaterThan(0);
  });

  it('exports water section and sets WaterLevel from region Y', () => {
    const doc = createDefaultOval();
    doc.water = [
      {
        id: 'lake1',
        y: -30,
        texture: { ...DEFAULT_WATER_TEXTURE },
        points: [
          { x: 0, y: 0, z: -800 },
          { x: 400, y: 0, z: -800 },
          { x: 200, y: 0, z: -400 },
        ],
      },
    ];
    const result = exportTrack(doc);
    const files = unzipSync(result.bytes);
    const secName = Object.keys(files).find((n) => n.endsWith('data_track_sections'))!;
    const text = new TextDecoder().decode(files[secName]);
    expect(text).toContain('water_0');
    expect(text).toContain(`surface="${SURFACE_IDS.water}"`);
    expect(text).toContain(`drawlayer="${LAYER.TRANSLUCENT}"`);
    expect(text).toContain(`flags="${CLIP.DEFAULT}"`);

    const sceneName = Object.keys(files).find((n) => n.endsWith('scene.json'))!;
    const scene = JSON.parse(new TextDecoder().decode(files[sceneName]));
    expect(scene.Props.WaterLevel).toBe(-30);
  });
});
