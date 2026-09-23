import { bounds, contains, transform } from "../geom/polygon";
import type { Vec } from "../geom/vec";
import { Bucket } from "../physics/bucket";
import { circleContact, reflect, segmentContact, segmentsCross } from "../physics/collide";
import { DEPTH, G } from "../physics/constants";
import { MATERIALS, type Material, type MaterialId, sampleMix } from "../physics/materials";
import { ParticlePool } from "../physics/particles";
import { Rng } from "./rng";
import type { PersonSpec, PipeSpec, Scenario } from "./scenario";

export type SimEvent =
  | { type: "tip"; bucket: string; volume: number }
  | { type: "reset"; bucket: string }
  | { type: "splash"; x: number; y: number; volume: number; speed: number; material: MaterialId }
  | { type: "soak"; person: string; wetness: number }
  | { type: "thunk"; bucket: string; speed: number };

export class Person {
  wet = 0;
  lastHit = -1;
  constructor(readonly spec: PersonSpec) {}
  /** Volume (m²) that fully soaks a person. */
  static readonly SOAK = 0.12;
  get width(): number {
    return this.spec.height * 0.32;
  }
}

interface BucketGeo {
  b: Bucket;
  cav: { x: number; y: number }[];
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** Book-keeping so tests (and the dashboard) can check volume conservation. */
export interface FlowStats {
  poured: number;
  grounded: number;
  soaked: number;
  lost: number;
}

/** Seconds during which a bucket can't recapture what it just poured. */
const RECAPTURE_GRACE = 0.2;
const FIXED_DT = 1 / 120;
const WALL_IMPULSE_SHARE = 0.25;
const BUCKET_SUBSTEPS = 2;

/** The whole simulated scene: pipes → particles → buckets → particles → ground/people. */
export class World {
  readonly buckets: Bucket[];
  readonly people: Person[];
  readonly particles: ParticlePool;
  readonly rng: Rng;
  time = 0;
  /** Global speed multiplier for the valves (the "master" lever). */
  master = 1;
  paused = false;
  events: SimEvent[] = [];
  stats: FlowStats = { poured: 0, grounded: 0, soaked: 0, lost: 0 };
  /** Splash'em points: each hit scores by how dry its target still was (spread the love). */
  points = 0;
  /** Which bucket each particle came from (−1 = a pipe), for the recapture grace. */
  private readonly src: Int16Array;
  private pipeAccum: number[];
  private spillAccum: number[];
  private accumulator = 0;
  /** Scratch kinematics for the particle being stepped (no per-particle allocation). */
  private readonly kin = { x: 0, y: 0, vx: 0, vy: 0 };

  constructor(
    readonly scenario: Scenario,
    maxParticles = 6000,
  ) {
    this.buckets = scenario.buckets.map((b) => new Bucket(b));
    this.people = scenario.people.map((p) => new Person(p));
    this.particles = new ParticlePool(maxParticles);
    this.src = new Int16Array(maxParticles);
    this.rng = new Rng(scenario.seed ?? 1);
    this.pipeAccum = scenario.pipes.map(() => 0);
    this.spillAccum = scenario.buckets.map(() => 0);
  }

  get pipes(): PipeSpec[] {
    return this.scenario.pipes;
  }

  /** Advance by wall-clock `dt` using fixed substeps; returns the number taken. */
  advance(dt: number, timeScale = 1): number {
    if (this.paused) return 0;
    this.accumulator += Math.min(dt, 0.1) * timeScale;
    let n = 0;
    while (this.accumulator >= FIXED_DT) {
      this.step(FIXED_DT);
      this.accumulator -= FIXED_DT;
      n++;
    }
    return n;
  }

  step(dt: number): void {
    this.time += dt;
    this.emitPipes(dt);
    const h = dt / BUCKET_SUBSTEPS;
    this.buckets.forEach((b, bi) => {
      const wasPhase = b.phase;
      const wasOm = b.om;
      for (let k = 0; k < BUCKET_SUBSTEPS; k++) {
        const spill = b.step(h);
        if (spill) this.emitSpill(bi, spill.volume, spill.at, spill.mouthDir, spill.vel, spill.head);
      }
      if (wasPhase !== b.phase) {
        this.events.push(
          b.phase === "dumping"
            ? { type: "tip", bucket: b.spec.id, volume: b.lastTipVolume }
            : { type: "reset", bucket: b.spec.id },
        );
      }
      // A sudden stop of a fast swing = it hit a mechanical stop.
      if (Math.abs(wasOm) > 1.2 && Math.abs(b.om) < Math.abs(wasOm) * 0.5) {
        this.events.push({ type: "thunk", bucket: b.spec.id, speed: Math.abs(wasOm) });
      }
    });
    this.stepParticles(dt);
  }

  private emitPipes(dt: number): void {
    const P = this.particles;
    this.pipes.forEach((pipe, i) => {
      const rate = pipe.flow * pipe.valve * this.master;
      if (rate <= 0) return;
      const mat = MATERIALS[pipe.material];
      this.pipeAccum[i] += rate * dt;
      this.stats.poured += rate * dt;
      const dx = Math.cos(pipe.angle);
      const dy = Math.sin(pipe.angle);
      while (this.pipeAccum[i] >= mat.particleVolume) {
        this.pipeAccum[i] -= mat.particleVolume;
        const j = (this.rng.next() - 0.5) * 0.08;
        const sp = pipe.speed * (0.9 + 0.2 * this.rng.next());
        const k = P.emit(
          pipe.x - dy * j,
          pipe.y + dx * j,
          dx * sp + (this.rng.next() - 0.5) * 0.2,
          dy * sp,
          mat.particleVolume,
          pipe.material,
          this.rng.int(0, 255),
        );
        this.src[k] = -1;
      }
    });
  }

  private emitSpill(bi: number, volume: number, at: Vec, mouthDir: Vec, vel: Vec, head: number): void {
    const b = this.buckets[bi];
    this.spillAccum[bi] += volume;
    const P = this.particles;
    const sheet = Math.min(0.35, 0.05 + head * 2);
    // The dominant material sets the particle size for this pour.
    let guard = 0;
    while (guard++ < 200) {
      const mat = MATERIALS[sampleMix(b.mix, this.rng.next())];
      if (this.spillAccum[bi] < mat.particleVolume) break;
      this.spillAccum[bi] -= mat.particleVolume;
      const u = this.rng.next();
      // Start just outside the lip so the particle doesn't re-enter immediately.
      const x = at.x + mouthDir.x * u * sheet - mouthDir.x * mat.radius;
      const y = at.y + mouthDir.y * u * sheet - Math.abs(mouthDir.x) * 0.01;
      const k = P.emit(
        x,
        y,
        vel.x * (0.85 + 0.3 * this.rng.next()),
        vel.y + (this.rng.next() - 0.5) * 0.4,
        mat.particleVolume,
        mat.id,
        this.rng.int(0, 255),
      );
      this.src[k] = bi;
    }
  }

  private stepParticles(dt: number): void {
    const P = this.particles;
    const geo = this.bucketGeometry();
    const { minX, maxX } = this.scenario.view;
    const k = this.kin;

    for (let i = 0; i < P.count; i++) {
      const mat = MATERIALS[P.material(i)];
      const x0 = P.x[i];
      const y0 = P.y[i];
      // Gravity + linear drag, then a straight-line move; collisions fix it up.
      const damp = 1 - mat.drag * dt;
      k.vx = P.vx[i] * damp;
      k.vy = (P.vy[i] - G * dt) * damp;
      k.x = x0 + k.vx * dt;
      k.y = y0 + k.vy * dt;
      P.age[i] += dt;

      let gone = this.bucketContact(i, mat, x0, y0, geo);
      if (!gone) {
        this.sceneryContact(mat);
        gone = this.personContact(i, mat) || this.groundContact(i, mat) || this.escaped(i, minX, maxX);
      }
      if (gone) {
        P.kill(i--);
        continue;
      }
      P.x[i] = k.x;
      P.y[i] = k.y;
      P.vx[i] = k.vx;
      P.vy[i] = k.vy;
    }
  }

  /** Per-step bucket cavities in world coordinates, with padded AABBs for culling. */
  private bucketGeometry(): BucketGeo[] {
    return this.buckets.map((b) => {
      const cav = transform(b.model.cavity, b.pose);
      const bb = bounds(cav);
      const pad = b.spec.wall + 0.1;
      return { b, cav, minX: bb.minX - pad, maxX: bb.maxX + pad, minY: bb.minY - pad, maxY: bb.maxY + pad };
    });
  }

  /**
   * Capture by a bucket (inside its cavity, or crossed its mouth this step)
   * transferring volume and momentum; otherwise bounce off its walls.
   * Returns true if the particle was captured.
   */
  private bucketContact(i: number, mat: Material, x0: number, y0: number, geo: BucketGeo[]): boolean {
    const P = this.particles;
    const k = this.kin;
    const mass = P.vol[i] * DEPTH * mat.density;
    for (let bi = 0; bi < geo.length; bi++) {
      const { b, cav, minX, maxX, minY, maxY } = geo[bi];
      if (k.x < minX || k.x > maxX || k.y < minY || k.y > maxY) continue;
      if (this.src[i] === bi && P.age[i] < RECAPTURE_GRACE) continue;
      const n = cav.length;
      const p = { x: k.x, y: k.y };
      if (contains(cav, p) || segmentsCross({ x: x0, y: y0 }, p, cav[n - 1], cav[0])) {
        b.addFluid(P.vol[i], mat.id);
        b.applyImpulse(p, { x: mass * k.vx, y: mass * k.vy });
        return true;
      }
      // Walls are capsules; the surface moves with the bucket (ω × r).
      for (let s = 0; s < n - 1; s++) {
        const c = segmentContact(k.x, k.y, mat.radius + b.spec.wall / 2, cav[s], cav[s + 1]);
        if (!c) continue;
        const sx = -b.om * (k.y - b.spec.pivot.y);
        const sy = b.om * (k.x - b.spec.pivot.x);
        const nv = reflect(k.vx, k.vy, c.nx, c.ny, mat.restitution, 0.1, sx, sy);
        // Only part of a splash's momentum reaches the bucket (the rest sprays
        // sideways); full transfer lets a stream pin an empty bucket over.
        const m = mass * WALL_IMPULSE_SHARE;
        b.applyImpulse({ x: k.x, y: k.y }, { x: -m * (nv.vx - k.vx), y: -m * (nv.vy - k.vy) });
        k.vx = nv.vx;
        k.vy = nv.vy;
        k.x += c.nx * c.depth;
        k.y += c.ny * c.depth;
      }
    }
    return false;
  }

  /** Pegs (plinko) and ramps. */
  private sceneryContact(mat: Material): void {
    const k = this.kin;
    for (const p of this.scenario.pegs) {
      const c = circleContact(k.x, k.y, mat.radius, p.x, p.y, p.r);
      if (c) this.bounce(c, Math.max(mat.restitution, 0.35), 0.05);
    }
    for (const rp of this.scenario.ramps) {
      const c = segmentContact(k.x, k.y, mat.radius + 0.03, rp.a, rp.b);
      if (c) this.bounce(c, mat.restitution * 0.5, 0.02);
    }
  }

  private bounce(c: { nx: number; ny: number; depth: number }, e: number, friction: number): void {
    const k = this.kin;
    const v = reflect(k.vx, k.vy, c.nx, c.ny, e, friction);
    k.vx = v.vx;
    k.vy = v.vy;
    k.x += c.nx * c.depth;
    k.y += c.ny * c.depth;
  }

  /** Soak a person; liquids are absorbed (true), solids bounce off. */
  private personContact(i: number, mat: Material): boolean {
    const k = this.kin;
    if (!this.hitPerson(i, k.x, k.y, mat.radius)) return false;
    if (mat.restitution < 0.3) {
      this.stats.soaked += this.particles.vol[i];
      return true;
    }
    k.vx = -k.vx * 0.5;
    k.vy = Math.abs(k.vy) * mat.restitution;
    return false;
  }

  /** Splash on first touch; liquids and tired solids are absorbed (true). */
  private groundContact(i: number, mat: Material): boolean {
    const P = this.particles;
    const k = this.kin;
    if (k.y >= mat.radius) return false;
    const speed = Math.hypot(k.vx, k.vy);
    if (P.hits[i] === 0) this.events.push({ type: "splash", x: k.x, y: 0, volume: P.vol[i], speed, material: mat.id });
    if (mat.restitution < 0.3 || P.hits[i] > 5 || speed < 0.3) {
      this.stats.grounded += P.vol[i];
      return true;
    }
    P.hits[i]++;
    k.y = mat.radius;
    const v = reflect(k.vx, k.vy, 0, 1, mat.restitution, 0.2);
    k.vx = v.vx;
    k.vy = v.vy;
    return false;
  }

  private escaped(i: number, minX: number, maxX: number): boolean {
    const k = this.kin;
    if (k.x > minX - 3 && k.x < maxX + 3 && this.particles.age[i] <= 20) return false;
    this.stats.lost += this.particles.vol[i];
    return true;
  }

  private hitPerson(i: number, x: number, y: number, r: number): boolean {
    for (const p of this.people) {
      const h = p.spec.height;
      const hw = p.width / 2;
      if (y > h + r || y < 0 || Math.abs(x - p.spec.x) > hw + r) continue;
      const before = p.wet;
      const dw = this.particles.vol[i] / Person.SOAK;
      this.points += 100 * dw * (1 - p.wet);
      p.wet = Math.min(1, p.wet + dw);
      p.lastHit = this.time;
      if (Math.floor(before * 4) !== Math.floor(p.wet * 4)) {
        this.events.push({ type: "soak", person: p.spec.id, wetness: p.wet });
      }
      return true;
    }
    return false;
  }

  /** Everything currently accounted for; equals `stats.poured` (+ what the pool recycled). */
  accountedVolume(): number {
    const held = this.buckets.reduce((s, b) => s + b.volume, 0);
    const pending = this.pipeAccum.reduce((s, v) => s + v, 0) + this.spillAccum.reduce((s, v) => s + v, 0);
    return held + pending + this.particles.totalVolume() + this.stats.grounded + this.stats.soaked + this.stats.lost + this.particles.dropped;
  }

  drainEvents(): SimEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  /** Horizontal extent people may roam (the framed content). */
  renderBounds(): { minX: number; maxX: number } {
    return { minX: this.scenario.view.minX, maxX: this.scenario.view.maxX };
  }

  bucket(id: string): Bucket | undefined {
    return this.buckets.find((b) => b.spec.id === id);
  }

  /** Splash'em score (≤ 100 per person, with diminishing returns per person). */
  get score(): number {
    return Math.round(this.points);
  }
}
