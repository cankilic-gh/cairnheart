import { describe, expect, it } from 'vitest';
import { ATTACKS, COMBO_WINDOW, COOLDOWNS } from '../../src/combat/attacks';
import { directionFrom, inArc, inBeam, inCircle } from '../../src/combat/geometry';
import { HeroCombat } from '../../src/combat/heroCombat';

const origin = { x: 0, z: 0 };

describe('hit geometry', () => {
  it('arc hits in front and misses behind', () => {
    expect(inArc(origin, 0, { x: 0, z: 2.5 }, 3, 1, 0.4)).toBe(true);
    expect(inArc(origin, 0, { x: 0, z: -2.5 }, 3, 1, 0.4)).toBe(false);
    expect(inArc(origin, 0, { x: 0, z: 3.6 }, 3, 1, 0.4)).toBe(false);
  });

  it('arc always hits something hugging the attacker', () => {
    expect(inArc(origin, 0, { x: 0, z: -0.5 }, 3, 0.5, 0.4)).toBe(true);
  });

  it('beam hits along its length only', () => {
    expect(inBeam(origin, Math.PI / 2, { x: 10, z: 0.5 }, 14, 0.9, 0.4)).toBe(true);
    expect(inBeam(origin, Math.PI / 2, { x: 10, z: 2 }, 14, 0.9, 0.4)).toBe(false);
    expect(inBeam(origin, Math.PI / 2, { x: -3, z: 0 }, 14, 0.9, 0.4)).toBe(false);
  });

  it('circle includes target radius', () => {
    expect(inCircle(origin, { x: 3.3, z: 0 }, 3, 0.4)).toBe(true);
    expect(inCircle(origin, { x: 3.5, z: 0 }, 3, 0.4)).toBe(false);
  });

  it('direction falls back to yaw when positions coincide', () => {
    const d = directionFrom(origin, origin, Math.PI / 2);
    expect(d.x).toBeCloseTo(1);
  });
});

const run = (c: HeroCombat, seconds: number) => {
  const events = [];
  for (let t = 0; t < seconds; t += 1 / 60) events.push(...c.update(1 / 60));
  return events;
};

describe('HeroCombat', () => {
  it('fires each hit exactly once', () => {
    const c = new HeroCombat();
    c.request('attack', 0);
    const events = run(c, ATTACKS.swipeR.duration + 0.1);
    expect(events).toHaveLength(1);
    expect(events[0]!.id).toBe('swipeR');
    expect(c.action).toBeNull();
  });

  it('chains swipeR, swipeL, slam within the combo window then resets', () => {
    const c = new HeroCombat();
    const ids: string[] = [];
    c.onStart = (a) => ids.push(a.id);
    for (const id of ['swipeR', 'swipeL', 'slam', 'swipeR'] as const) {
      c.request('attack', 0);
      run(c, ATTACKS[id].duration + 0.05);
    }
    expect(ids.slice(0, 3)).toEqual(['swipeR', 'swipeL', 'slam']);
    expect(ids[3]).toBe('swipeR');
  });

  it('restarts the combo after the window lapses', () => {
    const c = new HeroCombat();
    const ids: string[] = [];
    c.onStart = (a) => ids.push(a.id);
    c.request('attack', 0);
    run(c, ATTACKS.swipeR.duration + COMBO_WINDOW + 0.2);
    c.request('attack', 0);
    expect(ids).toEqual(['swipeR', 'swipeR']);
  });

  it('buffers a late request and starts it when the current action ends', () => {
    const c = new HeroCombat();
    const ids: string[] = [];
    c.onStart = (a) => ids.push(a.id);
    c.request('attack', 0);
    run(c, ATTACKS.swipeR.duration * 0.6);
    expect(c.request('attack', 1)).toBe(true);
    run(c, ATTACKS.swipeR.duration * 0.5);
    expect(ids).toEqual(['swipeR', 'swipeL']);
    expect(c.action?.yaw).toBe(1);
  });

  it('drops early requests and respects cooldowns', () => {
    const c = new HeroCombat();
    c.request('beam', 0);
    expect(c.request('spin', 0)).toBe(false);
    run(c, ATTACKS.beam.duration + 0.05);
    expect(c.request('beam', 0)).toBe(false);
    expect(c.cooldownFraction('beam')).toBeGreaterThan(0);
    run(c, COOLDOWNS.beam);
    expect(c.request('beam', 0)).toBe(true);
  });

  it('emits one event per spin tick', () => {
    const c = new HeroCombat();
    c.request('spin', 0);
    expect(run(c, ATTACKS.spin.duration + 0.1)).toHaveLength(ATTACKS.spin.hits.length);
  });
});
