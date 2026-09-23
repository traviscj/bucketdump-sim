import { bounds, contains, transform } from "../geom/polygon";
import type { Vec } from "../geom/vec";
import { Bucket } from "../physics/bucket";
import { circleContact, reflect, segmentContact, segmentsCross } from "../physics/collide";
import { DEPTH, G } from "../physics/constants";
import { MATERIALS, type MaterialId, sampleMix } from "../physics/materials";
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
  static readonly SOAK = 0.04;
  get width(): number {
    return this.spec.height * 0.32;
  }
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
  /** Which bucket each particle came from (−1 = a pipe), for the recapture grace. */
  private readonly src: Int16Array;
  private pipeAccum: number[];
  private spillAccum: number[];
  private accumulator = 0;

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
    const { pegs, ramps } = this.scenario;
    // Per-step bucket geometry in world coordinates.
    const geo = this.buckets.map((b) => {
      const pose = b.pose;
      const cav = transform(b.model.cavity, pose);
      const bb = bounds(cav);
      const pad = b.spec.wall + 0.1;
      return { b, cav, minX: bb.minX - pad, maxX: bb.maxX + pad, minY: bb.minY - pad, maxY: bb.maxY + pad };
    });
    const { minX, maxX } = this.scenario.view;

    for (let i = 0; i < P.count; i++) {
      const mat = MATERIALS[P.material(i)];
      const r = mat.radius;
      const x0 = P.x[i];
      const y0 = P.y[i];
      let vx = P.vx[i];
      let vy = P.vy[i] - G * dt;
      const damp = 1 - mat.drag * dt;
      vx *= damp;
      vy *= damp;
      let x = x0 + vx * dt;
      let y = y0 + vy * dt;
      P.age[i] += dt;

      // 1) Captured by a bucket? (inside the cavity, or crossed the mouth this step)
      let captured = false;
      for (let bi = 0; bi < geo.length; bi++) {
        const g = geo[bi];
        if (x < g.minX || x > g.maxX || y < g.minY || y > g.maxY) continue;
        if (this.src[i] === bi && P.age[i] < RECAPTURE_GRACE) continue;
        const cav = g.cav;
        const n = cav.length;
        const inside = contains(cav, { x, y }) || segmentsCross({ x: x0, y: y0 }, { x, y }, cav[n - 1], cav[0]);
        if (inside) {
          const m = P.vol[i] * DEPTH * mat.density;
          g.b.addFluid(P.vol[i], mat.id);
          g.b.applyImpulse({ x, y }, { x: m * vx, y: m * vy });
          captured = true;
          break;
        }
        // 2) Otherwise bounce off the bucket's walls (treated as capsules).
        for (let s = 0; s < n - 1; s++) {
          const c = segmentContact(x, y, r + g.b.spec.wall / 2, cav[s], cav[s + 1]);
          if (!c) continue;
          const b = g.b;
          const sx = -b.om * (y - b.spec.pivot.y);
          const sy = b.om * (x - b.spec.pivot.x);
          const nv = reflect(vx, vy, c.nx, c.ny, mat.restitution, 0.1, sx, sy);
          // Only part of a splash's momentum reaches the bucket (the rest sprays
          // sideways); full transfer lets a stream pin an empty bucket over.
          const m = P.vol[i] * DEPTH * mat.density * WALL_IMPULSE_SHARE;
          b.applyImpulse({ x, y }, { x: -m * (nv.vx - vx), y: -m * (nv.vy - vy) });
          vx = nv.vx;
          vy = nv.vy;
          x += c.nx * c.depth;
          y += c.ny * c.depth;
        }
      }
      if (captured) {
        P.kill(i--);
        continue;
      }

      // 3) Static scenery.
      for (const p of pegs) {
        const c = circleContact(x, y, r, p.x, p.y, p.r);
        if (!c) continue;
        ({ vx, vy } = reflect(vx, vy, c.nx, c.ny, Math.max(mat.restitution, 0.35), 0.05));
        x += c.nx * c.depth;
        y += c.ny * c.depth;
      }
      for (const rp of ramps) {
        const c = segmentContact(x, y, r + 0.03, rp.a, rp.b);
        if (!c) continue;
        ({ vx, vy } = reflect(vx, vy, c.nx, c.ny, mat.restitution * 0.5, 0.02));
        x += c.nx * c.depth;
        y += c.ny * c.depth;
      }

      // 4) People.
      if (this.hitPerson(i, x, y, r)) {
        if (mat.restitution < 0.3) {
          this.stats.soaked += P.vol[i];
          P.kill(i--);
          continue;
        }
        vx = -vx * 0.5;
        vy = Math.abs(vy) * mat.restitution;
      }

      // 5) Ground.
      if (y < r) {
        const speed = Math.hypot(vx, vy);
        if (P.hits[i] === 0) {
          this.events.push({ type: "splash", x, y: 0, volume: P.vol[i], speed, material: mat.id });
        }
        if (mat.restitution < 0.3 || P.hits[i] > 5 || speed < 0.3) {
          this.stats.grounded += P.vol[i];
          P.kill(i--);
          continue;
        }
        P.hits[i]++;
        y = r;
        ({ vx, vy } = reflect(vx, vy, 0, 1, mat.restitution, 0.2));
      }

      if (x < minX - 3 || x > maxX + 3 || P.age[i] > 20) {
        this.stats.lost += P.vol[i];
        P.kill(i--);
        continue;
      }
      P.x[i] = x;
      P.y[i] = y;
      P.vx[i] = vx;
      P.vy[i] = vy;
    }
  }

  private hitPerson(i: number, x: number, y: number, r: number): boolean {
    for (const p of this.people) {
      const h = p.spec.height;
      const hw = p.width / 2;
      if (y > h + r || y < 0 || Math.abs(x - p.spec.x) > hw + r) continue;
      const before = p.wet;
      p.wet = Math.min(1, p.wet + this.particles.vol[i] / Person.SOAK);
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

  bucket(id: string): Bucket | undefined {
    return this.buckets.find((b) => b.spec.id === id);
  }

  /** Splash'em score: soaked-ness summed over the crowd, 0–100 per person. */
  get score(): number {
    return Math.round(this.people.reduce((s, p) => s + p.wet * 100, 0));
  }
}
