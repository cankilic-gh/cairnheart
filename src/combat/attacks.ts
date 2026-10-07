export type Ability = 'attack' | 'beam' | 'spin' | 'quake';
export type AttackId = 'swipeR' | 'swipeL' | 'slam' | 'beam' | 'spin' | 'quake';

export const ABILITIES: readonly Ability[] = ['attack', 'beam', 'spin', 'quake'];
export const ATTACK_IDS: readonly AttackId[] = ['swipeR', 'swipeL', 'slam', 'beam', 'spin', 'quake'];

export type HitShape =
  | { kind: 'arc'; range: number; halfAngle: number; /** Dead zone near the body; the arc only bites from here outward. */ inner?: number }
  | { kind: 'circle'; radius: number; forward: number }
  | { kind: 'beam'; length: number; halfWidth: number }
  | { kind: 'none' };

/**
 * Extra mechanics a graft or rune bolts onto an attack. Each one changes where, when or how an
 * attack lands; none of them scales a number on the base attack.
 */
export type Behavior =
  /** Fires shards: straight ahead in a fan, or `radial` all around (rotated per hit). */
  | { kind: 'shot'; count: number; spread: number; speed: number; range: number; damage: number; pierce: boolean; radial: boolean }
  /** Struck enemies carry a fuse and burst `delay` seconds later, hurting everything nearby. */
  | { kind: 'fuse'; delay: number; radius: number; damage: number }
  /** The hero dashes `distance` along the aim over the first `until` of the action. */
  | { kind: 'lunge'; distance: number; until: number }
  /** Struck enemies are dragged toward the hero instead of thrown away, ending about `to` from it. */
  | { kind: 'pull'; to: number }
  /** The same strike lands again `delay` seconds later, `forward` further along the aim. */
  | { kind: 'echo'; delay: number; forward: number }
  /** Each hit drags enemies inside `radius` inward; the last hit throws them out. */
  | { kind: 'vortex'; radius: number; to: number; fling: number };

export type BehaviorKind = Behavior['kind'];
export type PoseId = AttackId | 'nova' | 'claw';

/** The part of an attack that decides what it does to enemies once it lands. */
export interface Strike {
  damage: number;
  shape: HitShape;
  knockback: number;
  stun: number;
  /** Snuffs fuses and cancels wind-ups. */
  interrupts: boolean;
  behaviors: readonly Behavior[];
}

export interface AttackSpec extends Strike {
  id: AttackId;
  ability: Ability;
  duration: number;
  /** Seconds into the action at which hit checks fire. */
  hits: readonly number[];
  hitStop: number;
  shake: number;
  /** Fraction of normal movement speed allowed while the action plays. */
  moveScale: number;
  /** Whether the hero's facing is pinned to the aim direction. */
  lockFacing: boolean;
  pose: PoseId;
}

const swipe = (id: 'swipeR' | 'swipeL'): AttackSpec => ({
  id,
  ability: 'attack',
  duration: 0.44,
  hits: [0.14],
  damage: 30,
  shape: { kind: 'arc', range: 3.2, halfAngle: 1.25 },
  knockback: 6,
  stun: 0.3,
  interrupts: false,
  behaviors: [],
  hitStop: 0.05,
  shake: 0.12,
  moveScale: 0.35,
  lockFacing: true,
  pose: id,
});

export const ATTACKS: Readonly<Record<AttackId, AttackSpec>> = {
  swipeR: swipe('swipeR'),
  swipeL: swipe('swipeL'),
  slam: {
    id: 'slam',
    ability: 'attack',
    duration: 0.78,
    hits: [0.4],
    damage: 55,
    shape: { kind: 'circle', radius: 2.5, forward: 1.8 },
    knockback: 9,
    stun: 0.6,
    interrupts: false,
    behaviors: [],
    hitStop: 0.08,
    shake: 0.35,
    moveScale: 0.1,
    lockFacing: true,
    pose: 'slam',
  },
  beam: {
    id: 'beam',
    ability: 'beam',
    duration: 1.25,
    hits: [0.52],
    damage: 90,
    shape: { kind: 'beam', length: 14, halfWidth: 0.9 },
    knockback: 13,
    stun: 0.8,
    interrupts: false,
    behaviors: [],
    hitStop: 0.07,
    shake: 0.45,
    moveScale: 0,
    lockFacing: true,
    pose: 'beam',
  },
  spin: {
    id: 'spin',
    ability: 'spin',
    duration: 1.6,
    hits: [0.2, 0.45, 0.7, 0.95, 1.2, 1.45],
    damage: 16,
    shape: { kind: 'circle', radius: 3.0, forward: 0 },
    knockback: 5,
    stun: 0.25,
    interrupts: false,
    behaviors: [],
    hitStop: 0,
    shake: 0.06,
    moveScale: 0.65,
    lockFacing: false,
    pose: 'spin',
  },
  quake: {
    id: 'quake',
    ability: 'quake',
    duration: 1.6,
    hits: [0.42],
    damage: 0,
    shape: { kind: 'circle', radius: 6, forward: 0 },
    knockback: 11,
    stun: 1.4,
    interrupts: true,
    behaviors: [],
    hitStop: 0,
    shake: 0.4,
    moveScale: 0.2,
    lockFacing: false,
    pose: 'quake',
  },
};

export const COOLDOWNS: Readonly<Record<Ability, number>> = { attack: 0, beam: 6, spin: 8, quake: 12 };

export const COMBO: readonly AttackId[] = ['swipeR', 'swipeL', 'slam'];
export const COMBO_WINDOW = 0.45;
/** Progress after which a new request is buffered instead of dropped. */
export const BUFFER_FROM = 0.45;
/** Hits on an enemy that is winding up an attack are counter-hits: double damage, and the only numbers shown. */
export const COUNTER_MULTIPLIER = 2;
