import type { RollingStats } from '../core/perf';

export interface PerfSnapshot {
  frame: RollingStats;
  cpu: RollingStats;
  gpu: RollingStats;
  gpuSupported: boolean;
  budgetMs: number;
  draws: number;
  triangles: number;
  width: number;
  height: number;
  scale: number;
  enemies: number;
  shots: number;
  voices: string;
}

const STORE_KEY = 'cairnheart.stats';
const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const fmtK = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));

/** Always-on-top stats strip: FPS, CPU and GPU frame cost with a scrolling graph. Not a modal. */
export class PerfPanel {
  visible = false;
  private readonly root = byId('perf');
  private readonly fps = byId('perf-fps');
  private readonly frameMs = byId('perf-frame');
  private readonly cpu = byId('perf-cpu');
  private readonly cpuPct = byId('perf-cpu-pct');
  private readonly gpu = byId('perf-gpu');
  private readonly gpuPct = byId('perf-gpu-pct');
  private readonly detail = byId('perf-detail');
  private readonly canvas = byId<HTMLCanvasElement>('perf-graph');
  private readonly ctx = this.canvas.getContext('2d');
  private readonly button = byId<HTMLButtonElement>('stats');
  private textIn = 0;

  constructor(initial: boolean) {
    this.set(initial || PerfPanel.stored());
  }

  private static stored(): boolean {
    try {
      return window.localStorage.getItem(STORE_KEY) === '1';
    } catch {
      return false;
    }
  }

  toggle(): void {
    this.set(!this.visible);
    try {
      window.localStorage.setItem(STORE_KEY, this.visible ? '1' : '0');
    } catch {
      // storage blocked; the toggle still works for this session
    }
  }

  update(dt: number, s: PerfSnapshot): void {
    if (!this.visible) return;
    this.drawGraph(s);
    this.textIn -= dt;
    if (this.textIn > 0) return;
    this.textIn = 0.25;
    const frame = s.frame.avg;
    const fps = frame > 0 ? 1000 / frame : NaN;
    this.fps.textContent = Number.isFinite(fps) ? fps.toFixed(0) : '--';
    this.fps.classList.toggle('is-bad', fps < 45);
    this.frameMs.textContent = Number.isFinite(frame) ? `${frame.toFixed(1)} ms` : '';
    const cpu = s.cpu.avg;
    this.cpu.textContent = `${cpu.toFixed(1)} ms`;
    this.cpuPct.textContent = `${Math.round((cpu / s.budgetMs) * 100)}% of frame`;
    if (s.gpuSupported && Number.isFinite(s.gpu.avg)) {
      const gpu = s.gpu.avg;
      this.gpu.textContent = `${gpu.toFixed(1)} ms`;
      this.gpuPct.textContent = `${Math.round((gpu / s.budgetMs) * 100)}% of frame`;
    } else {
      this.gpu.textContent = 'n/a';
      this.gpuPct.textContent = s.gpuSupported ? 'measuring' : 'browser hides it';
    }
    this.detail.textContent =
      `${s.draws} draws · ${fmtK(s.triangles)} tris · ${s.width}×${s.height} @${s.scale.toFixed(2)}x\n` +
      `${s.enemies} enemies · ${s.shots} shards · voices ${s.voices}`;
  }

  private set(visible: boolean): void {
    this.visible = visible;
    this.root.hidden = !visible;
    this.button.setAttribute('aria-pressed', String(visible));
  }

  private drawGraph(s: PerfSnapshot): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const { width: w, height: h } = this.canvas;
    const ceiling = s.budgetMs * 2;
    const y = (ms: number) => h - Math.min(1, ms / ceiling) * h;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(0, Math.round(y(s.budgetMs)), w, 1);
    const n = Math.min(w, s.frame.length);
    for (let i = 0; i < n; i++) {
      const x = w - 1 - i;
      const frame = s.frame.at(i);
      ctx.fillStyle = frame > s.budgetMs * 1.35 ? 'rgba(229,67,75,0.85)' : 'rgba(255,179,71,0.55)';
      ctx.fillRect(x, y(frame), 1, h - y(frame));
      const cpu = s.cpu.at(i);
      if (Number.isFinite(cpu)) {
        ctx.fillStyle = 'rgba(180,107,255,0.95)';
        ctx.fillRect(x, y(cpu), 1, 1);
      }
      const gpu = s.gpu.at(i);
      if (Number.isFinite(gpu)) {
        ctx.fillStyle = 'rgba(157,255,154,0.95)';
        ctx.fillRect(x, y(gpu), 1, 1);
      }
    }
  }
}
