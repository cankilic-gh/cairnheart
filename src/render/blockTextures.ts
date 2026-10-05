import { fbm, mulberry32, pick, type Rng } from '../core/rng';
import { GLOOM } from './gloomPaint';
import { EMBER, BRONZE } from './heroPaint';
import { hex, PixelCanvas, pixelMaterial, type Rgb } from './pixelCanvas';
import type * as THREE from 'three';

export const TILE = 16;

const SLATE = {
  grout: hex('#13151a'),
  lo: hex('#22252d'),
  a: hex('#2d313b'),
  b: hex('#343945'),
  c: hex('#292d36'),
  hi: hex('#434957'),
};

const jitter = (rng: Rng, base: Rgb): Rgb => {
  const r = rng();
  return r < 0.12 ? SLATE.lo : r < 0.2 ? SLATE.hi : base;
};

/** Fills one rectangular stone with a bevelled top-left edge and grout on the bottom-right. */
const stone = (pc: PixelCanvas, x0: number, y0: number, w: number, h: number, rng: Rng): void => {
  const base = pick([SLATE.a, SLATE.b, SLATE.c], rng);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x0 + x;
      const py = y0 + y;
      if (x === w - 1 || y === h - 1) pc.set(px, py, SLATE.grout);
      else if ((x === 0 || y === 0) && rng() < 0.7) pc.set(px, py, SLATE.hi);
      else pc.set(px, py, jitter(rng, base));
    }
  }
};

/** Irregular flagstones: each block splits into 2–4 rectangles of different sizes. */
export const paintFlagstones = (pc: PixelCanvas, ox: number, oy: number, rng: Rng): void => {
  const split = 5 + Math.floor(rng() * 7);
  if (rng() < 0.5) {
    const a = 4 + Math.floor(rng() * 8);
    const b = 4 + Math.floor(rng() * 8);
    stone(pc, ox, oy, split, a, rng);
    stone(pc, ox, oy + a, split, TILE - a, rng);
    stone(pc, ox + split, oy, TILE - split, b, rng);
    stone(pc, ox + split, oy + b, TILE - split, TILE - b, rng);
  } else {
    const a = 4 + Math.floor(rng() * 8);
    stone(pc, ox, oy, TILE, split, rng);
    stone(pc, ox, oy + split, a, TILE - split, rng);
    stone(pc, ox + a, oy + split, TILE - a, TILE - split, rng);
  }
};

/** Large staggered wall bricks. */
export const paintBricks = (pc: PixelCanvas, ox: number, oy: number, rng: Rng): void => {
  const colors: Rgb[] = Array.from({ length: 8 }, () => pick([SLATE.a, SLATE.b, SLATE.c, SLATE.hi], rng));
  for (let y = 0; y < TILE; y++) {
    const row = Math.floor(y / 5.34);
    const offset = (row % 2) * 5;
    for (let x = 0; x < TILE; x++) {
      const bx = (x + offset) % 10;
      const idx = (row * 2 + Math.floor((x + offset) / 10)) % colors.length;
      const mortar = y === 5 || y === 10 || y === 15 || bx === 9;
      pc.set(ox + x, oy + y, mortar ? SLATE.grout : jitter(rng, colors[idx]!));
    }
  }
};

export const paintRubble = (pc: PixelCanvas, ox: number, oy: number, rng: Rng): void => {
  const seeds = Array.from({ length: 6 }, () => ({ x: rng() * TILE, y: rng() * TILE, c: pick([SLATE.a, SLATE.b, SLATE.c, SLATE.lo], rng) }));
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      let d1 = Infinity;
      let d2 = Infinity;
      let c = SLATE.a;
      for (const s of seeds) {
        const dx = Math.min(Math.abs(s.x - x), TILE - Math.abs(s.x - x));
        const dy = Math.min(Math.abs(s.y - y), TILE - Math.abs(s.y - y));
        const d = dx * dx + dy * dy;
        if (d < d1) {
          d2 = d1;
          d1 = d;
          c = s.c;
        } else if (d < d2) d2 = d;
      }
      pc.set(ox + x, oy + y, Math.sqrt(d2) - Math.sqrt(d1) < 0.9 ? SLATE.grout : jitter(rng, c));
    }
  }
};

const GLYPHS = [
  ['...##...', '..#..#..', '.#.##.#.', '#.#..#.#', '#.#..#.#', '.#.##.#.', '..#..#..', '...##...'],
  ['#......#', '.#....#.', '..#..#..', '...##...', '...##...', '..#..#..', '.#....#.', '#......#'],
  ['..####..', '.#....#.', '#..##..#', '#.####.#', '#..##..#', '#......#', '.#....#.', '..####..'],
];

/** Dark polished slab with a bronze inlay border and an optional ember-lit rune. */
export const paintRuneStone = (pc: PixelCanvas, ox: number, oy: number, rng: Rng, rune: boolean): void => {
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const edge = x === 0 || y === 0 || x === TILE - 1 || y === TILE - 1;
      const inlay = x === 1 || y === 1 || x === TILE - 2 || y === TILE - 2;
      pc.set(ox + x, oy + y, edge ? SLATE.grout : inlay ? (rng() < 0.5 ? BRONZE.mid : BRONZE.shade) : rng() < 0.08 ? SLATE.a : SLATE.c);
    }
  }
  if (!rune) return;
  const glyph = pick(GLYPHS, rng);
  glyph.forEach((line, gy) => {
    for (let gx = 0; gx < line.length; gx++) {
      if (line[gx] === '#') pc.set(ox + 4 + gx, oy + 4 + gy, rng() < 0.6 ? EMBER.deep : EMBER.edge, 0.55);
    }
  });
};

/** Gloom corruption, sampled in global pixel space so neighbouring blocks merge into one growth. */
export const paintGloomTile = (pc: PixelCanvas, ox: number, oy: number, rng: Rng, seed: number, specks = 0.02, glow = 0.6): void => {
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const gx = ox + x;
      const gy = oy + y;
      const n = fbm(gx * 0.18, gy * 0.18, seed) + (rng() - 0.5) * 0.1;
      pc.set(gx, gy, n < 0.4 ? GLOOM.void : n < 0.52 ? GLOOM.deep : n < 0.64 ? GLOOM.dark : GLOOM.mid);
      const r = rng();
      if (r < specks) pc.set(gx, gy, r < specks * 0.3 ? GLOOM.crystalHi : GLOOM.crystal, glow);
    }
  }
};

/** Thin violet tendrils of gloom creeping over stone. */
export const paintGloomVeins = (pc: PixelCanvas, ox: number, oy: number, rng: Rng): void => {
  const walkers = 1 + Math.floor(rng() * 3);
  for (let w = 0; w < walkers; w++) {
    let x = Math.floor(rng() * TILE);
    let y = Math.floor(rng() * TILE);
    const steps = 8 + Math.floor(rng() * 10);
    for (let i = 0; i < steps; i++) {
      const lit = rng() < 0.1;
      pc.set(ox + x, oy + y, lit ? GLOOM.crystal : GLOOM.mid, lit ? 0.6 : 0);
      if (rng() < 0.5) x = Math.max(0, Math.min(TILE - 1, x + (rng() < 0.5 ? -1 : 1)));
      else y = Math.max(0, Math.min(TILE - 1, y + (rng() < 0.5 ? -1 : 1)));
    }
  }
};

export type BlockKind = 'bricks' | 'rubble' | 'flagstone' | 'gloom';

export const blockMaterial = (kind: BlockKind, seed: number, anisotropy = 1): THREE.MeshStandardMaterial => {
  const pc = new PixelCanvas(TILE, TILE);
  const rng = mulberry32(seed);
  if (kind === 'bricks') paintBricks(pc, 0, 0, rng);
  else if (kind === 'rubble') paintRubble(pc, 0, 0, rng);
  else if (kind === 'flagstone') paintFlagstones(pc, 0, 0, rng);
  else paintGloomTile(pc, 0, 0, rng, seed, 0.05, 0.9);
  return pixelMaterial(pc, { glowIntensity: 1, anisotropy, wrap: true });
};
