import { ATTACKS, type AttackId, type AttackSpec, type Behavior, type HitShape, type PoseId } from '../combat/attacks';
import { RUNES, type RuneId } from './runes';

export type GraftSlot = 'leftArm' | 'rightArm' | 'back' | 'core' | 'crown';
export const SLOTS: readonly GraftSlot[] = ['leftArm', 'rightArm', 'back', 'core', 'crown'];

export const SLOT_LABEL: Readonly<Record<GraftSlot, string>> = {
  leftArm: 'Left arm',
  rightArm: 'Right arm',
  back: 'Back',
  core: 'Core',
  crown: 'Crown',
};

/** The one attack each slot rewires. Crown is reserved for the quake (no greybox graft yet). */
export const SLOT_ATTACK: Readonly<Record<GraftSlot, AttackId>> = {
  leftArm: 'swipeL',
  rightArm: 'swipeR',
  back: 'spin',
  core: 'beam',
  crown: 'quake',
};

export const ATTACK_LABEL: Readonly<Record<AttackId, string>> = {
  swipeR: 'Swipe 1',
  swipeL: 'Swipe 2',
  slam: 'Slam',
  beam: 'Core Beam',
  spin: 'Spin',
  quake: 'Quake',
};

/** Elite kinds; an elite drops grafts of its own family. */
export type Family = 'burster' | 'spitter' | 'skitter';
export const FAMILIES: readonly Family[] = ['burster', 'spitter', 'skitter'];
export const FAMILY_COLOR: Readonly<Record<Family, number>> = { burster: 0xff5a24, spitter: 0x4fd8ff, skitter: 0x9dff4f };
export const FAMILY_LABEL: Readonly<Record<Family, string>> = { burster: 'Burster', spitter: 'Spitter', skitter: 'Skitter' };

export type GraftId = 'fuseKnuckle' | 'hookClaw' | 'shardSling' | 'mantisScythe' | 'quillMantle' | 'bursterHeart';

/** Fields a graft or rune may touch: geometry, timing and new mechanics. Damage and cooldowns are not among them. */
export const MECHANICAL_KEYS = ['shape', 'hits', 'duration', 'behaviors', 'pose'] as const;

export interface AttackPatch {
  shape?: HitShape;
  hits?: readonly number[];
  duration?: number;
  /** Appended to the attack's behaviors. */
  behaviors?: readonly Behavior[];
  pose?: PoseId;
}

type Range = readonly [number, number];

/** One greybox block of a graft, in hero pixel units (1/15 world units) relative to the slot mount. */
export interface PartBox {
  x: Range;
  y: Range;
  z: Range;
  color: number;
  /** Emissive strength of the block, 0 for plain stone. */
  glow?: number;
}

export interface PartRecipe {
  boxes: readonly PartBox[];
}

export interface GraftDef {
  id: GraftId;
  name: string;
  family: Family;
  slot: GraftSlot;
  text: string;
  patch: AttackPatch;
  recipe: PartRecipe;
}

const BURST = FAMILY_COLOR.burster;
const SHARD = FAMILY_COLOR.spitter;
const ACID = FAMILY_COLOR.skitter;

const spikes = (xs: readonly number[], y: Range, z: Range, color: number, glow: number): PartBox[] =>
  xs.map((x) => ({ x: [x - 1, x + 1], y, z, color, glow }));

export const GRAFTS: Readonly<Record<GraftId, GraftDef>> = {
  fuseKnuckle: {
    id: 'fuseKnuckle',
    name: 'Fuse Knuckle',
    family: 'burster',
    slot: 'leftArm',
    text: 'Swipe 2 plants a fuse in everything it hits. 0.9 s later each one bursts, hurting all within 2.4 m.',
    patch: { behaviors: [{ kind: 'fuse', delay: 0.9, radius: 2.4, damage: 34 }] },
    recipe: {
      boxes: [
        { x: [-7, 7], y: [-12, 2], z: [-7, 7], color: 0x3b2f4a },
        { x: [-6, -2], y: [-10, -4], z: [7, 10], color: BURST, glow: 1 },
        { x: [2, 6], y: [-10, -4], z: [7, 10], color: BURST, glow: 1 },
        { x: [-2, 2], y: [-4, 2], z: [7, 11], color: BURST, glow: 1 },
        { x: [7, 11], y: [-9, 1], z: [-2, 2], color: BURST, glow: 0.6 },
      ],
    },
  },
  hookClaw: {
    id: 'hookClaw',
    name: 'Hook Claw',
    family: 'skitter',
    slot: 'leftArm',
    text: 'Swipe 2 becomes a lunge: you dash 2.6 m and rake a long, narrow line up to 4.6 m.',
    patch: {
      shape: { kind: 'arc', range: 4.6, halfAngle: 0.5 },
      // The rake lands once the dash is over, so the line starts where the golem ends up.
      hits: [0.19],
      behaviors: [{ kind: 'lunge', distance: 2.6, until: 0.4 }],
      pose: 'claw',
    },
    recipe: {
      boxes: [
        { x: [-5, 5], y: [-6, 4], z: [-5, 5], color: 0x2f3a2a },
        ...spikes([-3, 0, 3], [-22, -6], [2, 5], ACID, 0.8),
        ...spikes([-3, 0, 3], [-25, -20], [5, 11], ACID, 1),
      ],
    },
  },
  shardSling: {
    id: 'shardSling',
    name: 'Shard Sling',
    family: 'spitter',
    slot: 'rightArm',
    text: 'Swipe 1 also flings a crystal shard 10 m ahead that pierces every foe in its path.',
    patch: { behaviors: [{ kind: 'shot', count: 1, spread: 0, speed: 20, range: 10, damage: 26, pierce: true, radial: false }] },
    recipe: {
      boxes: [
        { x: [-6, 6], y: [-8, 4], z: [-6, 6], color: 0x253a44 },
        { x: [-2, 2], y: [-4, 11], z: [6, 10], color: SHARD, glow: 1 },
        { x: [-7, -3], y: [-2, 7], z: [5, 8], color: SHARD, glow: 0.9 },
        { x: [3, 7], y: [-2, 7], z: [5, 8], color: SHARD, glow: 0.9 },
        { x: [-4, 4], y: [-13, -8], z: [-3, 3], color: SHARD, glow: 0.5 },
      ],
    },
  },
  mantisScythe: {
    id: 'mantisScythe',
    name: 'Mantis Scythe',
    family: 'skitter',
    slot: 'rightArm',
    text: 'Swipe 1 reaps a far band 1.6-4.8 m out and drags whatever it catches to your feet.',
    patch: {
      shape: { kind: 'arc', range: 4.8, halfAngle: 0.95, inner: 1.6 },
      behaviors: [{ kind: 'pull', to: 2 }],
    },
    recipe: {
      boxes: [
        { x: [-4, 4], y: [-8, 2], z: [-4, 4], color: 0x2f3a2a },
        { x: [-1, 1], y: [-12, -8], z: [-6, 24], color: ACID, glow: 0.9 },
        { x: [-1, 1], y: [-17, -12], z: [18, 24], color: ACID, glow: 1 },
      ],
    },
  },
  quillMantle: {
    id: 'quillMantle',
    name: 'Quill Mantle',
    family: 'spitter',
    slot: 'back',
    text: 'Spin stops cutting. Every turn sprays 6 quills outward instead, each flying 7 m.',
    patch: {
      shape: { kind: 'none' },
      behaviors: [{ kind: 'shot', count: 6, spread: 0, speed: 15, range: 7, damage: 14, pierce: false, radial: true }],
    },
    recipe: {
      boxes: [
        { x: [-12, 12], y: [-6, 8], z: [-4, 0], color: 0x253a44 },
        ...spikes([-9, -4.5, 0, 4.5, 9], [4, 20], [-9, -4], SHARD, 0.55),
      ],
    },
  },
  bursterHeart: {
    id: 'bursterHeart',
    name: 'Burster Heart',
    family: 'burster',
    slot: 'core',
    text: 'Core Beam becomes a heart nova: a 4.2 m blast all around you that fires in half the time.',
    patch: { shape: { kind: 'circle', radius: 4.2, forward: 0 }, duration: 0.9, hits: [0.38], pose: 'nova' },
    recipe: {
      boxes: [
        { x: [-7, 7], y: [-6, 8], z: [0, 7], color: 0x8a2d5a, glow: 0.35 },
        { x: [-4, 4], y: [-3, 5], z: [7, 10], color: BURST, glow: 1 },
        { x: [-10, -7], y: [-1, 3], z: [1, 5], color: BURST, glow: 0.9 },
        { x: [7, 10], y: [-1, 3], z: [1, 5], color: BURST, glow: 0.9 },
        { x: [-1, 1], y: [8, 12], z: [2, 5], color: BURST, glow: 0.9 },
      ],
    },
  },
};

export const GRAFT_IDS = Object.keys(GRAFTS) as GraftId[];

export type Loadout = Partial<Record<GraftSlot, GraftId>>;

/** Puts a graft in its slot. Whatever was there before comes off entirely. */
export const equip = (loadout: Loadout, id: GraftId): { loadout: Loadout; replaced: GraftId | null } => {
  const slot = GRAFTS[id].slot;
  const before = loadout[slot] ?? null;
  return { loadout: { ...loadout, [slot]: id }, replaced: before === id ? null : before };
};

export const isEquipped = (loadout: Loadout, id: GraftId): boolean => loadout[GRAFTS[id].slot] === id;

export const applyPatch = (spec: AttackSpec, patch: AttackPatch): AttackSpec => ({
  ...spec,
  ...(patch.shape ? { shape: patch.shape } : {}),
  ...(patch.hits ? { hits: patch.hits } : {}),
  ...(patch.duration !== undefined ? { duration: patch.duration } : {}),
  ...(patch.pose ? { pose: patch.pose } : {}),
  behaviors: [...spec.behaviors, ...(patch.behaviors ?? [])],
});

/** Every attack as the hero will actually throw it: base spec, then the slot's graft, then runes. */
export const resolveAttacks = (loadout: Loadout, runes: readonly RuneId[]): Record<AttackId, AttackSpec> => {
  const out = { ...ATTACKS } as Record<AttackId, AttackSpec>;
  for (const id of Object.values(loadout)) {
    const g = GRAFTS[id];
    const target = SLOT_ATTACK[g.slot];
    out[target] = applyPatch(out[target], g.patch);
  }
  for (const r of runes) {
    const def = RUNES[r];
    if (def.attack && def.patch) out[def.attack] = applyPatch(out[def.attack], def.patch);
  }
  return out;
};

/** The hero's damage-taking circle. Fixed: grafts make the golem look bigger, never easier to hit. */
export const HERO_HURT_RADIUS = 0.95;
export const heroHurtRadius = (_loadout: Loadout): number => HERO_HURT_RADIUS;

const PX = 1 / 15;

/** Top-down origin of each slot mount in hero pixel space; mirrors buildHero (arm pivots at x ±16, head at z 8). */
const SLOT_ORIGIN: Readonly<Record<GraftSlot, { x: number; z: number }>> = {
  leftArm: { x: 16, z: 0 },
  rightArm: { x: -16, z: 0 },
  back: { x: 0, z: -10 },
  core: { x: 0, z: 12 },
  crown: { x: 0, z: 9 },
};

/** Footprint of the bare golem (body, plates, arms) in pixel space. */
const BASE_FOOTPRINT: ReadonlyArray<{ x: Range; z: Range }> = [
  { x: [-12, 12], z: [-12, 14] },
  { x: [12, 20], z: [-4, 4] },
  { x: [-20, -12], z: [-4, 4] },
];

const farCorner = (x: Range, z: Range): number => Math.max(...x.flatMap((a) => z.map((b) => Math.hypot(a, b))));

/** Furthest point of the standing silhouette from the hero's centre, in world units. */
export const silhouetteRadius = (loadout: Loadout): number => {
  let r = Math.max(...BASE_FOOTPRINT.map((b) => farCorner(b.x, b.z)));
  for (const id of Object.values(loadout)) {
    const g = GRAFTS[id];
    const o = SLOT_ORIGIN[g.slot];
    for (const b of g.recipe.boxes) {
      r = Math.max(r, farCorner([b.x[0] + o.x, b.x[1] + o.x], [b.z[0] + o.z, b.z[1] + o.z]));
    }
  }
  return r * PX;
};

/** Slot mount points in hero pixel space, relative to the rig group named by `parent`. */
export const SLOT_MOUNT: Readonly<Record<GraftSlot, { parent: 'armL' | 'armR' | 'torso' | 'head'; at: readonly [number, number, number] }>> = {
  leftArm: { parent: 'armL', at: [0, -24, 0] },
  rightArm: { parent: 'armR', at: [0, -24, 0] },
  back: { parent: 'torso', at: [0, 14, -10] },
  core: { parent: 'torso', at: [0, 12, 12] },
  crown: { parent: 'head', at: [0, 8, 1] },
};
