import type { Rng } from '../core/rng';
import type { EnemyKind } from '../entities/enemies/types';
import { GATES, type GateId } from '../world/arenaConfig';

export interface SpawnOrder {
  at: number;
  gate: GateId;
  kind: EnemyKind;
  elite: boolean;
}

export interface WavePlan {
  wave: number;
  orders: SpawnOrder[];
  speedScale: number;
  boss: boolean;
  bossLevel: number;
}

export const BOSS_EVERY = 5;
export const isBossWave = (wave: number): boolean => wave > 0 && wave % BOSS_EVERY === 0;

export interface WaveSize {
  burster: number;
  elite: number;
  spitter: number;
  skitter: number;
  matriarch: number;
}

export const waveSize = (wave: number): WaveSize =>
  isBossWave(wave)
    ? { burster: 2 + wave / BOSS_EVERY, elite: 0, spitter: 0, skitter: 0, matriarch: 1 }
    : {
        burster: 3 + wave,
        elite: wave >= 4 ? Math.floor((wave - 1) / 3) : 0,
        spitter: wave >= 2 ? Math.floor(wave / 2) : 0,
        skitter: wave >= 3 ? Math.floor((wave - 1) / 2) : 0,
        matriarch: 0,
      };

const shuffle = <T>(items: T[], rng: Rng): T[] => {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
  return items;
};

const gate = (rng: Rng): GateId => GATES[Math.floor(rng() * GATES.length) % GATES.length]!.id;

export const planWave = (wave: number, rng: Rng): WavePlan => {
  const size = waveSize(wave);
  const speedScale = 1 + Math.min(0.45, (wave - 1) * 0.05);
  const bossLevel = Math.max(0, wave / BOSS_EVERY - 1);
  if (isBossWave(wave)) {
    const orders: SpawnOrder[] = [{ at: 1.2, gate: gate(rng), kind: 'matriarch', elite: true }];
    for (let i = 0; i < size.burster; i++) orders.push({ at: 6 + i * 5, gate: gate(rng), kind: 'burster', elite: false });
    return { wave, orders, speedScale, boss: true, bossLevel };
  }
  const kinds: Array<{ kind: EnemyKind; elite: boolean }> = [
    ...Array.from({ length: size.burster }, () => ({ kind: 'burster' as const, elite: false })),
    ...Array.from({ length: size.elite }, () => ({ kind: 'burster' as const, elite: true })),
    ...Array.from({ length: size.spitter }, () => ({ kind: 'spitter' as const, elite: false })),
    ...Array.from({ length: size.skitter }, () => ({ kind: 'skitter' as const, elite: false })),
  ];
  const first = kinds.shift()!;
  const order = [first, ...shuffle(kinds, rng)];
  const interval = Math.max(0.45, 1.5 - wave * 0.08);
  let at = 0.6;
  const orders = order.map(({ kind, elite }) => {
    const o: SpawnOrder = { at, gate: gate(rng), kind, elite };
    at += interval * (0.7 + rng() * 0.6);
    return o;
  });
  return { wave, orders, speedScale, boss: false, bossLevel };
};

export type WaveEvent =
  | { kind: 'waveStart'; wave: number; total: number; boss: boolean }
  | { kind: 'spawn'; order: SpawnOrder; speedScale: number; bossLevel: number }
  | { kind: 'waveCleared'; wave: number };

export class WaveDirector {
  wave = 0;
  phase: 'idle' | 'intermission' | 'active' = 'idle';
  private timer = 0;
  private elapsed = 0;
  private next = 0;
  private plan: WavePlan | null = null;

  constructor(
    private readonly rng: Rng,
    private readonly intermission = 3.5,
  ) {}

  /** Enemies of the current wave that have not come through a gate yet. */
  get pending(): number {
    return this.plan && this.phase === 'active' ? this.plan.orders.length - this.next : 0;
  }

  start(delay = 1): void {
    this.wave = 0;
    this.plan = null;
    this.phase = 'intermission';
    this.timer = delay;
  }

  update(dt: number, alive: number): WaveEvent[] {
    const events: WaveEvent[] = [];
    if (this.phase === 'intermission') {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.wave += 1;
        this.plan = planWave(this.wave, this.rng);
        this.next = 0;
        this.elapsed = 0;
        this.phase = 'active';
        events.push({ kind: 'waveStart', wave: this.wave, total: this.plan.orders.length, boss: this.plan.boss });
      }
      return events;
    }
    if (this.phase !== 'active' || !this.plan) return events;
    if (this.next >= this.plan.orders.length && alive === 0) {
      events.push({ kind: 'waveCleared', wave: this.wave });
      this.phase = 'intermission';
      this.timer = this.intermission;
      return events;
    }
    this.elapsed += dt;
    while (this.next < this.plan.orders.length && this.plan.orders[this.next]!.at <= this.elapsed) {
      events.push({ kind: 'spawn', order: this.plan.orders[this.next]!, speedScale: this.plan.speedScale, bossLevel: this.plan.bossLevel });
      this.next += 1;
    }
    return events;
  }
}
