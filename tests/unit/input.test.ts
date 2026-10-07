import { describe, expect, it } from 'vitest';
import { JOY_RADIUS, KEY_BINDINGS, PAD, joystickToIntent, keysToVector, readPad, type PadFrame } from '../../src/core/input';

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

const pad = (buttons: Record<number, number> = {}, axes: number[] = [0, 0, 0, 0]): PadFrame => ({
  buttons: Array.from({ length: 17 }, (_, i) => buttons[i] ?? 0),
  axes,
});

describe('gamepad', () => {
  it('maps the face buttons to swipe, beam, spin and quake', () => {
    const r = readPad(pad({ [PAD.X]: 1, [PAD.Y]: 1, [PAD.LB]: 1, [PAD.RB]: 1 }), pad());
    expect(r.pressed).toEqual(expect.arrayContaining(['attack', 'beam', 'spin', 'quake']));
  });

  it('fires a press once, not every frame it is held', () => {
    const held = pad({ [PAD.X]: 1 });
    expect(readPad(held, pad()).pressed).toContain('attack');
    expect(readPad(held, held).pressed).not.toContain('attack');
  });

  it('turns the left stick into a move intent with a dead zone and rim run', () => {
    expect(readPad(pad({}, [0.1, -0.1, 0, 0]), null).move).toBeNull();
    const walk = readPad(pad({}, [0, -0.6, 0, 0]), null).move!;
    expect(walk.y).toBeGreaterThan(0);
    expect(walk.run).toBe(false);
    expect(readPad(pad({}, [1, 0, 0, 0]), null).move!.run).toBe(true);
    expect(readPad(pad({ [PAD.LT]: 1 }, [0, -0.5, 0, 0]), null).move!.run).toBe(true);
  });

  it('aims with the right stick only when pushed', () => {
    expect(readPad(pad({}, [0, 0, 0.3, 0]), null).aim).toBeNull();
    const aim = readPad(pad({}, [0, 0, 0, -1]), null).aim!;
    expect(aim.y).toBeGreaterThan(0.9);
  });

  it('steps menus with the d-pad and once per stick push', () => {
    expect(readPad(pad({ [PAD.DOWN]: 1 }), pad()).pressed).toContain('navNext');
    const pushed = pad({}, [0, -0.9, 0, 0]);
    expect(readPad(pushed, pad()).pressed).toContain('navPrev');
    expect(readPad(pushed, pushed).pressed).not.toContain('navPrev');
  });

  it('confirms with A, backs out with B, pauses with Menu', () => {
    const r = readPad(pad({ [PAD.A]: 1, [PAD.B]: 1, [PAD.MENU]: 1 }), pad());
    expect(r.pressed).toEqual(expect.arrayContaining(['confirm', 'back', 'pause']));
  });
});

describe('keyboard bindings', () => {
  it('covers every action on a key', () => {
    const bound = new Set(Object.values(KEY_BINDINGS));
    for (const a of ['attack', 'beam', 'spin', 'quake', 'pause', 'pick1', 'pick2', 'pick3', 'reroll', 'skip', 'confirm', 'newRun'] as const) {
      expect(bound.has(a), a).toBe(true);
    }
  });
});
