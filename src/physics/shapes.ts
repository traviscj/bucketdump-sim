import type { Polygon } from "../geom/polygon";
import type { Vec } from "../geom/vec";

/**
 * Bucket cavity shapes. Every generator returns a CCW polygon in the bucket's
 * local frame (origin at the inside-bottom, +y toward the opening) such that
 * the closing edge — last vertex → first vertex — is the open mouth:
 * `cavity[0]` is the left rim and `cavity[n-1]` the right rim.
 */
export type ShapeKind = "rect" | "flared" | "vee" | "scoop" | "round";

export interface ShapeSpec {
  kind: ShapeKind;
  /** Mouth width (m). */
  width: number;
  /** Cavity depth (m). */
  height: number;
  /** flared: bottom width as a fraction of `width`; scoop: right-rim height fraction. */
  ratio?: number;
  /** Mirror left↔right (e.g. a scoop that pours left). */
  mirror?: boolean;
}

export const SHAPE_KINDS: ShapeKind[] = ["rect", "flared", "vee", "scoop", "round"];

export function cavityPolygon(spec: ShapeSpec): Polygon {
  const poly = baseCavity(spec);
  // Reversing after negating x keeps CCW winding and the left-rim-first convention.
  return spec.mirror ? poly.map((p) => ({ x: -p.x, y: p.y })).reverse() : poly;
}

function baseCavity(spec: ShapeSpec): Polygon {
  const w = spec.width;
  const h = spec.height;
  const hw = w / 2;
  switch (spec.kind) {
    case "rect":
      return [
        { x: -hw, y: h },
        { x: -hw, y: 0 },
        { x: hw, y: 0 },
        { x: hw, y: h },
      ];
    case "flared": {
      const hb = (w * (spec.ratio ?? 0.6)) / 2;
      return [
        { x: -hw, y: h },
        { x: -hb, y: 0 },
        { x: hb, y: 0 },
        { x: hw, y: h },
      ];
    }
    case "vee":
      // A tiny flat keeps the polygon non-degenerate at the tip.
      return [
        { x: -hw, y: h },
        { x: -0.02 * w, y: 0 },
        { x: 0.02 * w, y: 0 },
        { x: hw, y: h },
      ];
    case "scoop": {
      // Low right lip: always pours to the right.
      const hr = h * (spec.ratio ?? 0.65);
      return [
        { x: -hw, y: h },
        { x: -hw, y: 0 },
        { x: hw * 0.8, y: 0 },
        { x: hw, y: hr },
      ];
    }
    case "round": {
      // Straight sides down to a semicircular bottom.
      const r = Math.min(hw, h);
      const pts: Vec[] = [{ x: -hw, y: h }];
      const segs = 12;
      for (let i = 0; i <= segs; i++) {
        const a = Math.PI + (Math.PI * i) / segs; // π → 2π, left → bottom → right
        pts.push({ x: hw * Math.cos(a), y: r + r * Math.sin(a) });
      }
      pts.push({ x: hw, y: h });
      // Drop duplicate points where the arc meets a zero-length side.
      return pts.filter((p, i) => i === 0 || Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) > 1e-9);
    }
  }
}

/** The wall polyline (cavity minus the open mouth), used for shell mass and drawing. */
export function wallSegments(cavity: Polygon): [Vec, Vec][] {
  const segs: [Vec, Vec][] = [];
  for (let i = 0; i < cavity.length - 1; i++) segs.push([cavity[i], cavity[i + 1]]);
  return segs;
}

/**
 * Outer outline of a wall of thickness `t`: the cavity polyline offset
 * outward, closed back along the cavity. Good enough for convex-ish shapes.
 */
export function wallOutline(cavity: Polygon, t: number): Polygon {
  const n = cavity.length;
  const outer: Vec[] = [];
  for (let i = 0; i < n; i++) {
    // Average outward normal of adjacent wall edges (CCW polygon → outward = right-hand normal).
    const prev = i > 0 ? cavity[i - 1] : null;
    const next = i < n - 1 ? cavity[i + 1] : null;
    let nx = 0;
    let ny = 0;
    const p = cavity[i];
    for (const [a, b] of [
      [prev, p],
      [p, next],
    ] as const) {
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const l = Math.hypot(dx, dy) || 1;
      nx += dy / l;
      ny += -dx / l;
    }
    const l = Math.hypot(nx, ny) || 1;
    // Miter length correction, capped to avoid spikes on sharp corners.
    const miter = Math.min(2.5, 1 / Math.max(0.4, Math.hypot(nx, ny) / 2));
    outer.push({ x: p.x + (nx / l) * t * miter, y: p.y + (ny / l) * t * miter });
  }
  return [...cavity, ...outer.reverse()];
}
