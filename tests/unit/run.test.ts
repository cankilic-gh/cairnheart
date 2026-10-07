import { describe, expect, it } from 'vitest';
import { GRAFTS, GRAFT_IDS, type GraftId } from '../../src/game/grafts';
import { RUNE_IDS } from '../../src/game/runes';
import { RUN_WAVES, createRun, deserializeRun, planRun, rollOffer, serializeRun } from '../../src/game/run';
import { BOSS_WAVE } from '../../src/game/waves';

describe('run state', () => {
  it('round-trips through serialize and restore', () => {
    const run = createRun(1234, 300);
    run.wave = 5;
    run.time = 271.5;
    run.hp = 188;
    run.kills = 61;
    run.score = 4210;
    run.loadout = { leftArm: 'hookClaw', core: 'bursterHeart' };
    run.runes = ['echo'];
    run.rerolls = 0;
    run.offers = 4;
    run.pending = [{ family: 'spitter', wave: 5 }];
    const restored = deserializeRun(serializeRun(run));
    expect(restored).toEqual(run);
    expect(restored).not.toBe(run);
  });

  it('refuses saves from another version or with unknown parts', () => {
    const json = JSON.parse(serializeRun(createRun(1, 300)));
    expect(() => deserializeRun(JSON.stringify({ ...json, version: 99 }))).toThrow();
    expect(() => deserializeRun(JSON.stringify({ ...json, loadout: { leftArm: 'laserFist' } }))).toThrow();
    expect(() => deserializeRun(JSON.stringify({ ...json, loadout: { leftArm: 'quillMantle' } }))).toThrow();
    expect(() => deserializeRun(JSON.stringify({ ...json, runes: ['rage'] }))).toThrow();
    expect(() => deserializeRun('not json')).toThrow();
  });

  it('plans the same waves from the same seed', () => {
    expect(planRun(42)).toEqual(planRun(42));
    expect(JSON.stringify(planRun(42))).not.toEqual(JSON.stringify(planRun(43)));
  });

  it('plans eight waves with the boss only on the eighth', () => {
    const plans = planRun(7);
    expect(plans).toHaveLength(RUN_WAVES);
    expect(BOSS_WAVE).toBe(8);
    plans.forEach((p, i) => {
      expect(p.wave).toBe(i + 1);
      expect(p.boss).toBe(p.wave === 8);
      expect(p.orders.some((o) => o.kind === 'matriarch')).toBe(p.wave === 8);
    });
  });

  it('announces each wave elite up front and spawns exactly those elites', () => {
    for (const seed of [1, 2, 3, 99]) {
      for (const p of planRun(seed).slice(0, 7)) {
        expect(p.elites.length).toBeGreaterThan(0);
        const spawned = p.orders.filter((o) => o.elite).map((o) => o.kind);
        expect(spawned.sort()).toEqual([...p.elites].sort());
      }
    }
  });

  it('meets every elite family at least twice per run', () => {
    for (const seed of [1, 5, 8, 13, 21]) {
      const families = planRun(seed).flatMap((p) => p.elites);
      for (const f of ['burster', 'spitter', 'skitter']) expect(families.filter((x) => x === f).length).toBeGreaterThanOrEqual(2);
    }
  });

  it('rolls the same offer again from a restored run', () => {
    const run = createRun(77, 300);
    run.offers = 3;
    const restored = deserializeRun(serializeRun(run));
    expect(rollOffer(restored, 'skitter')).toEqual(rollOffer(run, 'skitter'));
  });

  it('offers three distinct options with at least one graft, led by the dropping family', () => {
    for (let n = 0; n < 40; n++) {
      const run = createRun(n, 300);
      run.offers = n;
      run.loadout = n % 3 === 0 ? { leftArm: 'fuseKnuckle', rightArm: 'shardSling', back: 'quillMantle', core: 'bursterHeart' } : {};
      // Never all four grafts and all four runes at once: eight elites cannot pay for eight picks before the last relic.
      run.runes = n % 2 === 0 && n % 3 !== 0 ? [...RUNE_IDS] : [];
      const family = (['burster', 'spitter', 'skitter'] as const)[n % 3]!;
      const options = rollOffer(run, family);
      expect(options).toHaveLength(3);
      expect(new Set(options.map((o) => `${o.type}:${o.id}`)).size).toBe(3);
      const grafts = options.filter((o) => o.type === 'graft').map((o) => o.id as GraftId);
      expect(grafts.length).toBeGreaterThanOrEqual(1);
      const equipped = Object.values(run.loadout);
      for (const g of grafts) expect(equipped).not.toContain(g);
      const lead = options[0]!;
      expect(lead.type).toBe('graft');
      const familyFree = GRAFT_IDS.filter((id) => GRAFTS[id].family === family && !equipped.includes(id));
      if (familyFree.length > 0) expect(GRAFTS[lead.id as GraftId].family).toBe(family);
      for (const o of options) if (o.type === 'rune') expect(run.runes).not.toContain(o.id);
    }
  });
});
