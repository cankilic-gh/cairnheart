import { describe, expect, it } from 'vitest';
import { EventLog } from '../../src/debug/eventLog';

const make = () => {
  let clock = 0;
  let ms = 0;
  const log = new EventLog(
    () => clock,
    () => ms,
  );
  return {
    log,
    advance: (s: number) => {
      clock += s;
      ms += s * 1000;
    },
  };
};

describe('event log', () => {
  it('records first input and first damage once per run', () => {
    const { log, advance } = make();
    log.startRun({ seed: 7, retry: false });
    advance(1.5);
    log.input('keyboard');
    log.input('gamepad');
    log.damage({ amount: 16.333, attack: 'shot', enemy: 'spitter', elite: false, wave: 2 });
    log.damage({ amount: 40, attack: 'blast', enemy: 'burster', elite: true, wave: 2 });
    const types = log.entries.map((e) => e.type);
    expect(types).toEqual(['runStart', 'firstInput', 'firstDamage']);
    expect(log.entries[1]!.data).toEqual({ device: 'keyboard', afterMs: 1500 });
    expect(log.entries[2]!.data).toMatchObject({ amount: 16.33, attack: 'shot', enemy: 'spitter' });
    log.startRun({ seed: 7, retry: true });
    log.input('touch');
    expect(log.entries.filter((e) => e.type === 'firstInput')).toHaveLength(2);
  });

  it('stamps entries with run number and run clock', () => {
    const { log, advance } = make();
    log.startRun({ seed: 1, retry: false });
    advance(42.123);
    log.push('runePick', { rune: 'echo' });
    expect(log.entries.at(-1)).toMatchObject({ run: 1, type: 'runePick', t: 42.12, data: { rune: 'echo' } });
  });

  it('exports plain JSON', () => {
    const { log } = make();
    log.startRun({ seed: 3, retry: false });
    log.push('death', { enemy: 'skitter' });
    const out = JSON.parse(JSON.stringify(log.export('test')));
    expect(out).toMatchObject({ game: 'cairnheart', runs: 1, userAgent: 'test' });
    expect(out.entries).toHaveLength(2);
  });
});
