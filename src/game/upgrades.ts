import type { Ability } from '../combat/attacks';
import type { Rng } from '../core/rng';

export type UpgradeId = 'fists' | 'reach' | 'overcharge' | 'whirlwind' | 'aftershock' | 'hide' | 'siphon' | 'stride';

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  max: number;
  text: string;
}

export const UPGRADES: Record<UpgradeId, UpgradeDef> = {
  fists: { id: 'fists', name: 'Heavy Fists', max: 5, text: 'Swipe and slam hit 20% harder.' },
  reach: { id: 'reach', name: 'Long Reach', max: 3, text: 'Swipe range and slam radius +12%.' },
  overcharge: { id: 'overcharge', name: 'Overcharge', max: 3, text: 'Core Beam recharges 18% faster and hits 15% harder.' },
  whirlwind: { id: 'whirlwind', name: 'Whirlwind', max: 3, text: 'Spin recharges 15% faster, reaches 12% further and hits 15% harder.' },
  aftershock: { id: 'aftershock', name: 'Aftershock', max: 3, text: 'Quake recharges 20% faster and now deals damage.' },
  hide: { id: 'hide', name: 'Stone Hide', max: 5, text: '+60 max health, restored right away.' },
  siphon: { id: 'siphon', name: 'Ember Siphon', max: 3, text: 'Every kill heals 4 health.' },
  stride: { id: 'stride', name: 'Stride', max: 3, text: 'Move 8% faster.' },
};

export const UPGRADE_IDS = Object.keys(UPGRADES) as UpgradeId[];

export type UpgradeLevels = Partial<Record<UpgradeId, number>>;

export interface HeroStats {
  maxHp: number;
  meleeDamage: number;
  reach: number;
  beamDamage: number;
  spinDamage: number;
  spinRadius: number;
  quakeDamage: number;
  siphon: number;
  moveSpeed: number;
  cooldownScale: Record<Ability, number>;
}

export const statsFor = (levels: UpgradeLevels, baseHp: number): HeroStats => {
  const l = (id: UpgradeId) => levels[id] ?? 0;
  return {
    maxHp: baseHp + 60 * l('hide'),
    meleeDamage: 1 + 0.2 * l('fists'),
    reach: 1 + 0.12 * l('reach'),
    beamDamage: 1 + 0.15 * l('overcharge'),
    spinDamage: 1 + 0.15 * l('whirlwind'),
    spinRadius: 1 + 0.12 * l('whirlwind'),
    quakeDamage: l('aftershock') > 0 ? 20 + 15 * (l('aftershock') - 1) : 0,
    siphon: 4 * l('siphon'),
    moveSpeed: 1 + 0.08 * l('stride'),
    cooldownScale: {
      attack: 1,
      beam: 0.82 ** l('overcharge'),
      spin: 0.85 ** l('whirlwind'),
      quake: 0.8 ** l('aftershock'),
    },
  };
};

/** Picks up to `count` distinct upgrades that are not maxed yet. */
export const rollUpgrades = (levels: UpgradeLevels, rng: Rng, count = 3): UpgradeId[] => {
  const open = UPGRADE_IDS.filter((id) => (levels[id] ?? 0) < UPGRADES[id].max);
  for (let i = open.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [open[i], open[j]] = [open[j]!, open[i]!];
  }
  return open.slice(0, count);
};
