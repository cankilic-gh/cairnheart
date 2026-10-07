import { describe, expect, it } from 'vitest';
import { ATTACKS, ATTACK_IDS, COOLDOWNS } from '../../src/combat/attacks';
import {
  FAMILIES,
  GRAFTS,
  GRAFT_IDS,
  HERO_HURT_RADIUS,
  MECHANICAL_KEYS,
  SLOT_ATTACK,
  equip,
  heroHurtRadius,
  resolveAttacks,
  silhouetteRadius,
  type Loadout,
} from '../../src/game/grafts';
import { RUNES, RUNE_IDS, SPITE } from '../../src/game/runes';

const FLAT_STAT = /scale|mult|percent|bonus|%/i;

describe('grafts', () => {
  it('ships six greybox grafts: two per arm, one back, one core', () => {
    const bySlot = (slot: string) => GRAFT_IDS.filter((id) => GRAFTS[id].slot === slot).length;
    expect(GRAFT_IDS).toHaveLength(6);
    expect([bySlot('leftArm'), bySlot('rightArm'), bySlot('back'), bySlot('core'), bySlot('crown')]).toEqual([2, 2, 1, 1, 0]);
  });

  it('gives every elite family two grafts', () => {
    for (const family of FAMILIES) expect(GRAFT_IDS.filter((id) => GRAFTS[id].family === family)).toHaveLength(2);
  });

  it('leaves every attack at its base spec with nothing grafted', () => {
    expect(resolveAttacks({}, [])).toEqual(ATTACKS);
  });

  it('removes the old effect completely when a slot changes hands', () => {
    const first = equip({}, 'fuseKnuckle');
    expect(first.replaced).toBeNull();
    const second = equip(first.loadout, 'hookClaw');
    expect(second.replaced).toBe('fuseKnuckle');
    expect(second.loadout).toEqual({ leftArm: 'hookClaw' });
    const resolved = resolveAttacks(second.loadout, []);
    expect(resolved).toEqual(resolveAttacks({ leftArm: 'hookClaw' }, []));
    expect(resolved.swipeL.behaviors.map((b) => b.kind)).not.toContain('fuse');
    expect(resolved.swipeR).toEqual(ATTACKS.swipeR);
  });

  it('does not mutate the loadout it was given', () => {
    const before: Loadout = { core: 'bursterHeart' };
    equip(before, 'quillMantle');
    expect(before).toEqual({ core: 'bursterHeart' });
  });

  it('never grants a flat percentage: each graft reshapes or re-sources one attack and leaves damage alone', () => {
    for (const id of GRAFT_IDS) {
      const g = GRAFTS[id];
      expect(Object.keys(g.patch).every((k) => (MECHANICAL_KEYS as readonly string[]).includes(k))).toBe(true);
      expect(JSON.stringify(g.patch)).not.toMatch(FLAT_STAT);
      const resolved = resolveAttacks({ [g.slot]: id }, []);
      for (const a of ATTACK_IDS) expect(resolved[a].damage).toBe(ATTACKS[a].damage);
      const target = SLOT_ATTACK[g.slot];
      const reshaped = JSON.stringify(resolved[target].shape) !== JSON.stringify(ATTACKS[target].shape);
      const resourced = resolved[target].behaviors.length > ATTACKS[target].behaviors.length;
      expect(reshaped || resourced, id).toBe(true);
      for (const a of ATTACK_IDS) if (a !== target) expect(resolved[a]).toEqual(ATTACKS[a]);
    }
  });

  it('builds a visible part for every graft', () => {
    for (const id of GRAFT_IDS) {
      const boxes = GRAFTS[id].recipe.boxes;
      expect(boxes.length).toBeGreaterThan(0);
      expect(boxes.some((b) => (b.glow ?? 0) > 0)).toBe(true);
    }
  });

  it('grows the silhouette but never the hurtbox', () => {
    const full: Loadout = { leftArm: 'hookClaw', rightArm: 'mantisScythe', back: 'quillMantle', core: 'bursterHeart' };
    expect(silhouetteRadius(full)).toBeGreaterThan(silhouetteRadius({}));
    for (const id of GRAFT_IDS) {
      const one = { [GRAFTS[id].slot]: id };
      expect(silhouetteRadius(one), id).toBeGreaterThanOrEqual(silhouetteRadius({}));
      expect(heroHurtRadius(one)).toBe(HERO_HURT_RADIUS);
    }
    expect(heroHurtRadius(full)).toBe(HERO_HURT_RADIUS);
    expect(HERO_HURT_RADIUS).toBeLessThan(silhouetteRadius({}));
  });

  it('does not touch cooldowns', () => {
    const before = { ...COOLDOWNS };
    resolveAttacks({ leftArm: 'fuseKnuckle', back: 'quillMantle', core: 'bursterHeart' }, [...RUNE_IDS]);
    expect(COOLDOWNS).toEqual(before);
  });
});

describe('runes', () => {
  it('ships four mechanical runes', () => {
    expect(RUNE_IDS).toHaveLength(4);
  });

  it('never grants a flat percentage either', () => {
    for (const id of RUNE_IDS) {
      const r = RUNES[id];
      expect(JSON.stringify(r)).not.toMatch(FLAT_STAT);
      if (!r.patch) continue;
      expect(Object.keys(r.patch).every((k) => (MECHANICAL_KEYS as readonly string[]).includes(k))).toBe(true);
      const resolved = resolveAttacks({}, [id]);
      const target = r.attack!;
      expect(resolved[target].damage).toBe(ATTACKS[target].damage);
      expect(resolved[target].behaviors.length).toBeGreaterThan(ATTACKS[target].behaviors.length);
    }
    expect(JSON.stringify(SPITE)).not.toMatch(FLAT_STAT);
  });

  it('stack on top of grafts without erasing them', () => {
    const resolved = resolveAttacks({ back: 'quillMantle' }, ['vortex']);
    expect(resolved.spin.behaviors.map((b) => b.kind)).toEqual(['shot', 'vortex']);
    expect(resolved.spin.shape.kind).toBe('none');
  });
});
