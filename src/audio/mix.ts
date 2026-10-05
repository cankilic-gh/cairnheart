import type { Vec2 } from '../entities/hero/motion';

export interface Spatial {
  pan: number;
  gain: number;
}

/**
 * Stereo position for a top-down camera: pan follows the screen's horizontal axis, level falls
 * off with distance from the hero but never below `floor` so far events still read.
 */
export const spatialize = (listener: Vec2, right: Vec2, source: Vec2, floor = 0.22): Spatial => {
  const dx = source.x - listener.x;
  const dz = source.z - listener.z;
  const across = dx * right.x + dz * right.z;
  const dist = Math.hypot(dx, dz);
  return {
    pan: Math.max(-1, Math.min(1, across / 11)) * 0.85,
    gain: Math.max(floor, 1 / (1 + (dist / 9) ** 2)),
  };
};

/** Fixed-size voice list per sound: when full, the oldest voice is the one to cut. */
export class VoiceLimiter<T> {
  private readonly voices: T[] = [];

  constructor(private readonly max: number) {}

  get size(): number {
    return this.voices.length;
  }

  /** Adds a voice and returns the voice that must be stopped to make room, if any. */
  add(voice: T): T | undefined {
    this.voices.push(voice);
    return this.voices.length > this.max ? this.voices.shift() : undefined;
  }

  remove(voice: T): void {
    const i = this.voices.indexOf(voice);
    if (i >= 0) this.voices.splice(i, 1);
  }
}
