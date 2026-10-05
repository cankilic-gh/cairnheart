export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

export const damp = (current: number, target: number, sharpness: number, dt: number): number =>
  lerp(current, target, 1 - Math.exp(-sharpness * dt));

/** Damped spring integrated semi-implicitly; used for secondary motion (arms, tendrils, lean). */
export class Spring {
  value = 0;
  velocity = 0;

  constructor(
    private readonly stiffness: number,
    private readonly damping: number,
  ) {}

  step(target: number, dt: number): number {
    const accel = this.stiffness * (target - this.value) - this.damping * this.velocity;
    this.velocity += accel * dt;
    this.value += this.velocity * dt;
    return this.value;
  }
}
