import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../src/core/rng';
import { EMERGE_TIME, configFor, createEnemy, damageEnemy, pushEnemy, separate, stepEnemy } from '../../src/entities/enemies/brain';
import type { EnemyEvent, EnemyKind, EnemyState } from '../../src/entities/enemies/types';
import { WaveDirector, isBossWave, planWave, waveSize } from '../../src/game/waves';

const active = (kind: EnemyKind, pos = { x: 0, z: 0 }, elite = false): EnemyState => {
  const e = createEnemy(1, configFor(kind, elite), pos, { x: 0, z: 1 });
  e.phase = 'active';
  return e;
};

const run = (e: EnemyState, target: { x: number; z: number }, seconds: number, targetRadius = 1.25) => {
  const events: EnemyEvent[] = [];
  for (let t = 0; t < seconds && e.phase !== 'dead'; t += 1 / 60) events.push(...stepEnemy(e, target, targetRadius, 1 / 60));
  return events;
};

describe('burster', () => {
  it('walks in from the gate, then chases', () => {
    const e = createEnemy(1, configFor('burster'), { x: 0, z: -18 }, { x: 0, z: 1 });
    run(e, { x: 10, z: 0 }, EMERGE_TIME + 0.05);
    expect(e.phase).toBe('active');
    expect(e.pos.z).toBeGreaterThan(-18);
  });

  it('lights its fuse in range and explodes', () => {
    const e = active('burster');
    const events = run(e, { x: 0, z: 1.5 }, 2);
    expect(events.map((ev) => ev.type)).toEqual(['explode']);
    expect(e.phase).toBe('dead');
  });

  it('lets the fuse fizzle when the target escapes', () => {
    const e = active('burster');
    run(e, { x: 0, z: 1.5 }, 0.6);
    expect(e.mode).toBe('fuse');
    run(e, { x: 0, z: 30 }, 1.5);
    expect(e.mode).toBe('chase');
    expect(e.meter).toBe(0);
  });

  it('quake interrupt snuffs a lit fuse', () => {
    const e = active('burster');
    run(e, { x: 0, z: 1.5 }, 0.6);
    pushEnemy(e, { x: 0, z: -1 }, 10, 1, true);
    expect(e.mode).toBe('chase');
    expect(e.meter).toBe(0);
  });
});

describe('spitter', () => {
  it('closes distance when far and backs off when crowded', () => {
    const far = active('spitter');
    far.cooldown = 99;
    run(far, { x: 0, z: 20 }, 1);
    expect(far.pos.z).toBeGreaterThan(0.5);
    const near = active('spitter');
    near.cooldown = 99;
    run(near, { x: 0, z: 2 }, 1);
    expect(near.pos.z).toBeLessThan(-0.5);
  });

  it('winds up then fires one shot at the target', () => {
    const e = active('spitter');
    e.cooldown = 0;
    const events = run(e, { x: 0, z: 7 }, 0.8);
    const shots = events.filter((ev) => ev.type === 'shoot');
    expect(shots).toHaveLength(1);
    const shot = shots[0]!;
    if (shot.type === 'shoot') expect(shot.dir.z).toBeCloseTo(1, 1);
    expect(e.cooldown).toBeGreaterThan(1);
  });

  it('a stun cancels the wind-up', () => {
    const e = active('spitter');
    e.cooldown = 0;
    run(e, { x: 0, z: 7 }, 0.2);
    expect(e.mode).toBe('aim');
    damageEnemy(e, 5, { x: 0, z: -1 }, 2, 0.5);
    expect(run(e, { x: 0, z: 7 }, 0.5).filter((ev) => ev.type === 'shoot')).toHaveLength(0);
  });
});

describe('skitter', () => {
  it('crouches, lunges and bites once', () => {
    const e = active('skitter');
    const events = run(e, { x: 0, z: 3.5 }, 1.2);
    expect(events.filter((ev) => ev.type === 'bite')).toHaveLength(1);
  });

  it('misses when the target sidesteps during the crouch', () => {
    const e = active('skitter');
    run(e, { x: 0, z: 3.5 }, 0.3);
    expect(e.mode).toBe('crouch');
    run(e, { x: 0, z: 3.5 }, 0.2);
    const events = run(e, { x: 8, z: 3.5 }, 0.6);
    expect(events.filter((ev) => ev.type === 'bite')).toHaveLength(0);
  });
});

describe('matriarch', () => {
  it('telegraphs a slam before it lands', () => {
    const e = active('matriarch');
    e.cooldown = 0;
    const events = run(e, { x: 0, z: 4 }, 1.4);
    const types = events.map((ev) => ev.type);
    expect(types.indexOf('telegraph')).toBeGreaterThanOrEqual(0);
    expect(types.indexOf('slam')).toBeGreaterThan(types.indexOf('telegraph'));
  });

  it('fires two rings of shards in a nova', () => {
    const e = active('matriarch');
    e.cooldown = 0;
    e.pattern = 1;
    const cfg = e.cfg;
    if (cfg.kind !== 'matriarch') throw new Error('expected a matriarch');
    const shots = run(e, { x: 0, z: 4 }, 2).filter((ev) => ev.type === 'shoot');
    expect(shots).toHaveLength(cfg.novaCount * 2);
  });

  it('summons bursters', () => {
    const e = active('matriarch');
    e.cooldown = 0;
    e.pattern = 3;
    const summons = run(e, { x: 0, z: 4 }, 1.2).filter((ev) => ev.type === 'summon');
    expect(summons).toHaveLength(1);
  });

  it('shrugs off knockback and most of a stun', () => {
    const boss = active('matriarch');
    const minion = active('burster');
    pushEnemy(boss, { x: 1, z: 0 }, 10, 1, false);
    pushEnemy(minion, { x: 1, z: 0 }, 10, 1, false);
    expect(boss.knock.x).toBeLessThan(minion.knock.x / 5);
    expect(boss.stun).toBeLessThan(0.2);
  });
});

describe('shared rules', () => {
  it('dies at zero hp and stops acting', () => {
    const e = active('burster');
    expect(damageEnemy(e, 30, { x: 1, z: 0 }, 5, 0.2)).toBe(false);
    expect(e.damaged).toBe(true);
    expect(damageEnemy(e, 30, { x: 1, z: 0 }, 5, 0.2)).toBe(true);
    expect(stepEnemy(e, { x: 0, z: 0 }, 1, 1 / 60)).toEqual([]);
  });

  it('drains the trailing health bar toward real health', () => {
    const e = active('spitter');
    damageEnemy(e, 20, { x: 1, z: 0 }, 0, 0);
    expect(e.trailHp).toBe(e.cfg.maxHp);
    run(e, { x: 20, z: 20 }, 2);
    expect(e.trailHp).toBe(e.hp);
  });

  it('separates overlaps and keeps enemies out of the hero', () => {
    const a = active('burster', { x: 0, z: 2 });
    const b = active('burster', { x: 0.1, z: 2 });
    separate([a, b], { x: 0, z: 0 }, 1.6, 17);
    expect(Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z)).toBeGreaterThanOrEqual(a.cfg.radius * 2 - 1e-6);
    for (const e of [a, b]) expect(Math.hypot(e.pos.x, e.pos.z)).toBeGreaterThanOrEqual(1.6 + e.cfg.radius - 1e-6);
  });
});

describe('waves', () => {
  it('adds spitters from wave 2, skitters from 3, elites from 4', () => {
    expect(waveSize(1)).toMatchObject({ burster: 4, spitter: 0, skitter: 0, elite: 0 });
    expect(waveSize(2).spitter).toBe(1);
    expect(waveSize(3).skitter).toBe(1);
    expect(waveSize(4).elite).toBe(1);
  });

  it('puts the matriarch in every fifth wave', () => {
    expect(isBossWave(5)).toBe(true);
    expect(isBossWave(4)).toBe(false);
    const plan = planWave(10, mulberry32(3));
    expect(plan.boss).toBe(true);
    expect(plan.bossLevel).toBe(1);
    expect(plan.orders.filter((o) => o.kind === 'matriarch')).toHaveLength(1);
  });

  it('plans ordered spawns matching the wave size', () => {
    const plan = planWave(7, mulberry32(1));
    const s = waveSize(7);
    expect(plan.orders).toHaveLength(s.burster + s.elite + s.spitter + s.skitter);
    expect(plan.orders[0]!.kind).toBe('burster');
    for (let i = 1; i < plan.orders.length; i++) expect(plan.orders[i]!.at).toBeGreaterThan(plan.orders[i - 1]!.at);
  });

  it('clears only once everything has spawned and died', () => {
    const d = new WaveDirector(mulberry32(2), 2);
    d.start(0.5);
    let spawned = 0;
    let cleared = 0;
    for (let t = 0; t < 30 && !(spawned > 0 && d.pending === 0); t += 1 / 30) {
      for (const e of d.update(1 / 30, spawned)) {
        if (e.kind === 'spawn') spawned++;
        if (e.kind === 'waveCleared') cleared++;
      }
    }
    expect(spawned).toBe(waveSize(1).burster);
    expect(cleared).toBe(0);
    expect(d.update(1 / 30, 0).map((e) => e.kind)).toEqual(['waveCleared']);
  });
});
