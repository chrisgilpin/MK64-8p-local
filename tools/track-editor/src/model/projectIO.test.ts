import { describe, expect, it } from 'vitest';
import { createDefaultOval, createSpikeLikeDoc } from './defaults';
import {
  parseProjectJson,
  projectToJson,
  serializeProject,
  normalizeTrackDoc,
} from './projectIO';

describe('projectIO', () => {
  it('round-trips a default oval', () => {
    const doc = createDefaultOval();
    doc.meta.name = 'My Loop';
    doc.actors = [
      {
        id: 'a1',
        name: 'mk:item_box',
        location: { x: 10, y: 0, z: -100 },
      },
    ];
    doc.walls = [
      {
        id: 'w1',
        height: 80,
        points: [
          { x: 0, y: 0, z: 0 },
          { x: 100, y: 0, z: -50 },
        ],
      },
    ];
    const json = projectToJson(doc);
    const result = parseProjectJson(json);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.meta.name).toBe('My Loop');
    expect(result.doc.actors).toHaveLength(1);
    expect(result.doc.walls).toHaveLength(1);
    expect(result.doc.spline.knots.length).toBe(doc.spline.knots.length);
    expect(result.doc.segments.length).toBe(doc.spline.knots.length);
  });

  it('loads a bare TrackDoc without envelope', () => {
    const doc = createSpikeLikeDoc();
    const result = parseProjectJson(JSON.stringify(doc));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.meta.debugName).toBe('spike');
  });

  it('fills missing groundFill and water arrays', () => {
    const raw = {
      version: 1,
      meta: {
        name: 'Old',
        resourceName: 'user:old',
        debugName: 'old',
        trackLength: '100m',
        modName: 'old',
      },
      spline: {
        closed: true,
        knots: [
          { x: 0, y: 0, z: 0 },
          { x: 0, y: 0, z: -400 },
          { x: 400, y: 0, z: -400 },
        ],
      },
      segments: [],
      decor: { apronWidth: 50 },
      env: {},
    };
    const { doc, warnings } = normalizeTrackDoc(raw);
    expect(doc.segments.length).toBe(3);
    expect(doc.decor.groundFill.enabled).toBe(true);
    expect(doc.water).toEqual([]);
    expect(doc.walls).toEqual([]);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('legacy segments without style flags derive breaks from texture changes', () => {
    const raw = {
      version: 1,
      meta: {
        name: 'Legacy',
        resourceName: 'user:legacy',
        debugName: 'legacy',
        trackLength: '100m',
        modName: 'legacy',
      },
      spline: {
        closed: true,
        knots: [
          { x: 0, y: 0, z: 0 },
          { x: 0, y: 0, z: -400 },
          { x: 400, y: 0, z: -400 },
          { x: 400, y: 0, z: 0 },
        ],
      },
      segments: [
        {
          widthLeft: 250,
          widthRight: 250,
          bank: 0,
          surface: 'asphalt',
          texture: {
            path: 'textures/a',
            width: 32,
            height: 32,
            bpp: 16,
          },
          wall: 'none',
          wallHeight: 80,
        },
        {
          widthLeft: 250,
          widthRight: 250,
          bank: 0,
          surface: 'asphalt',
          texture: {
            path: 'textures/a',
            width: 32,
            height: 32,
            bpp: 16,
          },
          wall: 'none',
          wallHeight: 80,
        },
        {
          widthLeft: 250,
          widthRight: 250,
          bank: 0,
          surface: 'asphalt',
          texture: {
            path: 'textures/b',
            width: 32,
            height: 32,
            bpp: 16,
          },
          wall: 'none',
          wallHeight: 80,
        },
        {
          widthLeft: 250,
          widthRight: 250,
          bank: 0,
          surface: 'asphalt',
          texture: {
            path: 'textures/b',
            width: 32,
            height: 32,
            bpp: 16,
          },
          wall: 'none',
          wallHeight: 80,
        },
      ],
      decor: { apronWidth: 50 },
      env: {},
    };
    const { doc } = normalizeTrackDoc(raw);
    expect(doc.segments[0].textureManual).toBe(true);
    expect(doc.segments[1].textureManual).toBe(false);
    expect(doc.segments[2].textureManual).toBe(true);
    expect(doc.segments[3].textureManual).toBe(false);
  });

  it('heals projects where every segment was marked textureManual', () => {
    const segs = [0, 1, 2, 3].map(() => ({
      widthLeft: 250,
      widthRight: 250,
      bank: 0,
      surface: 'asphalt',
      texture: {
        path: 'textures/checker',
        width: 32,
        height: 32,
        bpp: 16,
      },
      textureManual: true,
      wall: 'none',
      wallHeight: 80,
      wallManual: true,
    }));
    const raw = {
      version: 1,
      meta: {
        name: 'AllManual',
        resourceName: 'user:all',
        debugName: 'all',
        trackLength: '100m',
        modName: 'all',
      },
      spline: {
        closed: true,
        knots: [
          { x: 0, y: 0, z: 0 },
          { x: 0, y: 0, z: -400 },
          { x: 400, y: 0, z: -400 },
          { x: 400, y: 0, z: 0 },
        ],
      },
      segments: segs,
      decor: { apronWidth: 50 },
      env: {},
    };
    const { doc } = normalizeTrackDoc(raw);
    expect(doc.segments[0].textureManual).toBe(true);
    expect(doc.segments[1].textureManual).toBe(false);
    expect(doc.segments[2].textureManual).toBe(false);
  });

  it('rejects garbage JSON', () => {
    const result = parseProjectJson('{not json');
    expect(result.ok).toBe(false);
  });

  it('serializeProject includes format envelope', () => {
    const env = serializeProject(createDefaultOval());
    expect(env.format).toBe('mk64track');
    expect(env.formatVersion).toBe(1);
    expect(env.doc.version).toBe(1);
    expect(env.savedAt).toMatch(/^\d{4}-/);
  });
});
