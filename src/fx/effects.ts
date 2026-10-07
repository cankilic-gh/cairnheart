import * as THREE from 'three';
import { Blasts } from './blasts';
import { TELEGRAPH_ORDER, WARN_DISC_GEO, WARN_FILL_TEX, WARN_RING_TEX, warnMaterial } from './warnings';

interface Transient {
  root: THREE.Object3D;
  t: number;
  duration: number;
  update(p: number): void;
  materials: THREE.Material[];
}

interface FlashLight {
  light: THREE.PointLight;
  t: number;
  duration: number;
  peak: number;
}

const ARC_VERT = /* glsl */ `
varying vec2 vPos;
void main() {
  vPos = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const ARC_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uInner;
uniform float uOuter;
uniform float uStart;
uniform float uLength;
uniform float uSide;
varying vec2 vPos;
void main() {
  float r = length(vPos);
  float t = clamp((atan(vPos.y, vPos.x) - uStart) / uLength, 0.0, 1.0);
  if (uSide < 0.0) t = 1.0 - t;
  float radial = smoothstep(uInner, uOuter - 0.25, r) * (1.0 - smoothstep(uOuter - 0.12, uOuter, r));
  float a = radial * pow(t, 2.2) * uOpacity * 0.75;
  gl_FragColor = vec4(uColor * (0.35 + 0.95 * t), a);
}`;

const ARC_INNER = 1.3;

export interface ArcSize {
  inner: number;
  outer: number;
  halfAngle: number;
}

const DEFAULT_ARC: ArcSize = { inner: ARC_INNER, outer: 3.1, halfAngle: 1.25 };

const additive = (color: THREE.ColorRepresentation, boost = 1): THREE.MeshBasicMaterial =>
  new THREE.MeshBasicMaterial({
    color: new THREE.Color(color).multiplyScalar(boost),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });

/** Short-lived combat visuals: swipe arcs, the core beam, telegraphs, light pops, and particle fire (`blasts`). */
export class Effects {
  readonly blasts: Blasts;
  private readonly items: Transient[] = [];
  private readonly lights: FlashLight[] = [];
  private readonly arcGeos = new Map<string, THREE.RingGeometry>();
  private readonly beamCoreGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5);

  constructor(private readonly scene: THREE.Scene) {
    this.blasts = new Blasts(scene);
    // Fixed pool: adding lights at runtime would force every material to recompile.
    for (let i = 0; i < 1; i++) {
      const light = new THREE.PointLight(0xffb347, 0, 10, 1.8);
      scene.add(light);
      this.lights.push({ light, t: 1, duration: 1, peak: 0 });
    }
  }

  /** Swipe trail sized to the attack's real hit wedge, so what you see is what hits. */
  swipe(x: number, z: number, yaw: number, side: 1 | -1, arc: ArcSize = DEFAULT_ARC, color: THREE.ColorRepresentation = 0xffa83a, y = 1.3): void {
    const length = arc.halfAngle * 2;
    const start = -Math.PI / 2 - arc.halfAngle;
    const key = `${arc.inner}:${arc.outer}:${arc.halfAngle}`;
    let geo = this.arcGeos.get(key);
    if (!geo) {
      geo = new THREE.RingGeometry(arc.inner, arc.outer, 32, 2, start, length);
      this.arcGeos.set(key, geo);
    }
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(color) },
        uOpacity: { value: 1 },
        uInner: { value: arc.inner },
        uOuter: { value: arc.outer },
        uStart: { value: start },
        uLength: { value: length },
        uSide: { value: 1 },
      },
      vertexShader: ARC_VERT,
      fragmentShader: ARC_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const group = new THREE.Group();
    group.position.set(x, y, z);
    group.rotation.y = yaw;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.scale.x = side;
    group.add(mesh);
    this.add(group, 0.22, [mat], (p) => {
      mat.uniforms.uOpacity!.value = (1 - p) ** 2;
      group.rotation.y = yaw + side * (p - 0.5) * 0.5;
      mesh.scale.setScalar(1 + p * 0.12);
      mesh.scale.x *= side;
    });
  }

  /** The core beam: a white-hot shaft that thins out, with fire streaming off its length. */
  beam(x: number, y: number, z: number, yaw: number, length: number): void {
    const group = new THREE.Group();
    group.position.set(x, y, z);
    group.rotation.y = yaw;
    const coreMat = additive(0xff9a2e, 0.9);
    const core = new THREE.Mesh(this.beamCoreGeo, coreMat);
    core.scale.set(0.45, 0.45, length);
    group.add(core);
    this.add(group, 0.4, [coreMat], (p) => {
      const width = 0.45 * (1 - p) ** 0.7 + 0.03;
      core.scale.x = core.scale.y = width;
      coreMat.opacity = 0.8 * (1 - p) ** 1.5;
    });
    this.blasts.trail(x, y, z, yaw, length, 'ember');
  }

  /**
   * Ground warning for an incoming area attack: a pixel rim, a dithered disc that fills as the
   * wind-up runs out, and gloom flames licking up along the edge. Drawn after hero effects.
   */
  telegraph(x: number, z: number, radius: number, duration: number): void {
    const group = new THREE.Group();
    group.position.set(x, 0.07, z);
    const ringMat = warnMaterial(WARN_RING_TEX, 0.95);
    const ring = new THREE.Mesh(WARN_DISC_GEO, ringMat);
    ring.scale.setScalar(radius);
    ring.renderOrder = TELEGRAPH_ORDER + 1;
    const fillMat = warnMaterial(WARN_FILL_TEX, 0.3);
    const fill = new THREE.Mesh(WARN_DISC_GEO, fillMat);
    fill.renderOrder = TELEGRAPH_ORDER;
    group.add(ring, fill);
    let last = 0;
    this.add(group, duration, [ringMat, fillMat], (p) => {
      fill.scale.setScalar(Math.max(0.01, p * radius));
      fillMat.opacity = 0.25 + 0.35 * p;
      ringMat.opacity = 0.7 + 0.3 * Math.abs(Math.sin(p * Math.PI * 6));
      const flames = Math.floor((p - last) * duration * 60);
      if (flames > 0) last = p;
      for (let i = 0; i < flames; i++) this.blasts.rim(x, z, radius, 'gloom');
    });
  }

  flash(x: number, y: number, z: number, intensity: number, duration: number, color: THREE.ColorRepresentation = 0xffb347): void {
    const slot = this.lights.reduce((a, b) => (a.t / a.duration >= b.t / b.duration ? a : b));
    slot.light.position.set(x, y, z);
    slot.light.color.set(color);
    slot.t = 0;
    slot.duration = duration;
    slot.peak = intensity;
  }

  setPointScale(scale: number): void {
    this.blasts.setScale(scale);
  }

  update(dt: number): void {
    this.blasts.update(dt);
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i]!;
      it.t += dt;
      const p = Math.min(1, it.t / it.duration);
      it.update(p);
      if (p >= 1) {
        it.root.removeFromParent();
        for (const m of it.materials) m.dispose();
        this.items.splice(i, 1);
      }
    }
    for (const l of this.lights) {
      l.t += dt;
      const p = Math.min(1, l.t / l.duration);
      l.light.intensity = l.peak * (1 - p) ** 2;
    }
  }

  clear(): void {
    this.blasts.clear();
    for (const it of this.items) {
      it.root.removeFromParent();
      for (const m of it.materials) m.dispose();
    }
    this.items.length = 0;
    for (const l of this.lights) l.light.intensity = 0;
  }

  private add(root: THREE.Object3D, duration: number, materials: THREE.Material[], update: (p: number) => void): void {
    update(0);
    this.scene.add(root);
    this.items.push({ root, t: 0, duration, update, materials });
  }
}
