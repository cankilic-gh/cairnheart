import type { Rng } from '../core/rng';

/** One render pass: an offline context, its output node and a seeded RNG for the variant. */
export interface Voice {
  ctx: BaseAudioContext;
  out: AudioNode;
  rng: Rng;
  noise: AudioBuffer;
}

export const whiteNoise = (ctx: BaseAudioContext, seconds: number, rng: Rng): AudioBuffer => {
  const buf = ctx.createBuffer(1, Math.ceil(seconds * ctx.sampleRate), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = rng() * 2 - 1;
  return buf;
};

export const rand = (v: Voice, lo: number, hi: number): number => lo + (hi - lo) * v.rng();

const EPS = 0.0001;

/** Percussive envelope: exponential attack to `peak`, exponential decay to silence. */
export const envelope = (
  v: Voice,
  t: number,
  attack: number,
  peak: number,
  decay: number,
  dest: AudioNode = v.out,
  hold = 0,
): GainNode => {
  const g = v.ctx.createGain();
  g.gain.setValueAtTime(EPS, t);
  g.gain.exponentialRampToValueAtTime(Math.max(EPS, peak), t + Math.max(0.0005, attack));
  if (hold > 0) g.gain.setValueAtTime(Math.max(EPS, peak), t + attack + hold);
  g.gain.exponentialRampToValueAtTime(EPS, t + attack + hold + decay);
  g.connect(dest);
  return g;
};

/** Linear swell that ends abruptly; used for reverse-style risers. */
export const swell = (v: Voice, t: number, rise: number, peak: number, release: number, dest: AudioNode = v.out): GainNode => {
  const g = v.ctx.createGain();
  g.gain.setValueAtTime(EPS, t);
  g.gain.exponentialRampToValueAtTime(Math.max(EPS, peak), t + rise);
  g.gain.exponentialRampToValueAtTime(EPS, t + rise + release);
  g.connect(dest);
  return g;
};

export interface ToneOptions {
  type: OscillatorType;
  f0: number;
  f1?: number;
  t?: number;
  dur: number;
  peak: number;
  attack?: number;
  detune?: number;
  dest?: AudioNode;
}

/** Oscillator with an exponential pitch glide and a percussive envelope. */
export const tone = (v: Voice, o: ToneOptions): OscillatorNode => {
  const t = o.t ?? 0;
  const osc = v.ctx.createOscillator();
  osc.type = o.type;
  osc.frequency.setValueAtTime(o.f0, t);
  if (o.f1 !== undefined && o.f1 !== o.f0) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), t + o.dur);
  if (o.detune) osc.detune.value = o.detune;
  const attack = o.attack ?? 0.004;
  osc.connect(envelope(v, t, attack, o.peak, Math.max(0.01, o.dur - attack), o.dest ?? v.out));
  osc.start(t);
  osc.stop(t + o.dur + 0.05);
  return osc;
};

/** Noise source playing from a random offset of the shared noise buffer. */
export const noise = (v: Voice, t: number, dur: number, rate = 1): AudioBufferSourceNode => {
  const src = v.ctx.createBufferSource();
  src.buffer = v.noise;
  src.loop = true;
  src.playbackRate.value = rate;
  src.start(t, v.rng() * Math.max(0, v.noise.duration - 0.1));
  src.stop(t + dur + 0.05);
  return src;
};

export const filter = (
  v: Voice,
  type: BiquadFilterType,
  freq: number,
  q = 0.707,
  dest?: AudioNode,
): BiquadFilterNode => {
  const f = v.ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  if (dest) f.connect(dest);
  return f;
};

/** Exponential sweep of a filter's cutoff from `from` to `to` over [t, t + dur]. */
export const sweep = (param: AudioParam, from: number, to: number, t: number, dur: number): void => {
  param.setValueAtTime(from, t);
  param.exponentialRampToValueAtTime(Math.max(1, to), t + dur);
};

/** Soft-clipping waveshaper; `drive` around 1–8. */
export const saturate = (v: Voice, drive: number, dest?: AudioNode): WaveShaperNode => {
  const curve = new Float32Array(1024);
  const norm = Math.tanh(drive);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * drive) / norm;
  }
  const ws = v.ctx.createWaveShaper();
  ws.curve = curve;
  ws.oversample = '2x';
  if (dest) ws.connect(dest);
  return ws;
};

export interface BellOptions {
  f: number;
  ratio: number;
  index: number;
  t?: number;
  dur: number;
  peak: number;
  dest?: AudioNode;
}

/** Two-operator FM bell: inharmonic ratios give glassy crystal and bronze tones. */
export const bell = (v: Voice, o: BellOptions): void => {
  const t = o.t ?? 0;
  const mod = v.ctx.createOscillator();
  mod.frequency.value = o.f * o.ratio;
  const depth = v.ctx.createGain();
  depth.gain.setValueAtTime(o.f * o.index, t);
  depth.gain.exponentialRampToValueAtTime(Math.max(1, o.f * o.index * 0.1), t + o.dur);
  const car = v.ctx.createOscillator();
  car.frequency.value = o.f;
  mod.connect(depth).connect(car.frequency);
  car.connect(envelope(v, t, 0.002, o.peak, o.dur, o.dest ?? v.out));
  mod.start(t);
  car.start(t);
  mod.stop(t + o.dur + 0.05);
  car.stop(t + o.dur + 0.05);
};

export interface GrainOptions {
  count: number;
  t?: number;
  span: number;
  fLow: number;
  fHigh: number;
  len: number;
  peak: number;
  /** >1 bunches grains toward the start (debris settling). */
  bias?: number;
  dest?: AudioNode;
}

/** Scatter of tiny band-passed noise bursts: gravel, crackle, debris. */
export const grains = (v: Voice, o: GrainOptions): void => {
  const t0 = o.t ?? 0;
  for (let i = 0; i < o.count; i++) {
    const t = t0 + o.span * v.rng() ** (o.bias ?? 1);
    const bp = filter(v, 'bandpass', rand(v, o.fLow, o.fHigh), rand(v, 0.8, 3));
    noise(v, t, o.len * 2).connect(bp);
    bp.connect(envelope(v, t, 0.0008, o.peak * rand(v, 0.4, 1), o.len, o.dest ?? v.out));
  }
};

/** Low-frequency oscillator wired into a parameter: value = base ± depth at `rate` Hz. */
export const lfo = (v: Voice, param: AudioParam, rate: number, depth: number, dur: number, type: OscillatorType = 'sine'): OscillatorNode => {
  const osc = v.ctx.createOscillator();
  osc.type = type;
  osc.frequency.value = rate;
  const g = v.ctx.createGain();
  g.gain.value = depth;
  osc.connect(g).connect(param);
  osc.start(0);
  osc.stop(dur + 0.05);
  return osc;
};

/** Peak-normalises a rendered buffer and fades its tail so voices never click. */
export const finish = (buf: AudioBuffer, target = 0.89, fadeOut = 0.01, loop = false): AudioBuffer => {
  let peak = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]!));
  }
  const k = peak > 0 ? target / peak : 1;
  const fade = Math.floor(fadeOut * buf.sampleRate);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) {
      let g = k;
      if (i >= d.length - fade) g *= (d.length - i) / fade;
      if (loop && i < fade) g *= i / fade;
      d[i] = d[i]! * g;
    }
  }
  return buf;
};

/**
 * Stereo stone-hall impulse response: a handful of early reflections, then decorrelated
 * noise that decays and darkens over `seconds`.
 */
export const hallImpulse = (ctx: BaseAudioContext, seconds: number, rng: Rng): AudioBuffer => {
  const sr = ctx.sampleRate;
  const len = Math.floor(seconds * sr);
  const buf = ctx.createBuffer(2, len, sr);
  const taps = [0.011, 0.019, 0.027, 0.041, 0.053, 0.071, 0.089];
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const decay = Math.exp(-6.9 * (t / seconds));
      const darken = 0.25 + 0.7 * (t / seconds);
      lp += (rng() * 2 - 1 - lp) * (1 - darken);
      d[i] = lp * decay * (t < 0.012 ? t / 0.012 : 1) * 0.6;
    }
    for (const tap of taps) {
      const i = Math.floor((tap + (c ? 0.0037 : 0)) * sr);
      if (i < len) d[i] = d[i]! + (rng() < 0.5 ? -1 : 1) * 0.5 * Math.exp(-tap * 18);
    }
  }
  return buf;
};
