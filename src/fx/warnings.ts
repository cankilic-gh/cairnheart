import * as THREE from 'three';
import { fbm } from '../core/rng';

/** Telegraphs draw after (and over) every hero effect so a warning is never hidden by our own glow. */
export const TELEGRAPH_ORDER = 10;
export const WARN_COLOR = 0xff4fd8;

/** Flat 2x2 plane on the floor: radius 1 when scaled by the warning radius. */
export const WARN_DISC_GEO = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
/** Flat 1x1 lane on the floor running along +z from the origin, for aim and lunge warnings. */
export const WARN_LANE_GEO = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0, 0.5);

const pixelTexture = (w: number, h: number, alpha: (i: number, j: number) => number): THREE.DataTexture => {
  const data = new Uint8Array(w * h * 4);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) data.set([255, 255, 255, Math.round(THREE.MathUtils.clamp(alpha(i, j), 0, 1) * 255)], (j * w + i) * 4);
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
};

const polar = (i: number, j: number, n: number): number => Math.hypot((i + 0.5) / (n / 2) - 1, (j + 0.5) / (n / 2) - 1);

/**
 * Pixel-art warning circle (white, tinted by the material): a chunky broken rim, a dithered inner
 * edge and a sparse dot fill. Reads at a glance like the old outline, without looking vector-drawn.
 */
export const WARN_RING_TEX = pixelTexture(64, 64, (i, j) => {
  const d = polar(i, j, 64);
  if (d > 1) return 0;
  if (d > 0.9) return fbm(i * 0.22, j * 0.22, 5) > 0.3 ? 1 : 0.4;
  if (d > 0.84) return (i + j) % 2 === 0 ? 0.55 : 0;
  return i % 4 === 0 && j % 4 === 0 ? 0.3 : 0.04;
});

/** Dithered disc that grows inside the ring as the wind-up runs out. */
export const WARN_FILL_TEX = pixelTexture(32, 32, (i, j) => {
  const d = polar(i, j, 32);
  if (d > 1) return 0;
  return d > 0.9 ? ((i + j) % 2 === 0 ? 0.8 : 0.2) : (i + j) % 2 === 0 ? 0.55 : 0.35;
});

/** Lane: solid broken edges, a capped far end and a checker interior. */
export const WARN_LANE_TEX = pixelTexture(16, 32, (i, j) => {
  if (i < 2 || i >= 14) return fbm(i * 0.5, j * 0.4, 9) > 0.25 ? 1 : 0.35;
  if (j < 2) return 1;
  return (i + j) % 2 === 0 ? 0.4 : 0.1;
});

export const warnMaterial = (map: THREE.Texture, opacity: number, color: THREE.ColorRepresentation = WARN_COLOR): THREE.MeshBasicMaterial =>
  new THREE.MeshBasicMaterial({ map, color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
