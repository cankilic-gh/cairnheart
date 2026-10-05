export type Ability = 'attack' | 'beam' | 'spin' | 'quake';
export type AttackId = 'swipeR' | 'swipeL' | 'slam' | 'beam' | 'spin' | 'quake';

export const ABILITIES: readonly Ability[] = ['attack', 'beam', 'spin', 'quake'];

export type HitShape =
  | { kind: 'arc'; range: number; halfAngle: number }
  | { kind: 'circle'; radius: number; forward: number }
  | { kind: 'beam'; length: number; halfWidth: number };

export interface AttackSpec {
  id: AttackId;
  ability: Ability;
  duration: number;
  /** Seconds into the action at which hit checks fire. */
  hits: readonly number[];
  damage: number;
  shape: HitShape;
  knockback: number;
  stun: number;
  hitStop: number;
  shake: number;
  /** Fraction of normal movement speed allowed while the action plays. */
  moveScale: number;
  /** Whether the hero's facing is pinned to the aim direction. */
  lockFacing: boolean;
}

const swipe = (id: 'swipeR' | 'swipeL'): AttackSpec => ({
  id,
  ability: 'attack',
  duration: 0.5,
  hits: [0.19],
  damage: 30,
  shape: { kind: 'arc', range: 3.2, halfAngle: 1.25 },
  knockback: 6,
  stun: 0.3,
  hitStop: 0.05,
  shake: 0.12,
  moveScale: 0.35,
  lockFacing: true,
});

export const ATTACKS: Record<AttackId, AttackSpec> = {
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
    hitStop: 0.08,
    shake: 0.35,
    moveScale: 0.1,
    lockFacing: true,
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
    hitStop: 0.07,
    shake: 0.45,
    moveScale: 0,
    lockFacing: true,
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
    hitStop: 0,
    shake: 0.06,
    moveScale: 0.65,
    lockFacing: false,
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
    hitStop: 0,
    shake: 0.4,
    moveScale: 0.2,
    lockFacing: false,
  },
};

export const COOLDOWNS: Record<Ability, number> = { attack: 0, beam: 6, spin: 8, quake: 12 };

export const COMBO: readonly AttackId[] = ['swipeR', 'swipeL', 'slam'];
export const COMBO_WINDOW = 0.45;
/** Progress after which a new request is buffered instead of dropped. */
export const BUFFER_FROM = 0.45;
