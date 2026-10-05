import * as THREE from 'three';
import { hashString } from '../core/rng';
import { PixelCanvas, pixelTexture } from './pixelCanvas';

export type Face = 'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz';
export const FACES: readonly Face[] = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];
export type Range = readonly [number, number];
export type FacePainter = (face: Face, pc: PixelCanvas, seed: number) => void;

export interface PartSpec {
  name: string;
  x: Range;
  y: Range;
  z: Range;
  paint: FacePainter;
  /** Scales this part's emissive layer (0..1) so one shared material can carry different glow levels. */
  glow?: number;
}

export const faceSize = (face: Face, w: number, h: number, d: number): [number, number] =>
  face === 'px' || face === 'nx' ? [d, h] : face === 'py' || face === 'ny' ? [w, d] : [w, h];

export interface AtlasPart {
  geometry: THREE.BoxGeometry;
  center: THREE.Vector3;
}

export interface AtlasModel {
  map: THREE.Texture;
  emissiveMap: THREE.Texture | null;
  parts: Map<string, AtlasPart>;
}

/**
 * Paints every face of every part into one shared texture, so a whole mob costs one material
 * (and one draw per part) no matter how many instances are alive.
 */
export const buildAtlasModel = (specs: readonly PartSpec[], atlasWidth = 64): AtlasModel => {
  const painted = specs.map((spec) => {
    const w = spec.x[1] - spec.x[0];
    const h = spec.y[1] - spec.y[0];
    const d = spec.z[1] - spec.z[0];
    const seed = hashString(spec.name);
    const faces = FACES.map((face, i) => {
      const [fw, fh] = faceSize(face, w, h, d);
      const pc = new PixelCanvas(fw, fh);
      spec.paint(face, pc, seed + i * 977);
      if (spec.glow !== undefined && spec.glow !== 1) {
        for (let k = 0; k < pc.glow.length; k += 4) {
          pc.glow[k] = pc.glow[k]! * spec.glow;
          pc.glow[k + 1] = pc.glow[k + 1]! * spec.glow;
          pc.glow[k + 2] = pc.glow[k + 2]! * spec.glow;
        }
      }
      return pc;
    });
    return { spec, w, h, d, faces };
  });

  let cx = 0;
  let cy = 0;
  let rowH = 0;
  const slots = painted.map(({ faces }) =>
    faces.map((pc) => {
      if (cx + pc.w > atlasWidth) {
        cx = 0;
        cy += rowH;
        rowH = 0;
      }
      const slot = { x: cx, y: cy };
      cx += pc.w;
      rowH = Math.max(rowH, pc.h);
      return slot;
    }),
  );
  const atlasHeight = cy + rowH;
  const atlas = new PixelCanvas(atlasWidth, atlasHeight);
  painted.forEach(({ faces }, i) => faces.forEach((pc, f) => atlas.blit(pc, slots[i]![f]!.x, slots[i]![f]!.y)));

  const parts = new Map<string, AtlasPart>();
  painted.forEach(({ spec, w, h, d, faces }, i) => {
    const geometry = new THREE.BoxGeometry(w, h, d);
    const uv = geometry.attributes.uv as THREE.BufferAttribute;
    faces.forEach((pc, f) => {
      const slot = slots[i]![f]!;
      for (let v = f * 4; v < f * 4 + 4; v++) {
        const u0 = uv.getX(v);
        const v0 = uv.getY(v);
        uv.setXY(v, (slot.x + u0 * pc.w) / atlasWidth, 1 - (slot.y + (1 - v0) * pc.h) / atlasHeight);
      }
    });
    uv.needsUpdate = true;
    const center = new THREE.Vector3((spec.x[0] + spec.x[1]) / 2, (spec.y[0] + spec.y[1]) / 2, (spec.z[0] + spec.z[1]) / 2);
    parts.set(spec.name, { geometry, center });
  });

  return {
    map: pixelTexture(atlasWidth, atlasHeight, atlas.color, true),
    emissiveMap: atlas.hasGlow ? pixelTexture(atlasWidth, atlasHeight, atlas.glow, true) : null,
    parts,
  };
};
