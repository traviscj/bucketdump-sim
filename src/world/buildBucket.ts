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
}

export interface BuiltBucket {
  spec: BucketSpec;
  analysis: Hysteresis;
  /** Achieved tip fill fraction. */
  tipAt: number;
}

const TUNE = { thSteps: 90, vSteps: 40 };
const RHO = 1000;
const MAX_STOP = 1.6;

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

function tipFraction(spec: BucketSpec): { frac: number; h: Hysteresis; model: BucketModel } {
  const model = new BucketModel(spec);
  const h = analyze(model, RHO, TUNE);
  const frac = h.vTip != null ? h.vTip / model.maxCapacity : h.verdict === "overflows" ? 1 : 0;
  return { frac, h, model };
}

/** Dump stop just short of where the empty bucket (with this ballast) would flop over. */
function safeStop(r: BucketRecipe, ballast: number): number {
  const ot = overTheTop(new BucketModel(specFromRecipe(r, ballast, Math.PI)), r.pours === "left" ? 1 : -1, 120);
  return Math.min(MAX_STOP, ot != null ? Math.abs(ot) - 0.15 : MAX_STOP);
}

/** Bisection on ballast: tip volume is monotone in the counterweight. */
function tuneBallast(r: BucketRecipe, target: number): BucketSpec {
  let lo = 0;
  let hi = 60 * r.width * r.height * 4 + 50;
  for (let k = 0; k < 14; k++) {
    const mid = (lo + hi) / 2;
    const { frac, h } = tipFraction(specFromRecipe(r, mid, safeStop(r, mid)));
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
  const offsets = [r.pivotOffset ?? 0.04, 0.06, 0.1, 0.02];
  const heights = [r.pivotHeight ?? 0.25, 0.4, 0.15];
  let best: BuiltBucket | null = null;
  for (const pivotHeight of heights) {
    for (const pivotOffset of offsets) {
      const spec = tuneBallast({ ...r, pivotHeight, pivotOffset }, target);
      const model = new BucketModel(spec);
      const analysis = analyze(model, RHO);
      const tipAt = analysis.vTip != null ? analysis.vTip / model.maxCapacity : 0;
      const built = { spec, analysis, tipAt };
      if (analysis.verdict !== "works") continue;
      if (!best || Math.abs(tipAt - target) < Math.abs(best.tipAt - target)) best = built;
      if (Math.abs(tipAt - target) < 0.05) return best;
    }
  }
  if (best) return best;
  const spec = tuneBallast(r, target);
  return { spec, analysis: analyze(new BucketModel(spec), RHO), tipAt: 0 };
}
