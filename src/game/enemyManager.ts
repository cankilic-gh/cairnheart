import * as THREE from 'three';
import type { AttackSpec } from '../combat/attacks';
import { directionFrom, inArc, inBeam, inCircle } from '../combat/geometry';
import type { LoopHandle, Sfx } from '../audio/engine';
import type { CameraRig } from '../core/cameraRig';
import { EMERGE_TIME, configFor, createEnemy, damageEnemy, pushEnemy, separate, stepEnemy } from '../entities/enemies/brain';
import type { EnemyEvent, EnemyKind, EnemyState } from '../entities/enemies/types';
import { EnemyView } from '../entities/enemies/views';
import type { Vec2 } from '../entities/hero/motion';
import type { Effects } from '../fx/effects';
import type { ParticlePool } from '../fx/particles';
import type { DamageKind, EnemyBar, Hud } from '../ui/hud';
import type { GateInfo } from '../world/arena';
import { ARENA } from '../world/arenaConfig';
import { Projectiles } from './projectiles';

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

export type HeroDamageSource = 'blast' | 'shot' | 'bite' | 'slam';

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
  private nextId = 1;
  private time = 0;
  private heroPos: Vec2 = { x: 0, z: 0 };
  private heroRadius = 1.25;

  constructor(private readonly ctx: EnemyContext) {
    this.projectiles = new Projectiles(ctx.scene);
  }

  get alive(): number {
    return this.enemies.length;
  }

  spawn(kind: EnemyKind, gate: GateInfo, elite: boolean, speedScale: number, bossLevel = 0): EnemyState {
    const lateral = (Math.random() - 0.5) * 2.4;
    const pos = {
      x: gate.position.x - gate.inward.z * lateral - gate.inward.x * 0.6,
      z: gate.position.z + gate.inward.x * lateral - gate.inward.z * 0.6,
    };
    const state = this.spawnAt(kind, pos, { x: gate.inward.x, z: gate.inward.z }, elite, speedScale, bossLevel);
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

  spawnAt(kind: EnemyKind, pos: Vec2, inward: Vec2, elite = false, speedScale = 1, bossLevel = 0): EnemyState {
    const state = createEnemy(this.nextId++, configFor(kind, elite, speedScale, bossLevel), pos, inward);
    const view = new EnemyView(kind, elite);
    view.sync(state, this.time);
    this.ctx.scene.add(view.group);
    this.enemies.push({ state, view, fuse: null, lastMode: state.mode });
    return state;
  }

  update(dt: number, hero: Vec2, heroRadius: number): void {
    this.time += dt;
    this.heroPos = hero;
    this.heroRadius = heroRadius;
    const events: EnemyEvent[] = [];
    for (const e of this.enemies) {
      if (e.state.phase === 'dead') continue;
      events.push(...stepEnemy(e.state, hero, heroRadius, dt));
      const s = e.state;
      const fusing = s.cfg.kind === 'burster' && s.mode === 'fuse' && s.phase !== 'dead';
      if (fusing && !e.fuse) e.fuse = this.ctx.sfx.loop('fuse', { at: s.pos });
      if (fusing && e.fuse) {
        e.fuse.setPosition(s.pos);
        e.fuse.setRate(1 + s.charge * 0.9);
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
      heroRadius,
      ARENA.radius - 0.2,
    );
    for (const e of this.enemies) e.view.sync(e.state, this.time);

    this.projectiles.update(
      dt,
      hero,
      heroRadius,
      (p) => {
        for (let i = 0; i < 8; i++) this.spark(p.pos.x, p.y, p.pos.z, 3, VIOLET_SPARKS);
        this.ctx.onHeroDamaged(p.damage, p.pos, 'shot');
      },
      (p) => {
        if (Math.random() < dt * 30) this.spark(p.pos.x, p.y, p.pos.z, 0.4, VIOLET_SPARKS, 0.3);
      },
    );
  }

  /** Resolves one hit window of a hero attack. Returns how many enemies were struck. */
  applyAttack(spec: AttackSpec, yaw: number, origin: Vec2, damageScale = 1, reachScale = 1): number {
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const shape = spec.shape;
    const center = shape.kind === 'circle' ? { x: origin.x + fx * shape.forward, z: origin.z + fz * shape.forward } : origin;
    const damage = spec.damage * damageScale;
    let hits = 0;
    for (const e of this.enemies) {
      const c = e.state;
      if (c.phase === 'dead') continue;
      const r = c.cfg.radius;
      const hit =
        shape.kind === 'arc'
          ? inArc(origin, yaw, c.pos, shape.range * reachScale, shape.halfAngle, r)
          : shape.kind === 'beam'
            ? inBeam(origin, yaw, c.pos, shape.length, shape.halfWidth, r)
            : inCircle(center, c.pos, shape.radius * reachScale, r);
      if (!hit) continue;
      hits++;
      const away = directionFrom(shape.kind === 'circle' ? center : origin, c.pos, yaw);
      const dir = shape.kind === 'beam' ? { x: fx * 0.85 + away.x * 0.15, z: fz * 0.85 + away.z * 0.15 } : away;
      if (damage <= 0) {
        pushEnemy(c, dir, spec.knockback, spec.stun, true);
        continue;
      }
      const died = damageEnemy(c, damage, dir, spec.knockback, spec.stun);
      if (spec.id === 'quake') pushEnemy(c, dir, 0, 0, true);
      const y = c.cfg.height * 0.55;
      for (let i = 0; i < 10; i++) this.spark(c.pos.x, y, c.pos.z, 3.5, SPARK_COLORS);
      this.number(c, damage, damage >= 50 ? 'heavy' : 'normal');
      if (died) this.kill(e);
    }
    this.prune();
    return hits;
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
  }

  private handle(ev: EnemyEvent): void {
    switch (ev.type) {
      case 'explode':
        this.explode(ev.source, ev.radius, ev.damage);
        break;
      case 'shoot':
        this.projectiles.spawn(ev.from, ev.dir, ev.speed, ev.damage, ev.y);
        for (let i = 0; i < 5; i++) this.spark(ev.from.x, ev.y, ev.from.z, 1.5, VIOLET_SPARKS, 0.25);
        if (ev.volley === 'lead') this.ctx.sfx.play('nova', { at: ev.from });
        else if (ev.volley !== 'silent') this.ctx.sfx.play('spit', { at: ev.from });
        break;
      case 'bite':
        this.ctx.sfx.play('bite', { at: ev.source.pos });
        this.ctx.onHeroDamaged(ev.damage, ev.source.pos, 'bite');
        break;
      case 'telegraph':
        this.ctx.effects.telegraph(ev.at.x, ev.at.z, ev.radius, ev.duration);
        this.ctx.sfx.play('bossWarn', { at: ev.at });
        break;
      case 'slam': {
        const { x, z } = ev.at;
        this.ctx.effects.shockwave(x, z, ev.radius, 0xd08cff, 0.5);
        this.ctx.effects.flash(x, 1, z, 40, 0.35, 0xc77dff);
        for (let i = 0; i < 40; i++) this.shard(x, 0.3, z, 2 + Math.random() * 4, 0.12 + Math.random() * 0.1);
        const d = Math.hypot(this.heroPos.x - x, this.heroPos.z - z);
        this.ctx.cameraRig.kick(Math.max(0.15, 0.55 * (1 - d / 14)));
        this.ctx.sfx.play('slam', { at: ev.at });
        if (d <= ev.radius + this.heroRadius) this.ctx.onHeroDamaged(ev.damage, ev.at, 'slam');
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
        this.ctx.effects.shockwave(src.pos.x, src.pos.z, 4, 0xb46bff, 0.6);
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
    this.ctx.effects.shockwave(x, z, R, 0xd08cff, 0.5);
    this.ctx.effects.shockwave(x, z, R * 0.6, 0xffffff, 0.3, 0.6);
    this.ctx.effects.flash(x, 1.2, z, 60, 0.4, 0xc77dff);
    for (let i = 0; i < 46; i++) this.shard(x, 0.6 + Math.random() * 0.8, z, 3 + Math.random() * 5, 0.12 + Math.random() * 0.12);
    for (let i = 0; i < 26; i++) this.spark(x, 0.8, z, 6, VIOLET_SPARKS);

    const dh = Math.hypot(this.heroPos.x - x, this.heroPos.z - z);
    this.ctx.cameraRig.kick(Math.max(0.12, 0.6 * (1 - dh / 14)));
    this.ctx.sfx.play('explode', { at: c.pos });
    const reach = R + this.heroRadius;
    if (dh <= reach) this.ctx.onHeroDamaged(damage * (1 - 0.5 * (dh / reach)), c.pos, 'blast');

    for (const other of this.enemies) {
      const o = other.state;
      if (o === c || o.phase === 'dead') continue;
      if (!inCircle(c.pos, o.pos, R, o.cfg.radius)) continue;
      const died = damageEnemy(o, CHAIN_DAMAGE, directionFrom(c.pos, o.pos), 9, 0.5);
      this.number(o, CHAIN_DAMAGE, 'normal');
      if (died) this.kill(other);
    }
  }

  private kill(e: Enemy): void {
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
    this.ctx.effects.shockwave(c.pos.x, c.pos.z, big ? 7 : c.cfg.elite ? 2.2 : 1.4, 0xb46bff, big ? 0.8 : 0.3);
    if (big) {
      this.ctx.effects.flash(c.pos.x, 2, c.pos.z, 80, 0.8, 0xc77dff);
      this.ctx.cameraRig.kick(0.6);
    }
    this.ctx.sfx.play(big ? 'bossDeath' : 'shatter', { at: c.pos });
    this.ctx.onKill(c);
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

  private number(c: EnemyState, amount: number, kind: DamageKind): void {
    const p = this.ctx.project(c.pos.x, c.cfg.height + 0.6, c.pos.z);
    if (p.visible) this.ctx.hud.damageNumber(p.x, p.y, amount, kind);
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
