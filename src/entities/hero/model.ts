import * as THREE from 'three';
import { buildAtlasModel, type FacePainter, type PartSpec } from '../../render/atlasModel';
import type { PixelCanvas } from '../../render/pixelCanvas';
import {
  paintBronze,
  paintCrystal,
  paintEmber,
  paintLines,
  paintPlate,
  paintStone,
  paintVisor,
} from '../../render/heroPaint';

/** One model pixel in world units. The rig is authored in voxel pixel space. */
export const PX = 1 / 15;
export const HIP_Y = 10;
/** Brightest per-part glow; the shared material's emissive intensity, with each part scaled under it. */
const MAX_GLOW = 2;

interface BoxSpec extends Omit<PartSpec, 'glow'> {
  glow?: number;
}

export interface HeroRig {
  root: THREE.Group;
  /** Pixel-space body; spins as a whole for the spin attack. */
  spinner: THREE.Group;
  hips: THREE.Group;
  torso: THREE.Group;
  head: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  hornL: THREE.Group;
  hornR: THREE.Group;
  plateLower: THREE.Group;
  footL: THREE.Object3D;
  footR: THREE.Object3D;
  chestLight: THREE.PointLight;
  pulseMaterials: THREE.MeshStandardMaterial[];
}

/** Collects boxes first, then bakes every face into one atlas so the whole hero shares a material. */
class RigBuilder {
  private readonly boxes: Array<{ parent: THREE.Object3D; spec: BoxSpec }> = [];

  box(parent: THREE.Object3D, spec: BoxSpec): void {
    this.boxes.push({ parent, spec });
  }

  build(): THREE.MeshStandardMaterial {
    const atlas = buildAtlasModel(
      this.boxes.map(({ spec }) => ({ ...spec, glow: (spec.glow ?? 0.7) / MAX_GLOW })),
      128,
    );
    const material = new THREE.MeshStandardMaterial({
      map: atlas.map,
      emissiveMap: atlas.emissiveMap,
      emissive: 0xffffff,
      emissiveIntensity: MAX_GLOW,
      roughness: 0.92,
      metalness: 0,
    });
    material.userData.baseGlow = MAX_GLOW;
    for (const { parent, spec } of this.boxes) {
      const part = atlas.parts.get(spec.name)!;
      const mesh = new THREE.Mesh(part.geometry, material);
      mesh.name = spec.name;
      mesh.position.copy(part.center);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
    }
    return material;
  }
}

const paintBody: FacePainter = (face, pc, seed) => {
  paintStone(pc, seed, { lift: face === 'py' ? 0.06 : face === 'ny' ? -0.12 : 0, seams: face === 'ny' ? 0 : 1.2 });
  if (face === 'pz') paintEmber(pc, seed + 1, 1, 5, pc.w - 1, 24, 1);
};

const paintHead: FacePainter = (face, pc, seed) => {
  if (face === 'pz') paintVisor(pc, seed);
  else paintStone(pc, seed, { lift: face === 'py' ? 0.05 : 0, seams: 0.6 });
};

const paintLeg: FacePainter = (face, pc, seed) => {
  if (face === 'ny') {
    paintBronze(pc, seed, 0, pc.h);
    paintLines(pc, [2, 5], 0, pc.h);
    return;
  }
  paintStone(pc, seed, { seams: 0.8 });
  if (face === 'py') return;
  paintBronze(pc, seed + 1, pc.h - 3, pc.h);
  paintLines(pc, [2, 5], pc.h - 3, pc.h);
};

const paintArm: FacePainter = (face, pc, seed) => {
  if (face === 'py' || face === 'ny') {
    paintBronze(pc, seed, 0, pc.h);
    if (face === 'ny') paintLines(pc, [2, 5], 0, pc.h);
    return;
  }
  paintStone(pc, seed, { seams: 1.4 });
  paintBronze(pc, seed + 1, 0, 8, 4);
  paintBronze(pc, seed + 2, 13, 15);
  paintBronze(pc, seed + 3, pc.h - 5, pc.h, pc.h - 3);
  paintLines(pc, [2, 5], pc.h - 2, pc.h);
};

const paintCrystalAll: FacePainter = (_face, pc, seed) => paintCrystal(pc, seed);

const paintEmberAll: FacePainter = (_face, pc, seed) => paintEmber(pc, seed);

const paintPlateUpper: FacePainter = (face, pc, seed) => {
  if (face === 'pz') paintPlate(pc, seed, true);
  else if (face === 'ny') paintEmber(pc, seed, 0, 0, pc.w, pc.h, 0.6);
  else if (face === 'py' || face === 'px' || face === 'nx') paintBronze(pc, seed, 0, pc.h);
  else paintStone(pc, seed);
};

const paintPlateLower: FacePainter = (face, pc, seed) => {
  if (face === 'pz') paintPlate(pc, seed, false);
  else if (face === 'py') paintEmber(pc, seed, 0, 0, pc.w, pc.h, 0.7);
  else if (face === 'ny' || face === 'px' || face === 'nx') paintBronze(pc, seed, 0, pc.h);
  else paintStone(pc, seed);
};


export const buildHero = (): HeroRig => {
  const b = new RigBuilder();
  const root = new THREE.Group();
  root.name = 'cairnheart';
  const rig = new THREE.Group();
  rig.scale.setScalar(PX);
  root.add(rig);

  const hips = new THREE.Group();
  hips.position.y = HIP_Y;
  rig.add(hips);

  const makeLeg = (side: 1 | -1) => {
    const pivot = new THREE.Group();
    pivot.position.set(6 * side, 0, -1);
    hips.add(pivot);
    b.box(pivot, { name: `leg${side}`, x: [-4, 4], y: [-10, 0], z: [-4, 4], paint: paintLeg });
    const foot = new THREE.Object3D();
    foot.position.set(0, -10, 2);
    pivot.add(foot);
    return { pivot, foot };
  };
  const legL = makeLeg(1);
  const legR = makeLeg(-1);

  const torso = new THREE.Group();
  hips.add(torso);
  b.box(torso, { name: 'body', x: [-12, 12], y: [0, 26], z: [-10, 10], paint: paintBody, glow: 0.45 });
  for (const [y, h] of [
    [6, 4],
    [12, 5],
    [18, 4],
  ] as const) {
    b.box(torso, { name: `ridge${y}`, x: [-2, 2], y: [y, y + h], z: [-12, -10], paint: paintCrystalAll, glow: 1.5 });
  }

  b.box(torso, { name: 'plateUpper', x: [-11, 11], y: [13, 21], z: [9, 14], paint: paintPlateUpper, glow: 0.9 });
  b.box(torso, { name: 'heartGlow', x: [-9, 9], y: [11, 13], z: [10, 13], paint: paintEmberAll, glow: 1 });
  const plateLower = new THREE.Group();
  plateLower.position.set(0, 11, 9);
  torso.add(plateLower);
  b.box(plateLower, { name: 'plateLower', x: [-11, 11], y: [-8, 0], z: [0, 5], paint: paintPlateLower, glow: 0.9 });

  const head = new THREE.Group();
  head.position.set(0, 23, 8);
  torso.add(head);
  b.box(head, { name: 'head', x: [-6, 6], y: [-2, 8], z: [-4, 6], paint: paintHead, glow: 0.9 });
  b.box(head, { name: 'crest', x: [-1, 1], y: [8, 10], z: [-3, 4], paint: (_f: unknown, pc: PixelCanvas, seed: number) => paintBronze(pc, seed, 0, pc.h) });

  /** Swept-back amber crystal horns; pivots keep the old secondary-motion springs. */
  const makeHorn = (side: 1 | -1) => {
    const pivot = new THREE.Group();
    pivot.position.set(4 * side, 7, 0);
    pivot.rotation.order = 'ZXY';
    head.add(pivot);
    const base = new THREE.Group();
    base.rotation.set(-0.35, 0, -0.55 * side);
    pivot.add(base);
    b.box(base, { name: `horn${side}a`, x: [-1, 1], y: [0, 6], z: [-1, 1], paint: paintCrystalAll, glow: 1.7 });
    const tip = new THREE.Group();
    tip.position.y = 6;
    tip.rotation.set(-0.3, 0, -0.4 * side);
    base.add(tip);
    b.box(tip, { name: `horn${side}b`, x: [-1, 1], y: [0, 5], z: [-1, 1], paint: paintCrystalAll, glow: 2 });
    return pivot;
  };
  const hornL = makeHorn(1);
  const hornR = makeHorn(-1);

  const makeArm = (side: 1 | -1) => {
    const pivot = new THREE.Group();
    pivot.position.set(16 * side, 22, 0);
    torso.add(pivot);
    b.box(pivot, { name: `arm${side}`, x: [-4, 4], y: [-30, 4], z: [-4, 4], paint: paintArm });
    const crown = new THREE.Group();
    crown.position.set(side * 1, 4, 0);
    crown.rotation.z = -0.2 * side;
    pivot.add(crown);
    const spikes: Array<{ z: number; h: number; rx: number }> = [
      { z: -2.5, h: 7, rx: -0.22 },
      { z: 0, h: 10, rx: 0 },
      { z: 2.5, h: 6, rx: 0.24 },
    ];
    for (const s of spikes) {
      const g = new THREE.Group();
      g.position.z = s.z;
      g.rotation.x = s.rx;
      crown.add(g);
      b.box(g, { name: `shard${side}${s.z}`, x: [-1, 1], y: [-1, s.h], z: [-1, 1], paint: paintCrystalAll, glow: 1.6 });
    }
    return pivot;
  };
  const armL = makeArm(1);
  const armR = makeArm(-1);

  const chestLight = new THREE.PointLight(0xffa640, 1.5, 6, 2);
  chestLight.position.set(0, 1, 30);
  torso.add(chestLight);

  return {
    root,
    spinner: rig,
    hips,
    torso,
    head,
    legL: legL.pivot,
    legR: legR.pivot,
    armL,
    armR,
    hornL,
    hornR,
    plateLower,
    footL: legL.foot,
    footR: legR.foot,
    chestLight,
    pulseMaterials: [b.build()],
  };
};
