import { bell, envelope, filter, grains, lfo, noise, rand, saturate, sweep, swell, tone, type Voice } from './dsp';

export interface SoundDef {
  /** Rendered length in seconds. */
  dur: number;
  variants: number;
  /** Mix gain after peak normalisation. */
  volume: number;
  /** Send into the stone-hall reverb, 0..1. */
  reverb: number;
  maxVoices: number;
  /** Random ± playback-rate spread per play. */
  pitchVar: number;
  loop?: boolean;
  /** UI sounds bypass the gameplay bus so they still play while the game is paused. */
  ui?: boolean;
  render(v: Voice, variant: number): void;
}

const sub = (v: Voice, f0: number, f1: number, dur: number, peak: number, t = 0) =>
  tone(v, { type: 'sine', f0, f1, dur, peak, t, attack: 0.003 });

/** Stone impact body shared by footsteps, slams and the quake stomp. */
const stoneImpact = (v: Voice, t: number, weight: number) => {
  sub(v, 70 * rand(v, 0.9, 1.1), 28, 0.35 + weight * 0.4, 1, t);
  tone(v, { type: 'triangle', f0: 170 * rand(v, 0.9, 1.1), f1: 60, t, dur: 0.12, peak: 0.45 });
  const rumble = filter(v, 'lowpass', 900, 0.8);
  noise(v, t, 0.7).connect(rumble);
  sweep(rumble.frequency, 900, 140, t, 0.5 + weight * 0.3);
  rumble.connect(envelope(v, t, 0.004, 0.55 + weight * 0.3, 0.4 + weight * 0.4));
  const crack = filter(v, 'bandpass', rand(v, 1100, 1700), 1.2);
  noise(v, t, 0.15).connect(crack);
  crack.connect(saturate(v, 6, envelope(v, t, 0.001, 0.35 + weight * 0.3, 0.1)));
  grains(v, { t: t + 0.02, count: Math.round(10 + weight * 24), span: 0.25 + weight * 0.5, fLow: 1200, fHigh: 5200, len: 0.008, peak: 0.28, bias: 2 });
};

/** Glassy gloom-crystal pings scattered over `span`. */
const shards = (v: Voice, count: number, t: number, span: number, peak: number, maxDur = 0.4) => {
  for (let i = 0; i < count; i++) {
    bell(v, {
      f: rand(v, 1800, 6400),
      ratio: rand(v, 1.3, 3.7),
      index: rand(v, 0.4, 1.8),
      t: t + span * v.rng() ** 1.8,
      dur: rand(v, 0.06, maxDur),
      peak: peak * rand(v, 0.4, 1),
    });
  }
};

/** Growling roar: detuned saws through three vocal formants, with vibrato and a pitch arc. */
const roar = (v: Voice, t: number, dur: number, base: number, peak: number) => {
  const sum = v.ctx.createGain();
  const shaped = saturate(v, 2.5, envelope(v, t, dur * 0.18, peak, dur * 0.8, v.out, dur * 0.1));
  sum.connect(shaped);
  for (const [f, q, g] of [
    [320, 4, 1],
    [850, 5, 0.7],
    [2300, 6, 0.35],
  ] as const) {
    const bp = filter(v, 'bandpass', f, q);
    const gain = v.ctx.createGain();
    gain.gain.value = g;
    bp.connect(gain).connect(sum);
    for (const ratio of [1, 1.009, 1.5]) {
      const osc = v.ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(base * ratio, t);
      osc.frequency.linearRampToValueAtTime(base * ratio * 1.22, t + dur * 0.25);
      osc.frequency.exponentialRampToValueAtTime(base * ratio * 0.78, t + dur);
      lfo(v, osc.frequency, 5.5, 3 * ratio, t + dur);
      osc.connect(bp);
      osc.start(t);
      osc.stop(t + dur + 0.05);
    }
    const n = filter(v, 'bandpass', f, q);
    noise(v, t, dur).connect(n);
    const ng = v.ctx.createGain();
    ng.gain.value = 0.25 * g;
    n.connect(ng).connect(sum);
  }
};

export const SOUNDS = {
  step: {
    dur: 0.32,
    variants: 6,
    volume: 0.34,
    reverb: 0.18,
    maxVoices: 4,
    pitchVar: 0.06,
    render(v) {
      sub(v, 62 * rand(v, 0.9, 1.1), 34, 0.22, 1);
      const lp = filter(v, 'lowpass', 700, 0.9);
      noise(v, 0, 0.2).connect(lp);
      sweep(lp.frequency, 700, 180, 0, 0.15);
      lp.connect(envelope(v, 0, 0.003, 0.7, 0.16));
      grains(v, { count: 6 + Math.floor(v.rng() * 5), span: 0.09, fLow: 1800, fHigh: 4500, len: 0.006, peak: 0.25, bias: 1.5 });
    },
  },
  swing: {
    dur: 0.34,
    variants: 4,
    volume: 0.36,
    reverb: 0.12,
    maxVoices: 3,
    pitchVar: 0.08,
    render(v) {
      const bp = filter(v, 'bandpass', 400, 1.4);
      noise(v, 0, 0.34).connect(bp);
      bp.frequency.setValueAtTime(380 * rand(v, 0.9, 1.1), 0);
      bp.frequency.exponentialRampToValueAtTime(1600 * rand(v, 0.9, 1.1), 0.12);
      bp.frequency.exponentialRampToValueAtTime(600, 0.32);
      bp.connect(envelope(v, 0, 0.11, 1, 0.2));
      const air = filter(v, 'lowpass', 260);
      noise(v, 0, 0.34).connect(air);
      air.connect(envelope(v, 0, 0.1, 0.5, 0.2));
    },
  },
  swingHeavy: {
    dur: 0.5,
    variants: 3,
    volume: 0.46,
    reverb: 0.15,
    maxVoices: 2,
    pitchVar: 0.05,
    render(v) {
      const bp = filter(v, 'bandpass', 220, 1.2);
      noise(v, 0, 0.5).connect(bp);
      bp.frequency.setValueAtTime(220, 0);
      bp.frequency.exponentialRampToValueAtTime(950, 0.24);
      bp.frequency.exponentialRampToValueAtTime(380, 0.48);
      bp.connect(envelope(v, 0, 0.2, 1, 0.28));
      tone(v, { type: 'sine', f0: 60, f1: 48, dur: 0.45, peak: 0.3, attack: 0.18 });
    },
  },
  hit: {
    dur: 0.3,
    variants: 6,
    volume: 0.55,
    reverb: 0.14,
    maxVoices: 6,
    pitchVar: 0.08,
    render(v) {
      const j = rand(v, 0.88, 1.12);
      const click = filter(v, 'highpass', 3000);
      noise(v, 0, 0.02).connect(click);
      click.connect(envelope(v, 0, 0.0005, 0.6, 0.012));
      tone(v, { type: 'sine', f0: 150 * j, f1: 55, dur: 0.15, peak: 1, attack: 0.002 });
      tone(v, { type: 'triangle', f0: 300 * j, f1: 110, dur: 0.1, peak: 0.35, attack: 0.002 });
      const crunch = filter(v, 'bandpass', 900 * j, 0.8);
      noise(v, 0, 0.12).connect(crunch);
      crunch.connect(saturate(v, 4, envelope(v, 0, 0.002, 0.7, 0.09)));
      bell(v, { f: 2600 * j, ratio: 1.41, index: 1.2, dur: 0.18, peak: 0.16 });
      bell(v, { f: 3900 * j, ratio: 2.3, index: 0.8, dur: 0.12, peak: 0.09 });
    },
  },
  hitHeavy: {
    dur: 0.55,
    variants: 4,
    volume: 0.7,
    reverb: 0.22,
    maxVoices: 3,
    pitchVar: 0.06,
    render(v) {
      const click = filter(v, 'highpass', 2500);
      noise(v, 0, 0.03).connect(click);
      click.connect(envelope(v, 0, 0.0005, 0.7, 0.02));
      sub(v, 95 * rand(v, 0.9, 1.1), 34, 0.38, 1);
      tone(v, { type: 'triangle', f0: 220, f1: 80, dur: 0.16, peak: 0.45 });
      const crunch = filter(v, 'bandpass', 700, 0.7);
      noise(v, 0, 0.2).connect(crunch);
      crunch.connect(saturate(v, 5, envelope(v, 0, 0.002, 0.85, 0.18)));
      shards(v, 6, 0.005, 0.08, 0.14, 0.3);
    },
  },
  slam: {
    dur: 1.1,
    variants: 3,
    volume: 0.78,
    reverb: 0.45,
    maxVoices: 2,
    pitchVar: 0.04,
    render(v) {
      stoneImpact(v, 0, 1);
    },
  },
  explode: {
    dur: 1.5,
    variants: 4,
    volume: 0.82,
    reverb: 0.55,
    maxVoices: 4,
    pitchVar: 0.07,
    render(v) {
      sub(v, 66 * rand(v, 0.9, 1.1), 24, 1.0, 1);
      const blast = filter(v, 'lowpass', 4000, 0.7);
      noise(v, 0, 1.0).connect(blast);
      sweep(blast.frequency, 4200, 240, 0, 0.9);
      blast.connect(saturate(v, 2.5, envelope(v, 0, 0.003, 1, 0.9)));
      const mid = filter(v, 'bandpass', 600, 0.7);
      noise(v, 0, 0.4).connect(mid);
      mid.connect(envelope(v, 0, 0.002, 0.55, 0.35));
      shards(v, 22, 0.01, 0.3, 0.14, 0.5);
      grains(v, { t: 0.05, count: 30, span: 0.9, fLow: 900, fHigh: 4800, len: 0.01, peak: 0.25, bias: 2 });
    },
  },
  shatter: {
    dur: 0.65,
    variants: 5,
    volume: 0.55,
    reverb: 0.35,
    maxVoices: 5,
    pitchVar: 0.1,
    render(v) {
      const puff = filter(v, 'bandpass', 2200, 0.9);
      noise(v, 0, 0.15).connect(puff);
      puff.connect(envelope(v, 0, 0.002, 0.5, 0.12));
      tone(v, { type: 'sine', f0: 230, f1: 90, dur: 0.09, peak: 0.35 });
      shards(v, 12, 0, 0.08, 0.2, 0.35);
    },
  },
  beamCharge: {
    dur: 0.62,
    variants: 2,
    volume: 0.5,
    reverb: 0.25,
    maxVoices: 1,
    pitchVar: 0.03,
    render(v) {
      const dur = 0.58;
      const lp = filter(v, 'lowpass', 250, 9);
      sweep(lp.frequency, 250, 3200, 0, dur);
      const trem = v.ctx.createGain();
      trem.gain.value = 0.6;
      const vca = swell(v, 0, dur, 0.85, 0.04);
      lp.connect(trem).connect(vca);
      const rate = v.ctx.createOscillator();
      rate.frequency.setValueAtTime(8, 0);
      rate.frequency.exponentialRampToValueAtTime(30, dur);
      const depth = v.ctx.createGain();
      depth.gain.value = 0.4;
      rate.connect(depth).connect(trem.gain);
      rate.start(0);
      rate.stop(dur + 0.05);
      for (const d of [0, 9]) {
        const osc = v.ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.detune.value = d;
        sweep(osc.frequency, 70, 300, 0, dur);
        osc.connect(lp);
        osc.start(0);
        osc.stop(dur + 0.05);
      }
      const suck = filter(v, 'bandpass', 400, 2);
      noise(v, 0, dur).connect(suck);
      sweep(suck.frequency, 400, 4200, 0, dur);
      suck.connect(swell(v, 0, dur, 0.5, 0.04));
      tone(v, { type: 'sine', f0: 40, f1: 82, dur, peak: 0.3, attack: dur * 0.8 });
    },
  },
  beamBlast: {
    dur: 1.15,
    variants: 3,
    volume: 0.82,
    reverb: 0.5,
    maxVoices: 2,
    pitchVar: 0.04,
    render(v) {
      const hp = filter(v, 'highpass', 2000);
      noise(v, 0, 0.06).connect(hp);
      hp.connect(envelope(v, 0, 0.001, 0.9, 0.05));
      sub(v, 95, 32, 0.9, 1);
      const lp = filter(v, 'lowpass', 3000, 1.5);
      sweep(lp.frequency, 3000, 350, 0, 0.85);
      lp.connect(saturate(v, 3, envelope(v, 0, 0.004, 0.75, 0.85)));
      for (const [f, d] of [
        [110, 0],
        [110, 12],
        [55, -5],
      ] as const) {
        const osc = v.ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(f * rand(v, 0.98, 1.02), 0);
        osc.frequency.exponentialRampToValueAtTime(f * 0.7, 0.9);
        osc.detune.value = d;
        osc.connect(lp);
        osc.start(0);
        osc.stop(1);
      }
      const sizzle = filter(v, 'bandpass', 4500, 3);
      noise(v, 0, 0.8).connect(sizzle);
      const chop = v.ctx.createGain();
      chop.gain.value = 0.5;
      lfo(v, chop.gain, 38, 0.5, 0.8, 'square');
      sizzle.connect(chop).connect(envelope(v, 0, 0.01, 0.35, 0.7));
    },
  },
  spin: {
    dur: 1.75,
    variants: 2,
    volume: 0.5,
    reverb: 0.18,
    maxVoices: 1,
    pitchVar: 0.03,
    render(v) {
      const dur = 1.65;
      const bp = filter(v, 'bandpass', 800, 1.6);
      noise(v, 0, dur).connect(bp);
      lfo(v, bp.frequency, 2.6, 520, dur);
      const pulse = v.ctx.createGain();
      pulse.gain.value = 0.6;
      lfo(v, pulse.gain, 2.6, 0.4, dur);
      const env = v.ctx.createGain();
      env.gain.setValueAtTime(0.0001, 0);
      env.gain.exponentialRampToValueAtTime(1, 0.2);
      env.gain.setValueAtTime(1, dur - 0.3);
      env.gain.exponentialRampToValueAtTime(0.0001, dur);
      bp.connect(pulse).connect(env).connect(v.out);
      const air = filter(v, 'lowpass', 350);
      noise(v, 0, dur).connect(air);
      air.connect(envelope(v, 0, 0.25, 0.45, 1.3, v.out, 0.1));
    },
  },
  roar: {
    dur: 1.9,
    variants: 2,
    volume: 0.7,
    reverb: 0.5,
    maxVoices: 1,
    pitchVar: 0.03,
    render(v) {
      roar(v, 0, 1.7, 68, 1);
      sub(v, 50, 38, 1.4, 0.35);
    },
  },
  quake: {
    dur: 1.7,
    variants: 2,
    volume: 0.82,
    reverb: 0.5,
    maxVoices: 1,
    pitchVar: 0.03,
    render(v) {
      roar(v, 0, 0.75, 74, 0.7);
      stoneImpact(v, 0.42, 1.2);
    },
  },
  fuse: {
    dur: 1,
    variants: 1,
    volume: 0.13,
    reverb: 0.1,
    maxVoices: 8,
    pitchVar: 0.05,
    loop: true,
    render(v) {
      const hp = filter(v, 'highpass', 3500, 0.9);
      const lp = filter(v, 'lowpass', 8000, 0.7);
      noise(v, 0, 1).connect(hp).connect(lp);
      const g = v.ctx.createGain();
      g.gain.value = 0.55;
      lp.connect(g).connect(v.out);
      grains(v, { count: 26, span: 0.98, fLow: 3000, fHigh: 8000, len: 0.004, peak: 0.6 });
    },
  },
  spit: {
    dur: 0.26,
    variants: 4,
    volume: 0.36,
    reverb: 0.2,
    maxVoices: 4,
    pitchVar: 0.1,
    render(v) {
      const mod = v.ctx.createOscillator();
      const car = v.ctx.createOscillator();
      sweep(car.frequency, 1400 * rand(v, 0.9, 1.1), 320, 0, 0.18);
      mod.frequency.value = 700;
      const depth = v.ctx.createGain();
      depth.gain.value = 900;
      mod.connect(depth).connect(car.frequency);
      car.connect(envelope(v, 0, 0.003, 0.8, 0.18));
      mod.start(0);
      car.start(0);
      mod.stop(0.25);
      car.stop(0.25);
      const wet = filter(v, 'bandpass', 1800, 3);
      noise(v, 0, 0.15).connect(wet);
      sweep(wet.frequency, 1800, 700, 0, 0.12);
      wet.connect(envelope(v, 0, 0.002, 0.5, 0.12));
      bell(v, { f: 3200 * rand(v, 0.9, 1.1), ratio: 2.1, index: 1, dur: 0.12, peak: 0.15 });
    },
  },
  lunge: {
    dur: 0.32,
    variants: 3,
    volume: 0.36,
    reverb: 0.15,
    maxVoices: 3,
    pitchVar: 0.1,
    render(v) {
      const bp = filter(v, 'bandpass', 1100, 3);
      const sat = saturate(v, 3, envelope(v, 0, 0.06, 0.7, 0.22));
      bp.connect(sat);
      tone(v, { type: 'sawtooth', f0: 180, f1: 270, dur: 0.28, peak: 0.6, dest: bp });
      noise(v, 0, 0.28).connect(bp);
    },
  },
  bite: {
    dur: 0.22,
    variants: 3,
    volume: 0.45,
    reverb: 0.12,
    maxVoices: 3,
    pitchVar: 0.08,
    render(v) {
      for (const t of [0, 0.06]) {
        const hp = filter(v, 'highpass', 2500);
        noise(v, t, 0.03).connect(hp);
        hp.connect(envelope(v, t, 0.0005, 1, 0.02));
      }
      const crunch = filter(v, 'bandpass', 700, 1);
      noise(v, 0, 0.12).connect(crunch);
      crunch.connect(saturate(v, 4, envelope(v, 0, 0.002, 0.6, 0.1)));
    },
  },
  hurt: {
    dur: 0.6,
    variants: 3,
    volume: 0.75,
    reverb: 0.25,
    maxVoices: 2,
    pitchVar: 0.05,
    render(v) {
      const crack = filter(v, 'bandpass', 1300, 1);
      noise(v, 0, 0.15).connect(crack);
      crack.connect(saturate(v, 5, envelope(v, 0, 0.001, 0.8, 0.12)));
      const lp = filter(v, 'lowpass', 600);
      lp.connect(envelope(v, 0, 0.01, 0.5, 0.35));
      tone(v, { type: 'sawtooth', f0: 120, f1: 70, dur: 0.36, peak: 0.8, dest: lp });
      bell(v, { f: 420 * rand(v, 0.95, 1.05), ratio: 2.76, index: 1.5, dur: 0.5, peak: 0.35 });
    },
  },
  bossWarn: {
    dur: 1.05,
    variants: 1,
    volume: 0.6,
    reverb: 0.4,
    maxVoices: 1,
    pitchVar: 0,
    render(v) {
      const lp = filter(v, 'lowpass', 220, 4);
      const trem = v.ctx.createGain();
      trem.gain.value = 0.6;
      lfo(v, trem.gain, 9, 0.4, 1);
      lp.connect(trem).connect(envelope(v, 0, 0.3, 1, 0.1, v.out, 0.6));
      for (const d of [0, 14]) tone(v, { type: 'sawtooth', f0: 42, f1: 60, dur: 1, peak: 1, attack: 0.3, detune: d, dest: lp });
      const rumble = filter(v, 'lowpass', 120);
      noise(v, 0, 1).connect(rumble);
      rumble.connect(envelope(v, 0, 0.4, 0.6, 0.5, v.out, 0.1));
    },
  },
  nova: {
    dur: 0.8,
    variants: 2,
    volume: 0.55,
    reverb: 0.45,
    maxVoices: 2,
    pitchVar: 0.05,
    render(v) {
      const bp = filter(v, 'bandpass', 3000, 1);
      noise(v, 0, 0.5).connect(bp);
      sweep(bp.frequency, 3000, 1100, 0, 0.4);
      bp.connect(envelope(v, 0, 0.005, 0.6, 0.4));
      sub(v, 100, 50, 0.22, 0.6);
      shards(v, 12, 0, 0.12, 0.18, 0.45);
    },
  },
  summon: {
    dur: 1.2,
    variants: 1,
    volume: 0.55,
    reverb: 0.55,
    maxVoices: 1,
    pitchVar: 0,
    render(v) {
      const bp = filter(v, 'bandpass', 600, 2);
      noise(v, 0, 0.95).connect(bp);
      sweep(bp.frequency, 600, 2400, 0, 0.9);
      bp.connect(swell(v, 0, 0.9, 0.7, 0.08));
      const formant = filter(v, 'bandpass', 700, 3);
      formant.connect(envelope(v, 0, 0.6, 0.45, 0.5));
      for (const f of [110, 138.6, 165, 220]) tone(v, { type: 'sawtooth', f0: f, dur: 1.1, peak: 0.6, attack: 0.5, detune: rand(v, -8, 8), dest: formant });
      shards(v, 5, 0.85, 0.15, 0.12, 0.3);
    },
  },
  bossDeath: {
    dur: 2.8,
    variants: 1,
    volume: 0.95,
    reverb: 0.6,
    maxVoices: 1,
    pitchVar: 0,
    render(v) {
      roar(v, 0, 1.4, 52, 0.7);
      sub(v, 55, 20, 2.2, 1, 0.1);
      const blast = filter(v, 'lowpass', 3500);
      noise(v, 0.1, 2).connect(blast);
      sweep(blast.frequency, 3500, 150, 0.1, 2);
      blast.connect(saturate(v, 2, envelope(v, 0.1, 0.01, 0.9, 2)));
      shards(v, 40, 0.1, 0.8, 0.14, 0.7);
      grains(v, { t: 0.2, count: 60, span: 2.2, fLow: 800, fHigh: 5000, len: 0.012, peak: 0.25, bias: 1.6 });
    },
  },
  emerge: {
    dur: 0.75,
    variants: 3,
    volume: 0.26,
    reverb: 0.4,
    maxVoices: 3,
    pitchVar: 0.08,
    render(v) {
      const bp = filter(v, 'bandpass', 300, 4);
      noise(v, 0, 0.7).connect(bp);
      sweep(bp.frequency, 300, 1500, 0, 0.6);
      lfo(v, bp.Q, 6, 2, 0.7);
      bp.connect(envelope(v, 0, 0.3, 0.8, 0.35));
      tone(v, { type: 'sine', f0: 80, f1: 120, dur: 0.6, peak: 0.3, attack: 0.25 });
      shards(v, 3, 0.45, 0.15, 0.12, 0.25);
    },
  },
  waveStart: {
    dur: 1.8,
    variants: 1,
    volume: 0.32,
    reverb: 0.5,
    maxVoices: 1,
    pitchVar: 0,
    render(v) {
      const lp = filter(v, 'lowpass', 300, 1.5);
      lp.frequency.setValueAtTime(300, 0);
      lp.frequency.exponentialRampToValueAtTime(1400, 0.25);
      lp.frequency.exponentialRampToValueAtTime(600, 1.4);
      lp.connect(envelope(v, 0, 0.08, 1, 0.35, v.out, 1.1));
      for (const [f, type, d] of [
        [98, 'sawtooth', 0],
        [98, 'sawtooth', 9],
        [147, 'square', -4],
      ] as const) {
        const osc = v.ctx.createOscillator();
        osc.type = type;
        osc.frequency.setValueAtTime(f * 0.97, 0);
        osc.frequency.exponentialRampToValueAtTime(f, 0.18);
        osc.detune.value = d;
        const g = v.ctx.createGain();
        g.gain.value = type === 'square' ? 0.25 : 0.4;
        osc.connect(g).connect(lp);
        osc.start(0);
        osc.stop(1.6);
      }
      sub(v, 49, 49, 1.5, 0.3);
    },
  },
  waveClear: {
    dur: 1.6,
    ui: true,
    variants: 1,
    volume: 0.45,
    reverb: 0.55,
    maxVoices: 1,
    pitchVar: 0,
    render(v) {
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => bell(v, { f, ratio: 3.5, index: 1.1, t: i * 0.11, dur: 1.2, peak: 0.5 }));
    },
  },
  upgrade: {
    dur: 1,
    ui: true,
    variants: 1,
    volume: 0.45,
    reverb: 0.5,
    maxVoices: 1,
    pitchVar: 0,
    render(v) {
      bell(v, { f: 880, ratio: 2, index: 0.9, dur: 0.8, peak: 0.6 });
      bell(v, { f: 1318.5, ratio: 3, index: 0.7, t: 0.06, dur: 0.7, peak: 0.4 });
      tone(v, { type: 'sine', f0: 220, dur: 0.8, peak: 0.25, attack: 0.05 });
      for (let i = 0; i < 8; i++) bell(v, { f: rand(v, 3000, 6000), ratio: 2.5, index: 0.5, t: 0.05 + i * 0.05, dur: 0.2, peak: 0.1 });
    },
  },
  ui: {
    dur: 0.08,
    ui: true,
    variants: 2,
    volume: 0.3,
    reverb: 0.05,
    maxVoices: 2,
    pitchVar: 0.04,
    render(v) {
      tone(v, { type: 'sine', f0: 1800, f1: 1200, dur: 0.045, peak: 0.6, attack: 0.001 });
      const hp = filter(v, 'highpass', 4000);
      noise(v, 0, 0.02).connect(hp);
      hp.connect(envelope(v, 0, 0.0005, 0.3, 0.01));
    },
  },
  combo: {
    dur: 0.4,
    variants: 1,
    volume: 0.32,
    reverb: 0.35,
    maxVoices: 2,
    pitchVar: 0,
    render(v) {
      bell(v, { f: 1046.5, ratio: 2, index: 0.8, dur: 0.32, peak: 0.6 });
      bell(v, { f: 1568, ratio: 3, index: 0.5, t: 0.04, dur: 0.25, peak: 0.25 });
    },
  },
  death: {
    dur: 2.6,
    variants: 1,
    volume: 0.8,
    reverb: 0.55,
    maxVoices: 1,
    pitchVar: 0,
    render(v) {
      const lp = filter(v, 'lowpass', 500, 2);
      lp.connect(envelope(v, 0, 0.1, 0.8, 1.6, v.out, 0.3));
      tone(v, { type: 'sawtooth', f0: 90, f1: 38, dur: 2, peak: 1, attack: 0.08, dest: lp });
      grains(v, { t: 0.1, count: 70, span: 2.2, fLow: 700, fHigh: 4500, len: 0.012, peak: 0.3, bias: 1.3 });
      for (let i = 0; i < 5; i++) sub(v, 90 * rand(v, 0.8, 1.2), 38, 0.3, 0.6, 0.3 + i * 0.35 + rand(v, 0, 0.1));
    },
  },
  drip: {
    dur: 0.3,
    variants: 4,
    volume: 0.12,
    reverb: 0.85,
    maxVoices: 2,
    pitchVar: 0.15,
    render(v) {
      const f = rand(v, 1100, 1900);
      tone(v, { type: 'sine', f0: f, f1: f * 0.45, dur: 0.05, peak: 0.8, attack: 0.001 });
      tone(v, { type: 'sine', f0: f * 1.3, f1: f * 0.7, t: 0.09, dur: 0.04, peak: 0.25, attack: 0.001 });
    },
  },
  ambience: {
    dur: 12,
    variants: 1,
    volume: 0.09,
    reverb: 0.25,
    maxVoices: 1,
    pitchVar: 0,
    loop: true,
    render(v) {
      const dur = 12;
      for (const [f, g] of [
        [55, 0.35],
        [55.25, 0.35],
        [82.5, 0.12],
      ] as const) {
        const osc = v.ctx.createOscillator();
        osc.frequency.value = f;
        const gain = v.ctx.createGain();
        gain.gain.value = g;
        osc.connect(gain).connect(v.out);
        osc.start(0);
        osc.stop(dur);
      }
      const wind = filter(v, 'lowpass', 300, 1);
      noise(v, 0, dur, 0.5).connect(wind);
      lfo(v, wind.frequency, 1 / 12, 160, dur);
      const wg = v.ctx.createGain();
      wg.gain.value = 0.4;
      wind.connect(wg).connect(v.out);
      grains(v, { count: 45, span: dur - 0.1, fLow: 2000, fHigh: 5000, len: 0.006, peak: 0.08 });
    },
  },
} satisfies Record<string, SoundDef>;

export type SoundId = keyof typeof SOUNDS;
