import * as THREE from 'three';

const VERT = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
uniform float uScale;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vColor = aColor;
  vAlpha = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
uniform float uSoft;
varying vec3 vColor;
varying float vAlpha;
void main() {
  if (vAlpha <= 0.003) discard;
  float mask = 1.0;
  if (uSoft > 0.5) {
    // 8x8 pixel blob: a quantised radial falloff keeps the pixel-art edge but loses the hard square.
    vec2 q = (floor(gl_PointCoord * 8.0) + 0.5) / 4.0 - 1.0;
    mask = clamp(1.3 - length(q) * 1.15, 0.0, 1.0);
    if (mask <= 0.02) discard;
  }
  gl_FragColor = vec4(vColor, vAlpha * mask);
}`;

/** Voxel-style point sprites with per-particle colour, size and alpha: hard squares, or soft pixel blobs. */
const createPointsMaterial = (blending: THREE.Blending, soft: boolean): THREE.ShaderMaterial =>
  new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 500 }, uSoft: { value: soft ? 1 : 0 } },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    blending,
  });

/** Pixels per world unit at distance 1 for a perspective camera; keeps sprite size in world units. */
export const pointScale = (camera: THREE.PerspectiveCamera, viewportHeight: number): number =>
  viewportHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));

abstract class PointField {
  readonly points: THREE.Points;
  protected readonly pos: Float32Array;
  protected readonly col: Float32Array;
  protected readonly size: Float32Array;
  protected readonly alpha: Float32Array;

  constructor(
    protected readonly capacity: number,
    blending: THREE.Blending,
    soft = false,
  ) {
    this.pos = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(geo, createPointsMaterial(blending, soft));
    this.points.frustumCulled = false;
  }

  setScale(scale: number): void {
    (this.points.material as THREE.ShaderMaterial).uniforms.uScale!.value = scale;
  }

  protected flush(): void {
    const a = this.points.geometry.attributes;
    a.position!.needsUpdate = true;
    a.aColor!.needsUpdate = true;
    a.aSize!.needsUpdate = true;
    a.aAlpha!.needsUpdate = true;
  }
}

export interface SpawnOptions {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  size: number;
  color: THREE.Color;
  /** Colour at the end of life; the particle fades from `color` toward it (fire cooling, smoke darkening). */
  colorEnd?: THREE.Color;
  alpha?: number;
  /** Fades as remaining-life^fade from the first frame (fire, smoke); default holds full alpha, then fades late. */
  fade?: number;
  gravity?: number;
  drag?: number;
  grow?: number;
}

/** Ring-buffer burst particles (dust, sparks, embers). */
export class ParticlePool extends PointField {
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly baseAlpha: Float32Array;
  private readonly gravity: Float32Array;
  private readonly drag: Float32Array;
  private readonly grow: Float32Array;
  private readonly col0: Float32Array;
  private readonly col1: Float32Array;
  private readonly fade: Float32Array;
  private cursor = 0;

  constructor(capacity: number, blending: THREE.Blending, soft = false) {
    super(capacity, blending, soft);
    this.fade = new Float32Array(capacity);
    this.col0 = new Float32Array(capacity * 3);
    this.col1 = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.baseAlpha = new Float32Array(capacity);
    this.gravity = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.grow = new Float32Array(capacity);
  }

  spawn(o: SpawnOptions): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    this.pos.set([o.x, o.y, o.z], i * 3);
    this.vel.set([o.vx, o.vy, o.vz], i * 3);
    const end = o.colorEnd ?? o.color;
    this.col.set([o.color.r, o.color.g, o.color.b], i * 3);
    this.col0.set([o.color.r, o.color.g, o.color.b], i * 3);
    this.col1.set([end.r, end.g, end.b], i * 3);
    this.size[i] = o.size;
    this.life[i] = o.life;
    this.maxLife[i] = o.life;
    this.baseAlpha[i] = o.alpha ?? 1;
    this.alpha[i] = o.alpha ?? 1;
    this.gravity[i] = o.gravity ?? 0;
    this.drag[i] = o.drag ?? 0;
    this.grow[i] = o.grow ?? 0;
    this.fade[i] = o.fade ?? 0;
  }

  clear(): void {
    this.life.fill(0);
    this.alpha.fill(0);
    this.flush();
  }

  update(dt: number): void {
    for (let i = 0; i < this.capacity; i++) {
      if (this.life[i]! <= 0) continue;
      const life = this.life[i]! - dt;
      this.life[i] = life;
      if (life <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      const j = i * 3;
      const k = Math.exp(-this.drag[i]! * dt);
      this.vel[j + 1]! -= this.gravity[i]! * dt;
      this.vel[j] = this.vel[j]! * k;
      this.vel[j + 1] = this.vel[j + 1]! * k;
      this.vel[j + 2] = this.vel[j + 2]! * k;
      this.pos[j] = this.pos[j]! + this.vel[j]! * dt;
      this.pos[j + 1] = this.pos[j + 1]! + this.vel[j + 1]! * dt;
      this.pos[j + 2] = this.pos[j + 2]! + this.vel[j + 2]! * dt;
      if (this.pos[j + 1]! < 0.03) {
        this.pos[j + 1] = 0.03;
        this.vel[j + 1] = Math.abs(this.vel[j + 1]!) * 0.2;
      }
      this.size[i] = Math.max(0, this.size[i]! + this.grow[i]! * dt);
      const t = life / this.maxLife[i]!;
      const fade = this.fade[i]!;
      this.alpha[i] = this.baseAlpha[i]! * (fade > 0 ? t ** fade : Math.min(1, t * 2.5));
      // Ease toward the end colour early, so flames read hot only for a moment.
      const c = (1 - t) ** 0.7;
      this.col[j] = this.col0[j]! + (this.col1[j]! - this.col0[j]!) * c;
      this.col[j + 1] = this.col0[j + 1]! + (this.col1[j + 1]! - this.col0[j + 1]!) * c;
      this.col[j + 2] = this.col0[j + 2]! + (this.col1[j + 2]! - this.col0[j + 2]!) * c;
    }
    this.flush();
  }
}

/** Persistent embers and gloom motes drifting upward over the arena. */
export class EmberMotes extends PointField {
  private readonly speed: Float32Array;
  private readonly seed: Float32Array;
  private time = 0;

  constructor(
    count: number,
    private readonly radius: number,
    private readonly ceiling: number,
    palette: readonly THREE.ColorRepresentation[] = [0xffb347, 0xffd98a, 0xb46bff],
  ) {
    super(count, THREE.AdditiveBlending);
    this.speed = new Float32Array(count);
    this.seed = new Float32Array(count);
    const colors = palette.map((p) => new THREE.Color(p));
    for (let i = 0; i < count; i++) {
      this.respawn(i, Math.random() * ceiling);
      this.speed[i] = 0.18 + Math.random() * 0.4;
      this.seed[i] = Math.random() * 100;
      this.size[i] = 0.04 + Math.random() * 0.06;
      const c = colors[Math.floor(Math.random() * colors.length)]!;
      this.col.set([c.r, c.g, c.b], i * 3);
    }
  }

  update(dt: number): void {
    this.time += dt;
    for (let i = 0; i < this.capacity; i++) {
      const j = i * 3;
      const s = this.seed[i]!;
      this.pos[j] = this.pos[j]! + Math.sin(this.time * 0.7 + s) * dt * 0.15;
      this.pos[j + 1] = this.pos[j + 1]! + this.speed[i]! * dt;
      this.pos[j + 2] = this.pos[j + 2]! + Math.cos(this.time * 0.6 + s) * dt * 0.15;
      if (this.pos[j + 1]! > this.ceiling) this.respawn(i, 0);
      const h = this.pos[j + 1]! / this.ceiling;
      const flicker = 0.55 + 0.45 * Math.sin(this.time * 3 + s * 7);
      this.alpha[i] = Math.min(1, h * 6) * (1 - h) * flicker * 0.9;
    }
    this.flush();
  }

  private respawn(i: number, y: number): void {
    const r = Math.sqrt(Math.random()) * this.radius;
    const a = Math.random() * Math.PI * 2;
    this.pos.set([Math.cos(a) * r, y, Math.sin(a) * r], i * 3);
  }
}
