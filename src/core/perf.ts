/** Fixed-window statistics over the last `size` samples. */
export class RollingStats {
  private readonly values: Float32Array;
  private index = 0;
  private count = 0;

  constructor(readonly size = 120) {
    this.values = new Float32Array(size);
  }

  push(v: number): void {
    if (!Number.isFinite(v)) return;
    this.values[this.index] = v;
    this.index = (this.index + 1) % this.size;
    this.count = Math.min(this.size, this.count + 1);
  }

  get length(): number {
    return this.count;
  }

  get avg(): number {
    if (this.count === 0) return NaN;
    let s = 0;
    for (let i = 0; i < this.count; i++) s += this.values[i]!;
    return s / this.count;
  }

  get max(): number {
    let m = 0;
    for (let i = 0; i < this.count; i++) m = Math.max(m, this.values[i]!);
    return m;
  }

  /** Sample `ago` steps back (0 = newest). */
  at(ago: number): number {
    if (ago >= this.count) return NaN;
    return this.values[(this.index - 1 - ago + this.size * 2) % this.size]!;
  }

  clear(): void {
    this.index = 0;
    this.count = 0;
  }
}

/** Steps the render scale down when frames run long and back up when there is headroom. */
export class ResolutionGovernor {
  scale: number;
  private slow = 0;
  private fast = 0;

  constructor(
    readonly max: number,
    readonly min = 0.75,
    readonly step = 0.25,
  ) {
    this.scale = max;
  }

  /**
   * Feed one frame's cost in ms against its budget; returns true when the scale changed.
   * Without a real cost measurement (`allowUp` false) the governor only ever steps down.
   */
  update(costMs: number, budgetMs: number, dt: number, allowUp = true): boolean {
    if (costMs > budgetMs * 0.92) {
      this.slow += dt;
      this.fast = 0;
    } else if (costMs < budgetMs * 0.45) {
      this.fast += dt;
      this.slow = 0;
    } else {
      this.slow = Math.max(0, this.slow - dt);
      this.fast = Math.max(0, this.fast - dt);
    }
    if (this.slow > 1.5 && this.scale > this.min) {
      this.scale = Math.max(this.min, this.scale - this.step);
      this.slow = 0;
      return true;
    }
    if (allowUp && this.fast > 5 && this.scale < this.max) {
      this.scale = Math.min(this.max, this.scale + this.step);
      this.fast = 0;
      return true;
    }
    return false;
  }
}

interface TimerExt {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
}

/** GPU frame time from EXT_disjoint_timer_query_webgl2; unsupported browsers report NaN. */
export class GpuTimer {
  readonly supported: boolean;
  lastMs = NaN;
  private readonly ext: TimerExt | null;
  private readonly pending: WebGLQuery[] = [];
  private active: WebGLQuery | null = null;

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExt | null;
    this.supported = this.ext !== null;
  }

  begin(): void {
    if (!this.ext || this.active || this.pending.length >= 4) return;
    const q = this.gl.createQuery();
    if (!q) return;
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this.active = q;
  }

  end(): void {
    if (!this.ext || !this.active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = null;
  }

  /** Collects finished queries; call once per frame. Returns the newest GPU time or NaN. */
  poll(): number {
    if (!this.ext) return NaN;
    const gl = this.gl;
    const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT) as boolean;
    let latest = NaN;
    while (this.pending.length > 0) {
      const q = this.pending[0]!;
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      const ns = gl.getQueryParameter(q, gl.QUERY_RESULT) as number;
      if (!disjoint) latest = ns / 1e6;
      gl.deleteQuery(q);
      this.pending.shift();
    }
    if (Number.isFinite(latest)) this.lastMs = latest;
    return latest;
  }
}
