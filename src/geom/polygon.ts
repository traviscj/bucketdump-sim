import { type Vec, type Pose, toWorld } from "./vec";

/** A simple polygon as a vertex list (either winding; area is signed). */
export type Polygon = Vec[];

/** Signed area (shoelace). Positive for CCW winding. */
export function signedArea(poly: Polygon): number {
  let a = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export const area = (poly: Polygon): number => Math.abs(signedArea(poly));

/** Mass properties of a uniform lamina: area, centroid, polar second moment about the centroid. */
export interface MassProps {
  area: number;
  centroid: Vec;
  /** ∫ r² dA about the centroid (divide by area for radius of gyration²). */
  polarMoment: number;
}

export function massProps(poly: Polygon): MassProps {
  let a2 = 0; // twice the signed area
  let cx = 0;
  let cy = 0;
  let jo = 0; // ∫(x²+y²) about origin, times 12
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % n];
    const c = p.x * q.y - q.x * p.y;
    a2 += c;
    cx += (p.x + q.x) * c;
    cy += (p.y + q.y) * c;
    jo += c * (p.x * p.x + p.x * q.x + q.x * q.x + p.y * p.y + p.y * q.y + q.y * q.y);
  }
  if (Math.abs(a2) < 1e-14) {
    return { area: 0, centroid: meanPoint(poly), polarMoment: 0 };
  }
  const centroid = { x: cx / (3 * a2), y: cy / (3 * a2) };
  const signedA = a2 / 2;
  // Parallel-axis theorem to move from origin to centroid; sign-normalise for CW input.
  const jOrigin = jo / 12;
  const jc = jOrigin - signedA * (centroid.x ** 2 + centroid.y ** 2);
  return { area: Math.abs(signedA), centroid, polarMoment: Math.abs(jc) };
}

export function meanPoint(poly: Polygon): Vec {
  if (poly.length === 0) return { x: 0, y: 0 };
  let x = 0;
  let y = 0;
  for (const p of poly) {
    x += p.x;
    y += p.y;
  }
  return { x: x / poly.length, y: y / poly.length };
}

/**
 * Sutherland–Hodgman clip against the half-plane `y ≤ h`. Correct for any
 * simple polygon when clipping by a single line (the result may be a
 * degenerate "multi-piece" polygon joined along the line, whose area and
 * moments are still exact — which is all the fluid solver needs).
 */
export function clipBelow(poly: Polygon, h: number): Polygon {
  const out: Polygon = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % n];
    const pIn = p.y <= h;
    const qIn = q.y <= h;
    if (pIn) out.push(p);
    if (pIn !== qIn) {
      const t = (h - p.y) / (q.y - p.y);
      out.push({ x: p.x + (q.x - p.x) * t, y: h });
    }
  }
  return out;
}

export const transform = (poly: Polygon, pose: Pose): Polygon => poly.map((p) => toWorld(pose, p));

/** Even–odd point-in-polygon test. */
export function contains(poly: Polygon, pt: Vec): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > pt.y !== b.y > pt.y && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

export function bounds(poly: Polygon): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of poly) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

/** Closest point on segment ab to p, with the parameter t∈[0,1]. */
export function closestOnSegment(a: Vec, b: Vec, p: Vec): { pt: Vec; t: number } {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const l2 = abx * abx + aby * aby;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / l2)) : 0;
  return { pt: { x: a.x + abx * t, y: a.y + aby * t }, t };
}
