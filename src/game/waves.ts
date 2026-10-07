import type { Rng } from '../core/rng';
import type { EnemyKind } from '../entities/enemies/types';
import { GATES, type GateId } from '../world/arenaConfig';
import type { Family } from './grafts';

export interface SpawnOrder {
  at: number;
  gate: GateId;
  kind: EnemyKind;
  elite: boolean;
}

/** How a wave's enemies arrive: one by one, in pairs from opposite gates, or in packs from one gate. */
export type WavePattern = 'trickle' | 'pincer' | 'swarm' | 'boss';

export interface WavePlan {
  wave: number;
  orders: SpawnOrder[];
  speedScale: number;
  boss: boolean;
  pattern: WavePattern;
  /** Elite families this wave brings, announced before it starts; each elite drops a graft of its family. */
  elites: Family[];
}

export const BOSS_WAVE = 8;
export const isBossWave = (wave: number): boolean => wave === BOSS_WAVE;

export interface WaveTemplate {
  burster: number;
  spitter: number;
  skitter: number;
  elites: number;
  pattern: Exclude<WavePattern, 'boss'>;
}

/**
 * Waves 1-7. Enemy health never scales; pressure comes from new kinds, more of them at once and
 * the arrival pattern (pincers force a turn, swarms force the quake or the spin).
 */
export const WAVE_TEMPLATES: readonly WaveTemplate[] = [
  { burster: 10, spitter: 0, skitter: 0, elites: 1, pattern: 'trickle' },
  { burster: 10, spitter: 4, skitter: 0, elites: 1, pattern: 'trickle' },
  { burster: 9, spitter: 3, skitter: 5, elites: 1, pattern: 'trickle' },
  { burster: 14, spitter: 4, skitter: 4, elites: 1, pattern: 'pincer' },
  { burster: 12, spitter: 5, skitter: 6, elites: 1, pattern: 'trickle' },
  { burster: 16, spitter: 5, skitter: 5, elites: 1, pattern: 'swarm' },
  { burster: 18, spitter: 6, skitter: 7, elites: 2, pattern: 'pincer' },
];

/** Seconds between single arrivals: unhurried on wave 1, nearly twice as fast by wave 7. */
export const spawnInterval = (wave: number): number => 3.2 - Math.min(6, Math.max(0, wave - 1)) * (1.5 / 6);

export const shuffle = <T>(items: T[], rng: Rng): T[] => {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
  return items;
};

const gateIndex = (rng: Rng): number => Math.floor(rng() * GATES.length) % GATES.length;
const gateId = (i: number): GateId => GATES[((i % GATES.length) + GATES.length) % GATES.length]!.id;

/** Deals elite families to waves 1-7 so every family turns up at least twice. */
export const dealElites = (rng: Rng): Family[][] => {
  const total = WAVE_TEMPLATES.reduce((n, t) => n + t.elites, 0);
  const deck = shuffle<Family>(
    Array.from({ length: Math.ceil(total / 3) * 3 }, (_, i) => (['burster', 'spitter', 'skitter'] as const)[i % 3]!),
    rng,
  );
  let k = 0;
  return WAVE_TEMPLATES.map((t) => deck.slice(k, (k += t.elites)));
};

type Slot = { kind: EnemyKind; elite: boolean };

const bossPlan = (wave: number, rng: Rng, speedScale: number): WavePlan => {
  const orders: SpawnOrder[] = [{ at: 1.2, gate: gateId(gateIndex(rng)), kind: 'matriarch', elite: true }];
  for (let i = 0; i < 4; i++) orders.push({ at: 7 + i * 9, gate: gateId(gateIndex(rng)), kind: 'burster', elite: false });
  for (const at of [14, 30]) orders.push({ at, gate: gateId(gateIndex(rng)), kind: 'spitter', elite: false });
  orders.sort((a, b) => a.at - b.at);
  return { wave, orders, speedScale, boss: true, pattern: 'boss', elites: [] };
};

export const planWave = (wave: number, rng: Rng, elites: readonly Family[] = []): WavePlan => {
  const speedScale = 1 + (wave - 1) * 0.03;
  if (isBossWave(wave)) return bossPlan(wave, rng, speedScale);
  const t = WAVE_TEMPLATES[Math.min(wave, WAVE_TEMPLATES.length) - 1]!;
  const rest: Slot[] = shuffle(
    [
      ...Array.from({ length: t.burster - 1 }, () => ({ kind: 'burster' as const, elite: false })),
      ...Array.from({ length: t.spitter }, () => ({ kind: 'spitter' as const, elite: false })),
      ...Array.from({ length: t.skitter }, () => ({ kind: 'skitter' as const, elite: false })),
    ],
    rng,
  );
  const seq: Slot[] = [{ kind: 'burster', elite: false }, ...rest];
  // Elites arrive mid-wave with company, never first and never last.
  elites.forEach((family, i) => {
    const at = Math.round(seq.length * (0.4 + (0.3 * (i + 1)) / (elites.length + 1)));
    seq.splice(at, 0, { kind: family, elite: true });
  });

  const interval = spawnInterval(wave);
  const orders: SpawnOrder[] = [];
  let at = 0.6;
  if (t.pattern === 'trickle') {
    for (const s of seq) {
      orders.push({ at, gate: gateId(gateIndex(rng)), ...s });
      at += interval * (0.7 + rng() * 0.6);
    }
  } else {
    const size = t.pattern === 'pincer' ? 2 : 3;
    for (let i = 0; i < seq.length; i += size) {
      const g = gateIndex(rng);
      seq.slice(i, i + size).forEach((s, k) => {
        const gate = t.pattern === 'pincer' ? gateId(g + k * 2) : gateId(g);
        orders.push({ at: at + (t.pattern === 'swarm' ? k * 0.25 : 0), gate, ...s });
      });
      at += interval * size * (0.8 + rng() * 0.4);
    }
  }
  return { wave, orders, speedScale, boss: false, pattern: t.pattern, elites: [...elites] };
};

export type WaveEvent =
  | { kind: 'preview'; wave: number; boss: boolean; elites: Family[] }
  | { kind: 'waveStart'; wave: number; total: number; boss: boolean; elites: Family[] }
  | { kind: 'spawn'; order: SpawnOrder; speedScale: number }
  | { kind: 'waveCleared'; wave: number; last: boolean };

/** Plays a fixed list of wave plans: intermission (with a preview of what is coming), spawns, clear. */
export class WaveDirector {
  wave = 0;
  phase: 'idle' | 'intermission' | 'active' | 'done' = 'idle';
  private timer = 0;
  private elapsed = 0;
  private next = 0;
  private previewed = false;
  private plan: WavePlan | null = null;

  constructor(
    readonly plans: readonly WavePlan[],
    /** Breather between waves; long enough to read the next wave's elites. */
    private readonly intermission = 5,
  ) {}

  /** Enemies of the current wave that have not come through a gate yet. */
  get pending(): number {
    return this.plan && this.phase === 'active' ? this.plan.orders.length - this.next : 0;
  }

  get upcoming(): WavePlan | null {
    return this.plans[this.wave] ?? null;
  }

  start(delay = 1): void {
    this.wave = 0;
    this.plan = null;
    this.phase = 'intermission';
    this.previewed = false;
    this.timer = delay;
  }

  update(dt: number, alive: number): WaveEvent[] {
    const events: WaveEvent[] = [];
    if (this.phase === 'intermission') {
      const up = this.upcoming;
      if (!up) {
        this.phase = 'done';
        return events;
      }
      if (!this.previewed) {
        this.previewed = true;
        events.push({ kind: 'preview', wave: up.wave, boss: up.boss, elites: [...up.elites] });
      }
      this.timer -= dt;
      if (this.timer <= 0) {
        this.wave += 1;
        this.plan = up;
        this.next = 0;
        this.elapsed = 0;
        this.phase = 'active';
        events.push({ kind: 'waveStart', wave: this.wave, total: up.orders.length, boss: up.boss, elites: [...up.elites] });
      }
      return events;
    }
    if (this.phase !== 'active' || !this.plan) return events;
    if (this.next >= this.plan.orders.length && alive === 0) {
      const last = this.wave >= this.plans.length;
      events.push({ kind: 'waveCleared', wave: this.wave, last });
      this.phase = last ? 'done' : 'intermission';
      this.previewed = false;
      this.timer = this.intermission;
      return events;
    }
    this.elapsed += dt;
    while (this.next < this.plan.orders.length && this.plan.orders[this.next]!.at <= this.elapsed) {
      events.push({ kind: 'spawn', order: this.plan.orders[this.next]!, speedScale: this.plan.speedScale });
      this.next += 1;
    }
    return events;
  }
}
