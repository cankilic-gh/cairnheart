import { describe, expect, it } from 'vitest';
import {
  MOTION,
  cameraBasis,
  clampToArena,
  createMotionState,
  intentToWorld,
  stepMotion,
  wrapAngle,
} from '../../src/entities/hero/motion';
import { footfallIndex, strideLength } from '../../src/entities/hero/animator';
import { ARENA, inGateGap } from '../../src/world/arenaConfig';

const run = (frames: number, intent: { x: number; y: number; run: boolean }, az = 0) => {
  const s = createMotionState();
  for (let i = 0; i < frames; i++) stepMotion(s, intent, az, 1 / 60);
  return s;
};

describe('camera-relative movement', () => {
  it('maps screen up to away-from-camera on the ground', () => {
    const { forward, right } = cameraBasis(0);
    expect(forward.x).toBeCloseTo(0);
    expect(forward.z).toBeCloseTo(-1);
    expect(right.x).toBeCloseTo(1);
    expect(right.z).toBeCloseTo(0);
  });

  it('keeps the basis orthonormal for the diagonal camera', () => {
    const { forward, right } = cameraBasis(Math.PI / 4);
    expect(Math.hypot(forward.x, forward.z)).toBeCloseTo(1);
    expect(forward.x * right.x + forward.z * right.z).toBeCloseTo(0);
  });

  it('never exceeds unit length for combined intents', () => {
    const v = intentToWorld({ x: 1, y: 1, run: false }, 0.7);
    expect(Math.hypot(v.x, v.z)).toBeLessThanOrEqual(1 + 1e-9);
  });
});

describe('stepMotion', () => {
  it('accelerates to walk speed and faces the travel direction', () => {
    const s = run(120, { x: 0, y: 1, run: false });
    expect(s.speed).toBeCloseTo(MOTION.walkSpeed, 3);
    expect(Math.abs(wrapAngle(s.yaw - Math.PI))).toBeLessThan(0.01);
    expect(s.pos.z).toBeLessThan(0);
  });

  it('runs faster with the run modifier', () => {
    const s = run(120, { x: 1, y: 0, run: true });
    expect(s.speed).toBeCloseTo(MOTION.runSpeed, 3);
  });

  it('decelerates to rest without input', () => {
    const s = run(60, { x: 0, y: 1, run: true });
    for (let i = 0; i < 60; i++) stepMotion(s, { x: 0, y: 0, run: false }, 0, 1 / 60);
    expect(s.speed).toBe(0);
  });

  it('turns at a bounded rate', () => {
    const s = createMotionState();
    stepMotion(s, { x: 0, y: -1, run: false }, 0, 1 / 60);
    expect(Math.abs(s.yawRate)).toBeLessThanOrEqual(MOTION.turnRate + 1e-6);
  });

  it('ignores zero or negative dt', () => {
    const s = createMotionState();
    stepMotion(s, { x: 1, y: 0, run: false }, 0, 0);
    expect(s.pos.x).toBe(0);
  });
});

describe('arena bounds', () => {
  it('projects an escaping position back onto the boundary and keeps tangential speed', () => {
    const pos = { x: 20, z: 0 };
    const vel = { x: 3, z: 2 };
    expect(clampToArena(pos, vel, 10)).toBe(true);
    expect(Math.hypot(pos.x, pos.z)).toBeCloseTo(10);
    expect(vel.x).toBeCloseTo(0);
    expect(vel.z).toBeCloseTo(2);
  });

  it('never lets a long sprint leave the play radius', () => {
    const s = run(60 * 20, { x: 1, y: 0.3, run: true }, Math.PI / 4);
    expect(Math.hypot(s.pos.x, s.pos.z)).toBeLessThanOrEqual(ARENA.playRadius + 1e-9);
  });

  it('keeps the play radius clear of the wall ring', () => {
    expect(ARENA.playRadius).toBeLessThan(ARENA.wallInner - 1.2);
  });

  it('opens gates only on the four axes', () => {
    expect(inGateGap(0.5, -18.5)).toBe(true);
    expect(inGateGap(18.5, 1.5)).toBe(true);
    expect(inGateGap(12.5, 12.5)).toBe(false);
    expect(inGateGap(2.5, -18.5)).toBe(false);
  });
});

describe('gait', () => {
  it('lengthens stride when running', () => {
    expect(strideLength(1)).toBeGreaterThan(strideLength(0));
  });

  it('counts one footfall per half cycle', () => {
    expect(footfallIndex(Math.PI / 2 - 0.01)).toBe(-1);
    expect(footfallIndex(Math.PI / 2 + 0.01)).toBe(0);
    expect(footfallIndex(Math.PI * 1.5 + 0.01)).toBe(1);
  });
});
