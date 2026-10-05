import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../src/core/rng';
import { projectileHits } from '../../src/game/projectiles';
import { ScoreKeeper } from '../../src/game/score';
import { UPGRADES, UPGRADE_IDS, rollUpgrades, statsFor } from '../../src/game/upgrades';

describe('upgrades', () => {
  it('base stats change nothing', () => {
    const s = statsFor({}, 300);
    expect(s).toMatchObject({ maxHp: 300, meleeDamage: 1, reach: 1, quakeDamage: 0, siphon: 0, moveSpeed: 1 });
    expect(s.cooldownScale.beam).toBe(1);
  });

  it('stacks effects per level', () => {
    const s = statsFor({ fists: 2, hide: 1, overcharge: 1, aftershock: 2 }, 300);
    expect(s.meleeDamage).toBeCloseTo(1.4);
    expect(s.maxHp).toBe(360);
    expect(s.cooldownScale.beam).toBeCloseTo(0.82);
    expect(s.quakeDamage).toBe(35);
  });

  it('offers three distinct, unmaxed upgrades', () => {
    const picks = rollUpgrades({ hide: UPGRADES.hide.max }, mulberry32(4));
    expect(picks).toHaveLength(3);
    expect(new Set(picks).size).toBe(3);
    expect(picks).not.toContain('hide');
  });

  it('offers nothing once everything is maxed', () => {
    const maxed = Object.fromEntries(UPGRADE_IDS.map((id) => [id, UPGRADES[id].max]));
    expect(rollUpgrades(maxed, mulberry32(4))).toEqual([]);
  });
});

describe('score', () => {
  it('ramps the multiplier every five chained kills, capped at 3x', () => {
    const s = new ScoreKeeper();
    for (let i = 0; i < 4; i++) s.kill(10);
    expect(s.multiplier).toBe(1);
    s.kill(10);
    expect(s.multiplier).toBe(1.5);
    for (let i = 0; i < 40; i++) s.kill(10);
    expect(s.multiplier).toBe(3);
  });

  it('breaks the chain after the combo window', () => {
    const s = new ScoreKeeper();
    for (let i = 0; i < 6; i++) s.kill(10);
    s.update(3.1);
    expect(s.combo).toBe(0);
    expect(s.multiplier).toBe(1);
  });

  it('adds wave bonuses', () => {
    const s = new ScoreKeeper();
    expect(s.waveBonus(3)).toBe(300);
    expect(s.score).toBe(300);
  });
});

describe('projectiles', () => {
  it('hit when overlapping the hero', () => {
    const p = { pos: { x: 1.4, z: 0 }, vel: { x: 0, z: 0 }, y: 1, radius: 0.28, damage: 10, life: 1, spin: 0 };
    expect(projectileHits(p, { x: 0, z: 0 }, 1.25)).toBe(true);
    p.pos.x = 1.6;
    expect(projectileHits(p, { x: 0, z: 0 }, 1.25)).toBe(false);
  });
});
