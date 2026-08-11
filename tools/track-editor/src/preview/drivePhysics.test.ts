import { describe, expect, it } from 'vitest';
import {
  createDriveState,
  KART_BOUNDING,
  speedToKmh,
  stepDrive,
  TOP_SPEED,
} from './drivePhysics';

describe('drivePhysics scale anchors', () => {
  it('uses MK64-ish bounding box size', () => {
    expect(KART_BOUNDING).toBeCloseTo(5.5, 5);
  });

  it('maps top speed to ~108 km/h like the game HUD formula', () => {
    // (9 / 18) * 216 = 108; TOP_SPEED = 9 * 30
    expect(speedToKmh(TOP_SPEED)).toBeCloseTo(108, 0);
  });

  it('accelerates forward with W', () => {
    let s = createDriveState(0, 0, 0, 0);
    for (let i = 0; i < 60; i++) {
      s = stepDrive(
        s,
        { accel: true, brake: false, left: false, right: false, handbrake: false },
        1 / 30,
        0,
        1,
      );
    }
    expect(s.speed).toBeGreaterThan(50);
    expect(s.z).toBeGreaterThan(0); // yaw 0 → +Z
  });

  it('stays near ground when a surface is provided', () => {
    let s = createDriveState(0, 10, 0, 0);
    s = stepDrive(
      s,
      { accel: false, brake: false, left: false, right: false, handbrake: false },
      0.1,
      5,
      1,
    );
    expect(s.y).toBeLessThan(10);
    expect(s.y).toBeGreaterThan(5);
  });
});
