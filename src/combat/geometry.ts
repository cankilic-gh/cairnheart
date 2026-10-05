import { wrapAngle, type Vec2 } from '../entities/hero/motion';

/** Wedge in front of `origin` facing `yaw`; the target's radius widens the wedge so edge grazes still land. */
export const inArc = (origin: Vec2, yaw: number, target: Vec2, range: number, halfAngle: number, targetRadius = 0): boolean => {
  const dx = target.x - origin.x;
  const dz = target.z - origin.z;
  const d = Math.hypot(dx, dz);
  if (d > range + targetRadius) return false;
  if (d <= targetRadius + 0.6) return true;
  const off = Math.abs(wrapAngle(Math.atan2(dx, dz) - yaw));
  return off <= halfAngle + Math.asin(Math.min(1, targetRadius / d));
};

/** Straight beam of `length` starting at `origin` along `yaw`. */
export const inBeam = (origin: Vec2, yaw: number, target: Vec2, length: number, halfWidth: number, targetRadius = 0): boolean => {
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  const dx = target.x - origin.x;
  const dz = target.z - origin.z;
  const along = dx * fx + dz * fz;
  if (along < -targetRadius || along > length + targetRadius) return false;
  return Math.abs(dx * fz - dz * fx) <= halfWidth + targetRadius;
};

export const inCircle = (center: Vec2, target: Vec2, radius: number, targetRadius = 0): boolean =>
  Math.hypot(target.x - center.x, target.z - center.z) <= radius + targetRadius;

export const directionFrom = (from: Vec2, to: Vec2, fallbackYaw = 0): Vec2 => {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const d = Math.hypot(dx, dz);
  return d > 1e-6 ? { x: dx / d, z: dz / d } : { x: Math.sin(fallbackYaw), z: Math.cos(fallbackYaw) };
};
