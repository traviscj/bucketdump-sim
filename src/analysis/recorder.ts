/**
 * Fixed-capacity columnar ring buffer for time series (the ∂ panel traces).
 * Columns are Float32Arrays; `get(col, k)` indexes oldest→newest.
 */
export class Ring<C extends string> {
  private readonly data: Record<C, Float32Array>;
  private head = 0;
  size = 0;

  constructor(
    readonly columns: readonly C[],
    readonly capacity: number,
  ) {
    this.data = Object.fromEntries(columns.map((c) => [c, new Float32Array(capacity)])) as Record<C, Float32Array>;
  }

  push(row: Record<C, number>): void {
    for (const c of this.columns) this.data[c][this.head] = row[c];
    this.head = (this.head + 1) % this.capacity;
    this.size = Math.min(this.size + 1, this.capacity);
  }

  /** k-th sample, 0 = oldest retained. */
  get(col: C, k: number): number {
    const start = (this.head - this.size + this.capacity) % this.capacity;
    return this.data[col][(start + k) % this.capacity];
  }

  last(col: C): number {
    return this.size ? this.get(col, this.size - 1) : NaN;
  }

  extent(col: C): [number, number] {
    let lo = Infinity;
    let hi = -Infinity;
    for (let k = 0; k < this.size; k++) {
      const v = this.get(col, k);
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    return [lo, hi];
  }

  clear(): void {
    this.head = 0;
    this.size = 0;
  }
}

export const TRACE_COLUMNS = ["t", "th", "om", "v", "tau", "spill"] as const;
export type TraceColumn = (typeof TRACE_COLUMNS)[number];

/** Samples every bucket's state at a fixed rate of sim time. */
export class Recorder {
  readonly traces = new Map<string, Ring<TraceColumn>>();
  private nextT = 0;

  constructor(
    readonly hz = 30,
    readonly seconds = 60,
  ) {}

  sample(
    t: number,
    buckets: readonly { spec: { id: string }; th: number; om: number; volume: number; last: { tau: number }; lastSpillRate: number }[],
  ): void {
    if (t < this.nextT) return;
    this.nextT = t + 1 / this.hz;
    for (const b of buckets) {
      let ring = this.traces.get(b.spec.id);
      if (!ring) {
        ring = new Ring(TRACE_COLUMNS, this.hz * this.seconds);
        this.traces.set(b.spec.id, ring);
      }
      ring.push({ t, th: b.th, om: b.om, v: b.volume, tau: b.last.tau, spill: b.lastSpillRate });
    }
  }

  reset(): void {
    this.traces.clear();
    this.nextT = 0;
  }
}
