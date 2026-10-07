import * as THREE from 'three';
import type { Vec2 } from '../entities/hero/motion';

interface RelicView {
  id: number;
  at: Vec2;
  /** Seconds until it can be picked up, so killing an elite in melee does not snap a menu open mid-swing. */
  arm: number;
  group: THREE.Group;
  core: THREE.Mesh;
  materials: THREE.Material[];
}

const CORE_GEO = new THREE.BoxGeometry(0.55, 0.55, 0.55);
const BEAM_GEO = new THREE.BoxGeometry(0.14, 7, 0.14).translate(0, 3.5, 0);
const RING_GEO = new THREE.RingGeometry(0.7, 0.85, 32);

/** Graft relics dropped by elites: a spinning family-coloured block with a light pillar, until picked up. */
export class Relics {
  private readonly list: RelicView[] = [];

  constructor(private readonly scene: THREE.Scene) {}

  add(id: number, at: Vec2, color: number, arm = 1): void {
    const glow = new THREE.Color(color);
    const coreMat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 2.2, roughness: 0.5 });
    const beamMat = new THREE.MeshBasicMaterial({
      color: glow.clone().multiplyScalar(0.9),
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const ringMat = new THREE.MeshBasicMaterial({ color: glow.clone().multiplyScalar(1.4), transparent: true, opacity: 0.8, depthWrite: false });
    const group = new THREE.Group();
    group.position.set(at.x, 0, at.z);
    const core = new THREE.Mesh(CORE_GEO, coreMat);
    core.castShadow = true;
    const beam = new THREE.Mesh(BEAM_GEO, beamMat);
    const ring = new THREE.Mesh(RING_GEO, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    group.add(core, beam, ring);
    this.scene.add(group);
    this.list.push({ id, at: { ...at }, arm, group, core, materials: [coreMat, beamMat, ringMat] });
  }

  remove(id: number): void {
    const i = this.list.findIndex((r) => r.id === id);
    if (i < 0) return;
    this.dispose(this.list[i]!);
    this.list.splice(i, 1);
  }

  /** Id of an armed relic within `radius` of `pos`, if any. */
  touching(pos: Vec2, radius: number): number | null {
    for (const r of this.list) if (r.arm <= 0 && Math.hypot(r.at.x - pos.x, r.at.z - pos.z) <= radius) return r.id;
    return null;
  }

  /** Counts down arming in fight time (stops while paused or in a menu). */
  tick(dt: number): void {
    for (const r of this.list) r.arm = Math.max(0, r.arm - dt);
  }

  update(time: number): void {
    for (const r of this.list) {
      r.core.position.y = 0.9 + Math.sin(time * 2.4 + r.id) * 0.15;
      r.core.rotation.set(time * 0.9, time * 1.7, 0.4);
    }
  }

  clear(): void {
    for (const r of this.list) this.dispose(r);
    this.list.length = 0;
  }

  private dispose(r: RelicView): void {
    r.group.removeFromParent();
    for (const m of r.materials) m.dispose();
  }
}
