import { describe, expect, it } from 'vitest';
import { VoiceLimiter, gameAudioMode, spatialize } from '../../src/audio/mix';
import { ResolutionGovernor, RollingStats } from '../../src/core/perf';
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


describe('perf helpers', () => {
  it('keeps a rolling window', () => {
    const s = new RollingStats(3);
    [1, 2, 3, 4].forEach((v) => s.push(v));
    expect(s.length).toBe(3);
    expect(s.avg).toBeCloseTo(3);
    expect(s.max).toBe(4);
    expect(s.at(0)).toBe(4);
    expect(s.at(2)).toBe(2);
  });

  it('drops the render scale under sustained load and restores it with headroom', () => {
    const g = new ResolutionGovernor(1.5, 0.75, 0.25);
    let changed = false;
    for (let t = 0; t < 2 && !changed; t += 1 / 60) changed = g.update(20, 16.7, 1 / 60);
    expect(g.scale).toBe(1.25);
    for (let t = 0; t < 6; t += 1 / 60) g.update(4, 16.7, 1 / 60);
    expect(g.scale).toBe(1.5);
  });
});

describe('audio mix', () => {
  it('pans by the screen axis and fades with distance', () => {
    const left = spatialize({ x: 0, z: 0 }, { x: 1, z: 0 }, { x: -11, z: 0 });
    expect(left.pan).toBeCloseTo(-0.85);
    const near = spatialize({ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 0, z: 1 });
    const far = spatialize({ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 0, z: 30 });
    expect(near.gain).toBeGreaterThan(far.gain);
    expect(far.gain).toBeGreaterThanOrEqual(0.22);
  });

  it('cuts the oldest voice when a sound is over its limit', () => {
    const v = new VoiceLimiter<string>(2);
    expect(v.add('a')).toBeUndefined();
    expect(v.add('b')).toBeUndefined();
    expect(v.add('c')).toBe('a');
    v.remove('b');
    expect(v.size).toBe(1);
  });
});

describe('game audio mode', () => {
  it('silences gameplay audio behind the pause menu and the game-over card', () => {
    expect(gameAudioMode('playing', true)).toBe('paused');
    expect(gameAudioMode('over', false)).toBe('paused');
  });

  it('muffles under the upgrade picker and is live otherwise', () => {
    expect(gameAudioMode('upgrade', false)).toBe('muffled');
    expect(gameAudioMode('playing', false)).toBe('live');
    expect(gameAudioMode('dying', false)).toBe('live');
    expect(gameAudioMode('intro', false)).toBe('live');
  });
});
