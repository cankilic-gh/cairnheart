import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { fbm, mulberry32, type Rng } from '../core/rng';
import {
  TILE,
  blockMaterial,
  paintFlagstones,
  paintGloomTile,
  paintGloomVeins,
  paintRubble,
  paintRuneStone,
  type BlockKind,
} from '../render/blockTextures';
import { PixelCanvas, pixelMaterial } from '../render/pixelCanvas';
import { ARENA, GATES, inGateGap, type GateId } from './arenaConfig';

export interface GateInfo {
  id: GateId;
  position: THREE.Vector3;
  inward: THREE.Vector3;
}

export interface Arena {
  group: THREE.Group;
  gates: GateInfo[];
  update(dt: number, t: number): void;
}

interface Placement {
  x: number;
  y: number;
  z: number;
  kind: BlockKind;
  tint: number;
}

const FLOOR_SEED = 1337;
const KINDS: readonly BlockKind[] = ['bricks', 'rubble', 'flagstone', 'gloom'];

/** The Sunken Vault floor: flagstones, an ember rune ring around the dais, gloom creeping in from the walls. */
const buildFloor = (anisotropy: number): THREE.Mesh => {
  const n = ARENA.floorHalf * 2;
  const pc = new PixelCanvas(n * TILE, n * TILE);
  const rng = mulberry32(FLOOR_SEED);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const cx = c - ARENA.floorHalf + 0.5;
      const cz = r - ARENA.floorHalf + 0.5;
      const d = Math.hypot(cx, cz);
      const ox = c * TILE;
      const oy = r * TILE;
      const growth = fbm(cx * 0.13, cz * 0.13, 77) + (d > ARENA.radius - 3 ? 0.2 : 0) - (d < 6 ? 0.3 : 0);
      if (d < 2.4) paintRuneStone(pc, ox, oy, rng, false);
      else if (d > 3.2 && d < 4.7) paintRuneStone(pc, ox, oy, rng, (c + r) % 2 === 0);
      else if (growth > 0.72) paintGloomTile(pc, ox, oy, rng, FLOOR_SEED, 0.015, 0.45);
      else {
        if (rng() < 0.16) paintRubble(pc, ox, oy, rng);
        else paintFlagstones(pc, ox, oy, rng);
        if (growth > 0.62) paintGloomVeins(pc, ox, oy, rng);
      }
    }
  }
  const mat = pixelMaterial(pc, { glowIntensity: 1, anisotropy, roughness: 0.86 });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(n, n), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  mesh.name = 'vaultFloor';
  return mesh;
};

const buildOuterGround = (anisotropy: number): THREE.Mesh => {
  const pc = new PixelCanvas(TILE * 4, TILE * 4);
  const rng = mulberry32(99);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      if (rng() < 0.3) paintGloomTile(pc, c * TILE, r * TILE, rng, 99, 0.006, 0.3);
      else paintRubble(pc, c * TILE, r * TILE, rng);
    }
  }
  const mat = pixelMaterial(pc, { glowIntensity: 0.6, anisotropy, wrap: true });
  mat.color.setScalar(0.55);
  const size = 160;
  for (const tex of [mat.map, mat.emissiveMap]) tex?.repeat.set(size / 4, size / 4);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -0.02;
  mesh.receiveShadow = true;
  return mesh;
};

const columnKinds = (h: number, rng: Rng, gloomTop: number): BlockKind[] =>
  Array.from({ length: h }, (_, y) => {
    if (y === h - 1 && rng() < gloomTop) return 'gloom';
    if (y === 0 && rng() < 0.35) return 'rubble';
    return 'bricks';
  });

const RIFT_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const RIFT_FRAG = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
void main() {
  vec2 uv = (floor(vUv * 24.0) + 0.5) / 24.0;
  vec2 p = uv - vec2(0.5, 0.42);
  float r = length(p);
  float a = atan(p.y, p.x);
  float swirl = 0.5 + 0.5 * sin(a * 3.0 - r * 16.0 + uTime * 1.6);
  float core = smoothstep(0.55, 0.0, r);
  float band = step(0.82, swirl) * core;
  vec3 deep = vec3(0.02, 0.008, 0.035);
  vec3 violet = vec3(0.6, 0.28, 1.0);
  vec3 col = deep + violet * (band * 0.85 + pow(core, 4.0) * 0.45 + swirl * core * 0.08);
  gl_FragColor = vec4(col, 1.0);
}`;

const bronzeMaterial = new THREE.MeshStandardMaterial({ color: 0x8a5f2a, roughness: 0.45, metalness: 0.7 });
const plinthMaterial = new THREE.MeshStandardMaterial({ color: 0x2c3039, roughness: 0.9 });

const boxAt = (w: number, h: number, d: number, x: number, y: number, z: number): THREE.BufferGeometry =>
  new THREE.BoxGeometry(w, h, d).translate(x, y, z);

/** Bronze fire bowl on a stone plinth, as raw geometry so every brazier merges into one draw. */
const brazierGeometry = (): { stone: THREE.BufferGeometry[]; bronze: THREE.BufferGeometry[] } => ({
  stone: [boxAt(0.32, 0.3, 0.32, 0, 0.15, 0)],
  bronze: [
    boxAt(0.62, 0.08, 0.62, 0, 0.34, 0),
    boxAt(0.62, 0.14, 0.06, 0, 0.44, 0.29),
    boxAt(0.62, 0.14, 0.06, 0, 0.44, -0.29),
    boxAt(0.06, 0.14, 0.62, 0.29, 0.44, 0),
    boxAt(0.06, 0.14, 0.62, -0.29, 0.44, 0),
  ],
});

const FLAMES: ReadonlyArray<readonly [number, number, number, number]> = [
  [0.3, 0, 0.58, 0],
  [0.18, 0.1, 0.72, -0.06],
  [0.14, -0.09, 0.7, 0.08],
];

interface Braziers {
  group: THREE.Group;
  update(t: number): void;
}

const buildBraziers = (spots: ReadonlyArray<{ at: THREE.Vector3; light: boolean }>): Braziers => {
  const group = new THREE.Group();
  const stone: THREE.BufferGeometry[] = [];
  const bronze: THREE.BufferGeometry[] = [];
  for (const { at } of spots) {
    const g = brazierGeometry();
    stone.push(...g.stone.map((x) => x.translate(at.x, at.y, at.z)));
    bronze.push(...g.bronze.map((x) => x.translate(at.x, at.y, at.z)));
  }
  group.add(new THREE.Mesh(mergeGeometries(stone), plinthMaterial), new THREE.Mesh(mergeGeometries(bronze), bronzeMaterial));
  for (const m of group.children as THREE.Mesh[]) m.receiveShadow = true;

  const flameMaterial = new THREE.MeshStandardMaterial({ color: 0x3d1a04, emissive: 0xffa53a, emissiveIntensity: 3 });
  const flames = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), flameMaterial, spots.length * FLAMES.length);
  group.add(flames);
  const lights = spots.map(({ at, light }) => {
    if (!light) return null;
    const l = new THREE.PointLight(0xffa040, 26, 15, 1.6);
    const inward = new THREE.Vector3(-at.x, 0, -at.z).normalize().multiplyScalar(0.9);
    l.position.set(at.x + inward.x, at.y + 0.9, at.z + inward.z);
    group.add(l);
    return l;
  });
  const seeds = spots.map((_, i) => i * 13.7);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const sc = new THREE.Vector3();
  return {
    group,
    update(t) {
      let k = 0;
      spots.forEach(({ at }, i) => {
        const seed = seeds[i]!;
        const f = 0.8 + 0.12 * Math.sin(t * 9.3 + seed) + 0.08 * Math.sin(t * 23.7 + seed * 2.1);
        const l = lights[i];
        if (l) l.intensity = 26 * f;
        FLAMES.forEach(([size, x, y, z], j) => {
          const h = (size + 0.04) * (0.85 + 0.25 * Math.sin(t * (7 + j * 3.1) + seed + j));
          p.set(at.x + x, at.y + y - (size + 0.04 - h) / 2, at.z + z);
          sc.set(size, h, size);
          flames.setMatrixAt(k++, m.compose(p, q, sc));
        });
      });
      flames.instanceMatrix.needsUpdate = true;
      flameMaterial.emissiveIntensity = 3 * (0.9 + 0.1 * Math.sin(t * 11));
    },
  };
};

export const buildArena = (anisotropy: number): Arena => {
  const group = new THREE.Group();
  group.name = 'arena';
  group.add(buildFloor(anisotropy));
  group.add(buildOuterGround(anisotropy));

  const rng = mulberry32(4242);
  const walls: Placement[] = [];
  const backdrop: Placement[] = [];
  const pillarTops: THREE.Vector3[] = [];
  const brazierColumns: THREE.Vector3[] = [];
  const half = ARENA.floorHalf;
  const tint = () => 0.8 + rng() * 0.28;

  for (let bx = -half; bx < half; bx++) {
    for (let bz = -half; bz < half; bz++) {
      const cx = bx + 0.5;
      const cz = bz + 0.5;
      const d = Math.hypot(cx, cz);
      if (d < ARENA.wallInner || d > ARENA.wallOuter) continue;
      const t = (d - ARENA.wallInner) / (ARENA.wallOuter - ARENA.wallInner);
      if (inGateGap(cx, cz)) {
        if (d < ARENA.wallInner + 1.3) walls.push({ x: cx, y: 4.5, z: cz, kind: 'bricks', tint: tint() });
        continue;
      }
      const gateEdge =
        (Math.abs(Math.abs(cx) - 2.5) < 0.01 && Math.abs(cz) > 10) || (Math.abs(Math.abs(cz) - 2.5) < 0.01 && Math.abs(cx) > 10);
      const diagonal = Math.abs(Math.abs(cx) - 12.5) < 0.01 && Math.abs(Math.abs(cz) - 12.5) < 0.01;
      let h = 1 + Math.floor(fbm(cx * 0.35, cz * 0.35, 9) * 3.2 + t * 1.8);
      if (gateEdge) h = t < 0.5 ? 5 : 4;
      if (diagonal) h = 2;
      if (gateEdge && t < 0.2) pillarTops.push(new THREE.Vector3(cx, h, cz));
      if (diagonal) brazierColumns.push(new THREE.Vector3(cx, h, cz));
      columnKinds(h, rng, gateEdge ? 0.1 : 0.35).forEach((kind, y) => walls.push({ x: cx, y: y + 0.5, z: cz, kind, tint: tint() }));
    }
  }

  const pillarCount = 26;
  for (let i = 0; i < pillarCount; i++) {
    const a = (i / pillarCount) * Math.PI * 2 + (rng() - 0.5) * 0.18;
    const r = 24 + rng() * 12;
    const size = rng() < 0.4 ? 3 : 2;
    const h = 6 + Math.floor(rng() * 12);
    const x0 = Math.round(Math.cos(a) * r);
    const z0 = Math.round(Math.sin(a) * r);
    for (let dx = 0; dx < size; dx++) {
      for (let dz = 0; dz < size; dz++) {
        columnKinds(h, rng, 0.5).forEach((kind, y) => {
          const k = y >= h - 2 && rng() < 0.5 ? 'gloom' : kind;
          backdrop.push({ x: x0 + dx + 0.5, y: y + 0.5, z: z0 + dz + 0.5, kind: k, tint: tint() * 0.8 });
        });
      }
    }
  }

  const box = new THREE.BoxGeometry(1, 1, 1);
  const materials = new Map(KINDS.map((k, i) => [k, blockMaterial(k, 500 + i, anisotropy)]));
  const matrix = new THREE.Matrix4();
  const color = new THREE.Color();
  const instance = (list: Placement[], castShadow: boolean) => {
    for (const kind of KINDS) {
      const items = list.filter((p) => p.kind === kind);
      if (items.length === 0) continue;
      const mesh = new THREE.InstancedMesh(box, materials.get(kind)!, items.length);
      items.forEach((p, i) => {
        mesh.setMatrixAt(i, matrix.makeTranslation(p.x, p.y, p.z));
        mesh.setColorAt(i, color.setScalar(p.tint));
      });
      mesh.castShadow = castShadow;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
    }
  };
  // Wall blocks sit at the rim, outside the hero's shadow frustum: casting would only cost a pass.
  instance(walls, false);
  instance(backdrop, false);

  const braziers = buildBraziers([
    ...brazierColumns.map((at) => ({ at, light: true })),
    ...pillarTops.map((at) => ({ at, light: false })),
  ]);
  group.add(braziers.group);

  const riftMaterial = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: RIFT_VERT,
    fragmentShader: RIFT_FRAG,
    side: THREE.DoubleSide,
  });
  const gates: GateInfo[] = GATES.map(({ id, dir }) => {
    const position = new THREE.Vector3(dir.x * (ARENA.wallInner + 0.6), 0, dir.z * (ARENA.wallInner + 0.6));
    const inward = new THREE.Vector3(-dir.x, 0, -dir.z);
    const rift = new THREE.Mesh(new THREE.PlaneGeometry(ARENA.gateHalfWidth * 2, 4), riftMaterial);
    rift.position.set(position.x, 2, position.z);
    rift.rotation.y = Math.atan2(inward.x, inward.z);
    rift.name = `rift-${id}`;
    group.add(rift);
    return { id, position, inward };
  });

  return {
    group,
    gates,
    update(_dt, t) {
      riftMaterial.uniforms.uTime!.value = t;
      braziers.update(t);
    },
  };
};
