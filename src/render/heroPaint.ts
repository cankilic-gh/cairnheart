import { fbm, mulberry32, type Rng } from '../core/rng';
import { hex, type PixelCanvas, type Rgb } from './pixelCanvas';

/** Weathered basalt. */
export const STONE = {
  deep: hex('#1c1f26'),
  dark: hex('#272b34'),
  mid: hex('#333843'),
  light: hex('#424854'),
  hi: hex('#575e6c'),
};

/** Molten amber light from the heart crystal, leaking through seams. */
export const EMBER = {
  core: hex('#ffe6a8'),
  base: hex('#ffb347'),
  edge: hex('#e08a2a'),
  deep: hex('#a2520f'),
};

export const BRONZE = {
  hi: hex('#efcb83'),
  base: hex('#bf8d43'),
  mid: hex('#94692c'),
  shade: hex('#634419'),
  rivet: hex('#f6e1ad'),
  line: hex('#3b2810'),
};

const stoneColor = (n: number): Rgb =>
  n < 0.36 ? STONE.deep : n < 0.48 ? STONE.dark : n < 0.6 ? STONE.mid : n < 0.72 ? STONE.light : STONE.hi;

const bronzeColor = (rng: Rng, shade: number): Rgb => {
  const r = rng() * 0.7 + shade;
  return r < 0.2 ? BRONZE.hi : r < 0.6 ? BRONZE.base : r < 0.88 ? BRONZE.mid : BRONZE.shade;
};

export interface StoneOptions {
  lift?: number;
  /** Relative density of glowing kintsugi seams. */
  seams?: number;
}

/** Chiselled basalt with thin amber seams wandering across it. */
export const paintStone = (pc: PixelCanvas, seed: number, opts: StoneOptions = {}): void => {
  const rng = mulberry32(seed);
  for (let y = 0; y < pc.h; y++) {
    for (let x = 0; x < pc.w; x++) {
      const n = fbm(x * 0.22, y * 0.22, seed) + (rng() - 0.5) * 0.12 + (opts.lift ?? 0);
      pc.set(x, y, stoneColor(n));
    }
  }
  const count = Math.round(((pc.w * pc.h) / 220) * (opts.seams ?? 1));
  for (let s = 0; s < count; s++) {
    let x = Math.floor(rng() * pc.w);
    let y = Math.floor(rng() * pc.h);
    const horizontal = rng() < 0.5;
    const steps = 4 + Math.floor(rng() * (pc.w + pc.h) * 0.35);
    for (let i = 0; i < steps; i++) {
      pc.set(x, y, rng() < 0.25 ? EMBER.core : EMBER.base, 0.9);
      if (rng() < 0.7) {
        if (horizontal) x += 1;
        else y += 1;
      } else if (horizontal) y += rng() < 0.5 ? -1 : 1;
      else x += rng() < 0.5 ? -1 : 1;
      if (x < 0 || y < 0 || x >= pc.w || y >= pc.h) break;
    }
  }
};

/** Bronze band across rows [y0, y1) with lit top edge, dark bottom edge and an optional rivet row. */
export const paintBronze = (pc: PixelCanvas, seed: number, y0: number, y1: number, rivetRow: number | null = null): void => {
  const rng = mulberry32(seed);
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < pc.w; x++) {
      if (y === y0) pc.set(x, y, BRONZE.hi);
      else if (y === y1 - 1) pc.set(x, y, BRONZE.shade);
      else pc.set(x, y, bronzeColor(rng, ((y - y0) / Math.max(1, y1 - y0)) * 0.3));
    }
  }
  if (rivetRow !== null) for (let x = 1; x < pc.w; x += 3) pc.set(x, rivetRow, BRONZE.rivet);
};

export const paintLines = (pc: PixelCanvas, columns: readonly number[], y0: number, y1: number, color: Rgb = BRONZE.line): void => {
  for (const x of columns) for (let y = y0; y < y1; y++) pc.set(x, y, color);
};

/** Molten core light; mostly hidden behind the chest plates. */
export const paintEmber = (pc: PixelCanvas, seed: number, x0 = 0, y0 = 0, x1 = pc.w, y1 = pc.h, glow = 1): void => {
  const rng = mulberry32(seed);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const n = fbm(x * 0.3, y * 0.3, seed) + (rng() - 0.5) * 0.15;
      pc.set(x, y, n < 0.38 ? EMBER.deep : n < 0.5 ? EMBER.edge : n < 0.66 ? EMBER.base : EMBER.core, glow);
    }
  }
};

const CRYSTAL = { white: hex('#fff6dc'), core: hex('#ffe3a0'), base: hex('#ffc861'), edge: hex('#e89a3c') };

/** Faceted heart-amber crystal: warm rims, pale gold body, near-white diagonal facets. */
export const paintCrystal = (pc: PixelCanvas, seed: number): void => {
  const rng = mulberry32(seed);
  for (let y = 0; y < pc.h; y++) {
    for (let x = 0; x < pc.w; x++) {
      const rim = x === 0 || x === pc.w - 1;
      const facet = (x + y) % 4 === 0;
      const c = rim ? CRYSTAL.edge : facet ? CRYSTAL.white : rng() < 0.35 ? CRYSTAL.core : CRYSTAL.base;
      pc.set(x, y, c, rim ? 0.7 : 1);
    }
  }
};

/** Helm face: brow ridge, a dark visor slit and two ember eyes. */
export const paintVisor = (pc: PixelCanvas, seed: number): void => {
  paintStone(pc, seed, { seams: 0.4, lift: 0.04 });
  const slit = 4;
  for (let x = 1; x < pc.w - 1; x++) {
    pc.set(x, slit - 1, STONE.hi);
    pc.set(x, slit, hex('#0b0c10'));
    pc.set(x, slit + 1, hex('#0b0c10'));
    pc.set(x, slit + 2, STONE.deep);
  }
  const eyes = [2, pc.w - 4];
  for (const ex of eyes) {
    pc.set(ex, slit, EMBER.core, 1);
    pc.set(ex + 1, slit, EMBER.base, 1);
    pc.set(ex, slit + 1, EMBER.edge, 1);
    pc.set(ex + 1, slit + 1, EMBER.deep, 1);
  }
};

/** Chest plate front: stone slab framed in bronze, ember light leaking at the parting edge. */
export const paintPlate = (pc: PixelCanvas, seed: number, upper: boolean): void => {
  paintStone(pc, seed, { seams: 0.3, lift: 0.05 });
  const rng = mulberry32(seed + 3);
  const top = upper ? 0 : pc.h - 2;
  paintBronze(pc, seed + 1, top, top + 2);
  for (let y = 0; y < pc.h; y++) {
    pc.set(0, y, BRONZE.mid);
    pc.set(pc.w - 1, y, BRONZE.shade);
  }
  const glyph = ['.#..#.', '.####.', '..##..'];
  const gx = Math.floor(pc.w / 2) - 3;
  const gy = upper ? 3 : 2;
  glyph.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === '#') pc.set(gx + x, gy + y, rng() < 0.5 ? EMBER.edge : EMBER.deep, 0.7);
  });
  const leak = upper ? pc.h - 1 : 0;
  for (let x = 1; x < pc.w - 1; x += 2) pc.set(x, leak, EMBER.base, 0.9);
};
