import { describe, expect, it } from 'vitest';
import { createDefaultOval } from './defaults';
import {
  applyTextureRun,
  applyWallRun,
  deriveStyleBreaksFromValues,
  healAllManualStyleFlags,
} from './segmentStyle';
import type { Segment, TextureRef } from './types';

const grass: TextureRef = {
  path: 'textures/other_textures/grass_1',
  width: 32,
  height: 32,
  bpp: 16,
};

const sand: TextureRef = {
  path: 'textures/other_textures/sand',
  width: 32,
  height: 32,
  bpp: 16,
};

const road: TextureRef = {
  path: 'textures/course_4_textures/road_0',
  width: 64,
  height: 32,
  bpp: 16,
};

const checker: TextureRef = {
  path: 'textures/other_textures/checkerboard_black_white',
  width: 32,
  height: 32,
  bpp: 16,
};

describe('segment style inheritance', () => {
  it('paints texture forward through a same-texture run', () => {
    const doc = createDefaultOval();
    let segs: Segment[] = doc.segments.map((s) => ({
      ...s,
      texture: { ...grass },
      textureManual: false,
    }));
    segs[0] = { ...segs[0], textureManual: true };
    // Different texture at 5 — run boundary
    segs[5] = { ...segs[5], texture: { ...sand }, textureManual: true };

    segs = applyTextureRun(segs, 0, road);
    expect(segs[0].texture.path).toBe(road.path);
    expect(segs[0].textureManual).toBe(true);
    expect(segs[3].texture.path).toBe(road.path);
    expect(segs[3].textureManual).toBe(false);
    // Stopped at index 5 (different texture)
    expect(segs[5].texture.path).toBe(sand.path);
    expect(segs[5].textureManual).toBe(true);
  });

  it('starts a new texture run from a later knot', () => {
    let segs: Segment[] = createDefaultOval().segments.map((s) => ({
      ...s,
      texture: { ...grass },
      textureManual: false,
    }));
    segs[0] = { ...segs[0], textureManual: true };
    segs = applyTextureRun(segs, 0, grass);
    segs = applyTextureRun(segs, 4, sand);
    expect(segs[0].texture.path).toBe(grass.path);
    expect(segs[3].texture.path).toBe(grass.path);
    expect(segs[4].texture.path).toBe(sand.path);
    expect(segs[4].textureManual).toBe(true);
    expect(segs[7].texture.path).toBe(sand.path);
    expect(segs[7].textureManual).toBe(false);
  });

  it('propagates walls through a same-wall run', () => {
    let segs: Segment[] = createDefaultOval().segments.map((s) => ({
      ...s,
      wallManual: false,
      wall: 'none' as const,
      wallHeight: 80,
    }));
    segs[0] = { ...segs[0], wallManual: true };
    segs = applyWallRun(segs, 2, { wall: 'both', wallHeight: 100 });
    expect(segs[2].wall).toBe('both');
    expect(segs[2].wallManual).toBe(true);
    expect(segs[4].wall).toBe('both');
    expect(segs[4].wallHeight).toBe(100);
    expect(segs[4].wallManual).toBe(false);
  });

  it('paints past false all-manual flags when textures match (user bug)', () => {
    // Legacy / autosave: every segment textureManual=true, same checkerboard
    let segs: Segment[] = createDefaultOval().segments.map((s) => ({
      ...s,
      texture: { ...checker },
      textureManual: true,
    }));

    segs = applyTextureRun(segs, 2, road);
    expect(segs[2].texture.path).toBe(road.path);
    expect(segs[2].textureManual).toBe(true);
    // Must paint past knot 3 even though it was falsely "manual"
    expect(segs[3].texture.path).toBe(road.path);
    expect(segs[3].textureManual).toBe(false);
    expect(segs[10].texture.path).toBe(road.path);
    expect(segs[10].textureManual).toBe(false);
  });

  it('still stops at a later segment with a different texture', () => {
    let segs: Segment[] = createDefaultOval().segments.map((s, i) => ({
      ...s,
      texture: i < 5 ? { ...grass } : { ...sand },
      textureManual: i === 0 || i === 5,
    }));

    segs = applyTextureRun(segs, 2, road);
    expect(segs[2].texture.path).toBe(road.path);
    expect(segs[3].texture.path).toBe(road.path);
    expect(segs[4].texture.path).toBe(road.path);
    // Sand at 5 preserved
    expect(segs[5].texture.path).toBe(sand.path);
    expect(segs[5].textureManual).toBe(true);
    expect(segs[6].texture.path).toBe(sand.path);
  });

  it('heals all-manual same texture to only first break', () => {
    const segs: Segment[] = createDefaultOval().segments.map((s) => ({
      ...s,
      texture: { ...checker },
      textureManual: true,
      wall: 'none' as const,
      wallManual: true,
    }));
    const healed = healAllManualStyleFlags(segs);
    expect(healed[0].textureManual).toBe(true);
    expect(healed[1].textureManual).toBe(false);
    expect(healed[5].textureManual).toBe(false);
    expect(healed[0].wallManual).toBe(true);
    expect(healed[3].wallManual).toBe(false);
  });

  it('deriveStyleBreaksFromValues marks texture changes', () => {
    const segs: Segment[] = createDefaultOval().segments.map((s, i) => ({
      ...s,
      texture: i < 4 ? { ...grass } : { ...sand },
      textureManual: false,
    }));
    const derived = deriveStyleBreaksFromValues(segs);
    expect(derived[0].textureManual).toBe(true);
    expect(derived[3].textureManual).toBe(false);
    expect(derived[4].textureManual).toBe(true);
    expect(derived[7].textureManual).toBe(false);
  });
});
