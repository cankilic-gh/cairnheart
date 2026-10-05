import { describe, expect, it } from 'vitest';
import { JOY_RADIUS, joystickToIntent, keysToVector } from '../../src/core/input';

describe('keysToVector', () => {
  it('returns zero with no keys', () => {
    expect(keysToVector(new Set())).toEqual({ x: 0, y: 0 });
  });

  it('normalises diagonals', () => {
    const v = keysToVector(new Set(['KeyW', 'KeyD']));
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(1);
    expect(v.x).toBeGreaterThan(0);
    expect(v.y).toBeGreaterThan(0);
  });

  it('cancels opposing keys and accepts arrows', () => {
    expect(keysToVector(new Set(['KeyA', 'KeyD']))).toEqual({ x: 0, y: 0 });
    expect(keysToVector(new Set(['ArrowDown']))).toEqual({ x: 0, y: -1 });
  });
});

describe('joystickToIntent', () => {
  it('ignores the dead zone', () => {
    expect(joystickToIntent(3, 2)).toEqual({ x: 0, y: 0, run: false });
  });

  it('flips screen y so dragging up moves away from the camera', () => {
    const i = joystickToIntent(0, -JOY_RADIUS * 0.6);
    expect(i.y).toBeGreaterThan(0);
    expect(i.run).toBe(false);
  });

  it('runs at the rim', () => {
    const i = joystickToIntent(JOY_RADIUS, 0);
    expect(i.x).toBeCloseTo(1);
    expect(i.run).toBe(true);
  });
});
