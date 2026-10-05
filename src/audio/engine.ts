import { hashString, mulberry32 } from '../core/rng';
import type { Vec2 } from '../entities/hero/motion';
import { finish, hallImpulse, whiteNoise, type Voice } from './dsp';
import { VoiceLimiter, spatialize, type GameAudioMode } from './mix';
import { SOUNDS, type SoundDef, type SoundId } from './sounds';

export interface PlayOptions {
  /** World position; omitted sounds play centred at full level (UI, hero-owned sounds). */
  at?: Vec2;
  volume?: number;
  pitch?: number;
  delay?: number;
}

export interface LoopHandle {
  setRate(rate: number): void;
  setPosition(at: Vec2): void;
  stop(fade?: number): void;
}

interface Active {
  src: AudioBufferSourceNode;
  out: GainNode;
}

const NO_LOOP: LoopHandle = { setRate() {}, setPosition() {}, stop() {} };
const MASTER = 0.8;
/** Above this many live voices, ambient detail sounds are skipped so the mix stays readable. */
const BUSY_VOICES = 28;
const DETAIL: ReadonlySet<SoundId> = new Set<SoundId>(['step', 'drip', 'emerge', 'spit', 'fuse', 'shatter']);

/**
 * Procedural SFX engine. On first gesture it renders every sound (and its variants) offline into
 * buffers, then plays them through a stone-hall reverb, stereo placement and a bus compressor.
 */
export class Sfx {
  muted = false;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private muffle: BiquadFilterNode | null = null;
  private gameBus: GainNode | null = null;
  private uiBus: GainNode | null = null;
  private mode: GameAudioMode = 'live';
  private reverbIn: GainNode | null = null;
  private readonly bank = new Map<SoundId, AudioBuffer[]>();
  private readonly limiters = new Map<SoundId, VoiceLimiter<Active>>();
  private listener: Vec2 = { x: 0, z: 0 };
  private right: Vec2 = { x: 1, z: 0 };
  private ambience: LoopHandle = NO_LOOP;
  private dripIn = 4;
  private readonly rng = mulberry32(7);

  /** Voices currently playing, for the stats panel. */
  get voiceCount(): number {
    let n = 0;
    for (const l of this.limiters.values()) n += l.size;
    return n;
  }

  get ready(): boolean {
    return this.bank.size === Object.keys(SOUNDS).length;
  }

  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext;
      if (!Ctor) return;
      const ctx = new Ctor({ latencyHint: 'interactive' });
      this.ctx = ctx;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.knee.value = 10;
      comp.ratio.value = 4;
      comp.attack.value = 0.004;
      comp.release.value = 0.18;
      this.master = ctx.createGain();
      this.master.gain.value = MASTER;
      comp.connect(this.master).connect(ctx.destination);
      // Gameplay sounds (and their reverb) share one bus that pause can silence; UI has its own.
      this.gameBus = ctx.createGain();
      this.muffle = ctx.createBiquadFilter();
      this.muffle.type = 'lowpass';
      this.muffle.frequency.value = 20000;
      this.gameBus.connect(this.muffle).connect(comp);
      this.uiBus = ctx.createGain();
      this.uiBus.connect(comp);
      const convolver = ctx.createConvolver();
      convolver.buffer = hallImpulse(ctx, 2.2, mulberry32(11));
      this.reverbIn = ctx.createGain();
      const wet = ctx.createGain();
      wet.gain.value = 0.55;
      this.reverbIn.connect(convolver).connect(wet).connect(this.gameBus);
      this.applyMode(true);
      void this.renderBank(ctx);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : MASTER, this.ctx.currentTime, 0.05);
    return this.muted;
  }

  /** Hero position and the camera's screen-right on the ground, for stereo placement. */
  setListener(at: Vec2, right: Vec2): void {
    this.listener = at;
    this.right = right;
  }

  /** Silences, muffles or restores gameplay audio; safe to call every frame. */
  setMode(mode: GameAudioMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.applyMode(false);
  }

  /** A hidden tab gets no audio at all; the context resumes when the page is visible again. */
  setHidden(hidden: boolean): void {
    if (!this.ctx) return;
    if (hidden) void this.ctx.suspend();
    else void this.ctx.resume();
  }

  play(id: SoundId, o: PlayOptions = {}): void {
    const voice = this.start(id, o, false);
    if (!voice) return;
    voice.src.onended = () => {
      this.limiters.get(id)?.remove(voice);
      voice.out.disconnect();
    };
  }

  loop(id: SoundId, o: PlayOptions = {}): LoopHandle {
    const voice = this.start(id, o, true);
    if (!voice || !this.ctx) return NO_LOOP;
    const ctx = this.ctx;
    const def: SoundDef = SOUNDS[id];
    const panner = voice.out.context === ctx ? (voice.out as GainNode & { panner?: StereoPannerNode }).panner : undefined;
    let stopped = false;
    return {
      setRate: (rate) => voice.src.playbackRate.setTargetAtTime(rate, ctx.currentTime, 0.05),
      setPosition: (at) => {
        if (!panner) return;
        const s = spatialize(this.listener, this.right, at);
        panner.pan.setTargetAtTime(s.pan, ctx.currentTime, 0.05);
        voice.out.gain.setTargetAtTime(def.volume * (o.volume ?? 1) * s.gain, ctx.currentTime, 0.05);
      },
      stop: (fade = 0.08) => {
        if (stopped) return;
        stopped = true;
        const t = ctx.currentTime;
        voice.out.gain.cancelScheduledValues(t);
        voice.out.gain.setValueAtTime(voice.out.gain.value, t);
        voice.out.gain.linearRampToValueAtTime(0, t + fade);
        voice.src.stop(t + fade + 0.02);
        this.limiters.get(id)?.remove(voice);
      },
    };
  }

  /** Ambient bed and the occasional water drip somewhere in the vault. */
  update(dt: number): void {
    if (!this.ready || this.muted || this.mode !== 'live') return;
    this.dripIn -= dt;
    if (this.dripIn <= 0) {
      this.dripIn = 2.5 + this.rng() * 6;
      const a = this.rng() * Math.PI * 2;
      const r = 6 + this.rng() * 10;
      this.play('drip', { at: { x: this.listener.x + Math.cos(a) * r, z: this.listener.z + Math.sin(a) * r } });
    }
  }

  private start(id: SoundId, o: PlayOptions, loop: boolean): Active | null {
    const ctx = this.ctx;
    const buffers = this.bank.get(id);
    const def: SoundDef = SOUNDS[id];
    const bus = def.ui ? this.uiBus : this.gameBus;
    if (!ctx || !bus || !this.reverbIn || !buffers || this.muted) return null;
    if (!def.ui && this.mode === 'paused') return null;
    if (DETAIL.has(id) && this.voiceCount >= BUSY_VOICES) return null;
    const src = ctx.createBufferSource();
    src.buffer = buffers[Math.floor(this.rng() * buffers.length)]!;
    src.loop = loop;
    src.playbackRate.value = (o.pitch ?? 1) * (1 + (this.rng() * 2 - 1) * def.pitchVar);
    const s = o.at ? spatialize(this.listener, this.right, o.at) : { pan: 0, gain: 1 };
    const out = ctx.createGain() as GainNode & { panner?: StereoPannerNode };
    out.gain.value = def.volume * (o.volume ?? 1) * s.gain;
    const panner = ctx.createStereoPanner();
    panner.pan.value = s.pan;
    out.panner = panner;
    src.connect(out).connect(panner).connect(bus);
    if (def.reverb > 0 && !def.ui) {
      const send = ctx.createGain();
      send.gain.value = def.reverb;
      out.connect(send).connect(this.reverbIn);
    }
    src.start(ctx.currentTime + (o.delay ?? 0));
    let limiter = this.limiters.get(id);
    if (!limiter) {
      limiter = new VoiceLimiter<Active>(def.maxVoices);
      this.limiters.set(id, limiter);
    }
    const voice = { src, out };
    const cut = limiter.add(voice);
    if (cut) {
      const t = ctx.currentTime;
      cut.out.gain.setTargetAtTime(0, t, 0.015);
      cut.src.stop(t + 0.08);
    }
    return voice;
  }

  private applyMode(instant: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.gameBus || !this.muffle) return;
    const t = ctx.currentTime;
    const level = this.mode === 'paused' ? 0 : this.mode === 'muffled' ? 0.55 : 1;
    const cutoff = this.mode === 'live' ? 20000 : 700;
    if (instant) {
      this.gameBus.gain.value = level;
      this.muffle.frequency.value = cutoff;
      return;
    }
    this.gameBus.gain.cancelScheduledValues(t);
    this.gameBus.gain.setTargetAtTime(level, t, this.mode === 'paused' ? 0.025 : 0.08);
    this.muffle.frequency.cancelScheduledValues(t);
    this.muffle.frequency.setTargetAtTime(cutoff, t, 0.06);
  }

  private async renderBank(live: AudioContext): Promise<void> {
    const sr = live.sampleRate;
    const entries = Object.entries(SOUNDS) as Array<[SoundId, SoundDef]>;
    for (const [id, def] of entries) {
      const variants = await Promise.all(
        Array.from({ length: def.variants }, async (_, i) => {
          const off = new OfflineAudioContext(1, Math.ceil(def.dur * sr), sr);
          const rng = mulberry32(hashString(id) + i * 7919);
          const out = off.createGain();
          out.connect(off.destination);
          const v: Voice = { ctx: off, out, rng, noise: whiteNoise(off, 2, rng) };
          def.render(v, i);
          return finish(await off.startRendering(), 0.89, def.loop ? 0.02 : 0.01, def.loop);
        }),
      );
      this.bank.set(id, variants);
    }
    this.ambience = this.loop('ambience');
  }
}
