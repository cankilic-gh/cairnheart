import * as THREE from 'three';
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
}

/** True when a projectile overlaps a circle (the hero's body). */
export const projectileHits = (p: Projectile, center: Vec2, radius: number): boolean =>
  Math.hypot(p.pos.x - center.x, p.pos.z - center.z) <= p.radius + radius;

const CAPACITY = 160;

/** Gloom shards fired by spitters and the matriarch. One instanced mesh for all of them. */
export class Projectiles {
  readonly list: Projectile[] = [];
  private readonly mesh: THREE.InstancedMesh;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly s = new THREE.Vector3();
  private readonly p = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xb46bff).multiplyScalar(1.5) });
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, CAPACITY);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  spawn(from: Vec2, dir: Vec2, speed: number, damage: number, y: number): void {
    if (this.list.length >= CAPACITY) this.list.shift();
    this.list.push({ pos: { ...from }, vel: { x: dir.x * speed, z: dir.z * speed }, y, radius: 0.28, damage, life: 4, spin: Math.random() * 6 });
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
    this.list.forEach((p, i) => {
      this.e.set(p.spin, p.spin * 0.7, Math.PI / 4);
      this.q.setFromEuler(this.e);
      this.s.set(0.22, 0.22, 0.42);
      this.p.set(p.pos.x, p.y, p.pos.z);
      this.mesh.setMatrixAt(i, this.m.compose(this.p, this.q, this.s));
    });
    this.mesh.count = this.list.length;
    this.mesh.instanceMatrix.needsUpdate = true;
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
    this.mesh.count = 0;
  }
}
