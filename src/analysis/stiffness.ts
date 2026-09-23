import type { Bucket } from "../physics/bucket";
import { G } from "../physics/constants";

export interface Stability {
  /** Rotational stiffness k = −∂τ/∂θ (N·m/rad); negative = unstable. */
  k: number;
  /** Small-oscillation period (s) about the current angle, or NaN if unstable. */
  period: number;
  /** Effective "metacentric height" k/(M·g) in metres: + stable, − capsizing. */
  gm: number;
}

/** Linearised stability at the bucket's current state (central difference). */
export function stability(b: Bucket, h = 0.004): Stability {
  const rho = b.density;
  const v = b.last.fluid.volume;
  const tp = b.model.evaluate(b.th + h, v, rho, true).tau;
  const tm = b.model.evaluate(b.th - h, v, rho, true).tau;
  const k = -(tp - tm) / (2 * h);
  const period = k > 0 ? (2 * Math.PI) / Math.sqrt(k / b.last.inertia) : NaN;
  return { k, period, gm: k / (b.last.mass * G) };
}

/**
 * Potential-energy landscape U(θ) = −∫τ dθ at a fixed fill, for the "ball in a
 * valley" plot. Returns samples over the bucket's travel, U(θmin) = 0.
 */
export function landscape(b: Bucket, volume: number, n = 80): { th: number[]; u: number[] } {
  const { thMin, thMax } = b.spec;
  const rho = b.density;
  const th: number[] = [];
  const u: number[] = [];
  let acc = 0;
  let prev = 0;
  for (let i = 0; i <= n; i++) {
    const t = thMin + ((thMax - thMin) * i) / n;
    const tau = b.model.evaluate(t, volume, rho, true).tau;
    if (i > 0) acc -= ((prev + tau) / 2) * ((thMax - thMin) / n);
    th.push(t);
    u.push(acc);
    prev = tau;
  }
  return { th, u };
}
