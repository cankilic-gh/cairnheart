export type LogType =
  | 'runStart'
  | 'firstInput'
  | 'firstDamage'
  | 'graftOffer'
  | 'graftAccept'
  | 'graftReject'
  | 'reroll'
  | 'runePick'
  | 'death'
  | 'runEnd'
  | 'retry';

export interface LogEntry {
  /** 1-based run number within this session. */
  run: number;
  type: LogType;
  /** Run clock (live fighting seconds) when it happened. */
  t: number;
  /** Milliseconds since the page loaded. */
  ms: number;
  data: Record<string, unknown>;
}

export interface LogExport {
  game: 'cairnheart';
  build: 'grafted-greybox';
  exportedAt: string;
  userAgent: string;
  runs: number;
  entries: LogEntry[];
}

const round = (n: number): number => Math.round(n * 100) / 100;

/**
 * Playtest event log: first input, first damage and its source, graft offers and choices, rune
 * picks, death cause, run length and retries. Kept in memory for the session; exported as JSON.
 */
export class EventLog {
  readonly entries: LogEntry[] = [];
  run = 0;
  private sawInput = false;
  private sawDamage = false;
  private startMs = 0;

  constructor(
    private readonly clock: () => number,
    private readonly now: () => number = () => performance.now(),
  ) {}

  startRun(data: { seed: number; retry: boolean }): void {
    this.run += 1;
    this.sawInput = false;
    this.sawDamage = false;
    this.startMs = this.now();
    this.push('runStart', data);
  }

  input(device: string): void {
    if (this.sawInput || this.run === 0) return;
    this.sawInput = true;
    this.push('firstInput', { device, afterMs: Math.round(this.now() - this.startMs) });
  }

  damage(data: { amount: number; attack: string; enemy: string; elite: boolean; wave: number }): void {
    if (this.sawDamage || this.run === 0) return;
    this.sawDamage = true;
    this.push('firstDamage', { ...data, amount: round(data.amount) });
  }

  push(type: LogType, data: Record<string, unknown> = {}): void {
    this.entries.push({ run: this.run, type, t: round(this.clock()), ms: Math.round(this.now()), data });
  }

  /** Wall-clock seconds since the current run started. */
  get wallSeconds(): number {
    return round((this.now() - this.startMs) / 1000);
  }

  export(userAgent = ''): LogExport {
    return {
      game: 'cairnheart',
      build: 'grafted-greybox',
      exportedAt: new Date().toISOString(),
      userAgent,
      runs: this.run,
      entries: this.entries.map((e) => ({ ...e, data: { ...e.data } })),
    };
  }

  /** Saves the log as a JSON file through a temporary download link. */
  download(): void {
    const json = JSON.stringify(this.export(navigator.userAgent), null, 2);
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `cairnheart-log-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
