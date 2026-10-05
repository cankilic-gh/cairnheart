import type { Vec2 } from '../hero/motion';

export type EnemyKind = 'burster' | 'spitter' | 'skitter' | 'matriarch';
export type EnemyPhase = 'emerging' | 'active' | 'dead';
export type EnemyMode =
  | 'chase'
  | 'fuse'
  | 'move'
  | 'aim'
  | 'crouch'
  | 'lunge'
  | 'recover'
  | 'walk'
  | 'slam'
  | 'nova'
  | 'summon';

interface BaseConfig {
  elite: boolean;
  maxHp: number;
  speed: number;
  radius: number;
  scale: number;
  /** Divides incoming knockback. */
  knockResist: number;
  /** Multiplies incoming stun duration. */
  stunResist: number;
  score: number;
  /** Top of the model in world units, for health bars and damage numbers. */
  height: number;
}

export interface BursterConfig extends BaseConfig {
  kind: 'burster';
  fuseTime: number;
  fuseRange: number;
  cancelRange: number;
  blastRadius: number;
  blastDamage: number;
}

export interface SpitterConfig extends BaseConfig {
  kind: 'spitter';
  preferMin: number;
  preferMax: number;
  aimTime: number;
  cooldown: number;
  shotSpeed: number;
  shotDamage: number;
}

export interface SkitterConfig extends BaseConfig {
  kind: 'skitter';
  lungeRange: number;
  crouchTime: number;
  lungeTime: number;
  lungeSpeed: number;
  biteDamage: number;
  recoverTime: number;
  cooldown: number;
}

export interface MatriarchConfig extends BaseConfig {
  kind: 'matriarch';
  slamRadius: number;
  slamReach: number;
  slamDamage: number;
  slamWindup: number;
  novaCount: number;
  novaSpeed: number;
  novaDamage: number;
  summonCount: number;
}

export type EnemyConfig = BursterConfig | SpitterConfig | SkitterConfig | MatriarchConfig;

export interface EnemyState {
  id: number;
  cfg: EnemyConfig;
  phase: EnemyPhase;
  mode: EnemyMode;
  /** Seconds spent in the current mode. */
  modeT: number;
  pos: Vec2;
  vel: Vec2;
  knock: Vec2;
  inward: Vec2;
  /** Locked attack direction (spit, lunge, slam). */
  aim: Vec2;
  yaw: number;
  hp: number;
  /** Delayed health shown as the pale "damage taken" chunk of the bar. */
  trailHp: number;
  stun: number;
  emerge: number;
  walk: number;
  hitFlash: number;
  damaged: boolean;
  /** Fuse for bursters; unused otherwise. */
  meter: number;
  /** 0..1 telegraph progress, read by the view (fuse blink, spit wind-up, crouch, boss charge). */
  charge: number;
  cooldown: number;
  strafe: 1 | -1;
  strafeT: number;
  hitDone: boolean;
  pattern: number;
}

export type EnemyEvent =
  | { type: 'explode'; source: EnemyState; radius: number; damage: number }
  | { type: 'shoot'; from: Vec2; dir: Vec2; speed: number; damage: number; y: number }
  | { type: 'bite'; source: EnemyState; damage: number }
  | { type: 'telegraph'; at: Vec2; radius: number; duration: number }
  | { type: 'slam'; source: EnemyState; at: Vec2; radius: number; damage: number }
  | { type: 'summon'; source: EnemyState; count: number };
