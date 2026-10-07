import * as THREE from 'three';
import { COUNTER_MULTIPLIER, type Strike } from '../combat/attacks';
import { directionFrom, inArc, inBeam, inCircle } from '../combat/geometry';
import type { LoopHandle, Sfx } from '../audio/engine';
import type { CameraRig } from '../core/cameraRig';
import { EMERGE_TIME, configFor, createEnemy, damageEnemy, pushEnemy, separate, slamCenter, stepEnemy, windingUp } from '../entities/enemies/brain';
import type { EnemyEvent, EnemyKind, EnemyState } from '../entities/enemies/types';
import { EnemyView } from '../entities/enemies/views';
import type { Vec2 } from '../entities/hero/motion';
import type { Effects } from '../fx/effects';
import type { ParticlePool } from '../fx/particles';
import type { EnemyBar, Hud } from '../ui/hud';
import type { GateInfo } from '../world/arena';
import { ARENA } from '../world/arenaConfig';
import { FAMILY_COLOR } from './grafts';
import { HeroShots, Projectiles, type HeroShot } from './projectiles';

interface Enemy {
  state: EnemyState;
  view: EnemyView;
  fuse: LoopHandle | null;
  lastMode: EnemyState['mode'];
}

export interface ScreenPoint {
  x: number;
  y: number;
  visible: boolean;
}

export interface HeroDamageSource {
  attack: 'blast' | 'shot' | 'bite' | 'slam';
  enemy: EnemyKind;
  elite: boolean;
}

export interface StrikeResult {
  hit: EnemyState[];
  counters: number;
}

/** Read-only view of the fight for the test bot. */
export interface EnemySnapshot {
  id: number;
  kind: EnemyKind;
  elite: boolean;
  x: number;
  z: number;
  radius: number;
  hp: number;
  maxHp: number;
  mode: EnemyState['mode'];
  phase: EnemyState['phase'];
  charge: number;
  /** Area about to be hit: a lit fuse's blast or the matriarch's slam. */
  threat: { x: number; z: number; r: number } | null;
}

export interface EnemyContext {
  scene: THREE.Scene;
  effects: Effects;
  dust: ParticlePool;
  embers: ParticlePool;
  sfx: Sfx;
  cameraRig: CameraRig;
  hud: Hud;
  project(x: number, y: number, z: number): ScreenPoint;
  onHeroDamaged(amount: number, from: Vec2, source: HeroDamageSource): void;
  onKill(e: EnemyState): void;
}

const GLOOM_COLORS = [0x31244a, 0x463466, 0x181225, 0x6a33b5].map((c) => new THREE.Color(c));
const SPARK_COLORS = [0xffffff, 0xffd28a, 0xffb347].map((c) => new THREE.Color(c));
const VIOLET_SPARKS = [0xe4bcff, 0xb46bff, 0xff5fd2].map((c) => new THREE.Color(c));
const CHAIN_DAMAGE = 45;

export class EnemyManager {
  readonly enemies: Enemy[] = [];
  readonly projectiles: Projectiles;
  readonly heroShots: HeroShots;
  private nextId = 1;
  private time = 0;
  private heroPos: Vec2 = { x: 0, z: 0 };
  private hurtRadius = 0.95;

  constructor(private readonly ctx: EnemyContext) {
    this.projectiles = new Projectiles(ctx.scene);
    this.heroShots = new HeroShots(ctx.scene);
  }

  get alive(): number {
    return this.enemies.length;
  }

  spawn(kind: EnemyKind, gate: GateInfo, elite: boolean, speedScale: number): EnemyState {
    const lateral = (Math.random() - 0.5) * 2.4;
    const pos = {
      x: gate.position.x - gate.inward.z * lateral - gate.inward.x * 0.6,
      z: gate.position.z + gate.inward.x * lateral - gate.inward.z * 0.6,
    };
    const state = this.spawnAt(kind, pos, { x: gate.inward.x, z: gate.inward.z }, elite, speedScale);
    this.ctx.sfx.play(kind === 'matriarch' ? 'summon' : 'emerge', { at: pos });
    for (let i = 0; i < (kind === 'matriarch' ? 60 : 14); i++) {
      this.ctx.embers.spawn({
        x: pos.x + (Math.random() - 0.5) * 1.5,
        y: 0.3 + Math.random() * 2.5,
        z: pos.z + (Math.random() - 0.5) * 1.5,
        vx: gate.inward.x * (1 + Math.random() * 2),
        vy: 0.3 + Math.random(),
        vz: gate.inward.z * (1 + Math.random() * 2),
        life: 0.6 + Math.random() * 0.5,
        size: 0.06 + Math.random() * 0.06,
        color: VIOLET_SPARKS[i % VIOLET_SPARKS.length]!,
        drag: 1.5,
      });
    }
    return state;
  }

  spawnAt(kind: EnemyKind, pos: Vec2, inward: Vec2, elite = false, speedScale = 1): EnemyState {
    const state = createEnemy(this.nextId++, configFor(kind, elite, speedScale), pos, inward);
    const view = new EnemyView(kind, elite, elite && kind !== 'matriarch' ? FAMILY_COLOR[kind] : null);
    view.sync(state, this.time);
    this.ctx.scene.add(view.group);
    this.enemies.push({ state, view, fuse: null, lastMode: state.mode });
    return state;
  }

  /** `bodyRadius` keeps enemies off the golem's model; `hurtRadius` is what their attacks must reach. */
  update(dt: number, hero: Vec2, bodyRadius: number, hurtRadius: number): void {
    this.time += dt;
    this.heroPos = hero;
    this.hurtRadius = hurtRadius;
    const events: EnemyEvent[] = [];
    for (const e of this.enemies) {
      if (e.state.phase === 'dead') continue;
      events.push(...stepEnemy(e.state, hero, hurtRadius, dt));
      const s = e.state;
      const fusing = s.cfg.kind === 'burster' && s.mode === 'fuse' && s.phase !== 'dead';
      if (fusing && !e.fuse) e.fuse = this.ctx.sfx.loop('fuse', { at: s.pos });
      if (fusing && e.fuse) {
        e.fuse.setPosition(s.pos);
        e.fuse.setRate(1 + s.charge * 0.9);
      }
      // Gloom flames lick up around the blast edge, faster as the fuse burns down.
      if (fusing && s.cfg.kind === 'burster' && Math.random() < dt * 30 * (0.3 + s.charge)) {
        this.ctx.effects.blasts.rim(s.pos.x, s.pos.z, s.cfg.blastRadius, 'gloom');
      }
      if (!fusing && e.fuse) this.silence(e);
      if (s.mode !== e.lastMode && s.mode === 'crouch') this.ctx.sfx.play('lunge', { at: s.pos });
      e.lastMode = s.mode;
    }
    for (const ev of events) this.handle(ev);
    this.prune();
    separate(
      this.enemies.map((e) => e.state),
      hero,
      bodyRadius,
      ARENA.radius - 0.2,
    );
    for (const e of this.enemies) e.view.sync(e.state, this.time);

    this.heroShots.update(dt, (s) => this.shotContact(s));
    this.projectiles.update(
      dt,
      hero,
      hurtRadius,
      (p) => {
        for (let i = 0; i < 8; i++) this.spark(p.pos.x, p.y, p.pos.z, 3, VIOLET_SPARKS);
        this.ctx.onHeroDamaged(p.damage, p.pos, { attack: 'shot', enemy: p.owner.kind, elite: p.owner.elite });
      },
      (p) => {
        if (Math.random() < dt * 30) this.spark(p.pos.x, p.y, p.pos.z, 0.4, VIOLET_SPARKS, 0.3);
      },
    );
  }

  /**
   * Resolves one hit window of a hero strike from `origin` facing `yaw`. Enemies caught while
   * winding up an attack take a counter-hit: double damage and the only damage numbers shown.
   */
  applyAttack(strike: Strike, yaw: number, origin: Vec2): StrikeResult {
    const shape = strike.shape;
    const result: StrikeResult = { hit: [], counters: 0 };
    if (shape.kind === 'none') return result;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const center = shape.kind === 'circle' ? { x: origin.x + fx * shape.forward, z: origin.z + fz * shape.forward } : origin;
    const pull = strike.behaviors.find((b) => b.kind === 'pull');
    for (const e of this.enemies) {
      const c = e.state;
      if (c.phase === 'dead') continue;
      const r = c.cfg.radius;
      const hit =
        shape.kind === 'arc'
          ? inArc(origin, yaw, c.pos, shape.range, shape.halfAngle, r) &&
            (!shape.inner || Math.hypot(c.pos.x - origin.x, c.pos.z - origin.z) + r >= shape.inner)
          : shape.kind === 'beam'
            ? inBeam(origin, yaw, c.pos, shape.length, shape.halfWidth, r)
            : inCircle(center, c.pos, shape.radius, r);
      if (!hit) continue;
      result.hit.push(c);
      const away = directionFrom(shape.kind === 'circle' ? center : origin, c.pos, yaw);
      let dir = shape.kind === 'beam' ? { x: fx * 0.85 + away.x * 0.15, z: fz * 0.85 + away.z * 0.15 } : away;
      let knock = strike.knockback;
      if (pull) {
        const d = Math.hypot(c.pos.x - origin.x, c.pos.z - origin.z);
        dir = directionFrom(c.pos, origin, yaw + Math.PI);
        knock = 5 * Math.max(0, d - pull.to);
      }
      if (strike.damage <= 0) {
        pushEnemy(c, dir, knock, strike.stun, strike.interrupts);
        continue;
      }
      const counter = windingUp(c);
      const damage = strike.damage * (counter ? COUNTER_MULTIPLIER : 1);
      const died = damageEnemy(c, damage, dir, knock, strike.stun);
      if (strike.interrupts) pushEnemy(c, dir, 0, 0, true);
      const y = c.cfg.height * 0.55;
      for (let i = 0; i < 10; i++) this.spark(c.pos.x, y, c.pos.z, 3.5, SPARK_COLORS);
      if (counter) {
        result.counters++;
        this.number(c, damage);
      }
      if (died) this.kill(e);
    }
    this.prune();
    return result;
  }

  /** Shatters every enemy without awarding kills (the matriarch fell; her brood goes with her). */
  shatterAll(): void {
    for (const e of [...this.enemies]) if (e.state.phase !== 'dead') this.kill(e, false);
    this.prune();
    this.projectiles.clear();
  }

  snapshot(): EnemySnapshot[] {
    return this.enemies
      .filter((e) => e.state.phase !== 'dead')
      .map(({ state: c }) => {
        let threat: EnemySnapshot['threat'] = null;
        if (c.cfg.kind === 'burster' && c.mode === 'fuse') threat = { x: c.pos.x, z: c.pos.z, r: c.cfg.blastRadius };
        if (c.cfg.kind === 'matriarch' && c.mode === 'slam' && !c.hitDone) {
          const p = slamCenter(c, c.cfg);
          threat = { x: p.x, z: p.z, r: c.cfg.slamRadius };
        }
        return {
          id: c.id,
          kind: c.cfg.kind,
          elite: c.cfg.elite,
          x: c.pos.x,
          z: c.pos.z,
          radius: c.cfg.radius,
          hp: c.hp,
          maxHp: c.cfg.maxHp,
          mode: c.mode,
          phase: c.phase,
          charge: c.charge,
          threat,
        };
      });
  }

  /** Shatters projectiles caught in the quake and returns how many broke. */
  shatterProjectiles(center: Vec2, radius: number): number {
    const broken = this.projectiles.clearWithin(center, radius);
    for (const p of broken) for (let i = 0; i < 6; i++) this.spark(p.x, 1.2, p.z, 2.5, VIOLET_SPARKS);
    return broken.length;
  }

  bars(): EnemyBar[] {
    const list: EnemyBar[] = [];
    for (const e of this.enemies) {
      const c = e.state;
      if (!c.damaged || c.phase === 'dead' || c.cfg.kind === 'matriarch') continue;
      const p = this.ctx.project(c.pos.x, c.cfg.height + 0.25, c.pos.z);
      if (!p.visible) continue;
      list.push({ id: c.id, x: p.x, y: p.y, hp: c.hp, trail: c.trailHp, max: c.cfg.maxHp, elite: c.cfg.elite });
    }
    return list;
  }

  boss(): EnemyState | null {
    return this.enemies.find((e) => e.state.cfg.kind === 'matriarch' && e.state.phase !== 'dead')?.state ?? null;
  }

  nearest(from: Vec2, maxDist: number, accept: (c: EnemyState) => boolean): EnemyState | null {
    let best: EnemyState | null = null;
    let bestD = maxDist;
    for (const e of this.enemies) {
      const c = e.state;
      if (c.phase !== 'active' || !accept(c)) continue;
      const d = Math.hypot(c.pos.x - from.x, c.pos.z - from.z) - c.cfg.radius;
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  /** Stops every enemy loop (lit fuses) without removing anyone, e.g. when the hero falls. */
  silenceLoops(): void {
    for (const e of this.enemies) this.silence(e);
  }

  clear(): void {
    for (const e of this.enemies) {
      this.silence(e);
      e.view.dispose();
    }
    this.enemies.length = 0;
    this.projectiles.clear();
    this.heroShots.clear();
  }

  /** A graft shard touching enemies; returns true once it is spent. */
  private shotContact(s: HeroShot): boolean {
    for (const e of this.enemies) {
      const c = e.state;
      if (c.phase === 'dead' || s.struck.has(c.id)) continue;
      if (!inCircle(s.pos, c.pos, s.radius, c.cfg.radius)) continue;
      s.struck.add(c.id);
      const counter = windingUp(c);
      const damage = s.damage * (counter ? COUNTER_MULTIPLIER : 1);
      const died = damageEnemy(c, damage, directionFrom(s.pos, c.pos), 3, 0.15);
      for (let i = 0; i < 6; i++) this.spark(c.pos.x, s.y, c.pos.z, 3, SPARK_COLORS);
      if (counter) this.number(c, damage);
      if (died) this.kill(e);
      if (!s.pierce) return true;
    }
    return false;
  }

  private handle(ev: EnemyEvent): void {
    switch (ev.type) {
      case 'explode':
        this.explode(ev.source, ev.radius, ev.damage);
        break;
      case 'shoot':
        this.projectiles.spawn(ev.from, ev.dir, ev.speed, ev.damage, ev.y, { kind: ev.source.cfg.kind, elite: ev.source.cfg.elite });
        for (let i = 0; i < 5; i++) this.spark(ev.from.x, ev.y, ev.from.z, 1.5, VIOLET_SPARKS, 0.25);
        if (ev.volley === 'lead') this.ctx.sfx.play('nova', { at: ev.from });
        else if (ev.volley !== 'silent') this.ctx.sfx.play('spit', { at: ev.from });
        break;
      case 'bite':
        this.ctx.sfx.play('bite', { at: ev.source.pos });
        this.ctx.onHeroDamaged(ev.damage, ev.source.pos, { attack: 'bite', enemy: ev.source.cfg.kind, elite: ev.source.cfg.elite });
        break;
      case 'telegraph':
        this.ctx.effects.telegraph(ev.at.x, ev.at.z, ev.radius, ev.duration);
        this.ctx.sfx.play('bossWarn', { at: ev.at });
        break;
      case 'slam': {
        const { x, z } = ev.at;
        this.ctx.effects.blasts.explosion(x, z, ev.radius, 'gloom', { strength: 0.9, y: 0.3 });
        this.ctx.effects.flash(x, 1, z, 40, 0.35, 0xc77dff);
        for (let i = 0; i < 24; i++) this.shard(x, 0.3, z, 2 + Math.random() * 4, 0.12 + Math.random() * 0.1);
        const d = Math.hypot(this.heroPos.x - x, this.heroPos.z - z);
        this.ctx.cameraRig.kick(Math.max(0.15, 0.55 * (1 - d / 14)));
        this.ctx.sfx.play('slam', { at: ev.at });
        if (d <= ev.radius + this.hurtRadius) this.ctx.onHeroDamaged(ev.damage, ev.at, { attack: 'slam', enemy: 'matriarch', elite: true });
        break;
      }
      case 'summon': {
        const src = ev.source;
        for (let i = 0; i < ev.count; i++) {
          const a = src.yaw + Math.PI + ((i - (ev.count - 1) / 2) * Math.PI) / 3;
          const dir = { x: Math.sin(a), z: Math.cos(a) };
          const r = src.cfg.radius + 1;
          const s = this.spawnAt('burster', { x: src.pos.x + dir.x * r, z: src.pos.z + dir.z * r }, dir);
          s.emerge = EMERGE_TIME * 0.4;
          for (let k = 0; k < 10; k++) this.spark(s.pos.x, 0.6, s.pos.z, 2, VIOLET_SPARKS);
        }
        this.ctx.effects.blasts.swirl(src.pos.x, src.pos.z, 4, 'gloom', true, 0.8);
        this.ctx.effects.blasts.puff(src.pos.x, 0.6, src.pos.z, 'gloom', 1.6);
        this.ctx.sfx.play('summon', { at: src.pos });
        break;
      }
    }
  }

  private explode(c: EnemyState, R: number, damage: number): void {
    const e = this.enemies.find((x) => x.state === c);
    if (e) {
      this.silence(e);
      e.view.dispose();
    }
    const { x, z } = c.pos;
    this.ctx.effects.blasts.explosion(x, z, R, 'gloom', { strength: c.cfg.elite ? 1.3 : 1 });
    this.ctx.effects.flash(x, 1.2, z, 32, 0.35, 0xc77dff);
    for (let i = 0; i < 26; i++) this.shard(x, 0.6 + Math.random() * 0.8, z, 3 + Math.random() * 5, 0.12 + Math.random() * 0.12);

    const dh = Math.hypot(this.heroPos.x - x, this.heroPos.z - z);
    this.ctx.cameraRig.kick(Math.max(0.12, 0.6 * (1 - dh / 14)));
    this.ctx.sfx.play('explode', { at: c.pos });
    const reach = R + this.hurtRadius;
    if (dh <= reach) this.ctx.onHeroDamaged(damage * (1 - 0.5 * (dh / reach)), c.pos, { attack: 'blast', enemy: 'burster', elite: c.cfg.elite });

    for (const other of this.enemies) {
      const o = other.state;
      if (o === c || o.phase === 'dead') continue;
      if (!inCircle(c.pos, o.pos, R, o.cfg.radius)) continue;
      const died = damageEnemy(o, CHAIN_DAMAGE, directionFrom(c.pos, o.pos), 9, 0.5);
      if (died) this.kill(other);
    }
  }

  private kill(e: Enemy, award = true): void {
    const c = e.state;
    c.phase = 'dead';
    this.silence(e);
    e.view.dispose();
    const h = c.cfg.height;
    const big = c.cfg.kind === 'matriarch';
    const shards = big ? 140 : c.cfg.elite ? 40 : 26;
    for (let i = 0; i < shards; i++) {
      this.shard(c.pos.x, Math.random() * h, c.pos.z, (big ? 3 : 1.5) + Math.random() * 3, (big ? 0.16 : 0.1) + Math.random() * 0.1);
    }
    for (let i = 0; i < (big ? 60 : 12); i++) this.spark(c.pos.x, h * 0.6, c.pos.z, big ? 6 : 2.5, VIOLET_SPARKS);
    if (big) this.ctx.effects.blasts.explosion(c.pos.x, c.pos.z, 6, 'gloom', { strength: 1.6, y: 1.5 });
    else this.ctx.effects.blasts.puff(c.pos.x, h * 0.4, c.pos.z, 'gloom', c.cfg.elite ? 1.4 : 0.8);
    if (big) {
      this.ctx.effects.flash(c.pos.x, 2, c.pos.z, 80, 0.8, 0xc77dff);
      this.ctx.cameraRig.kick(0.6);
    }
    this.ctx.sfx.play(big ? 'bossDeath' : 'shatter', { at: c.pos });
    if (award) this.ctx.onKill(c);
  }

  private spark(x: number, y: number, z: number, speed: number, palette: THREE.Color[], life = 0.35): void {
    const a = Math.random() * Math.PI * 2;
    const s = speed * (0.4 + Math.random() * 0.6);
    this.ctx.embers.spawn({
      x,
      y,
      z,
      vx: Math.cos(a) * s,
      vy: 1 + Math.random() * speed * 0.6,
      vz: Math.sin(a) * s,
      life: 0.25 + Math.random() * life,
      size: 0.05 + Math.random() * 0.06,
      color: palette[Math.floor(Math.random() * palette.length)]!,
      gravity: 6,
      drag: 2,
    });
  }

  private shard(x: number, y: number, z: number, speed: number, size: number): void {
    const a = Math.random() * Math.PI * 2;
    this.ctx.dust.spawn({
      x,
      y,
      z,
      vx: Math.cos(a) * speed,
      vy: 1.5 + Math.random() * 3,
      vz: Math.sin(a) * speed,
      life: 0.6 + Math.random() * 0.6,
      size,
      color: GLOOM_COLORS[Math.floor(Math.random() * GLOOM_COLORS.length)]!,
      alpha: 0.95,
      gravity: 9,
      drag: 1.4,
    });
  }

  /** Counter-hit number; ordinary hits show none. */
  private number(c: EnemyState, amount: number): void {
    const p = this.ctx.project(c.pos.x, c.cfg.height + 0.6, c.pos.z);
    if (p.visible) this.ctx.hud.critNumber(p.x, p.y, amount);
  }

  private silence(e: Enemy): void {
    e.fuse?.stop();
    e.fuse = null;
  }

  private prune(): void {
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i]!;
      if (e.state.phase !== 'dead') continue;
      this.silence(e);
      e.view.dispose();
      this.enemies.splice(i, 1);
    }
  }
}
