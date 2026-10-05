/** Tiny synthesized SFX bank; no audio files to load. */
export class Sfx {
  muted = false;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;

  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.55;
      this.master.connect(this.ctx.destination);
      const len = Math.floor(this.ctx.sampleRate * 0.6);
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.55;
    return this.muted;
  }

  footstep(strength: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.muted) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(78, now);
    osc.frequency.exponentialRampToValueAtTime(38, now + 0.2);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.5 * strength, now + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
    osc.connect(g).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.3);
    this.noiseBurst(now, 0.16, 520, 0.22 * strength);
  }

  roar(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.muted) return;
    const now = ctx.currentTime;
    for (const [freq, detune] of [
      [55, 0],
      [82, 7],
      [110, -9],
    ] as const) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq * 0.8, now);
      osc.frequency.linearRampToValueAtTime(freq, now + 0.3);
      osc.frequency.linearRampToValueAtTime(freq * 0.7, now + 1.4);
      osc.detune.value = detune;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(300, now);
      lp.frequency.linearRampToValueAtTime(900, now + 0.35);
      lp.frequency.linearRampToValueAtTime(240, now + 1.4);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.12, now + 0.25);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 1.5);
      osc.connect(lp).connect(g).connect(this.master);
      osc.start(now);
      osc.stop(now + 1.55);
    }
    this.noiseBurst(now, 1.2, 700, 0.12);
  }

  swing(heavy = false): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const now = ctx.currentTime;
    this.sweep(now, heavy ? 0.32 : 0.2, heavy ? 300 : 700, heavy ? 1500 : 2600, heavy ? 0.22 : 0.16, 'bandpass');
  }

  hit(strength = 1): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.muted) return;
    const now = ctx.currentTime;
    this.tone(now, 'square', 160, 70, 0.09, 0.12 * strength);
    this.noiseBurst(now, 0.08, 2200, 0.2 * strength);
  }

  pop(): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const now = ctx.currentTime;
    this.tone(now, 'triangle', 520, 1400, 0.12, 0.12);
    this.noiseBurst(now, 0.18, 4200, 0.14);
  }

  explode(strength = 1): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const now = ctx.currentTime;
    this.tone(now, 'sine', 90, 28, 0.6, 0.6 * strength);
    this.noiseBurst(now, 0.9, 900, 0.5 * strength);
  }

  /** Burster fuse hiss; returns a stopper for when the fuse fizzles or the burster dies. */
  hiss(duration: number): () => void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise || this.muted) return () => {};
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'highpass';
    bp.frequency.value = 3200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.09, now + 0.1);
    g.gain.setValueAtTime(0.09, now + duration);
    g.gain.exponentialRampToValueAtTime(0.0001, now + duration + 0.05);
    src.connect(bp).connect(g).connect(this.master);
    src.start(now);
    src.stop(now + duration + 0.1);
    return () => {
      const t = ctx.currentTime;
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
      try {
        src.stop(t + 0.08);
      } catch {
        // already stopped
      }
    };
  }

  spit(): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const now = ctx.currentTime;
    this.tone(now, 'square', 900, 300, 0.12, 0.05, 2400);
    this.noiseBurst(now, 0.08, 3000, 0.06);
  }

  /** Low warning growl under a boss wind-up. */
  rumble(duration: number): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const now = ctx.currentTime;
    this.tone(now, 'sawtooth', 48, 70, duration, 0.14, 260);
  }

  beamCharge(duration: number): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const now = ctx.currentTime;
    this.tone(now, 'sawtooth', 60, 240, duration, 0.08, 600);
  }

  beamBlast(): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const now = ctx.currentTime;
    this.tone(now, 'square', 140, 40, 0.7, 0.22, 1200);
    this.tone(now, 'sine', 70, 30, 0.8, 0.5);
    this.noiseBurst(now, 0.5, 1800, 0.35);
  }

  spin(): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const now = ctx.currentTime;
    for (let i = 0; i < 6; i++) this.sweep(now + i * 0.25, 0.22, 400, 1600, 0.12, 'bandpass');
  }

  hurt(): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const now = ctx.currentTime;
    this.tone(now, 'sawtooth', 110, 55, 0.35, 0.16, 500);
  }

  waveStart(): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const now = ctx.currentTime;
    this.tone(now, 'sawtooth', 55, 55, 1.1, 0.1, 400);
    this.tone(now + 0.05, 'sawtooth', 82.5, 82.5, 1.0, 0.07, 400);
  }

  private tone(
    at: number,
    type: OscillatorType,
    from: number,
    to: number,
    dur: number,
    gain: number,
    lowpass = 0,
  ): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, at);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), at + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain, at + Math.min(0.02, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    let node: AudioNode = osc;
    if (lowpass > 0) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = lowpass;
      node = node.connect(lp);
    }
    node.connect(g).connect(this.master);
    osc.start(at);
    osc.stop(at + dur + 0.02);
  }

  private sweep(at: number, dur: number, from: number, to: number, gain: number, type: BiquadFilterType): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = 1.4;
    f.frequency.setValueAtTime(from, at);
    f.frequency.exponentialRampToValueAtTime(to, at + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain, at + dur * 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(at);
    src.stop(at + dur);
  }

  private noiseBurst(at: number, dur: number, cutoff: number, gain: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(lp).connect(g).connect(this.master);
    src.start(at);
    src.stop(at + Math.min(dur, 0.59));
  }
}
