import * as THREE from 'three';

export type Rgb = readonly [number, number, number];

export const hex = (h: string): Rgb => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

export const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/** CPU-side pixel buffer with a parallel glow layer that becomes the emissive map. */
export class PixelCanvas {
  readonly color: Uint8ClampedArray<ArrayBuffer>;
  readonly glow: Uint8ClampedArray<ArrayBuffer>;
  hasGlow = false;

  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.color = new Uint8ClampedArray(w * h * 4);
    this.glow = new Uint8ClampedArray(w * h * 4);
    for (let i = 3; i < this.glow.length; i += 4) this.glow[i] = 255;
  }

  set(x: number, y: number, c: Rgb, glow = 0): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (Math.floor(y) * this.w + Math.floor(x)) * 4;
    this.color[i] = c[0];
    this.color[i + 1] = c[1];
    this.color[i + 2] = c[2];
    this.color[i + 3] = 255;
    const g = Math.min(1, Math.max(0, glow));
    this.glow[i] = c[0] * g;
    this.glow[i + 1] = c[1] * g;
    this.glow[i + 2] = c[2] * g;
    if (g > 0) this.hasGlow = true;
  }

  fill(c: Rgb, glow = 0): void {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) this.set(x, y, c, glow);
  }

  blit(src: PixelCanvas, dx: number, dy: number): void {
    for (let y = 0; y < src.h; y++) {
      const from = y * src.w * 4;
      const to = ((dy + y) * this.w + dx) * 4;
      this.color.set(src.color.subarray(from, from + src.w * 4), to);
      this.glow.set(src.glow.subarray(from, from + src.w * 4), to);
    }
    if (src.hasGlow) this.hasGlow = true;
  }
}

export const pixelTexture = (
  w: number,
  h: number,
  data: Uint8ClampedArray<ArrayBuffer>,
  nearest = false,
): THREE.CanvasTexture => {
  const tex = toTexture(w, h, data);
  if (nearest) {
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
  }
  return tex;
};

const toTexture = (w: number, h: number, data: Uint8ClampedArray<ArrayBuffer>): THREE.CanvasTexture => {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.putImageData(new ImageData(data, w, h), 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
};

export interface PixelMaterialOptions {
  glowIntensity?: number;
  roughness?: number;
  anisotropy?: number;
  wrap?: boolean;
}

export const pixelMaterial = (pc: PixelCanvas, opts: PixelMaterialOptions = {}): THREE.MeshStandardMaterial => {
  const map = toTexture(pc.w, pc.h, pc.color);
  if (opts.anisotropy) map.anisotropy = opts.anisotropy;
  if (opts.wrap) map.wrapS = map.wrapT = THREE.RepeatWrapping;
  const mat = new THREE.MeshStandardMaterial({ map, roughness: opts.roughness ?? 0.92, metalness: 0 });
  if (pc.hasGlow) {
    const emissiveMap = toTexture(pc.w, pc.h, pc.glow);
    if (opts.anisotropy) emissiveMap.anisotropy = opts.anisotropy;
    if (opts.wrap) emissiveMap.wrapS = emissiveMap.wrapT = THREE.RepeatWrapping;
    mat.emissiveMap = emissiveMap;
    mat.emissive = new THREE.Color(0xffffff);
    mat.emissiveIntensity = opts.glowIntensity ?? 1;
  }
  return mat;
};
