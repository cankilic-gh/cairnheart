import { clampToArena, wrapAngle, type Vec2 } from '../hero/motion';
import type {
  BursterConfig,
  EnemyConfig,
  EnemyEvent,
  EnemyKind,
  EnemyState,
  MatriarchConfig,
  SkitterConfig,
  SpitterConfig,
} from './types';

export const EMERGE_TIME = 0.9;

/** Elites differ by pattern (bigger blast, three-shot fan, double lunge), not just by health. */
export const configFor = (kind: EnemyKind, elite = false, speedScale = 1): EnemyConfig => {
  switch (kind) {
    case 'burster':
      return elite
        ? {
            kind,
            elite,
            maxHp: 160,
            speed: 1.9 * speedScale,
            radius: 0.6,
            scale: 1.4,
            knockResist: 1.8,
            stunResist: 1,
            score: 30,
            height: 1.75,
            fuseTime: 1.5,
            fuseRange: 2.7,
            cancelRange: 4.8,
            blastRadius: 4.2,
            blastDamage: 70,
          }
        : {
            kind,
            elite,
            maxHp: 60,
            speed: 2.4 * speedScale,
            radius: 0.45,
            scale: 1,
            knockResist: 1,
            stunResist: 1,
            score: 10,
            height: 1.25,
            fuseTime: 1.25,
            fuseRange: 2.3,
            cancelRange: 4.2,
            blastRadius: 3.2,
            blastDamage: 40,
          };
    case 'spitter':
      return {
        kind,
        elite,
        maxHp: elite ? 110 : 45,
        speed: 2.3 * speedScale,
        radius: elite ? 0.55 : 0.4,
        scale: elite ? 1.35 : 1,
        knockResist: elite ? 1.8 : 1,
        stunResist: 1,
        score: elite ? 35 : 15,
        height: elite ? 2.1 : 1.55,
        preferMin: 5.5,
        preferMax: 9,
        aimTime: elite ? 0.75 : 0.6,
        cooldown: elite ? 2.9 : 2.6,
        shotSpeed: 9,
        shotDamage: 16,
        fan: elite ? 3 : 1,
        fanSpread: elite ? 0.5 : 0,
      };
    case 'skitter':
      return {
        kind,
        elite,
        maxHp: elite ? 90 : 36,
        speed: 4 * speedScale,
        radius: elite ? 0.55 : 0.42,
        scale: elite ? 1.35 : 1,
        knockResist: elite ? 1.6 : 0.9,
        stunResist: 1,
        score: elite ? 35 : 12,
        height: elite ? 1.1 : 0.8,
        lungeRange: 4.6,
        crouchTime: 0.45,
        lungeTime: 0.38,
        lungeSpeed: 11,
        biteDamage: elite ? 18 : 14,
        recoverTime: 0.7,
        cooldown: elite ? 1.6 : 1.2,
        lunges: elite ? 2 : 1,
        relunge: 0.3,
      };
    case 'matriarch':
      return {
        kind,
        elite: true,
        maxHp: 2200,
        speed: 1.35 * speedScale,
        radius: 1.7,
        scale: 1.25,
        knockResist: 12,
        stunResist: 0.12,
        score: 300,
        height: 4,
        slamRadius: 3.6,
        slamReach: 3,
        slamDamage: 50,
        slamWindup: 1,
        novaCount: 14,
        novaSpeed: 7,
        novaDamage: 14,
        summonCount: 3,
      };
  }
};

const startMode = (kind: EnemyKind): EnemyState['mode'] =>
  kind === 'burster' || kind === 'skitter' ? 'chase' : kind === 'spitter' ? 'move' : 'walk';

export const createEnemy = (id: number, cfg: EnemyConfig, pos: Vec2, inward: Vec2): EnemyState => ({
  id,
  cfg,
  phase: 'emerging',
  mode: startMode(cfg.kind),
  modeT: 0,
  pos: { ...pos },
  vel: { x: 0, z: 0 },
  knock: { x: 0, z: 0 },
  inward: { ...inward },
  aim: { ...inward },
  yaw: Math.atan2(inward.x, inward.z),
  hp: cfg.maxHp,
  trailHp: cfg.maxHp,
  stun: 0,
  emerge: 0,
  walk: 0,
  hitFlash: 0,
  damaged: false,
  meter: 0,
  charge: 0,
  cooldown: cfg.kind === 'spitter' ? 1.2 : cfg.kind === 'matriarch' ? 2.5 : 0,
  strafe: id % 2 === 0 ? 1 : -1,
  strafeT: 1.5,
  hitDone: false,
  pattern: 0,
  chain: 0,
  marked: 0,
});

const setMode = (e: EnemyState, mode: EnemyState['mode']): void => {
  e.mode = mode;
  e.modeT = 0;
};

const crossed = (prev: number, now: number, t: number): boolean => prev < t && now >= t;

interface Frame {
  dx: number;
  dz: number;
  dist: number;
  nx: number;
  nz: number;
  targetRadius: number;
  prevT: number;
  dt: number;
  stunned: boolean;
  events: EnemyEvent[];
}

/** Each brain returns the velocity it wants this frame; null means "keep current velocity" (lunge). */
type Brain<C extends EnemyConfig> = (e: EnemyState, cfg: C, f: Frame) => Vec2 | null;

const toward = (f: Frame, speed: number): Vec2 => ({ x: f.nx * speed, z: f.nz * speed });

const burster: Brain<BursterConfig> = (e, cfg, f) => {
  if (e.mode === 'chase' && !f.stunned && f.dist <= cfg.fuseRange) setMode(e, 'fuse');
  if (e.mode === 'fuse') {
    if (f.dist > cfg.cancelRange) {
      e.meter = Math.max(0, e.meter - f.dt * 1.5);
      if (e.meter === 0) setMode(e, 'chase');
    } else if (!f.stunned) {
      e.meter += f.dt;
      if (e.meter >= cfg.fuseTime) {
        e.phase = 'dead';
        f.events.push({ type: 'explode', source: e, radius: cfg.blastRadius, damage: cfg.blastDamage });
      }
    }
  }
  e.charge = e.meter / cfg.fuseTime;
  if (f.stunned) return { x: 0, z: 0 };
  return toward(f, e.mode === 'fuse' ? cfg.speed * 0.25 : cfg.speed);
};

const spitter: Brain<SpitterConfig> = (e, cfg, f) => {
  if (f.stunned) {
    if (e.mode === 'aim') {
      setMode(e, 'move');
      e.cooldown = 0.6;
    }
    e.charge = 0;
    return { x: 0, z: 0 };
  }
  if (e.mode === 'move') {
    e.charge = 0;
    if (e.cooldown <= 0 && f.dist >= 2 && f.dist <= cfg.preferMax + 2) {
      setMode(e, 'aim');
      e.aim = { x: f.nx, z: f.nz };
      return { x: 0, z: 0 };
    }
    e.strafeT -= f.dt;
    if (e.strafeT <= 0) {
      e.strafe = e.strafe === 1 ? -1 : 1;
      e.strafeT = 1.4 + (e.id % 3) * 0.4;
    }
    if (f.dist > cfg.preferMax) return toward(f, cfg.speed);
    if (f.dist < cfg.preferMin) return toward(f, -cfg.speed * 0.9);
    return { x: -f.nz * e.strafe * cfg.speed * 0.55, z: f.nx * e.strafe * cfg.speed * 0.55 };
  }
  e.charge = Math.min(1, e.modeT / cfg.aimTime);
  if (e.modeT < cfg.aimTime * 0.7) e.aim = { x: f.nx, z: f.nz };
  if (crossed(f.prevT, e.modeT, cfg.aimTime)) {
    const base = Math.atan2(e.aim.x, e.aim.z);
    for (let i = 0; i < cfg.fan; i++) {
      const a = base + (cfg.fan > 1 ? (i / (cfg.fan - 1) - 0.5) * cfg.fanSpread : 0);
      const dir = { x: Math.sin(a), z: Math.cos(a) };
      f.events.push({
        type: 'shoot',
        source: e,
        from: { x: e.pos.x + dir.x * 0.5, z: e.pos.z + dir.z * 0.5 },
        dir,
        speed: cfg.shotSpeed,
        damage: cfg.shotDamage,
        y: 1.15 * cfg.scale,
        volley: i === 0 ? undefined : 'silent',
      });
    }
    setMode(e, 'move');
    e.cooldown = cfg.cooldown;
  }
  return { x: 0, z: 0 };
};

const skitter: Brain<SkitterConfig> = (e, cfg, f) => {
  if (f.stunned && (e.mode === 'crouch' || e.mode === 'lunge')) {
    setMode(e, 'recover');
    e.charge = 0;
  }
  switch (e.mode) {
    case 'chase':
      e.charge = 0;
      if (f.stunned) return { x: 0, z: 0 };
      if (e.cooldown <= 0 && f.dist <= cfg.lungeRange) {
        setMode(e, 'crouch');
        e.chain = 0;
        e.aim = { x: f.nx, z: f.nz };
        return { x: 0, z: 0 };
      }
      return toward(f, cfg.speed);
    case 'crouch': {
      const crouch = e.chain > 0 ? cfg.relunge : cfg.crouchTime;
      e.aim = { x: f.nx, z: f.nz };
      e.charge = Math.min(1, e.modeT / crouch);
      if (e.modeT >= crouch) {
        setMode(e, 'lunge');
        e.hitDone = false;
        e.vel = { x: e.aim.x * cfg.lungeSpeed, z: e.aim.z * cfg.lungeSpeed };
      }
      return { x: 0, z: 0 };
    }
    case 'lunge':
      e.charge = 1;
      if (!e.hitDone && f.dist <= cfg.radius + f.targetRadius + 0.25) {
        e.hitDone = true;
        f.events.push({ type: 'bite', source: e, damage: cfg.biteDamage });
      }
      if (e.modeT >= cfg.lungeTime) {
        e.chain += 1;
        setMode(e, e.chain < cfg.lunges ? 'crouch' : 'recover');
      }
      return null;
    default:
      e.charge = 0;
      if (e.modeT >= cfg.recoverTime) {
        setMode(e, 'chase');
        e.cooldown = cfg.cooldown;
      }
      return f.stunned ? { x: 0, z: 0 } : toward(f, cfg.speed * 0.3);
  }
};

const PATTERN: ReadonlyArray<'slam' | 'nova' | 'summon'> = ['slam', 'nova', 'slam', 'summon', 'nova'];

const ring = (e: EnemyState, cfg: MatriarchConfig, offset: number, events: EnemyEvent[]): void => {
  for (let i = 0; i < cfg.novaCount; i++) {
    const a = ((i + offset) / cfg.novaCount) * Math.PI * 2;
    const dir = { x: Math.sin(a), z: Math.cos(a) };
    events.push({
      type: 'shoot',
      source: e,
      from: { x: e.pos.x + dir.x * cfg.radius, z: e.pos.z + dir.z * cfg.radius },
      dir,
      speed: cfg.novaSpeed,
      damage: cfg.novaDamage,
      y: 1.4,
      volley: i === 0 ? 'lead' : 'silent',
    });
  }
};

export const slamCenter = (e: EnemyState, cfg: MatriarchConfig): Vec2 => ({
  x: e.pos.x + e.aim.x * cfg.slamReach,
  z: e.pos.z + e.aim.z * cfg.slamReach,
});

const matriarch: Brain<MatriarchConfig> = (e, cfg, f) => {
  const t = e.modeT;
  switch (e.mode) {
    case 'walk': {
      e.charge = 0;
      if (e.cooldown <= 0) {
        let next = PATTERN[e.pattern % PATTERN.length]!;
        e.pattern += 1;
        if (next === 'slam' && f.dist > 7) next = 'nova';
        setMode(e, next);
        e.hitDone = false;
        if (next === 'slam') {
          e.aim = { x: f.nx, z: f.nz };
          f.events.push({ type: 'telegraph', at: slamCenter(e, cfg), radius: cfg.slamRadius, duration: cfg.slamWindup });
        }
        return { x: 0, z: 0 };
      }
      return f.stunned || f.dist < cfg.radius + f.targetRadius + 0.6 ? { x: 0, z: 0 } : toward(f, cfg.speed);
    }
    case 'slam':
      e.charge = Math.min(1, t / cfg.slamWindup);
      if (!e.hitDone && t >= cfg.slamWindup) {
        e.hitDone = true;
        f.events.push({ type: 'slam', source: e, at: slamCenter(e, cfg), radius: cfg.slamRadius, damage: cfg.slamDamage });
      }
      if (t >= cfg.slamWindup + 0.6) {
        setMode(e, 'walk');
        e.cooldown = 1.6;
      }
      return { x: 0, z: 0 };
    case 'nova':
      e.charge = Math.min(1, t / 0.8);
      if (crossed(f.prevT, t, 0.8)) ring(e, cfg, 0, f.events);
      if (crossed(f.prevT, t, 1.4)) ring(e, cfg, 0.5, f.events);
      if (t >= 1.9) {
        setMode(e, 'walk');
        e.cooldown = 1.8;
      }
      return { x: 0, z: 0 };
    default:
      e.charge = Math.min(1, t / 0.9);
      if (crossed(f.prevT, t, 0.9)) f.events.push({ type: 'summon', source: e, count: cfg.summonCount });
      if (t >= 1.5) {
        setMode(e, 'walk');
        e.cooldown = 2;
      }
      return { x: 0, z: 0 };
  }
};

const FACES_AIM = new Set<EnemyState['mode']>(['aim', 'crouch', 'lunge', 'slam']);
const WINDUP_MODES = new Set<EnemyState['mode']>(['fuse', 'aim', 'crouch', 'slam', 'nova', 'summon']);

/** True while the enemy telegraphs an attack; hits landed now are counter-hits. */
export const windingUp = (e: EnemyState): boolean =>
  e.phase === 'active' && WINDUP_MODES.has(e.mode) && e.charge > 0 && e.charge < 1;

/** Every number an enemy can hurt the hero with, for the single-hit cap check. */
export const enemyHitDamages = (c: EnemyConfig): number[] => {
  switch (c.kind) {
    case 'burster':
      return [c.blastDamage];
    case 'spitter':
      return [c.shotDamage];
    case 'skitter':
      return [c.biteDamage];
    case 'matriarch':
      return [c.slamDamage, c.novaDamage];
  }
};

/** Advances one enemy and returns what it did this frame. */
export const stepEnemy = (e: EnemyState, target: Vec2, targetRadius: number, dt: number): EnemyEvent[] => {
  if (e.phase === 'dead' || dt <= 0) return [];
  const events: EnemyEvent[] = [];
  e.hitFlash = Math.max(0, e.hitFlash - dt);
  e.marked = Math.max(0, e.marked - dt);
  e.stun = Math.max(0, e.stun - dt);
  e.cooldown = Math.max(0, e.cooldown - dt);
  if (e.trailHp > e.hp) e.trailHp = Math.max(e.hp, e.trailHp - e.cfg.maxHp * 0.9 * dt);

  const dx = target.x - e.pos.x;
  const dz = target.z - e.pos.z;
  const dist = Math.hypot(dx, dz);
  const prevT = e.modeT;
  e.modeT += dt;
  const f: Frame = {
    dx,
    dz,
    dist,
    nx: dist > 1e-6 ? dx / dist : 0,
    nz: dist > 1e-6 ? dz / dist : 0,
    targetRadius,
    prevT,
    dt,
    stunned: e.stun > 0,
    events,
  };

  let want: Vec2 | null;
  if (e.phase === 'emerging') {
    e.emerge += dt;
    want = { x: e.inward.x * e.cfg.speed * 0.7, z: e.inward.z * e.cfg.speed * 0.7 };
    if (e.emerge >= EMERGE_TIME) {
      e.phase = 'active';
      e.modeT = 0;
    }
  } else {
    const cfg = e.cfg;
    want =
      cfg.kind === 'burster'
        ? burster(e, cfg, f)
        : cfg.kind === 'spitter'
          ? spitter(e, cfg, f)
          : cfg.kind === 'skitter'
            ? skitter(e, cfg, f)
            : matriarch(e, cfg, f);
  }

  if (want) {
    const k = 1 - Math.exp(-dt * 10);
    e.vel.x += (want.x - e.vel.x) * k;
    e.vel.z += (want.z - e.vel.z) * k;
  }
  const kd = Math.exp(-dt * 5);
  e.knock.x *= kd;
  e.knock.z *= kd;
  e.pos.x += (e.vel.x + e.knock.x) * dt;
  e.pos.z += (e.vel.z + e.knock.z) * dt;
  e.walk += Math.hypot(e.vel.x, e.vel.z) * dt * 3.2;

  if (e.phase === 'active' && !f.stunned) {
    const faceAim = FACES_AIM.has(e.mode);
    const goal = faceAim ? Math.atan2(e.aim.x, e.aim.z) : Math.atan2(dx, dz);
    if (faceAim || dist > 0.05) {
      const turn = (e.cfg.kind === 'matriarch' ? 2.5 : 8) * dt;
      e.yaw = wrapAngle(e.yaw + Math.max(-turn, Math.min(turn, wrapAngle(goal - e.yaw))));
    }
  }
  return events;
};

/** Applies damage and knockback. Returns true when this hit killed the enemy. */
export const damageEnemy = (e: EnemyState, amount: number, dir: Vec2, knock: number, stun: number): boolean => {
  if (e.phase === 'dead') return false;
  e.hp = Math.max(0, e.hp - amount);
  e.damaged = true;
  e.hitFlash = 0.14;
  pushEnemy(e, dir, knock, stun, false);
  if (e.hp <= 0) {
    e.phase = 'dead';
    return true;
  }
  return false;
};

/** Knockback without damage; `interrupt` also snuffs a fuse and cancels wind-ups (quake). */
export const pushEnemy = (e: EnemyState, dir: Vec2, knock: number, stun: number, interrupt: boolean): void => {
  if (e.phase === 'dead') return;
  const k = knock / e.cfg.knockResist;
  e.knock.x += dir.x * k;
  e.knock.z += dir.z * k;
  e.stun = Math.max(e.stun, stun * e.cfg.stunResist);
  if (e.phase === 'emerging') {
    e.phase = 'active';
    e.modeT = 0;
  }
  if (!interrupt) return;
  if (e.cfg.kind === 'burster') {
    e.meter = 0;
    e.charge = 0;
    if (e.mode === 'fuse') setMode(e, 'chase');
  } else if (e.cfg.kind === 'spitter' && e.mode === 'aim') {
    setMode(e, 'move');
    e.cooldown = 1;
  } else if (e.cfg.kind === 'skitter' && (e.mode === 'crouch' || e.mode === 'lunge')) {
    setMode(e, 'recover');
  }
};

/** Pushes enemies apart, out of the hero's body, and back inside the arena once they have emerged. */
export const separate = (list: readonly EnemyState[], hero: Vec2, heroRadius: number, arenaRadius: number): void => {
  for (let i = 0; i < list.length; i++) {
    const a = list[i]!;
    if (a.phase === 'dead') continue;
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j]!;
      if (b.phase === 'dead') continue;
      const dx = b.pos.x - a.pos.x;
      const dz = b.pos.z - a.pos.z;
      const d = Math.hypot(dx, dz);
      const overlap = a.cfg.radius + b.cfg.radius - d;
      if (overlap <= 0) continue;
      const nx = d > 1e-6 ? dx / d : 1;
      const nz = d > 1e-6 ? dz / d : 0;
      const wa = b.cfg.knockResist / (a.cfg.knockResist + b.cfg.knockResist);
      a.pos.x -= nx * overlap * wa;
      a.pos.z -= nz * overlap * wa;
      b.pos.x += nx * overlap * (1 - wa);
      b.pos.z += nz * overlap * (1 - wa);
    }
    const wx = a.pos.x - hero.x;
    const wz = a.pos.z - hero.z;
    const wd = Math.hypot(wx, wz);
    const wOverlap = heroRadius + a.cfg.radius - wd;
    if (wOverlap > 0) {
      a.pos.x += (wd > 1e-6 ? wx / wd : 1) * wOverlap;
      a.pos.z += (wd > 1e-6 ? wz / wd : 0) * wOverlap;
    }
    if (a.phase !== 'emerging') clampToArena(a.pos, a.knock, arenaRadius - a.cfg.radius);
  }
};
