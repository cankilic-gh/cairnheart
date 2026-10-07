import { hashString, mulberry32, type Rng } from '../core/rng';
import { FAMILIES, GRAFTS, GRAFT_IDS, SLOTS, isEquipped, type Family, type GraftId, type GraftSlot, type Loadout } from './grafts';
import { RUNE_IDS, type RuneId } from './runes';
import { BOSS_WAVE, dealElites, planWave, shuffle, type WavePlan } from './waves';

export const RUN_VERSION = 1;
/** The golem's heart. Fixed for the whole run: grafts and runes change attacks, never stats. */
export const HERO_HP = 300;
/** No single enemy hit may take more than this share of the heart. */
export const MAX_HIT_FRACTION = 0.4;
export const RUN_WAVES = BOSS_WAVE;
/** Rerolls per arena; there is one arena, so per run. */
export const REROLLS_PER_ARENA = 1;
export const OFFER_SIZE = 3;

/** A graft relic an elite dropped that has not been opened yet. */
export interface PendingOffer {
  family: Family;
  wave: number;
}

export type RunOutcome = 'running' | 'victory' | 'defeat';

/** Everything needed to describe (and resume or replay) a run. */
export interface RunState {
  version: typeof RUN_VERSION;
  seed: number;
  arena: 'sunkenVault';
  /** Last wave that started. */
  wave: number;
  /** Seconds of live fighting (intermissions included, menus and offers excluded). */
  time: number;
  hp: number;
  kills: number;
  score: number;
  loadout: Loadout;
  runes: RuneId[];
  rerolls: number;
  /** How many offers have been rolled; seeds the next roll so a restored run deals the same cards. */
  offers: number;
  pending: PendingOffer[];
  outcome: RunOutcome;
}

export type OfferOption = { type: 'graft'; id: GraftId } | { type: 'rune'; id: RuneId };

/** Independent random stream per purpose, so drawing offers never shifts the wave plan. */
export const seedRng = (seed: number, stream: string): Rng => mulberry32((seed ^ hashString(stream)) >>> 0);

export const newSeed = (): number => (Math.floor(Math.random() * 0x7fffffff) + 1) >>> 0;

export const createRun = (seed: number, hp: number): RunState => ({
  version: RUN_VERSION,
  seed: seed >>> 0,
  arena: 'sunkenVault',
  wave: 0,
  time: 0,
  hp,
  kills: 0,
  score: 0,
  loadout: {},
  runes: [],
  rerolls: REROLLS_PER_ARENA,
  offers: 0,
  pending: [],
  outcome: 'running',
});

/** All eight waves of a run. Same seed, same plan. */
export const planRun = (seed: number): WavePlan[] => {
  const elites = dealElites(seedRng(seed, 'elites'));
  return Array.from({ length: RUN_WAVES }, (_, i) => planWave(i + 1, seedRng(seed, `wave:${i + 1}`), elites[i] ?? []));
};

/**
 * Three cards for a relic of `family`: a graft of that family leads (any graft if both are already
 * worn), the other two come from the remaining grafts and unowned runes. Pure; the caller bumps `offers`.
 */
export const rollOffer = (run: RunState, family: Family): OfferOption[] => {
  const rng = seedRng(run.seed, `offer:${run.offers}`);
  const free = GRAFT_IDS.filter((id) => !isEquipped(run.loadout, id));
  const own = free.filter((id) => GRAFTS[id].family === family);
  const leadPool = own.length > 0 ? own : free;
  if (leadPool.length === 0) return [];
  const lead = leadPool[Math.floor(rng() * leadPool.length) % leadPool.length]!;
  const rest: OfferOption[] = shuffle(
    [
      ...free.filter((id) => id !== lead).map((id) => ({ type: 'graft' as const, id })),
      ...RUNE_IDS.filter((id) => !run.runes.includes(id)).map((id) => ({ type: 'rune' as const, id })),
    ],
    rng,
  );
  return [{ type: 'graft', id: lead }, ...rest.slice(0, OFFER_SIZE - 1)];
};

export const serializeRun = (run: RunState): string => JSON.stringify(run);

const fail = (why: string): never => {
  throw new Error(`Invalid run save: ${why}`);
};

const num = (v: unknown, name: string): number => (typeof v === 'number' && Number.isFinite(v) ? v : fail(name));

export const deserializeRun = (json: string): RunState => {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return fail('not JSON');
  }
  if (!raw || typeof raw !== 'object') return fail('not an object');
  const r = raw as Record<string, unknown>;
  if (r.version !== RUN_VERSION) fail(`version ${String(r.version)}`);
  if (r.arena !== 'sunkenVault') fail('arena');
  const loadout: Loadout = {};
  const rawLoadout = (r.loadout ?? {}) as Record<string, unknown>;
  for (const [slot, id] of Object.entries(rawLoadout)) {
    if (!SLOTS.includes(slot as GraftSlot)) fail(`slot ${slot}`);
    if (!GRAFT_IDS.includes(id as GraftId)) fail(`graft ${String(id)}`);
    if (GRAFTS[id as GraftId].slot !== slot) fail(`${String(id)} does not fit ${slot}`);
    loadout[slot as GraftSlot] = id as GraftId;
  }
  const runes = Array.isArray(r.runes) ? r.runes : fail('runes');
  for (const id of runes) if (!RUNE_IDS.includes(id as RuneId)) fail(`rune ${String(id)}`);
  const pending = Array.isArray(r.pending) ? r.pending : fail('pending');
  const outcome = r.outcome;
  if (outcome !== 'running' && outcome !== 'victory' && outcome !== 'defeat') fail('outcome');
  return {
    version: RUN_VERSION,
    seed: num(r.seed, 'seed') >>> 0,
    arena: 'sunkenVault',
    wave: num(r.wave, 'wave'),
    time: num(r.time, 'time'),
    hp: num(r.hp, 'hp'),
    kills: num(r.kills, 'kills'),
    score: num(r.score, 'score'),
    loadout,
    runes: [...(runes as RuneId[])],
    rerolls: num(r.rerolls, 'rerolls'),
    offers: num(r.offers, 'offers'),
    pending: pending.map((p: unknown) => {
      const o = (p ?? {}) as Record<string, unknown>;
      if (!FAMILIES.includes(o.family as Family)) fail('pending family');
      return { family: o.family as Family, wave: num(o.wave, 'pending wave') };
    }),
    outcome: outcome as RunOutcome,
  };
};
