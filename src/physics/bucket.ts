import { type Pose, type Vec, rotate, toWorld } from "../geom/vec";
import { type Hysteresis, analyze } from "../analysis/equilibrium";
import { BucketModel, type BucketSpec, type TorqueEval } from "./bucketModel";
import { G } from "./constants";
import { weirRate } from "./fluid";
import { type MaterialId, type Mix, mixCd, mixDensity } from "./materials";

export type BucketPhase = "filling" | "dumping";

export interface SpillOut {
  volume: number;
  /** World position of the lip and a unit vector along the mouth from the lip inward. */
  at: Vec;
  mouthDir: Vec;
  /** Initial velocity of the outflow (world). */
  vel: Vec;
  /** Head above the lip (m) — sets how wide the pour sheet is. */
  head: number;
}

/** Fastest the excess can drain, 1/s, so an inverted bucket doesn't empty in one tick. */
const MAX_DRAIN_RATE = 5;
/** Tilt from rest (rad) past which we call it a dump, and back under which it has reset. */
const DUMP_ANGLE = 0.45;
const RESET_ANGLE = 0.12;
const LIFT_ANGLE = 0.02;

/**
 * A live tipping bucket: the static model plus (θ, ω, V, mix) state, a
 * semi-implicit Euler step with hard stops, and weir spill.
 */
export class Bucket {
  readonly model: BucketModel;
  th: number;
  om = 0;
  volume = 0;
  mix: Mix = {};
  phase: BucketPhase = "filling";
  dumps = 0;
  /** Volume held when the bucket last lifted off its rest (the dynamic fold). */
  lastTipVolume = 0;
  private liftVolume = 0;
  /** External torque from taps/shoves (N·m), decays each step. */
  private shoveTorque = 0;
  last: TorqueEval;
  lastSpillRate = 0;
  /** Smoothed inflow (m²/s), for the time-to-tip countdown. */
  inflowRate = 0;
  private pendingIn = 0;
  private analysisCache: { rho: number; h: Hysteresis } | null = null;

  constructor(readonly spec: BucketSpec) {
    this.model = new BucketModel(spec);
    this.th = Math.max(spec.thMin, Math.min(spec.thMax, 0));
    this.last = this.model.evaluate(this.th, 0, mixDensity(this.mix));
  }

  get density(): number {
    return mixDensity(this.mix);
  }

  /** Local→world pose: the pivot stays fixed while the body rotates about it. */
  get pose(): Pose {
    const pr = rotate(this.spec.pivotLocal, this.th);
    return { x: this.spec.pivot.x - pr.x, y: this.spec.pivot.y - pr.y, th: this.th };
  }

  toWorld(p: Vec): Vec {
    return toWorld(this.pose, p);
  }

  /** Static hysteresis analysis for the current contents' density (cached). */
  get analysis(): Hysteresis {
    const rho = this.density;
    if (!this.analysisCache || Math.abs(this.analysisCache.rho - rho) / rho > 0.05) {
      this.analysisCache = { rho, h: analyze(this.model, rho, { thSteps: 120, vSteps: 60 }) };
    }
    return this.analysisCache.h;
  }

  /** 0 → calm, 1 → about to tip. Drives the ding-ding-ding. */
  get warning(): number {
    if (this.phase !== "filling") return 0;
    const vTip = this.analysis.vTip;
    if (!vTip) return 0;
    return Math.max(0, Math.min(1, (this.volume / vTip - 0.7) / 0.3));
  }

  addFluid(volume: number, material: MaterialId): void {
    if (volume <= 0) return;
    const total = this.volume + volume;
    const next: Mix = {};
    for (const [id, f] of Object.entries(this.mix) as [MaterialId, number][]) next[id] = (f * this.volume) / total;
    next[material] = (next[material] ?? 0) + volume / total;
    this.mix = next;
    this.volume = total;
    this.pendingIn += volume;
  }

  /** Angular impulse from something hitting the bucket at world point `at`. */
  applyImpulse(at: Vec, impulse: Vec): void {
    const r = { x: at.x - this.spec.pivot.x, y: at.y - this.spec.pivot.y };
    this.om += (r.x * impulse.y - r.y * impulse.x) / this.last.inertia;
  }

  /** Seconds until the fill reaches V_tip at the current inflow (∞ if not filling). */
  get eta(): number {
    const vTip = this.analysis.vTip;
    if (this.phase !== "filling" || !vTip || this.inflowRate < 1e-4) return Infinity;
    return Math.max(0, (vTip - this.volume) / this.inflowRate);
  }

  /** A kid-sized shove in the tipping direction (or `dir` to override). */
  shove(dir?: number): void {
    const d = dir ?? (Math.sign(this.analysis.thDump ?? this.spec.thMax) || 1);
    this.shoveTorque = d * (this.last.mass * G * 0.35 + 400);
  }

  empty(): void {
    this.volume = 0;
    this.mix = {};
  }

  /** Advance by `dt`. Returns what poured over the lip this step, if anything. */
  step(dt: number): SpillOut | null {
    const { spec } = this;
    // Inflow EMA with a ~0.7 s time constant (particles arrive in lumps).
    this.inflowRate += (this.pendingIn / dt - this.inflowRate) * (1 - Math.exp(-dt / 0.7));
    this.pendingIn = 0;
    const ev = this.model.evaluate(this.th, this.volume, this.density);
    this.last = ev;

    // Rigid-body update, semi-implicit Euler.
    const alpha = (ev.tau - spec.damping * this.om + this.shoveTorque) / ev.inertia;
    this.shoveTorque *= Math.exp(-dt / 0.25);
    if (Math.abs(this.shoveTorque) < 1) this.shoveTorque = 0;
    this.om += alpha * dt;
    this.th += this.om * dt;
    if (this.th < spec.thMin) {
      this.th = spec.thMin;
      if (this.om < 0) this.om = -this.om * spec.restitution;
    } else if (this.th > spec.thMax) {
      this.th = spec.thMax;
      if (this.om > 0) this.om = -this.om * spec.restitution;
    }

    this.updatePhase();
    return this.spill(ev, dt);
  }

  private updatePhase(): void {
    const tilt = Math.abs(this.th - this.analysis.thRest);
    if (this.phase === "filling" && tilt < LIFT_ANGLE) this.liftVolume = this.volume;
    if (this.phase === "filling" && tilt > DUMP_ANGLE) {
      this.phase = "dumping";
      this.dumps++;
      this.lastTipVolume = this.liftVolume;
    } else if (this.phase === "dumping" && tilt < RESET_ANGLE && Math.abs(this.om) < 0.5) {
      this.phase = "filling";
    }
  }

  private spill(ev: TorqueEval, dt: number): SpillOut | null {
    const f = ev.fluid;
    if (f.excess <= 0) {
      this.lastSpillRate = 0;
      return null;
    }
    const head = f.excess / f.surfaceWidth;
    const rate = Math.min(weirRate(head, mixCd(this.mix), G), f.excess * MAX_DRAIN_RATE + 0.05);
    const out = Math.min(f.excess, rate * dt);
    this.volume -= out;
    this.lastSpillRate = rate;

    // Geometry of the pour in world coordinates.
    const pose = this.pose;
    const lipW = { x: f.lip.x + pose.x, y: f.lip.y + pose.y };
    const cav = this.model.cavity;
    const otherLocal = f.lipSide < 0 ? cav[cav.length - 1] : cav[0];
    const other = rotate(otherLocal, this.th);
    const mdx = other.x - f.lip.x;
    const mdy = other.y - f.lip.y;
    const ml = Math.hypot(mdx, mdy) || 1;
    const mouthDir = { x: mdx / ml, y: mdy / ml };

    // Rim velocity (ω × r) plus outflow directed away from the mouth.
    const r = { x: lipW.x - this.spec.pivot.x, y: lipW.y - this.spec.pivot.y };
    const vRim = { x: -this.om * r.y, y: this.om * r.x };
    const vOut = Math.min(Math.sqrt(2 * G * head), 4);
    return {
      volume: out,
      at: lipW,
      mouthDir,
      vel: { x: vRim.x - mouthDir.x * vOut, y: vRim.y - mouthDir.y * vOut * 0.3 },
      head,
    };
  }
}
