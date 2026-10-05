import { fbm, mulberry32 } from '../core/rng';
import { hex, type PixelCanvas, type Rgb } from './pixelCanvas';

/** The gloom: violet crystal corruption carried by every enemy and creeping over the vault floor. */
export const GLOOM = {
  void: hex('#1b1428'),
  deep: hex('#271d3a'),
  dark: hex('#35284e'),
  mid: hex('#473563'),
  light: hex('#5e4784'),
  crystal: hex('#b46bff'),
  crystalHi: hex('#e4bcff'),
  crystalDeep: hex('#6a33b5'),
  eye: hex('#ff5fd2'),
  eyeHi: hex('#ffd3f5'),
  bone: hex('#d8cfe6'),
};

const hideColor = (n: number): Rgb =>
  n < 0.36 ? GLOOM.void : n < 0.48 ? GLOOM.deep : n < 0.6 ? GLOOM.dark : n < 0.72 ? GLOOM.mid : GLOOM.light;

/** Mottled dark hide with a few faint crystal flecks. */
export const paintHide = (pc: PixelCanvas, seed: number, lift = 0, flecks = 0.02): void => {
  const rng = mulberry32(seed);
  for (let y = 0; y < pc.h; y++) {
    for (let x = 0; x < pc.w; x++) {
      pc.set(x, y, hideColor(fbm(x * 0.3, y * 0.3, seed) + (rng() - 0.5) * 0.12 + lift));
      if (rng() < flecks) pc.set(x, y, GLOOM.crystal, 0.8);
    }
  }
};

/** Violet crystal with bright facets; fully emissive so it reads in the dark. */
export const paintGloomCrystal = (pc: PixelCanvas, seed: number): void => {
  const rng = mulberry32(seed);
  for (let y = 0; y < pc.h; y++) {
    for (let x = 0; x < pc.w; x++) {
      const rim = x === 0 || x === pc.w - 1;
      const facet = (x + 2 * y) % 5 === 0;
      const c = rim ? GLOOM.crystalDeep : facet ? GLOOM.crystalHi : rng() < 0.25 ? GLOOM.crystalDeep : GLOOM.crystal;
      pc.set(x, y, c, rim ? 0.55 : 1);
    }
  }
};

/** Glowing eye block (w×h) with a bright pupil, at (x, y). */
export const paintEye = (pc: PixelCanvas, x: number, y: number, w: number, h: number): void => {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) pc.set(x + i, y + j, GLOOM.eye, 1);
  pc.set(x + Math.floor(w / 2), y + Math.floor(h / 2), GLOOM.eyeHi, 1);
};
