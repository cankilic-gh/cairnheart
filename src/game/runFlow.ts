import type { EnemyKind } from '../entities/enemies/types';
import type { Vec2 } from '../entities/hero/motion';
import { GRAFTS, equip, type Family, type GraftId, type GraftSlot } from './grafts';
import type { RuneId } from './runes';
import { HERO_HP, createRun, planRun, rollOffer, type OfferOption, type RunState } from './run';
import { BOSS_WAVE, WaveDirector, type WaveEvent, type WavePlan } from './waves';

export type RunPhase = 'intro' | 'intermission' | 'wave' | 'offer' | 'dying' | 'defeat' | 'victory';

export interface Relic {
  id: number;
  family: Family;
  wave: number;
  at: Vec2;
}

export interface Offer {
  id: number;
  family: Family;
  wave: number;
  options: OfferOption[];
  rerolled: boolean;
}

export type RejectReason = 'chose-other' | 'skipped';

export type FlowEvent =
  | WaveEvent
  | { kind: 'relic'; id: number; family: Family; at: Vec2 }
  | { kind: 'offer'; offer: Offer }
  | { kind: 'equip'; graft: GraftId; slot: GraftSlot; replaced: GraftId | null }
  | { kind: 'rune'; rune: RuneId }
  | { kind: 'reject'; offer: number; grafts: GraftId[]; reason: RejectReason }
  | { kind: 'victory' }
  | { kind: 'defeat' };

export interface KillInfo {
  kind: EnemyKind;
  elite: boolean;
  pos: Vec2;
}

/**
 * The run's rules without any rendering: which wave is on, elite relics and graft offers, rerolls,
 * victory and defeat. The game feeds it time, kills and choices and presents what it emits.
 */
export class RunFlow {
  readonly run: RunState;
  readonly plans: WavePlan[];
  phase: RunPhase = 'intro';
  offer: Offer | null = null;
  readonly relics: Relic[] = [];

  private readonly director: WaveDirector;
  private nextId = 1;
  private offerOrigin: 'wave' | 'intermission' = 'wave';
  /** Set when a wave clears with relics still on the floor: they open one after another. */
  private draining = false;

  constructor(seed: number, hp = HERO_HP) {
    this.run = createRun(seed, hp);
    this.plans = planRun(this.run.seed);
    this.director = new WaveDirector(this.plans);
  }

  get wave(): number {
    return this.run.wave;
  }

  /** Enemies of the current wave still waiting at the gates. */
  get pending(): number {
    return this.director.pending;
  }

  get live(): boolean {
    return this.phase === 'intermission' || this.phase === 'wave';
  }

  /** Intro is over: the first intermission (and wave 1 preview) starts. */
  begin(delay = 1.2): void {
    if (this.phase !== 'intro') return;
    this.phase = 'intermission';
    this.director.start(delay);
  }

  update(dt: number, alive: number): FlowEvent[] {
    if (!this.live) return [];
    this.run.time += dt;
    const events: FlowEvent[] = [];
    for (const ev of this.director.update(dt, alive)) {
      events.push(ev);
      if (ev.kind === 'waveStart') {
        this.run.wave = ev.wave;
        this.phase = 'wave';
      } else if (ev.kind === 'waveCleared') {
        this.phase = 'intermission';
        if (this.relics.length > 0) {
          this.draining = true;
          events.push(...this.open(this.relics[0]!.id));
        }
        break;
      }
    }
    return events;
  }

  enemyKilled(e: KillInfo): FlowEvent[] {
    if (!this.live) return [];
    this.run.kills += 1;
    if (e.kind === 'matriarch') {
      if (this.run.wave !== BOSS_WAVE) return [];
      this.phase = 'victory';
      this.run.outcome = 'victory';
      return [{ kind: 'victory' }];
    }
    if (!e.elite) return [];
    const relic: Relic = { id: this.nextId++, family: e.kind, wave: this.run.wave, at: { ...e.pos } };
    this.relics.push(relic);
    this.syncPending();
    return [{ kind: 'relic', id: relic.id, family: relic.family, at: { ...relic.at } }];
  }

  /** The hero touched a relic: open its offer. */
  collectRelic(id: number): FlowEvent[] {
    if (!this.live) return [];
    return this.open(id);
  }

  /** Accept option `index` of the open offer. */
  take(index: number): FlowEvent[] {
    const offer = this.offer;
    const choice = offer?.options[index];
    if (this.phase !== 'offer' || !offer || !choice) return [];
    const events: FlowEvent[] = [];
    if (choice.type === 'graft') {
      const { loadout, replaced } = equip(this.run.loadout, choice.id);
      this.run.loadout = loadout;
      events.push({ kind: 'equip', graft: choice.id, slot: GRAFTS[choice.id].slot, replaced });
    } else {
      this.run.runes = [...this.run.runes, choice.id];
      events.push({ kind: 'rune', rune: choice.id });
    }
    const left = offer.options.filter((o, i) => i !== index && o.type === 'graft').map((o) => o.id as GraftId);
    if (left.length > 0) events.push({ kind: 'reject', offer: offer.id, grafts: left, reason: 'chose-other' });
    return [...events, ...this.close()];
  }

  /** Turn the open offer down. */
  skip(): FlowEvent[] {
    const offer = this.offer;
    if (this.phase !== 'offer' || !offer) return [];
    const grafts = offer.options.filter((o) => o.type === 'graft').map((o) => o.id as GraftId);
    return [{ kind: 'reject', offer: offer.id, grafts, reason: 'skipped' }, ...this.close()];
  }

  /** Redraw the open offer; one per arena. */
  reroll(): FlowEvent[] {
    const offer = this.offer;
    if (this.phase !== 'offer' || !offer || this.run.rerolls <= 0) return [];
    this.run.rerolls -= 1;
    this.offer = { ...offer, options: this.roll(offer.family), rerolled: true };
    return [{ kind: 'offer', offer: this.offer }];
  }

  heroDied(): void {
    if (this.phase === 'victory' || this.phase === 'defeat') return;
    this.offer = null;
    this.phase = 'dying';
  }

  /** The fall animation is over. */
  finishDeath(): FlowEvent[] {
    if (this.phase !== 'dying') return [];
    this.phase = 'defeat';
    this.run.outcome = 'defeat';
    return [{ kind: 'defeat' }];
  }

  private open(id: number): FlowEvent[] {
    const i = this.relics.findIndex((r) => r.id === id);
    if (i < 0) return [];
    const [relic] = this.relics.splice(i, 1);
    this.syncPending();
    const options = this.roll(relic!.family);
    if (options.length === 0) return [];
    this.offerOrigin = this.phase === 'wave' ? 'wave' : 'intermission';
    this.offer = { id: relic!.id, family: relic!.family, wave: relic!.wave, options, rerolled: false };
    this.phase = 'offer';
    return [{ kind: 'offer', offer: this.offer }];
  }

  private close(): FlowEvent[] {
    this.offer = null;
    this.phase = this.offerOrigin;
    if (this.draining && this.relics.length > 0) return this.open(this.relics[0]!.id);
    this.draining = false;
    return [];
  }

  private roll(family: Family): OfferOption[] {
    const options = rollOffer(this.run, family);
    this.run.offers += 1;
    return options;
  }

  private syncPending(): void {
    this.run.pending = this.relics.map((r) => ({ family: r.family, wave: r.wave }));
  }
}
