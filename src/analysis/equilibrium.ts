import { BucketModel } from "../physics/bucketModel";

/**
 * Static stability analysis of a bucket: the equilibrium set of
 *   τ(θ, V) = 0   (V = retained volume, excess poured off),
 * traced as V grows (fill) and shrinks (dump). The fill branch ends at a
 * saddle-node fold V_tip; the tipped branch folds back at V_ret. The pair is the
 * hysteresis loop you see in the ∂ panel.
 */
export interface EqPoint {
  v: number;
  th: number;
  stable: boolean;
  /** Equilibrium held by a mechanical stop rather than a torque zero. */
  stop: boolean;
}

export type Verdict = "works" | "overflows" | "stuck" | "unstable";

export interface Hysteresis {
  verdict: Verdict;
  thRest: number;
  vTip: number | null;
  thTip: number | null;
  thDump: number | null;
  vRet: number | null;
  /** Retained volume at the dumped angle (what is left right after the tip). */
  vHeldDumped: number | null;
  vMax: number;
  points: EqPoint[];
}

export interface AnalysisOptions {
  thSteps?: number;
  vSteps?: number;
  /** A tracked equilibrium moving more than this in one V step counts as a jump. */
  jumpTol?: number;
}

/** All equilibria at a given retained volume. */
export function equilibria(model: BucketModel, v: number, rho: number, thSteps = 160): EqPoint[] {
  const { thMin, thMax } = model.spec;
  const ths: number[] = [];
  const taus: number[] = [];
  for (let i = 0; i <= thSteps; i++) {
    const th = thMin + ((thMax - thMin) * i) / thSteps;
    ths.push(th);
    taus.push(retainedTorque(model, th, v, rho));
  }
  const out: EqPoint[] = [];
  if (taus[0] < 0) out.push({ v, th: thMin, stable: true, stop: true });
  for (let i = 0; i < thSteps; i++) {
    const a = taus[i];
    const b = taus[i + 1];
    // Half-open test so a root landing exactly on a grid point is counted once.
    if (a !== 0 && ((a > 0 && b <= 0) || (a < 0 && b >= 0))) {
      const t = a / (a - b);
      out.push({ v, th: ths[i] + (ths[i + 1] - ths[i]) * t, stable: a > 0, stop: false });
    }
  }
  if (taus[thSteps] > 0) out.push({ v, th: thMax, stable: true, stop: true });
  return out;
}

export function retainedTorque(model: BucketModel, th: number, v: number, rho: number): number {
  return model.evaluate(th, v, rho, true).tau;
}

function nearestStable(eqs: EqPoint[], th: number): EqPoint | null {
  let best: EqPoint | null = null;
  for (const e of eqs) {
    if (e.stable && (!best || Math.abs(e.th - th) < Math.abs(best.th - th))) best = e;
  }
  return best;
}

export function analyze(model: BucketModel, rho: number, opts: AnalysisOptions = {}): Hysteresis {
  const thSteps = opts.thSteps ?? 160;
  const vSteps = opts.vSteps ?? 80;
  const jumpTol = opts.jumpTol ?? Math.max(0.2, (model.spec.thMax - model.spec.thMin) / 12);
  const vMax = model.maxCapacity;
  const vs = Array.from({ length: vSteps + 1 }, (_, i) => (vMax * i) / vSteps);
  const eqAt = vs.map((v) => equilibria(model, v, rho, thSteps));
  const points = eqAt.flat();

  const base: Hysteresis = {
    verdict: "unstable",
    thRest: 0,
    vTip: null,
    thTip: null,
    thDump: null,
    vRet: null,
    vHeldDumped: null,
    vMax,
    points,
  };

  // Empty rest angle: the stable equilibrium closest to upright.
  const rest = nearestStable(eqAt[0], 0);
  if (!rest || Math.abs(rest.th) > 0.6) return base;
  base.thRest = rest.th;
  // An empty bucket with a second resting place (e.g. flopped over against the
  // far stop) will get stuck there after a vigorous dump.
  const trapped = eqAt[0].some((e) => e.stable && Math.abs(e.th - rest.th) > jumpTol);
  if (trapped) return { ...base, verdict: "stuck" };

  // Fill: follow the rest branch until it folds or the bucket brims over.
  let th = rest.th;
  let tipIdx = -1;
  for (let i = 1; i <= vSteps; i++) {
    const cap = model.evaluate(th, 0, rho).fluid.capacity;
    if (vs[i] >= cap) return { ...base, verdict: "overflows", vTip: null, thTip: th };
    const e = nearestStable(eqAt[i], th);
    if (!e || Math.abs(e.th - th) > jumpTol) {
      tipIdx = i;
      break;
    }
    th = e.th;
  }
  if (tipIdx < 0) return { ...base, verdict: "overflows", thTip: th };

  // Refine the fold volume by bisection on "branch still exists near th".
  let lo = vs[tipIdx - 1];
  let hi = vs[tipIdx];
  for (let k = 0; k < 12; k++) {
    const mid = (lo + hi) / 2;
    const e = nearestStable(equilibria(model, mid, rho, thSteps), th);
    if (e && Math.abs(e.th - th) <= jumpTol) {
      lo = mid;
      th = e.th;
    } else hi = mid;
  }
  const vTip = lo;
  const thTip = th;

  // Which way does it go? Follow the torque sign just past the fold.
  const dir = Math.sign(retainedTorque(model, thTip, hi, rho)) || 1;
  const dumpEqs = equilibria(model, hi, rho, thSteps).filter((e) => e.stable && (e.th - thTip) * dir > jumpTol / 2);
  if (dumpEqs.length === 0) return { ...base, verdict: "stuck", vTip, thTip };
  const dump = dumpEqs.reduce((a, b) => (Math.abs(b.th - thTip) < Math.abs(a.th - thTip) ? b : a));

  // Dump: the bucket pours down to what it can hold at the dumped angle, then drains.
  const held = Math.min(vTip, model.evaluate(dump.th, 0, rho).fluid.capacity);
  let thD = dump.th;
  let vRet: number | null = null;
  const nDown = 60;
  for (let i = 0; i <= nDown; i++) {
    const v = held * (1 - i / nDown);
    const e = nearestStable(equilibria(model, v, rho, thSteps), thD);
    if (!e || Math.abs(e.th - thD) > jumpTol) {
      vRet = v;
      break;
    }
    thD = e.th;
  }
  // A dumped branch that slides continuously back to rest also counts as a return.
  const returned = vRet !== null || Math.abs(thD - base.thRest) <= jumpTol;
  if (vRet === null && returned) vRet = 0;
  return {
    ...base,
    verdict: returned ? "works" : "stuck",
    vTip,
    thTip,
    thDump: dump.th,
    vRet,
    vHeldDumped: held,
  };
}

/**
 * Angle at which the *empty* bucket goes over the top (its first unstable
 * equilibrium beyond rest in direction `dir`), or null if it never does.
 * A dump stop must sit short of this or the bucket can flop over and stay.
 */
export function overTheTop(model: BucketModel, dir: 1 | -1, thSteps = 240): number | null {
  const probe = new BucketModel({
    ...model.spec,
    thMin: dir > 0 ? model.spec.thMin : -Math.PI,
    thMax: dir > 0 ? Math.PI : model.spec.thMax,
  });
  const eqs = equilibria(probe, 0, 1000, thSteps)
    .filter((e) => !e.stable && !e.stop && e.th * dir > 0.05)
    .sort((a, b) => Math.abs(a.th) - Math.abs(b.th));
  return eqs.length ? eqs[0].th : null;
}
