import { clamp } from '../../core/math';
import { ARENA } from '../../world/arenaConfig';

export interface Vec2 {
  x: number;
  z: number;
}

/** Screen-space intent: x = right, y = up/away from camera. Magnitude ≤ 1 (analog sticks may be partial). */
export interface MoveIntent {
  x: number;
  y: number;
  run: boolean;
}

export interface MotionConfig {
  walkSpeed: number;
  runSpeed: number;
  accel: number;
  decel: number;
  turnRate: number;
  turnSharpness: number;
  radius: number;
}

export interface MotionState {
  pos: Vec2;
  vel: Vec2;
  yaw: number;
  yawRate: number;
  speed: number;
  accelForward: number;
}

export const MOTION: MotionConfig = {
  walkSpeed: 3.2,
  runSpeed: 5.8,
  accel: 13,
  decel: 20,
  turnRate: 9,
  turnSharpness: 12,
  radius: ARENA.playRadius,
};

export const createMotionState = (): MotionState => ({
  pos: { x: 0, z: 0 },
  vel: { x: 0, z: 0 },
  yaw: 0,
  yawRate: 0,
  speed: 0,
  accelForward: 0,
});

export const wrapAngle = (a: number): number => {
  const twoPi = Math.PI * 2;
  let r = (a + Math.PI) % twoPi;
  if (r < 0) r += twoPi;
  return r - Math.PI;
};

/** Ground-plane basis for a camera orbiting at `azimuth` (0 = camera on +Z looking toward -Z). */
export const cameraBasis = (azimuth: number): { forward: Vec2; right: Vec2 } => ({
  forward: { x: -Math.sin(azimuth), z: -Math.cos(azimuth) },
  right: { x: Math.cos(azimuth), z: -Math.sin(azimuth) },
});

export const intentToWorld = (intent: MoveIntent, azimuth: number): Vec2 => {
  const { forward, right } = cameraBasis(azimuth);
  let x = right.x * intent.x + forward.x * intent.y;
  let z = right.z * intent.x + forward.z * intent.y;
  const len = Math.hypot(x, z);
  if (len > 1) {
    x /= len;
    z /= len;
  }
  return { x, z };
};

/** Keeps `pos` inside the circle and strips the outward velocity so the hero slides along the wall. */
export const clampToArena = (pos: Vec2, vel: Vec2, radius: number): boolean => {
  const r = Math.hypot(pos.x, pos.z);
  if (r <= radius) return false;
  const nx = pos.x / r;
  const nz = pos.z / r;
  pos.x = nx * radius;
  pos.z = nz * radius;
  const vn = vel.x * nx + vel.z * nz;
  if (vn > 0) {
    vel.x -= vn * nx;
    vel.z -= vn * nz;
  }
  return true;
};

export const stepMotion = (
  s: MotionState,
  intent: MoveIntent,
  azimuth: number,
  dt: number,
  cfg: MotionConfig = MOTION,
  facing?: number,
): MotionState => {
  if (dt <= 0) return s;
  const prevYaw = s.yaw;
  const prevForward = s.vel.x * Math.sin(prevYaw) + s.vel.z * Math.cos(prevYaw);

  const dir = intentToWorld(intent, azimuth);
  const mag = Math.hypot(dir.x, dir.z);
  const maxSpeed = intent.run ? cfg.runSpeed : cfg.walkSpeed;
  const dvx = dir.x * maxSpeed - s.vel.x;
  const dvz = dir.z * maxSpeed - s.vel.z;
  const dvLen = Math.hypot(dvx, dvz);
  const maxDv = (mag > 0.05 ? cfg.accel : cfg.decel) * dt;
  if (dvLen <= maxDv) {
    s.vel.x += dvx;
    s.vel.z += dvz;
  } else {
    s.vel.x += (dvx / dvLen) * maxDv;
    s.vel.z += (dvz / dvLen) * maxDv;
  }

  s.pos.x += s.vel.x * dt;
  s.pos.z += s.vel.z * dt;
  clampToArena(s.pos, s.vel, cfg.radius);
  s.speed = Math.hypot(s.vel.x, s.vel.z);

  if (facing !== undefined || mag > 0.05) {
    const goal = facing ?? Math.atan2(dir.x, dir.z);
    const diff = wrapAngle(goal - s.yaw);
    const maxTurn = cfg.turnRate * dt;
    const step = clamp(diff * Math.min(1, cfg.turnSharpness * dt), -maxTurn, maxTurn);
    s.yaw = wrapAngle(s.yaw + step);
  }
  s.yawRate = wrapAngle(s.yaw - prevYaw) / dt;

  const forward = s.vel.x * Math.sin(s.yaw) + s.vel.z * Math.cos(s.yaw);
  s.accelForward = (forward - prevForward) / dt;
  return s;
};
