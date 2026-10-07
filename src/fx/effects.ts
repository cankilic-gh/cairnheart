import * as THREE from 'three';

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

/** Telegraphs draw after (and over) every hero effect so a warning is never hidden by our own glow. */
export const TELEGRAPH_ORDER = 10;

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

/** Short-lived combat visuals: swipe arcs, shockwaves, the core beam and light pops. */
export class Effects {
  private readonly items: Transient[] = [];
  private readonly lights: FlashLight[] = [];
  private readonly ringGeo = new THREE.RingGeometry(0.86, 1, 48);
  private readonly discGeo = new THREE.CircleGeometry(1, 40);
  private readonly arcGeos = new Map<string, THREE.RingGeometry>();
  private readonly beamRingGeo = new THREE.RingGeometry(0.42, 0.62, 16);
  private readonly beamCoreGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5);

  constructor(private readonly scene: THREE.Scene) {
    // Fixed pool: adding lights at runtime would force every material to recompile.
    for (let i = 0; i < 1; i++) {
      const light = new THREE.PointLight(0xffb347, 0, 10, 1.8);
      scene.add(light);
      this.lights.push({ light, t: 1, duration: 1, peak: 0 });
    }
  }

  shockwave(x: number, z: number, radius: number, color: THREE.ColorRepresentation = 0xffc070, duration = 0.45, y = 0.08): void {
    const mat = additive(color, 2.2);
    const mesh = new THREE.Mesh(this.ringGeo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, y, z);
    this.add(mesh, duration, [mat], (p) => {
      const e = 1 - (1 - p) ** 3;
      mesh.scale.setScalar(0.2 + e * radius);
      mat.opacity = (1 - p) ** 1.5;
    });
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

  beam(x: number, y: number, z: number, yaw: number, length: number): void {
    const group = new THREE.Group();
    group.position.set(x, y, z);
    group.rotation.y = yaw;
    const coreMat = additive(0xff9a2e, 0.9);
    const core = new THREE.Mesh(this.beamCoreGeo, coreMat);
    core.scale.set(0.45, 0.45, length);
    group.add(core);
    const mats: THREE.Material[] = [coreMat];
    const rings: Array<{ mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; delay: number }> = [];
    const count = 12;
    for (let i = 0; i < count; i++) {
      const mat = additive(0xffd28a, 0.9);
      const mesh = new THREE.Mesh(this.beamRingGeo, mat);
      mesh.position.z = 1 + (i * (length - 1)) / (count - 1);
      group.add(mesh);
      mats.push(mat);
      rings.push({ mesh, mat, delay: i * 0.025 });
    }
    this.add(group, 0.55, mats, (p) => {
      const t = p * 0.55;
      const width = 0.45 * (1 - p) ** 0.7 + 0.04;
      core.scale.x = core.scale.y = width;
      coreMat.opacity = 0.8 * (1 - p) ** 1.5;
      for (const r of rings) {
        const local = Math.max(0, t - r.delay) / 0.4;
        r.mesh.scale.setScalar(0.4 + local * 2.2);
        r.mat.opacity = local <= 0 ? 0 : Math.max(0, 1 - local);
      }
    });
  }

  /**
   * Ground warning for an incoming area attack: a fixed outline and a disc that fills as the wind-up
   * ends. Normal-blended and drawn last, so hero glows (which are additive) cannot wash it out.
   */
  telegraph(x: number, z: number, radius: number, duration: number, color: THREE.ColorRepresentation = 0xff4fd8): void {
    const group = new THREE.Group();
    group.position.set(x, 0.07, z);
    const warn = (opacity: number) =>
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
    const ringMat = warn(0.9);
    const ring = new THREE.Mesh(this.ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.scale.setScalar(radius);
    ring.renderOrder = TELEGRAPH_ORDER + 1;
    const discMat = warn(0.3);
    const disc = new THREE.Mesh(this.discGeo, discMat);
    disc.rotation.x = -Math.PI / 2;
    disc.renderOrder = TELEGRAPH_ORDER;
    group.add(ring, disc);
    this.add(group, duration, [ringMat, discMat], (p) => {
      disc.scale.setScalar(Math.max(0.01, p * radius));
      discMat.opacity = 0.22 + 0.3 * p;
      ringMat.opacity = 0.6 + 0.4 * Math.abs(Math.sin(p * Math.PI * 6));
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

  update(dt: number): void {
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
