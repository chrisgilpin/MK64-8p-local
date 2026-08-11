/**
 * Lightweight arcade drive model in MK64 game units.
 *
 * Scale anchors from the decomp (src/data/kart_attributes.c):
 * - gKartBoundingBoxSizeTable ≈ 5.5–6.0
 * - gKartTopSpeedTable ≈ 9.0 (per-frame speed at ~30 Hz physics)
 * - Display km/h ≈ (speed / 18) * 216 → top ~108 km/h unboosted
 *
 * This is NOT a full MK64 physics port — it exists so road width, corner radii,
 * and lap length feel proportional in the editor.
 */

export type DriveKeys = {
  accel: boolean;
  brake: boolean;
  left: boolean;
  right: boolean;
  handbrake: boolean;
};

export type DriveState = {
  x: number;
  y: number;
  z: number;
  /** Radians; 0 faces +Z in three.js / game-ish forward depends on track. */
  yaw: number;
  /** Game-units per second. */
  speed: number;
  /** Vertical velocity for simple hops off ramps. */
  vy: number;
  onGround: boolean;
};

/** Kart body size for the preview mesh (game units). */
export const KART_HALF_WIDTH = 3.0;
export const KART_HALF_LENGTH = 4.5;
export const KART_HEIGHT = 3.5;
/** Matches gKartBoundingBoxSizeTable (~Mario). */
export const KART_BOUNDING = 5.5;

/** ~9.0 * 30 fps → units/second. */
export const TOP_SPEED = 270;
export const BOOST_TOP = 360;
const ACCEL = 220;
const REVERSE_ACCEL = 120;
const MAX_REVERSE = 80;
const DRAG = 55;
const BRAKE_FORCE = 380;
const TURN_BASE = 2.4; // rad/s at low speed
const TURN_AT_SPEED = 1.35; // rad/s near top
const GRAVITY = 980; // game units/s² (tuned for feel on ramps)
const GROUND_SNAP = 40;
const KART_CLEARANCE = 1.2;

export function createDriveState(
  x: number,
  y: number,
  z: number,
  yaw: number,
): DriveState {
  return { x, y, z, yaw, speed: 0, vy: 0, onGround: true };
}

/**
 * @param groundY  surface height under the kart (from raycast / height sample)
 * @param groundNy approximate surface normal Y (1 = flat); used for slight ramp boost
 */
export function stepDrive(
  s: DriveState,
  keys: DriveKeys,
  dt: number,
  groundY: number | null,
  groundNy = 1,
): DriveState {
  dt = Math.min(0.05, Math.max(0, dt));
  let { x, y, z, yaw, speed, vy, onGround } = s;

  // Steering: more responsive at low speed (arcade), still turn at speed.
  const speedRatio = Math.min(1, Math.abs(speed) / TOP_SPEED);
  const turnRate =
    TURN_BASE * (1 - speedRatio) + TURN_AT_SPEED * speedRatio;
  const steer =
    (keys.left ? 1 : 0) + (keys.right ? -1 : 0);
  // Handbrake tightens the turn radius a bit.
  const steerMul = keys.handbrake ? 1.45 : 1;
  if (Math.abs(speed) > 2) {
    const dir = speed >= 0 ? 1 : -1;
    yaw += steer * turnRate * steerMul * dir * dt;
  }

  // Longitudinal forces
  if (keys.accel) {
    const target = keys.handbrake ? TOP_SPEED * 0.7 : TOP_SPEED;
    if (speed < target) speed += ACCEL * dt;
  }
  if (keys.brake) {
    if (speed > 0.5) speed -= BRAKE_FORCE * dt;
    else speed -= REVERSE_ACCEL * dt;
  }
  if (!keys.accel && !keys.brake) {
    // Coasting drag
    if (speed > 0) speed = Math.max(0, speed - DRAG * dt);
    else if (speed < 0) speed = Math.min(0, speed + DRAG * dt);
  }
  if (keys.handbrake && Math.abs(speed) > 10) {
    speed -= Math.sign(speed) * 90 * dt;
  }
  speed = Math.max(-MAX_REVERSE, Math.min(TOP_SPEED * 1.05, speed));

  // Integrate XZ
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  x += fx * speed * dt;
  z += fz * speed * dt;

  // Vertical: stick to surface or simple ballistic when airborne
  if (groundY != null) {
    const targetY = groundY + KART_CLEARANCE;
    if (onGround || y <= targetY + 2) {
      // On or near ground
      if (y > targetY + 8 && vy > 0) {
        // Still rising after a lip
        onGround = false;
      } else {
        const dy = targetY - y;
        // Snap / spring toward surface
        y += dy * Math.min(1, GROUND_SNAP * dt);
        // Leaving a ramp: if surface slopes up and we're fast, slight launch
        if (groundNy < 0.92 && speed > TOP_SPEED * 0.45 && dy < 1) {
          const launch = (1 - groundNy) * speed * 0.35;
          if (launch > 30) {
            vy = launch;
            onGround = false;
            y = targetY + 0.5;
          } else {
            vy = 0;
            onGround = true;
          }
        } else {
          vy = 0;
          onGround = true;
        }
      }
    } else {
      onGround = false;
    }
  } else {
    onGround = false;
  }

  if (!onGround) {
    vy -= GRAVITY * dt;
    y += vy * dt;
    if (groundY != null && y < groundY + KART_CLEARANCE) {
      y = groundY + KART_CLEARANCE;
      vy = 0;
      onGround = true;
    }
  }

  return { x, y, z, yaw, speed, vy, onGround };
}

/** km/h readout using the same conversion the game HUD uses. */
export function speedToKmh(speedUnitsPerSec: number): number {
  // Internal frame speed ≈ speedUnitsPerSec / 30
  const frameSpeed = speedUnitsPerSec / 30;
  return (frameSpeed / 18) * 216;
}
