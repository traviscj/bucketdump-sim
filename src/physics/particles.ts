import { MATERIALS, MATERIAL_IDS, type MaterialId } from "./materials";

/**
 * Struct-of-arrays particle pool. Particles carry volume, so a stream that
 * lands in a bucket delivers exactly what left the pipe or lip.
 * When the pool is full the oldest particle is recycled (its volume is lost —
 * a deliberate render-budget tradeoff, reported via `dropped`).
 */
export class ParticlePool {
  readonly cap: number;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly vol: Float32Array;
  readonly age: Float32Array;
  readonly mat: Uint8Array;
  /** Per-particle palette index for multi-coloured materials. */
  readonly tint: Uint8Array;
  /** Bounces so far (for grounded solids that should settle and fade). */
  readonly hits: Uint8Array;
  count = 0;
  dropped = 0;
  private cursor = 0;

  constructor(cap = 6000) {
    this.cap = cap;
    this.x = new Float32Array(cap);
    this.y = new Float32Array(cap);
    this.vx = new Float32Array(cap);
    this.vy = new Float32Array(cap);
    this.vol = new Float32Array(cap);
    this.age = new Float32Array(cap);
    this.mat = new Uint8Array(cap);
    this.tint = new Uint8Array(cap);
    this.hits = new Uint8Array(cap);
  }

  emit(x: number, y: number, vx: number, vy: number, vol: number, mat: MaterialId, tint = 0): number {
    let i: number;
    if (this.count < this.cap) {
      i = this.count++;
    } else {
      // Recycle round-robin: approximately the oldest.
      i = this.cursor;
      this.cursor = (this.cursor + 1) % this.cap;
      this.dropped += this.vol[i];
    }
    this.x[i] = x;
    this.y[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.vol[i] = vol;
    this.age[i] = 0;
    this.mat[i] = MATERIAL_IDS.indexOf(mat);
    this.tint[i] = tint;
    this.hits[i] = 0;
    return i;
  }

  /** Remove particle i by swapping in the last one. Callers iterating must revisit index i. */
  kill(i: number): void {
    const j = --this.count;
    if (i !== j) {
      this.x[i] = this.x[j];
      this.y[i] = this.y[j];
      this.vx[i] = this.vx[j];
      this.vy[i] = this.vy[j];
      this.vol[i] = this.vol[j];
      this.age[i] = this.age[j];
      this.mat[i] = this.mat[j];
      this.tint[i] = this.tint[j];
      this.hits[i] = this.hits[j];
    }
    if (this.cursor >= this.count) this.cursor = 0;
  }

  material(i: number): MaterialId {
    return MATERIAL_IDS[this.mat[i]];
  }

  radius(i: number): number {
    return MATERIALS[MATERIAL_IDS[this.mat[i]]].radius;
  }

  totalVolume(): number {
    let v = 0;
    for (let i = 0; i < this.count; i++) v += this.vol[i];
    return v;
  }

  clear(): void {
    this.count = 0;
    this.cursor = 0;
  }
}
