import { describe, expect, it } from 'vitest';
import { GRAFTS, type GraftId } from '../../src/game/grafts';
import { RunFlow, type FlowEvent } from '../../src/game/runFlow';

const STEP = 1 / 20;

/** Advances the flow with nobody alive, so every wave clears as soon as its last enemy has spawned. */
const advance = (flow: RunFlow, seconds: number, alive = 0): FlowEvent[] => {
  const events: FlowEvent[] = [];
  for (let t = 0; t < seconds; t += STEP) events.push(...flow.update(STEP, alive));
  return events;
};

/** Plays until `wave` has started (skipping relics; nobody is killed). */
const reachWave = (flow: RunFlow, wave: number): FlowEvent[] => {
  const events: FlowEvent[] = [];
  for (let guard = 0; guard < 20000 && flow.wave < wave; guard++) events.push(...flow.update(STEP, 0));
  return events;
};

const started = (events: FlowEvent[]) => events.filter((e) => e.kind === 'waveStart');

describe('run flow', () => {
  it('previews each wave elite before the wave starts', () => {
    const flow = new RunFlow(11);
    flow.begin(0.5);
    const events = advance(flow, 0.2);
    const preview = events.find((e) => e.kind === 'preview');
    expect(preview).toMatchObject({ kind: 'preview', wave: 1 });
    expect(preview && preview.kind === 'preview' && preview.elites).toEqual(flow.plans[0]!.elites);
    expect(started(events)).toHaveLength(0);
  });

  it('runs eight waves and makes the eighth the boss', () => {
    const flow = new RunFlow(3);
    flow.begin(0);
    const events = reachWave(flow, 8);
    const starts = started(events);
    expect(starts.map((e) => e.kind === 'waveStart' && e.wave)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(starts.map((e) => e.kind === 'waveStart' && e.boss)).toEqual([false, false, false, false, false, false, false, true]);
    const spawns = advance(flow, 3, 1).filter((e) => e.kind === 'spawn');
    expect(spawns.some((e) => e.kind === 'spawn' && e.order.kind === 'matriarch')).toBe(true);
  });

  it('wins the run when the boss dies', () => {
    const flow = new RunFlow(3);
    flow.begin(0);
    reachWave(flow, 8);
    advance(flow, 3, 1);
    const events = flow.enemyKilled({ kind: 'matriarch', elite: true, pos: { x: 0, z: 0 } });
    expect(events.map((e) => e.kind)).toContain('victory');
    expect(flow.phase).toBe('victory');
    expect(flow.run.outcome).toBe('victory');
    expect(advance(flow, 5)).toEqual([]);
  });

  it('does not win when the boss is killed before wave eight (debug spawns)', () => {
    const flow = new RunFlow(3);
    flow.begin(0);
    reachWave(flow, 2);
    expect(flow.enemyKilled({ kind: 'matriarch', elite: true, pos: { x: 0, z: 0 } }).map((e) => e.kind)).not.toContain('victory');
  });

  it('drops a relic when an elite dies and offers its family graft on pickup', () => {
    const flow = new RunFlow(5);
    flow.begin(0);
    reachWave(flow, 1);
    const family = flow.plans[0]!.elites[0]!;
    const dropped = flow.enemyKilled({ kind: family, elite: true, pos: { x: 2, z: 3 } });
    const relic = dropped.find((e) => e.kind === 'relic');
    expect(relic).toMatchObject({ kind: 'relic', family, at: { x: 2, z: 3 } });
    expect(flow.relics).toHaveLength(1);

    const opened = flow.collectRelic(flow.relics[0]!.id);
    const offer = opened.find((e) => e.kind === 'offer');
    expect(offer).toBeDefined();
    expect(flow.phase).toBe('offer');
    expect(flow.offer!.options).toHaveLength(3);
    const lead = flow.offer!.options[0]!;
    expect(lead.type).toBe('graft');
    expect(GRAFTS[lead.id as GraftId].family).toBe(family);
  });

  it('ignores ordinary kills', () => {
    const flow = new RunFlow(5);
    flow.begin(0);
    reachWave(flow, 1);
    expect(flow.enemyKilled({ kind: 'burster', elite: false, pos: { x: 0, z: 0 } })).toEqual([]);
    expect(flow.relics).toHaveLength(0);
  });

  it('opens uncollected relics when the wave clears, and holds the next wave until they are resolved', () => {
    const flow = new RunFlow(5);
    flow.begin(0);
    reachWave(flow, 1);
    flow.enemyKilled({ kind: flow.plans[0]!.elites[0]!, elite: true, pos: { x: 0, z: 0 } });
    const events = advance(flow, 60);
    expect(events.map((e) => e.kind)).toContain('waveCleared');
    expect(events.map((e) => e.kind)).toContain('offer');
    expect(flow.phase).toBe('offer');
    expect(flow.wave).toBe(1);
    expect(started(advance(flow, 30))).toHaveLength(0);
    flow.take(0);
    expect(flow.phase).toBe('intermission');
    expect(started(advance(flow, 10)).length).toBe(1);
  });

  it('equips the taken graft and reports the grafts left behind', () => {
    const flow = new RunFlow(8);
    flow.begin(0);
    reachWave(flow, 1);
    flow.enemyKilled({ kind: flow.plans[0]!.elites[0]!, elite: true, pos: { x: 0, z: 0 } });
    flow.collectRelic(flow.relics[0]!.id);
    const options = flow.offer!.options;
    const events = flow.take(0);
    const graft = options[0]!.id as GraftId;
    expect(events).toContainEqual({ kind: 'equip', graft, slot: GRAFTS[graft].slot, replaced: null });
    const leftGrafts = options.slice(1).filter((o) => o.type === 'graft').map((o) => o.id);
    const reject = events.find((e) => e.kind === 'reject');
    if (leftGrafts.length > 0) expect(reject).toMatchObject({ kind: 'reject', grafts: leftGrafts, reason: 'chose-other' });
    expect(flow.run.loadout[GRAFTS[graft].slot]).toBe(graft);
    expect(flow.phase).toBe('wave');
  });

  it('allows one reroll per arena, still guaranteeing a graft', () => {
    const flow = new RunFlow(9);
    flow.begin(0);
    reachWave(flow, 1);
    flow.enemyKilled({ kind: flow.plans[0]!.elites[0]!, elite: true, pos: { x: 0, z: 0 } });
    flow.enemyKilled({ kind: flow.plans[0]!.elites[0]!, elite: true, pos: { x: 1, z: 0 } });
    flow.collectRelic(flow.relics[0]!.id);
    expect(flow.run.rerolls).toBe(1);
    const rerolled = flow.reroll();
    expect(rerolled.map((e) => e.kind)).toContain('offer');
    expect(flow.offer!.options.some((o) => o.type === 'graft')).toBe(true);
    expect(flow.run.rerolls).toBe(0);
    expect(flow.reroll()).toEqual([]);
    flow.take(0);
    flow.collectRelic(flow.relics[0]!.id);
    expect(flow.reroll()).toEqual([]);
  });

  it('can turn an offer down, rejecting every graft in it', () => {
    const flow = new RunFlow(10);
    flow.begin(0);
    reachWave(flow, 1);
    flow.enemyKilled({ kind: flow.plans[0]!.elites[0]!, elite: true, pos: { x: 0, z: 0 } });
    flow.collectRelic(flow.relics[0]!.id);
    const grafts = flow.offer!.options.filter((o) => o.type === 'graft').map((o) => o.id);
    const events = flow.skip();
    expect(events).toContainEqual(expect.objectContaining({ kind: 'reject', grafts, reason: 'skipped' }));
    expect(flow.run.loadout).toEqual({});
    expect(flow.phase).toBe('wave');
  });

  it('ends in defeat and replays the same plan from the same seed', () => {
    const flow = new RunFlow(21);
    flow.begin(0);
    reachWave(flow, 2);
    flow.heroDied();
    expect(flow.phase).toBe('dying');
    expect(flow.update(1, 0)).toEqual([]);
    flow.finishDeath();
    expect(flow.phase).toBe('defeat');
    expect(flow.run.outcome).toBe('defeat');
    expect(new RunFlow(flow.run.seed).plans).toEqual(flow.plans);
  });

  it('counts run time only while the fight is live', () => {
    const flow = new RunFlow(4);
    flow.begin(0);
    reachWave(flow, 1);
    const before = flow.run.time;
    flow.enemyKilled({ kind: flow.plans[0]!.elites[0]!, elite: true, pos: { x: 0, z: 0 } });
    flow.collectRelic(flow.relics[0]!.id);
    advance(flow, 10);
    expect(flow.run.time).toBeCloseTo(before, 5);
  });
});
