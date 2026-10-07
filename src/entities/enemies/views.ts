import * as THREE from 'three';
import { buildAtlasModel, type AtlasModel, type FacePainter, type PartSpec } from '../../render/atlasModel';
import { TELEGRAPH_ORDER, WARN_DISC_GEO, WARN_LANE_GEO, WARN_LANE_TEX, WARN_RING_TEX, warnMaterial } from '../../fx/warnings';
import { applyFlash, createFlash, type FlashUniforms } from '../../render/flash';
import { GLOOM, paintEye, paintGloomCrystal, paintHide } from '../../render/gloomPaint';
import { EMERGE_TIME } from './brain';
import type { EnemyKind, EnemyState } from './types';

/** One enemy pixel in world units. */
const PX = 1 / 16;
const HURT = new THREE.Color(1, 0.12, 0.1);
const CHARGE = new THREE.Color(1, 0.92, 1);
const FUSE_MARK = new THREE.Color(1, 0.45, 0.2);
const ELITE_TINT: Partial<Record<EnemyKind, { color: number; emissive: number }>> = {
  burster: { color: 0xffb3e6, emissive: 0xff8fd6 },
  spitter: { color: 0xb8f0ff, emissive: 0x8fe8ff },
  skitter: { color: 0xd8ffb3, emissive: 0xb8ff8f },
};
const RING_GEO = new THREE.RingGeometry(0.78, 1, 40);


const hide =
  (lift = 0, flecks = 0.02): FacePainter =>
  (face, pc, seed) =>
    paintHide(pc, seed, face === 'ny' ? lift - 0.15 : face === 'py' ? lift + 0.05 : lift, flecks);

const crystal: FacePainter = (_face, pc, seed) => paintGloomCrystal(pc, seed);

const BURSTER: PartSpec[] = [
  {
    name: 'b-body',
    x: [-6, 6],
    y: [3, 13],
    z: [-5, 5],
    paint: (face, pc, seed) => {
      hide(0.02)(face, pc, seed);
      if (face !== 'pz') return;
      paintEye(pc, 4, 2, 4, 3);
      for (let x = 2; x < pc.w - 2; x++) pc.set(x, 7, x % 2 === 0 ? GLOOM.bone : GLOOM.void);
    },
  },
  { name: 'b-crystal-tall', x: [-1, 1], y: [0, 8], z: [-1, 1], paint: crystal },
  { name: 'b-crystal-short', x: [-1, 1], y: [0, 5], z: [-1, 1], paint: crystal },
  { name: 'b-leg', x: [-2, 2], y: [-3, 0], z: [-2, 2], paint: hide(-0.05) },
];

const SPITTER: PartSpec[] = [
  { name: 's-leg', x: [-1, 1], y: [-8, 0], z: [-1, 1], paint: hide(-0.05) },
  { name: 's-body', x: [-3, 3], y: [8, 18], z: [-2, 2], paint: hide(0.04, 0.04) },
  {
    name: 's-head',
    x: [-3, 3],
    y: [0, 6],
    z: [-3, 3],
    paint: (face, pc, seed) => {
      hide(0.06)(face, pc, seed);
      if (face === 'pz') {
        paintEye(pc, 0, 1, 2, 1);
        paintEye(pc, 4, 1, 2, 1);
      }
    },
  },
  {
    name: 's-snout',
    x: [-1, 1],
    y: [0, 3],
    z: [0, 4],
    paint: (face, pc, seed) => (face === 'pz' ? paintGloomCrystal(pc, seed) : hide(0.1)(face, pc, seed)),
  },
  { name: 's-spike', x: [-1, 1], y: [0, 4], z: [-1, 1], paint: crystal },
];

const SKITTER: PartSpec[] = [
  { name: 'k-body', x: [-3, 3], y: [4, 9], z: [-6, 5], paint: hide(0.03, 0.03) },
  {
    name: 'k-head',
    x: [-3, 3],
    y: [-2, 3],
    z: [0, 5],
    paint: (face, pc, seed) => {
      hide(0.05)(face, pc, seed);
      if (face !== 'pz') return;
      paintEye(pc, 0, 1, 2, 1);
      paintEye(pc, 4, 1, 2, 1);
      for (let x = 1; x < pc.w - 1; x++) pc.set(x, 3, x % 2 === 0 ? GLOOM.bone : GLOOM.void);
    },
  },
  { name: 'k-leg', x: [-1, 1], y: [-4, 0], z: [-1, 1], paint: hide(-0.05) },
  { name: 'k-spine', x: [-1, 1], y: [0, 3], z: [-1, 1], paint: crystal },
];

const MATRIARCH: PartSpec[] = [
  { name: 'm-body', x: [-14, 14], y: [12, 32], z: [-16, 12], paint: hide(0.02, 0.03) },
  {
    name: 'm-head',
    x: [-9, 9],
    y: [-8, 6],
    z: [0, 12],
    paint: (face, pc, seed) => {
      hide(0.06)(face, pc, seed);
      if (face !== 'pz') return;
      for (const [x, y] of [
        [2, 2],
        [12, 2],
        [5, 5],
        [9, 5],
      ] as const) {
        paintEye(pc, x, y, 3, 2);
      }
      for (let x = 2; x < pc.w - 2; x++) {
        pc.set(x, 10, GLOOM.void);
        if (x % 3 === 0) {
          pc.set(x, 9, GLOOM.crystalHi, 1);
          pc.set(x, 11, GLOOM.crystalHi, 1);
        }
      }
    },
  },
  { name: 'm-leg', x: [-4, 4], y: [-12, 0], z: [-4, 4], paint: hide(-0.04) },
  { name: 'm-crystal-tall', x: [-2, 2], y: [0, 16], z: [-2, 2], paint: crystal },
  { name: 'm-crystal-short', x: [-2, 2], y: [0, 10], z: [-2, 2], paint: crystal },
];

const SPECS: Record<EnemyKind, PartSpec[]> = { burster: BURSTER, spitter: SPITTER, skitter: SKITTER, matriarch: MATRIARCH };
const templates = new Map<EnemyKind, AtlasModel>();
const template = (kind: EnemyKind): AtlasModel => {
  let t = templates.get(kind);
  if (!t) {
    t = buildAtlasModel(SPECS[kind], kind === 'matriarch' ? 128 : 64);
    templates.set(kind, t);
  }
  return t;
};

interface Rig {
  body: THREE.Group;
  head: THREE.Group | null;
  legs: THREE.Group[];
  crystals: THREE.Group[];
}

/** One instance of an enemy model; owns its material so hit flashes stay per-enemy. */
export class EnemyView {
  readonly group = new THREE.Group();
  private readonly root = new THREE.Group();
  private readonly material: THREE.MeshStandardMaterial;
  private readonly flash: FlashUniforms;
  private readonly rig: Rig;
  private readonly t: AtlasModel;
  private readonly ring: THREE.Mesh | null = null;
  /** Floor telegraph: burster blast ring, spitter aim lane or skitter lunge lane. */
  private readonly warn: THREE.Mesh | null = null;
  private readonly warnMat: THREE.MeshBasicMaterial | null = null;

  /** `ringColor` marks an elite with its graft family's colour on the floor. */
  constructor(
    private readonly kind: EnemyKind,
    elite: boolean,
    ringColor: number | null = null,
  ) {
    this.t = template(kind);
    this.material = new THREE.MeshStandardMaterial({
      map: this.t.map,
      emissiveMap: this.t.emissiveMap,
      emissive: 0xffffff,
      emissiveIntensity: kind === 'matriarch' ? 1.3 : 1,
      roughness: 0.6,
      metalness: 0.05,
      transparent: true,
      opacity: 1,
    });
    const tint = elite ? ELITE_TINT[kind] : undefined;
    if (tint) {
      this.material.color.set(tint.color);
      this.material.emissive.set(tint.emissive);
    }
    this.flash = createFlash();
    applyFlash(this.material, this.flash);
    this.root.scale.setScalar(PX);
    this.group.add(this.root);
    this.rig = this.build();
    if (kind !== 'matriarch') {
      this.warnMat = warnMaterial(kind === 'burster' ? WARN_RING_TEX : WARN_LANE_TEX, 0);
      this.warn = new THREE.Mesh(kind === 'burster' ? WARN_DISC_GEO : WARN_LANE_GEO, this.warnMat);
      this.warn.position.y = 0.06;
      this.warn.renderOrder = TELEGRAPH_ORDER;
      this.warn.visible = false;
      this.group.add(this.warn);
    }
    if (ringColor !== null) {
      this.ring = new THREE.Mesh(
        RING_GEO,
        new THREE.MeshBasicMaterial({ color: new THREE.Color(ringColor).multiplyScalar(1.6), transparent: true, opacity: 0.85, depthWrite: false }),
      );
      this.ring.rotation.x = -Math.PI / 2;
      this.ring.position.y = 0.05;
      this.group.add(this.ring);
    }
  }

  sync(e: EnemyState, time: number): void {
    const g = this.group;
    g.position.set(e.pos.x, 0, e.pos.z);
    g.rotation.y = e.yaw;
    const emerge = e.phase === 'emerging' ? Math.min(1, e.emerge / (EMERGE_TIME * 0.55)) : 1;
    this.material.opacity = emerge;
    this.material.transparent = emerge < 1;
    const s = e.cfg.scale * (0.6 + 0.4 * emerge);
    g.scale.setScalar(s);
    if (this.ring) {
      this.ring.scale.setScalar((e.cfg.radius + 0.35) / s);
      this.ring.rotation.z = time * 1.5;
    }
    this.syncWarning(e, s);

    const moving = Math.min(1, Math.hypot(e.vel.x, e.vel.z) / 1.2);
    const w = e.walk;
    const r = this.rig;
    const c = e.charge;
    r.body.position.set(0, 0, 0);
    r.body.rotation.set(0, 0, 0);
    r.body.scale.set(1, 1, 1);
    if (r.head) r.head.rotation.set(0, 0, e.stun > 0 ? Math.sin(time * 18) * 0.18 : 0);

    switch (this.kind) {
      case 'burster': {
        const swing = Math.sin(w * 1.3) * 0.7 * moving;
        r.legs[0]!.rotation.x = swing;
        r.legs[1]!.rotation.x = -swing;
        r.body.rotation.z = Math.sin(w * 1.3) * 0.1 * moving;
        const swell = 1 + c * 0.24 + (c > 0 ? Math.sin(time * 42) * 0.02 : 0);
        r.body.scale.set(swell, 1 + c * 0.12, swell);
        break;
      }
      case 'spitter': {
        const swing = Math.sin(w) * 0.6 * moving;
        r.legs[0]!.rotation.x = swing;
        r.legs[1]!.rotation.x = -swing;
        if (r.head) r.head.rotation.x = -0.55 * c + (e.mode === 'move' ? Math.sin(w * 2) * 0.05 : 0);
        r.body.rotation.x = -0.12 * c;
        break;
      }
      case 'skitter': {
        const swing = Math.sin(w * 1.6) * 0.8 * moving;
        r.legs[0]!.rotation.x = swing;
        r.legs[3]!.rotation.x = swing;
        r.legs[1]!.rotation.x = -swing;
        r.legs[2]!.rotation.x = -swing;
        const crouch = e.mode === 'crouch' ? c : 0;
        r.body.position.y = -2 * crouch + Math.abs(Math.sin(w * 1.6)) * 0.6 * moving;
        r.body.rotation.x = 0.2 * crouch;
        if (e.mode === 'lunge') {
          r.body.scale.set(0.9, 0.9, 1.25);
          for (const l of r.legs) l.rotation.x = l === r.legs[0] || l === r.legs[1] ? -0.9 : 0.9;
        }
        if (r.head) r.head.rotation.x = 0.35 * crouch;
        break;
      }
      case 'matriarch': {
        const swing = Math.sin(w * 0.8) * 0.45 * moving;
        r.legs[0]!.rotation.x = swing;
        r.legs[3]!.rotation.x = swing;
        r.legs[1]!.rotation.x = -swing;
        r.legs[2]!.rotation.x = -swing;
        if (e.mode === 'slam') {
          const rear = c < 1 ? -0.38 * c : 0.12;
          r.body.rotation.x = rear;
          r.legs[0]!.rotation.x = r.legs[1]!.rotation.x = rear * 1.6;
        } else if (e.mode === 'nova') {
          r.body.position.x = Math.sin(time * 50) * 0.4 * c;
        } else if (e.mode === 'summon' && r.head) {
          r.head.rotation.x = -0.5 * c;
        }
        const glow = e.mode === 'nova' || e.mode === 'summon' ? 1 + c * 2 : 1;
        this.material.emissiveIntensity = 1.3 * glow;
        break;
      }
    }

    if (e.hitFlash > 0) {
      this.flash.uFlashColor.value.copy(HURT);
      this.flash.uFlash.value = 0.6;
    } else if (e.marked > 0) {
      this.flash.uFlashColor.value.copy(FUSE_MARK);
      this.flash.uFlash.value = Math.sin(time * (14 + (1 - e.marked) * 30)) > 0 ? 0.55 : 0.1;
    } else {
      const blinking = this.kind === 'burster' && c > 0;
      const winding = (this.kind === 'spitter' && e.mode === 'aim') || (this.kind === 'skitter' && e.mode === 'crouch');
      const blink = blinking ? (Math.sin(time * (9 + c * 26)) > 0 ? 0.35 + c * 0.45 : 0) : winding ? c * 0.35 : 0;
      this.flash.uFlashColor.value.copy(CHARGE);
      this.flash.uFlash.value = blink;
    }
  }

  private syncWarning(e: EnemyState, s: number): void {
    const w = this.warn;
    const m = this.warnMat;
    if (!w || !m) return;
    const cfg = e.cfg;
    const on =
      e.phase === 'active' &&
      ((cfg.kind === 'burster' && e.mode === 'fuse') || (cfg.kind === 'spitter' && e.mode === 'aim') || (cfg.kind === 'skitter' && e.mode === 'crouch'));
    w.visible = on;
    if (!on) return;
    m.opacity = 0.3 + 0.55 * e.charge;
    if (cfg.kind === 'burster') w.scale.setScalar(cfg.blastRadius / s);
    else if (cfg.kind === 'spitter') w.scale.set(0.35 / s, 1, cfg.preferMax / s);
    else if (cfg.kind === 'skitter') w.scale.set(0.7 / s, 1, (cfg.lungeSpeed * cfg.lungeTime) / s);
  }

  dispose(): void {
    this.group.removeFromParent();
    this.material.dispose();
    this.warnMat?.dispose();
    (this.ring?.material as THREE.Material | undefined)?.dispose();
  }

  private mesh(name: string, parent: THREE.Object3D): THREE.Mesh {
    const part = this.t.parts.get(name)!;
    const m = new THREE.Mesh(part.geometry, this.material);
    m.position.copy(part.center);
    m.castShadow = true;
    parent.add(m);
    return m;
  }

  private pivot(parent: THREE.Object3D, x: number, y: number, z: number, rx = 0, rz = 0): THREE.Group {
    const p = new THREE.Group();
    p.position.set(x, y, z);
    p.rotation.set(rx, 0, rz);
    parent.add(p);
    return p;
  }

  private build(): Rig {
    const body = new THREE.Group();
    this.root.add(body);
    const legs: THREE.Group[] = [];
    const crystals: THREE.Group[] = [];
    let head: THREE.Group | null = null;
    switch (this.kind) {
      case 'burster': {
        this.mesh('b-body', body);
        for (const [x, y, z, rx, rz, name] of [
          [0, 12, -2, -0.3, 0, 'b-crystal-tall'],
          [-3, 11, -1, -0.2, 0.5, 'b-crystal-short'],
          [3, 11, -2, -0.25, -0.5, 'b-crystal-short'],
        ] as const) {
          const p = this.pivot(body, x, y, z, rx, rz);
          this.mesh(name, p);
          crystals.push(p);
        }
        for (const x of [-3, 3]) {
          const p = this.pivot(this.root, x, 3, 0);
          this.mesh('b-leg', p);
          legs.push(p);
        }
        break;
      }
      case 'spitter': {
        for (const x of [-2, 2]) {
          const p = this.pivot(this.root, x, 8, 0);
          this.mesh('s-leg', p);
          legs.push(p);
        }
        this.mesh('s-body', body);
        head = this.pivot(body, 0, 18, 0);
        this.mesh('s-head', head);
        const snout = this.pivot(head, 0, 1, 3);
        this.mesh('s-snout', snout);
        for (const x of [-3, 3]) crystals.push(this.pivot(body, x, 17, -1, -0.3, -x * 0.12));
        for (const p of crystals) this.mesh('s-spike', p);
        break;
      }
      case 'skitter': {
        this.mesh('k-body', body);
        head = this.pivot(body, 0, 7, 5);
        this.mesh('k-head', head);
        for (const z of [-3.5, -0.5, 2.5]) {
          const p = this.pivot(body, 0, 9, z, -0.5, 0);
          this.mesh('k-spine', p);
          crystals.push(p);
        }
        for (const [x, z] of [
          [-4, 3],
          [4, 3],
          [-4, -4],
          [4, -4],
        ] as const) {
          const p = this.pivot(body, x, 5, z);
          this.mesh('k-leg', p);
          legs.push(p);
        }
        break;
      }
      case 'matriarch': {
        body.position.set(0, 0, 0);
        this.mesh('m-body', body);
        head = this.pivot(body, 0, 26, 12);
        this.mesh('m-head', head);
        for (const [x, z, rx, rz, tall] of [
          [0, -4, -0.25, 0, true],
          [-7, -2, -0.15, 0.35, true],
          [7, -6, -0.2, -0.3, true],
          [-10, -11, -0.3, 0.5, false],
          [10, -12, -0.35, -0.45, false],
          [3, 4, 0.1, -0.2, false],
          [-4, -13, -0.5, 0.1, false],
        ] as const) {
          const p = this.pivot(body, x, 32, z, rx, rz);
          this.mesh(tall ? 'm-crystal-tall' : 'm-crystal-short', p);
          crystals.push(p);
        }
        for (const [x, z] of [
          [-11, 7],
          [11, 7],
          [-11, -11],
          [11, -11],
        ] as const) {
          const p = this.pivot(this.root, x, 12, z);
          this.mesh('m-leg', p);
          legs.push(p);
        }
        break;
      }
    }
    return { body, head, legs, crystals };
  }
}
