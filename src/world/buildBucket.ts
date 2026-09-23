import { type Hysteresis, analyze, overTheTop } from "../analysis/equilibrium";
import type { Vec } from "../geom/vec";
import { BucketModel, type BucketSpec } from "../physics/bucketModel";
import type { ShapeKind } from "../physics/shapes";

/**
 * High-level, "always works" way to make a bucket: say how big, which way it
 * pours and how full it should get before tipping; the counterweight and
 * dump stop are solved for.
 */
export interface BucketRecipe {
  id: string;
  pivot: Vec;
  kind: ShapeKind;
  width: number;
  height: number;
  pours: "left" | "right";
  /** Target tip fill fraction, 0.3–0.9. */
  tipAt: number;
  /** Axle height as a fraction of cavity height. */
  pivotHeight?: number;
  /** Axle offset toward the heavy side, as a fraction of width. */
  pivotOffset?: number;
  shellMass?: number;
  damping?: number;
  color: string;
  ratio?: number;
  /** Density of what it will hold (kg/m³); light fills need less counterweight. */
  density?: number;
}

export interface BuiltBucket {
  spec: BucketSpec;
  analysis: Hysteresis;
  /** Achieved tip fill fraction. */
  tipAt: number;
  /**
   * Swings back even if a pipe keeps it brim-full at the dump stop. Without
   * this, a strong enough pipe can hold the bucket tipped forever.
   */
  returnsWhileFed: boolean;
}

/** Torque at the dump stop with the bucket holding all it can there; must pull back toward rest. */
export function returnsWhileFed(spec: BucketSpec, rho: number): boolean {
  const model = new BucketModel(spec);
  const stop = spec.thMax > 0 ? spec.thMax : spec.thMin;
  const cap = model.evaluate(stop, 0, rho).fluid.capacity;
  const tau = model.evaluate(stop, cap, rho, true).tau;
  // Pull back with at least ~5% of the empty bucket's weight-torque scale.
  const scale = 0.05 * (spec.shellMass + spec.ballast) * 9.81 * spec.shape.width;
  return -Math.sign(stop) * tau > scale;
}

const TUNE = { thSteps: 90, vSteps: 40 };
const RHO = 1000;
const MAX_STOP = 1.6;
/** Keep the dump stop this far (rad) short of over-the-top so the empty bucket swings back firmly. */
const STOP_MARGIN = 0.3;

export function specFromRecipe(r: BucketRecipe, ballast: number, thStop = MAX_STOP): BucketSpec {
  const s = r.pours === "left" ? 1 : -1;
  const w = r.width;
  const h = r.height;
  return {
    id: r.id,
    // The base scoop's low lip is on the right; mirror it for left-pourers.
    shape: { kind: r.kind, width: w, height: h, ratio: r.ratio, mirror: r.kind === "scoop" && r.pours === "left" },
    pivot: r.pivot,
    pivotLocal: { x: s * (r.pivotOffset ?? 0.04) * w, y: (r.pivotHeight ?? 0.25) * h },
    shellMass: r.shellMass ?? 40 * w * h + 20,
    ballast,
    ballastLocal: { x: (s * w) / 2, y: 0 },
    damping: r.damping ?? 25 * w * h,
    thMin: s > 0 ? 0 : -thStop,
    thMax: s > 0 ? thStop : 0,
    restitution: 0.25,
    wall: Math.max(0.03, 0.04 * w),
    color: r.color,
  };
}

function tipFraction(spec: BucketSpec, rho: number): { frac: number; h: Hysteresis; model: BucketModel } {
  const model = new BucketModel(spec);
  const h = analyze(model, rho, TUNE);
  const frac = h.vTip != null ? h.vTip / model.maxCapacity : h.verdict === "overflows" ? 1 : 0;
  return { frac, h, model };
}

/** Dump stop just short of where the empty bucket (with this ballast) would flop over. */
function safeStop(r: BucketRecipe, ballast: number): number {
  const ot = overTheTop(new BucketModel(specFromRecipe(r, ballast, Math.PI)), r.pours === "left" ? 1 : -1, 120);
  return Math.min(MAX_STOP, ot != null ? Math.abs(ot) - STOP_MARGIN : MAX_STOP);
}

/** Bisection on ballast: tip volume is monotone in the counterweight. */
function tuneBallast(r: BucketRecipe, target: number): BucketSpec {
  let lo = 0;
  let hi = 60 * r.width * r.height * 4 + 50;
  for (let k = 0; k < 14; k++) {
    const mid = (lo + hi) / 2;
    const { frac, h } = tipFraction(specFromRecipe(r, mid, safeStop(r, mid)), r.density ?? RHO);
    // "overflows" = too much counterweight; "stuck"/"unstable" = too little.
    if (h.verdict === "overflows" || frac > target) hi = mid;
    else lo = mid;
  }
  return specFromRecipe(r, lo, safeStop(r, lo));
}

/**
 * Solve ballast and a safe dump stop for the recipe. If the requested axle
 * placement can't hit the target, nudge it through a few known-good
 * alternatives and keep the closest working result.
 */
export function buildBucket(r: BucketRecipe): BuiltBucket {
  const target = Math.max(0.3, Math.min(0.9, r.tipAt));
  const rho = r.density ?? RHO;
  const offsets = [r.pivotOffset ?? 0.04, 0.06, 0.1, 0.02];
  const heights = [r.pivotHeight ?? 0.25, 0.4, 0.15, 0.55];
  let best: BuiltBucket | null = null;
  // Prefer buckets that return even while fed, then the closest tip fill.
  const better = (a: BuiltBucket, b: BuiltBucket | null) =>
    !b ||
    (a.returnsWhileFed && !b.returnsWhileFed) ||
    (a.returnsWhileFed === b.returnsWhileFed && Math.abs(a.tipAt - target) < Math.abs(b.tipAt - target));
  for (const pivotHeight of heights) {
    for (const pivotOffset of offsets) {
      const spec = tuneBallast({ ...r, pivotHeight, pivotOffset }, target);
      const model = new BucketModel(spec);
      const analysis = analyze(model, rho);
      if (analysis.verdict !== "works") continue;
      const built: BuiltBucket = {
        spec,
        analysis,
        tipAt: analysis.vTip! / model.maxCapacity,
        returnsWhileFed: returnsWhileFed(spec, rho),
      };
      if (better(built, best)) best = built;
      if (best?.returnsWhileFed && Math.abs(best.tipAt - target) < 0.05) return best;
    }
  }
  if (best) return best;
  const spec = tuneBallast(r, target);
  return { spec, analysis: analyze(new BucketModel(spec), rho), tipAt: 0, returnsWhileFed: false };
}

/** Where the pour lands horizontally-ish: the lip's world x with the bucket against its dump stop. */
export function pourX(spec: BucketSpec): number {
  const model = new BucketModel(spec);
  const th = spec.thMax > 0 ? spec.thMax : spec.thMin;
  const c = model.cavity;
  const rim = th > 0 ? c[0] : c[c.length - 1];
  const rel = { x: rim.x - spec.pivotLocal.x, y: rim.y - spec.pivotLocal.y };
  return spec.pivot.x + Math.cos(th) * rel.x - Math.sin(th) * rel.y;
}
