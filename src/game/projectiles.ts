import * as THREE from 'three';
import type { EnemyKind } from '../entities/enemies/types';
import type { Vec2 } from '../entities/hero/motion';
import { ARENA } from '../world/arenaConfig';

export interface Projectile {
  pos: Vec2;
  vel: Vec2;
  y: number;
  radius: number;
  damage: number;
  life: number;
  spin: number;
  /** Who fired it, for the event log's damage source. */
  owner: { kind: EnemyKind; elite: boolean };
}

/** True when a projectile overlaps a circle (the hero's hurtbox). */
export const projectileHits = (p: Pick<Projectile, 'pos' | 'radius'>, center: Vec2, radius: number): boolean =>
  Math.hypot(p.pos.x - center.x, p.pos.z - center.z) <= p.radius + radius;

const CAPACITY = 160;

/** One instanced mesh of spinning crystal shards. */
class ShardMesh {
  readonly mesh: THREE.InstancedMesh;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly s = new THREE.Vector3();
  private readonly p = new THREE.Vector3();

  constructor(scene: THREE.Scene, color: THREE.Color, private readonly size: readonly [number, number, number]) {
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color }), CAPACITY);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  sync(list: ReadonlyArray<{ pos: Vec2; y: number; spin: number; vel: Vec2 }>, aligned: boolean): void {
    list.forEach((p, i) => {
      if (aligned) this.e.set(0, Math.atan2(p.vel.x, p.vel.z), p.spin);
      else this.e.set(p.spin, p.spin * 0.7, Math.PI / 4);
      this.q.setFromEuler(this.e);
      this.s.set(...this.size);
      this.p.set(p.pos.x, p.y, p.pos.z);
      this.mesh.setMatrixAt(i, this.m.compose(this.p, this.q, this.s));
    });
    this.mesh.count = list.length;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/** Gloom shards fired by spitters and the matriarch. */
export class Projectiles {
  readonly list: Projectile[] = [];
  private readonly shards: ShardMesh;

  constructor(scene: THREE.Scene) {
    this.shards = new ShardMesh(scene, new THREE.Color(0xb46bff).multiplyScalar(1.5), [0.22, 0.22, 0.42]);
  }

  spawn(from: Vec2, dir: Vec2, speed: number, damage: number, y: number, owner: Projectile['owner']): void {
    if (this.list.length >= CAPACITY) this.list.shift();
    this.list.push({ pos: { ...from }, vel: { x: dir.x * speed, z: dir.z * speed }, y, radius: 0.28, damage, life: 4, spin: Math.random() * 6, owner });
  }

  /** Moves every shard; calls `onHit` for shards that strike the hero and drops them. */
  update(dt: number, hero: Vec2, heroRadius: number, onHit: (p: Projectile) => void, onTrail?: (p: Projectile) => void): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i]!;
      p.pos.x += p.vel.x * dt;
      p.pos.z += p.vel.z * dt;
      p.life -= dt;
      p.spin += dt * 9;
      if (projectileHits(p, hero, heroRadius)) {
        onHit(p);
        this.list.splice(i, 1);
        continue;
      }
      if (p.life <= 0 || Math.hypot(p.pos.x, p.pos.z) > ARENA.radius + 1.5) {
        this.list.splice(i, 1);
        continue;
      }
      onTrail?.(p);
    }
    this.shards.sync(this.list, false);
  }

  /** Removes shards inside a circle (the quake shockwave) and returns their positions for effects. */
  clearWithin(center: Vec2, radius: number): Vec2[] {
    const removed: Vec2[] = [];
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i]!;
      if (Math.hypot(p.pos.x - center.x, p.pos.z - center.z) <= radius) {
        removed.push(p.pos);
        this.list.splice(i, 1);
      }
    }
    return removed;
  }

  clear(): void {
    this.list.length = 0;
    this.shards.sync(this.list, false);
  }
}

export interface HeroShot {
  pos: Vec2;
  vel: Vec2;
  y: number;
  radius: number;
  damage: number;
  /** Distance left before the shard crumbles. */
  range: number;
  pierce: boolean;
  spin: number;
  /** Enemies already struck, so a piercing shard hits each one once. */
  struck: Set<number>;
}

/** Shards and quills thrown by grafts (Shard Sling, Quill Mantle). */
export class HeroShots {
  readonly list: HeroShot[] = [];
  private readonly shards: ShardMesh;

  constructor(scene: THREE.Scene) {
    this.shards = new ShardMesh(scene, new THREE.Color(0xffd28a).multiplyScalar(1.6), [0.16, 0.16, 0.7]);
  }

  spawn(from: Vec2, dir: Vec2, speed: number, range: number, damage: number, pierce: boolean, y = 1.2): void {
    if (this.list.length >= CAPACITY) this.list.shift();
    this.list.push({ pos: { ...from }, vel: { x: dir.x * speed, z: dir.z * speed }, y, radius: 0.32, damage, range, pierce, spin: 0, struck: new Set() });
  }

  /** Moves every shard; `strike` resolves contact and returns true when the shard is spent. */
  update(dt: number, strike: (s: HeroShot) => boolean): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const s = this.list[i]!;
      const step = Math.hypot(s.vel.x, s.vel.z) * dt;
      s.pos.x += s.vel.x * dt;
      s.pos.z += s.vel.z * dt;
      s.range -= step;
      s.spin += dt * 14;
      if (strike(s) || s.range <= 0 || Math.hypot(s.pos.x, s.pos.z) > ARENA.radius + 1) this.list.splice(i, 1);
    }
    this.shards.sync(this.list, true);
  }

  clear(): void {
    this.list.length = 0;
    this.shards.sync(this.list, true);
  }
}
