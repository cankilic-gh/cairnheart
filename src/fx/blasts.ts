import * as THREE from 'three';
import { fbm } from '../core/rng';
import { ParticlePool, type SpawnOptions } from './particles';

/** Fire colour families: gloom (violet enemy fire), ember (the golem's amber), heart (burster grafts). */
export type BlastPalette = 'gloom' | 'ember' | 'heart';

interface Palette {
  hot: THREE.Color;
  warm: THREE.Color;
  cool: THREE.Color;
  smoke: THREE.Color;
  smokeEnd: THREE.Color;
  sparks: THREE.Color[];
}

const col = (hex: number) => new THREE.Color(hex);

const PALETTES: Record<BlastPalette, Palette> = {
  ember: {
    hot: col(0xffd88a),
    warm: col(0xff8a24),
    cool: col(0x4a1004),
    smoke: col(0x4a423c),
    smokeEnd: col(0x16131a),
    sparks: [col(0xffe2a0), col(0xffb347), col(0xffd28a)],
  },
  heart: {
    hot: col(0xffc46a),
    warm: col(0xff5418),
    cool: col(0x3a0804),
    smoke: col(0x4a302a),
    smokeEnd: col(0x120a0c),
    sparks: [col(0xffd28a), col(0xff8a3a), col(0xffffff)],
  },
  gloom: {
    hot: col(0xf7a8ff),
    warm: col(0xa040f0),
    cool: col(0x1c0636),
    smoke: col(0x3c2c58),
    smokeEnd: col(0x0c0914),
    sparks: [col(0xe4bcff), col(0xff5fd2), col(0xb46bff)],
  },
};

const STONE = [0x6a6f7b, 0x5a5f6a, 0x4a4f5b, 0x7a7d86].map(col);
const STONE_END = col(0x2a2c33);

const rnd = Math.random;
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;

/** 32x32 pixel decals: a ragged soot patch, and a scatter of embers that burns out first. */
const decalTexture = (kind: 'soot' | 'embers'): THREE.DataTexture => {
  const N = 32;
  const data = new Uint8Array(N * N * 4);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const u = (i + 0.5) / (N / 2) - 1;
      const v = (j + 0.5) / (N / 2) - 1;
      const d = Math.hypot(u, v);
      const n = fbm(i * 0.3, j * 0.3, kind === 'soot' ? 17 : 41);
      const k = (j * N + i) * 4;
      if (kind === 'soot') {
        const a = THREE.MathUtils.smoothstep(1 - (d + (n - 0.5) * 0.55), 0, 0.55);
        const q = Math.round(a * 4) / 4;
        data.set([20, 15, 22, Math.round(q * 235)], k);
      } else {
        const lit = d < 0.75 && n > 0.62 - (0.75 - d) * 0.25;
        // Near-white so the material colour (the palette's flame) decides the hue.
        data.set([255, 236, 210, lit ? Math.round(255 * (1 - d * 0.6)) : 0], k);
      }
    }
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
};

interface Decal {
  mesh: THREE.Mesh;
  glow: THREE.Mesh;
  t: number;
}

const MAX_DECALS = 16;
const SOOT_LIFE = 4.5;
const GLOW_LIFE = 0.7;

export interface ExplosionOptions {
  /** Scales particle counts. */
  strength?: number;
  /** Leave a soot mark on the floor. */
  scorch?: boolean;
  /** Height of the fireball's centre. */
  y?: number;
}

/**
 * Particle fire for every blast in the game: fireballs that cool from white-hot to dark, rising
 * flame tongues, smoke that outlives the flames, sparks, a fire or dust front that runs out to the
 * attack's real radius, and soot left on the floor. Replaces the old flat shockwave rings.
 */
export class Blasts {
  /** Off in headless runs. */
  enabled = true;
  private readonly fire = new ParticlePool(2600, THREE.AdditiveBlending, true);
  private readonly smoke = new ParticlePool(1000, THREE.NormalBlending, true);
  private readonly decals: Decal[] = [];
  private readonly decalGeo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
  private readonly soot = decalTexture('soot');
  private readonly embers = decalTexture('embers');

  constructor(private readonly scene: THREE.Scene) {
    // Smoke under fire; both under telegraphs (render order 10+).
    this.smoke.points.renderOrder = 1;
    this.fire.points.renderOrder = 2;
    scene.add(this.smoke.points, this.fire.points);
  }

  setScale(scale: number): void {
    this.fire.setScale(scale);
    this.smoke.setScale(scale);
  }

  /** A full explosion of radius `r`: fireball, flame tongues, fire front out to `r`, smoke, sparks, soot. */
  explosion(x: number, z: number, r: number, palette: BlastPalette, o: ExplosionOptions = {}): void {
    if (!this.enabled) return;
    const p = PALETTES[palette];
    const k = o.strength ?? 1;
    const y = o.y ?? 0.5;
    const scale = THREE.MathUtils.clamp(0.65 + r * 0.12, 0.7, 1.5);

    const balls = Math.round((18 + r * 11) * k);
    for (let i = 0; i < balls; i++) {
      const a = rnd() * Math.PI * 2;
      const h = r * (0.8 + rnd() * 1.6);
      const jitter = rnd() * r * 0.3;
      const size = (0.55 + rnd() * 0.6) * scale;
      const life = 0.4 + rnd() * 0.55;
      const core = rnd() < 0.22;
      this.flame({
        x: x + Math.cos(a) * jitter,
        y: y + rnd() * 0.6,
        z: z + Math.sin(a) * jitter,
        vx: Math.cos(a) * h,
        vy: 1 + rnd() * 3.5,
        vz: Math.sin(a) * h,
        life,
        size,
        grow: (-size / life) * 0.35,
        color: core ? p.hot : p.warm,
        colorEnd: core ? p.warm : p.cool,
        gravity: -2.5,
        drag: 4.5,
        alpha: 0.7,
        fade: 1.1,
      });
    }
    for (let i = 0; i < Math.round((5 + r * 1.5) * k); i++) {
      const size = (0.35 + rnd() * 0.3) * scale;
      const life = 0.5 + rnd() * 0.35;
      this.flame({
        x: x + (rnd() - 0.5) * r * 0.5,
        y: y + 0.3,
        z: z + (rnd() - 0.5) * r * 0.5,
        vx: (rnd() - 0.5) * 1.2,
        vy: 4.5 + rnd() * 3.5,
        vz: (rnd() - 0.5) * 1.2,
        life,
        size,
        grow: (-size / life) * 0.7,
        color: p.warm,
        colorEnd: p.cool,
        gravity: -1,
        drag: 1.8,
        alpha: 0.75,
        fade: 0.9,
      });
    }
    this.front(x, z, r, p, k);
    this.smokeCloud(x, z, r, p, k, scale);
    this.sparks(x, y + 0.4, z, Math.round((8 + r * 4) * k), p, 4 + r);
    if (o.scorch !== false) this.scorch(x, z, r * 0.75, p);
  }

  /** A low front of fire (or stone dust) racing out to radius `r` along the floor: shows exactly what was hit. */
  groundWave(x: number, z: number, r: number, palette: BlastPalette | 'stone', strength = 1): void {
    if (!this.enabled) return;
    if (palette !== 'stone') {
      this.front(x, z, r, PALETTES[palette], strength);
      return;
    }
    const n = Math.round((16 + r * 16) * strength);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rnd() * 0.3;
      const v = (r - 0.4) * 5 * (0.85 + rnd() * 0.2);
      const size = 0.35 + rnd() * 0.35;
      this.smoke.spawn({
        x: x + Math.cos(a) * 0.4,
        y: 0.08,
        z: z + Math.sin(a) * 0.4,
        vx: Math.cos(a) * v,
        vy: 0.6 + rnd() * 1.6,
        vz: Math.sin(a) * v,
        life: 0.55 + rnd() * 0.3,
        size,
        grow: 0.7,
        color: pick(STONE),
        colorEnd: STONE_END,
        alpha: 0.75,
        fade: 0.7,
        gravity: 1.5,
        drag: 5,
      });
    }
    // Rock chips thrown up, and a few embers from the golem's heat.
    for (let i = 0; i < Math.round(r * 3 * strength); i++) {
      const a = rnd() * Math.PI * 2;
      const v = 1.5 + rnd() * 3;
      this.smoke.spawn({
        x: x + Math.cos(a) * r * 0.4,
        y: 0.1,
        z: z + Math.sin(a) * r * 0.4,
        vx: Math.cos(a) * v,
        vy: 3 + rnd() * 4,
        vz: Math.sin(a) * v,
        life: 0.7 + rnd() * 0.4,
        size: 0.14 + rnd() * 0.12,
        color: pick(STONE),
        gravity: 12,
        drag: 0.8,
      });
    }
    this.sparks(x, 0.3, z, Math.round(r * 2 * strength), PALETTES.ember, 3 + r * 0.6);
  }

  /** Flames whipping around a circle of radius `r`; `inward` drags them to the centre instead (the Vortex rune). */
  swirl(x: number, z: number, r: number, palette: BlastPalette, inward: boolean, strength = 1): void {
    if (!this.enabled) return;
    const p = PALETTES[palette];
    const n = Math.round((14 + r * 7) * strength);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rnd() * 0.4;
      const rr = r * (inward ? 1 : 0.8 + rnd() * 0.25);
      const tx = -Math.sin(a);
      const tz = Math.cos(a);
      const spin = (inward ? 4 : 7) + rnd() * 2;
      const pull = inward ? (r - 0.8) * 4 : 0;
      const size = 0.3 + rnd() * 0.25;
      const life = inward ? 0.45 + rnd() * 0.2 : 0.24 + rnd() * 0.14;
      this.flame({
        x: x + Math.cos(a) * rr,
        y: 0.5 + rnd() * 1.1,
        z: z + Math.sin(a) * rr,
        vx: tx * spin - Math.cos(a) * pull,
        vy: 0.3 + rnd() * 0.8,
        vz: tz * spin - Math.sin(a) * pull,
        life,
        size,
        grow: (-size / life) * 0.5,
        color: rnd() < 0.3 ? p.hot : p.warm,
        colorEnd: p.cool,
        drag: inward ? 4 : 1.5,
        alpha: 0.7,
        fade: 1,
      });
    }
  }

  /** Small burst for a death or a summon: smoke, a little fire and sparks. */
  puff(x: number, y: number, z: number, palette: BlastPalette, size = 1): void {
    if (!this.enabled) return;
    const p = PALETTES[palette];
    for (let i = 0; i < Math.round(6 * size); i++) {
      const s = (0.45 + rnd() * 0.4) * size;
      this.smoke.spawn({
        x: x + (rnd() - 0.5) * 0.6 * size,
        y: y + rnd() * 0.5,
        z: z + (rnd() - 0.5) * 0.6 * size,
        vx: (rnd() - 0.5) * 1.6,
        vy: 0.6 + rnd() * 1.2,
        vz: (rnd() - 0.5) * 1.6,
        life: 0.8 + rnd() * 0.8,
        size: s,
        grow: 0.6,
        color: p.smoke,
        colorEnd: p.smokeEnd,
        alpha: 0.4,
        fade: 0.8,
        gravity: -0.3,
        drag: 1.6,
      });
    }
    for (let i = 0; i < Math.round(7 * size); i++) {
      const s = (0.3 + rnd() * 0.3) * size;
      const life = 0.25 + rnd() * 0.3;
      this.flame({
        x,
        y: y + 0.2,
        z,
        vx: (rnd() - 0.5) * 3 * size,
        vy: 1 + rnd() * 2.5,
        vz: (rnd() - 0.5) * 3 * size,
        life,
        size: s,
        grow: (-s / life) * 0.6,
        color: p.hot,
        colorEnd: p.cool,
        gravity: -2,
        drag: 3,
        alpha: 0.7,
        fade: 1,
      });
    }
    this.sparks(x, y + 0.3, z, Math.round(6 * size), p, 3 * size);
  }

  /** One small flame rising from the edge of a warning circle. */
  rim(x: number, z: number, r: number, palette: BlastPalette): void {
    if (!this.enabled) return;
    const p = PALETTES[palette];
    const a = rnd() * Math.PI * 2;
    const size = 0.2 + rnd() * 0.18;
    const life = 0.4 + rnd() * 0.35;
    this.flame({
      x: x + Math.cos(a) * r,
      y: 0.1,
      z: z + Math.sin(a) * r,
      vx: 0,
      vy: 0.8 + rnd() * 1.2,
      vz: 0,
      life,
      size,
      grow: (-size / life) * 0.6,
      color: p.warm,
      colorEnd: p.cool,
      gravity: -0.8,
      drag: 1,
      alpha: 0.7,
      fade: 0.8,
    });
  }

  /** Fire streaming off the core beam along its length. */
  trail(x: number, y: number, z: number, yaw: number, length: number, palette: BlastPalette): void {
    if (!this.enabled) return;
    const p = PALETTES[palette];
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    for (let d = 0.6; d < length; d += 0.19) {
      const s = 0.36 + rnd() * 0.34;
      const life = 0.35 + rnd() * 0.35;
      const side = (rnd() - 0.5) * 2;
      this.flame({
        x: x + fx * d + fz * side * 0.15,
        y: y + (rnd() - 0.5) * 0.3,
        z: z + fz * d - fx * side * 0.15,
        vx: fx * 3 + fz * side * 1.8,
        vy: 0.5 + rnd() * 1.5,
        vz: fz * 3 - fx * side * 1.8,
        life,
        size: s,
        grow: (-s / life) * 0.5,
        color: rnd() < 0.4 ? p.hot : p.warm,
        colorEnd: p.cool,
        gravity: -2,
        drag: 3,
        alpha: 0.7,
        fade: 1,
      });
      if (rnd() < 0.15) {
        this.smoke.spawn({
          x: x + fx * d,
          y,
          z: z + fz * d,
          vx: rnd() - 0.5,
          vy: 0.6 + rnd(),
          vz: rnd() - 0.5,
          life: 0.7 + rnd() * 0.6,
          size: 0.45 + rnd() * 0.3,
          grow: 0.55,
          color: p.smoke,
          colorEnd: p.smokeEnd,
          alpha: 0.3,
          fade: 0.8,
          drag: 1.5,
        });
      }
    }
  }

  update(dt: number): void {
    this.fire.update(dt);
    this.smoke.update(dt);
    for (let i = this.decals.length - 1; i >= 0; i--) {
      const d = this.decals[i]!;
      d.t += dt;
      (d.mesh.material as THREE.MeshBasicMaterial).opacity = 0.75 * (1 - THREE.MathUtils.smoothstep(d.t, SOOT_LIFE * 0.5, SOOT_LIFE));
      (d.glow.material as THREE.MeshBasicMaterial).opacity = 0.8 * Math.max(0, 1 - d.t / GLOW_LIFE) * (0.75 + 0.25 * Math.sin(d.t * 40));
      d.glow.visible = d.t < GLOW_LIFE;
      if (d.t >= SOOT_LIFE) this.dropDecal(i);
    }
  }

  clear(): void {
    this.fire.clear();
    this.smoke.clear();
    for (let i = this.decals.length - 1; i >= 0; i--) this.dropDecal(i);
  }

  private flame(o: SpawnOptions): void {
    this.fire.spawn(o);
  }

  private front(x: number, z: number, r: number, p: Palette, k: number): void {
    const n = Math.round((10 + r * 11) * k);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rnd() * 0.35;
      const r0 = 0.3;
      const v = (r - r0) * 5 * (0.85 + rnd() * 0.2);
      const size = 0.38 + rnd() * 0.3;
      const life = 0.45 + rnd() * 0.25;
      this.flame({
        x: x + Math.cos(a) * r0,
        y: 0.12 + rnd() * 0.2,
        z: z + Math.sin(a) * r0,
        vx: Math.cos(a) * v,
        vy: 0.4 + rnd() * 1.4,
        vz: Math.sin(a) * v,
        life,
        size,
        grow: (-size / life) * 0.4,
        color: rnd() < 0.25 ? p.hot : p.warm,
        colorEnd: p.cool,
        gravity: -1.5,
        drag: 5,
        alpha: 0.7,
        fade: 0.9,
      });
    }
  }

  private smokeCloud(x: number, z: number, r: number, p: Palette, k: number, scale: number): void {
    for (let i = 0; i < Math.round((5 + r * 3) * k); i++) {
      const a = rnd() * Math.PI * 2;
      const d = rnd() * r * 0.5;
      const out = 0.5 + rnd() * 0.8;
      this.smoke.spawn({
        x: x + Math.cos(a) * d,
        y: 0.6 + rnd() * 0.8,
        z: z + Math.sin(a) * d,
        vx: Math.cos(a) * out,
        vy: 0.6 + rnd() * 1.3,
        vz: Math.sin(a) * out,
        life: 1.1 + rnd() * 1.1,
        size: (0.75 + rnd() * 0.6) * scale,
        grow: 0.8,
        color: p.smoke,
        colorEnd: p.smokeEnd,
        alpha: 0.38 + rnd() * 0.14,
        fade: 0.75,
        gravity: -0.35,
        drag: 1.4,
      });
    }
  }

  private sparks(x: number, y: number, z: number, n: number, p: Palette, speed: number): void {
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2;
      const v = speed * (0.5 + rnd() * 0.7);
      this.fire.spawn({
        x,
        y,
        z,
        vx: Math.cos(a) * v,
        vy: 2.5 + rnd() * 4.5,
        vz: Math.sin(a) * v,
        life: 0.4 + rnd() * 0.5,
        size: 0.06 + rnd() * 0.05,
        color: pick(p.sparks),
        gravity: 12,
        drag: 1.2,
      });
    }
  }

  private scorch(x: number, z: number, r: number, p: Palette): void {
    if (this.decals.length >= MAX_DECALS) this.dropDecal(0);
    const mesh = new THREE.Mesh(
      this.decalGeo,
      new THREE.MeshBasicMaterial({ map: this.soot, transparent: true, depthWrite: false, opacity: 0.75, polygonOffset: true, polygonOffsetFactor: -2 }),
    );
    const glow = new THREE.Mesh(
      this.decalGeo,
      new THREE.MeshBasicMaterial({
        map: this.embers,
        color: p.warm,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        polygonOffset: true,
        polygonOffsetFactor: -3,
      }),
    );
    for (const m of [mesh, glow]) {
      m.position.set(x, 0.035, z);
      m.rotation.y = rnd() * Math.PI * 2;
      m.scale.setScalar(Math.max(0.6, r));
      this.scene.add(m);
    }
    this.decals.push({ mesh, glow, t: 0 });
  }

  private dropDecal(i: number): void {
    const [d] = this.decals.splice(i, 1);
    if (!d) return;
    for (const m of [d.mesh, d.glow]) {
      m.removeFromParent();
      (m.material as THREE.Material).dispose();
    }
  }
}
