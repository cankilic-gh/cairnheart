import type { AttackId } from '../../combat/attacks';
import { Spring, clamp, lerp, smoothstep } from '../../core/math';
import { HIP_Y, type HeroRig } from './model';

export interface AnimInput {
  speed: number;
  walkSpeed: number;
  runSpeed: number;
  yawRate: number;
  accelForward: number;
  /** Current combat action and its normalised progress; the intro roar uses its own overlay. */
  action?: { id: AttackId; p: number } | null;
}

export type FootSide = 'left' | 'right';

/** World units travelled per full gait cycle (two footfalls). */
export const strideLength = (runFactor: number): number => lerp(1.7, 2.5, runFactor);

/** Index of the last footfall at or before `phase`; footfalls land at π/2 + kπ. */
export const footfallIndex = (phase: number): number => Math.floor((phase - Math.PI / 2) / Math.PI);

type Keys = ReadonlyArray<readonly [number, number]>;

/** Smoothstep-interpolated keyframe track over normalised progress. */
export const sampleKeys = (keys: Keys, p: number): number => {
  const first = keys[0]!;
  if (p <= first[0]) return first[1];
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i]!;
    const b = keys[i + 1]!;
    if (p <= b[0]) {
      const t = (p - a[0]) / (b[0] - a[0]);
      return lerp(a[1], b[1], t * t * (3 - 2 * t));
    }
  }
  return keys[keys.length - 1]![1];
};

interface ActionPose {
  torsoYaw?: Keys;
  torsoPitch?: Keys;
  armLX?: Keys;
  armLZ?: Keys;
  armRX?: Keys;
  armRZ?: Keys;
  jaw?: Keys;
  head?: Keys;
  hips?: Keys;
  glow?: Keys;
  tendril?: Keys;
  tremble?: Keys;
  spinTurns?: number;
}

const neg = (k: Keys): Keys => k.map(([p, v]) => [p, -v] as const);

const SWIPE_YAW: Keys = [[0, 0], [0.32, -0.55], [0.46, 0.6], [0.72, 0.4], [1, 0]];
const SWIPE_X: Keys = [[0, 0], [0.32, -1.25], [0.46, -1.45], [0.72, -0.85], [1, 0]];
const SWIPE_Z: Keys = [[0, 0], [0.32, -0.85], [0.46, 0.45], [0.72, 0.3], [1, 0]];
const SWIPE_PITCH: Keys = [[0, 0], [0.46, 0.12], [1, 0]];
const SWIPE_JAW: Keys = [[0, 0], [0.4, 0.18], [1, 0]];

const SLAM_X: Keys = [[0, 0], [0.42, -2.7], [0.52, -1.0], [0.76, -0.95], [1, 0]];
const SLAM_Z: Keys = [[0, 0], [0.42, -0.12], [0.52, -0.08], [1, 0]];
const BEAM_ARM_X: Keys = [[0, 0], [0.36, 0.55], [0.44, 0.2], [1, 0]];
const BEAM_ARM_Z: Keys = [[0, 0], [0.36, 0.35], [0.5, 0.5], [1, 0]];
const QUAKE_ARM_X: Keys = [[0, 0], [0.2, -1.2], [0.28, -0.4], [0.6, -0.3], [1, 0]];
const QUAKE_ARM_Z: Keys = [[0, 0], [0.2, 0.9], [0.28, 0.6], [0.6, 0.4], [1, 0]];
const SPIN_ARM_Z: Keys = [[0, 0], [0.12, 1.35], [0.88, 1.35], [1, 0]];
const SPIN_ARM_X: Keys = [[0, 0], [0.12, -0.12], [0.88, -0.12], [1, 0]];

const POSES: Partial<Record<AttackId, ActionPose>> = {
  swipeR: { torsoYaw: SWIPE_YAW, armRX: SWIPE_X, armRZ: SWIPE_Z, torsoPitch: SWIPE_PITCH, jaw: SWIPE_JAW },
  swipeL: { torsoYaw: neg(SWIPE_YAW), armLX: SWIPE_X, armLZ: neg(SWIPE_Z), torsoPitch: SWIPE_PITCH, jaw: SWIPE_JAW },
  slam: {
    armLX: SLAM_X,
    armRX: SLAM_X,
    armLZ: SLAM_Z,
    armRZ: neg(SLAM_Z),
    torsoPitch: [[0, 0], [0.42, -0.3], [0.52, 0.42], [0.76, 0.38], [1, 0]],
    hips: [[0, 0], [0.42, 1], [0.52, -2.5], [0.76, -2], [1, 0]],
    jaw: [[0, 0], [0.42, 0.35], [0.52, 0.55], [0.8, 0.2], [1, 0]],
    head: [[0, 0], [0.42, -0.3], [0.52, 0.15], [1, 0]],
    tendril: [[0, 0], [0.42, -0.2], [0.52, 0.45], [1, 0]],
  },
  beam: {
    torsoPitch: [[0, 0], [0.38, 0.38], [0.44, -0.14], [0.72, -0.05], [1, 0]],
    head: [[0, 0], [0.38, 0.32], [0.44, -0.22], [0.72, -0.1], [1, 0]],
    jaw: [[0, 0], [0.38, 0.72], [0.44, 0.92], [0.72, 0.8], [1, 0]],
    armLX: BEAM_ARM_X,
    armRX: BEAM_ARM_X,
    armLZ: BEAM_ARM_Z,
    armRZ: neg(BEAM_ARM_Z),
    hips: [[0, 0], [0.38, -1.5], [0.44, 0.5], [1, 0]],
    glow: [[0, 0], [0.38, 2.6], [0.44, 4], [0.72, 1.5], [1, 0]],
    tendril: [[0, 0], [0.38, 0.5], [0.44, 0.75], [1, 0]],
    tremble: [[0, 0], [0.36, 1], [0.42, 0], [1, 0]],
  },
  quake: {
    armLX: QUAKE_ARM_X,
    armRX: QUAKE_ARM_X,
    armLZ: QUAKE_ARM_Z,
    armRZ: neg(QUAKE_ARM_Z),
    hips: [[0, 0], [0.2, 1.5], [0.28, -2.6], [0.6, -1.5], [1, 0]],
    torsoPitch: [[0, 0], [0.2, -0.25], [0.28, 0.3], [0.6, 0.15], [1, 0]],
    head: [[0, 0], [0.2, -0.35], [0.3, 0.1], [1, 0]],
    jaw: [[0, 0], [0.2, 0.5], [0.3, 0.65], [0.7, 0.4], [1, 0]],
    glow: [[0, 0], [0.2, 1.5], [0.3, 2.5], [0.7, 1], [1, 0]],
    tendril: [[0, 0], [0.2, 0.4], [1, 0]],
    tremble: [[0, 0], [0.26, 1], [0.4, 0], [1, 0]],
  },
  spin: {
    armLZ: SPIN_ARM_Z,
    armRZ: neg(SPIN_ARM_Z),
    armLX: SPIN_ARM_X,
    armRX: SPIN_ARM_X,
    tendril: [[0, 0], [0.12, 0.6], [0.88, 0.6], [1, 0]],
    jaw: [[0, 0], [0.15, 0.3], [0.85, 0.3], [1, 0]],
    glow: [[0, 0], [0.15, 1], [0.85, 1], [1, 0]],
    torsoPitch: [[0, 0], [0.12, -0.08], [0.88, -0.08], [1, 0]],
    spinTurns: 4,
  },
};

const easeInOut = (p: number): number => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2);

/** Procedural locomotion, heartbeat glow, intro roar and attack overlays for the hero rig. */
export class HeroAnimator {
  phase = 0;
  time = 0;
  beat = 0;
  roarEnvelope = 0;
  onFootstep?: (side: FootSide, strength: number) => void;

  private beatPhase = 0;
  private heartRate = 1;
  private roarTimer = 0;
  private roarDuration = 1;
  private lastHipY = HIP_Y;

  private readonly armL = new Spring(60, 10);
  private readonly armR = new Spring(60, 10);
  private readonly pitch = new Spring(40, 11);
  private readonly roll = new Spring(45, 10);
  private readonly headYaw = new Spring(30, 9);
  private readonly hornL = new Spring(90, 6);
  private readonly hornR = new Spring(90, 6);
  private readonly hornPitch = new Spring(70, 7);

  constructor(private readonly rig: HeroRig) {}

  get roaring(): boolean {
    return this.roarTimer > 0;
  }

  triggerRoar(duration = 1.6): void {
    this.roarDuration = duration;
    this.roarTimer = duration;
  }

  update(dt: number, m: AnimInput): void {
    const r = this.rig;
    this.time += dt;
    const t = this.time;

    const walkF = clamp(m.speed / m.walkSpeed, 0, 1);
    const runF = clamp((m.speed - m.walkSpeed) / (m.runSpeed - m.walkSpeed), 0, 1);
    const gait = smoothstep(0.02, 0.6, walkF);

    const prevPhase = this.phase;
    this.phase += ((m.speed * dt) / strideLength(runF)) * Math.PI * 2;
    if (gait > 0.25 && footfallIndex(this.phase) > footfallIndex(prevPhase)) {
      const side: FootSide = footfallIndex(this.phase) % 2 === 0 ? 'right' : 'left';
      this.onFootstep?.(side, lerp(0.55, 1, runF) * gait);
    }
    const ph = this.phase;
    const s = Math.sin(ph);

    if (this.roarTimer > 0) this.roarTimer = Math.max(0, this.roarTimer - dt);
    const rp = 1 - this.roarTimer / this.roarDuration;
    this.roarEnvelope = this.roarTimer > 0 ? smoothstep(0, 0.22, rp) * (1 - smoothstep(0.72, 1, rp)) : 0;
    const roar = this.roarEnvelope;

    const pose = m.action ? POSES[m.action.id] : undefined;
    const ap = m.action?.p ?? 0;
    const k = (keys: Keys | undefined): number => (keys ? sampleKeys(keys, ap) : 0);
    const acting = pose ? 1 : 0;
    const tremble = (roar + k(pose?.tremble)) * Math.sin(t * 61) * 0.03;

    const legAmp = lerp(0.5, 0.78, runF) * gait;
    r.legL.rotation.x = s * legAmp;
    r.legR.rotation.x = -s * legAmp;

    const breathe = Math.sin(t * 1.6);
    const bobDepth = lerp(1.0, 2.2, runF) * gait;
    r.hips.position.y = HIP_Y - bobDepth * (1 - Math.abs(Math.cos(ph))) + breathe * 0.15 * (1 - gait) + k(pose?.hips);
    const hipVel = dt > 0 ? (r.hips.position.y - this.lastHipY) / dt : 0;
    this.lastHipY = r.hips.position.y;

    const leanTarget = lerp(0.03, 0.15, runF) * walkF + clamp(m.accelForward * 0.012, -0.1, 0.1) - roar * 0.16;
    r.torso.rotation.x = this.pitch.step(leanTarget, dt) + k(pose?.torsoPitch);
    const turnLean = clamp(-m.yawRate * m.speed * 0.016, -0.16, 0.16);
    r.torso.rotation.z = this.roll.step(s * 0.07 * gait + turnLean, dt) + tremble;
    r.torso.rotation.y = k(pose?.torsoYaw);
    r.torso.scale.set(1 - breathe * 0.004, 1 + breathe * 0.008, 1 - breathe * 0.004);

    const armAmp = lerp(0.3, 0.62, runF) * gait * (1 - acting * 0.7);
    const sway = Math.sin(t * 1.1) * 0.035 * (1 - gait);
    r.armL.rotation.x = this.armL.step(-s * armAmp + sway - roar * 0.35, dt) + k(pose?.armLX);
    r.armR.rotation.x = this.armR.step(s * armAmp - sway - roar * 0.35, dt) + k(pose?.armRX);
    const spread = 0.06 + runF * 0.06 + roar * 0.55;
    r.armL.rotation.z = spread + Math.sin(t * 0.9) * 0.015 + k(pose?.armLZ);
    r.armR.rotation.z = -spread - Math.sin(t * 0.9 + 1) * 0.015 + k(pose?.armRZ);

    r.head.rotation.x = -r.torso.rotation.x * 0.6 + Math.sin(ph * 2) * 0.035 * gait - roar * 0.38 + k(pose?.head);
    r.head.rotation.y = this.headYaw.step(clamp(m.yawRate * 0.08, -0.3, 0.3), dt) - r.torso.rotation.y * 0.4;
    r.head.rotation.z = -r.torso.rotation.z * 0.5;

    const flop = clamp(hipVel * 0.012, -0.25, 0.25);
    const idleL = Math.sin(t * 2.1) * 0.06;
    const idleR = Math.sin(t * 2.1 + 1.3) * 0.06;
    const flare = roar * 0.45 + k(pose?.tendril);
    r.hornL.rotation.z = this.hornL.step((-r.torso.rotation.z * 1.4 - flop - flare + idleL) * 0.35, dt) + tremble;
    r.hornR.rotation.z = this.hornR.step((-r.torso.rotation.z * 1.4 + flop + flare + idleR) * 0.35, dt) - tremble;
    const tp = this.hornPitch.step((-r.torso.rotation.x * 1.2 - clamp(m.accelForward * 0.01, -0.2, 0.2)) * 0.35, dt);
    r.hornL.rotation.x = tp;
    r.hornR.rotation.x = tp;

    r.spinner.rotation.y = pose?.spinTurns ? easeInOut(ap) * pose.spinTurns * Math.PI * 2 : 0;

    const bpm = lerp(52, 118, Math.max(runF, roar, acting * 0.6));
    this.heartRate = lerp(this.heartRate, bpm / 60, 1 - Math.exp(-dt * 1.5));
    this.beatPhase = (this.beatPhase + dt * this.heartRate) % 1;
    const f = this.beatPhase;
    this.beat = Math.max(Math.exp(-(((f - 0.05) / 0.05) ** 2)), 0.6 * Math.exp(-(((f - 0.24) / 0.06) ** 2)));

    r.plateLower.rotation.x =
      (0.5 + 0.5 * breathe) * 0.05 + this.beat * 0.05 + runF * 0.08 + roar * 0.62 + tremble + k(pose?.jaw);

    const glowBoost = 1 + this.beat * 0.6 + roar * 1.2 + k(pose?.glow) * 0.4;
    for (const mat of r.pulseMaterials) mat.emissiveIntensity = (mat.userData.baseGlow as number) * glowBoost;
    r.chestLight.intensity = 1.5 + this.beat * 3 + roar * 9 + k(pose?.glow) * 4;
  }
}
