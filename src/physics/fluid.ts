import { type Polygon, area, clipBelow, massProps } from "../geom/polygon";
import { type Vec, rotate } from "../geom/vec";

/**
 * Quasi-static fluid in a tilted cavity. Everything here works in the
 * "rotated local" frame: the cavity rotated by θ about the local origin but not
 * translated, so gravity is −y and the free surface is horizontal.
 */
export interface FluidState {
  /** Retained volume (≤ capacity). */
  volume: number;
  /** Volume above the lip, draining over the weir. */
  excess: number;
  /** Free-surface height (rotated-local y). */
  level: number;
  /** Fluid region polygon (rotated-local). Empty when dry. */
  poly: Polygon;
  centroid: Vec;
  polarMoment: number;
  capacity: number;
  /** Lowest point of the mouth: where overflow pours out (rotated-local). */
  lip: Vec;
  /** Which rim is the lip: -1 left rim (cavity[0]), +1 right rim (cavity[n-1]). */
  lipSide: -1 | 1;
  /** Width of the free surface, used to turn excess volume into weir head. */
  surfaceWidth: number;
}

export const rotatePoly = (poly: Polygon, th: number): Polygon => poly.map((p) => rotate(p, th));

export function lipOf(rot: Polygon): { lip: Vec; lipSide: -1 | 1 } {
  const left = rot[0];
  const right = rot[rot.length - 1];
  return left.y < right.y ? { lip: left, lipSide: -1 } : { lip: right, lipSide: 1 };
}

/** Horizontal extent of the polygon's cross-section at height y. */
export function widthAt(poly: Polygon, y: number): number {
  const xs: number[] = [];
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % n];
    if ((p.y <= y && q.y > y) || (q.y <= y && p.y > y)) {
      xs.push(p.x + ((y - p.y) / (q.y - p.y)) * (q.x - p.x));
    }
  }
  if (xs.length < 2) return 0;
  xs.sort((a, b) => a - b);
  let w = 0;
  for (let i = 0; i + 1 < xs.length; i += 2) w += xs[i + 1] - xs[i];
  return w;
}

function minY(poly: Polygon): number {
  let m = Infinity;
  for (const p of poly) m = Math.min(m, p.y);
  return m;
}

/** Cavity capacity at tilt θ: area below the lowest mouth point. */
export function capacity(cavity: Polygon, th: number): number {
  const rot = rotatePoly(cavity, th);
  return area(clipBelow(rot, lipOf(rot).lip.y));
}

/**
 * Solve for the free-surface level holding `volume`, by bisection on
 * A(h) = area(cavity ∩ {y ≤ h}), which is monotone in h.
 */
export function solveFluid(cavity: Polygon, th: number, volume: number): FluidState {
  const rot = rotatePoly(cavity, th);
  const { lip, lipSide } = lipOf(rot);
  const floor = minY(rot);
  const full = clipBelow(rot, lip.y);
  const cap = lip.y > floor ? area(full) : 0;
  const retained = Math.max(0, Math.min(volume, cap));
  const excess = Math.max(0, volume - cap);

  let level: number;
  let poly: Polygon;
  if (retained <= 1e-12) {
    level = floor;
    poly = [];
  } else if (retained >= cap - 1e-12) {
    level = lip.y;
    poly = full;
  } else {
    let lo = floor;
    let hi = lip.y;
    for (let i = 0; i < 48 && hi - lo > 1e-9; i++) {
      const mid = (lo + hi) / 2;
      if (area(clipBelow(rot, mid)) < retained) lo = mid;
      else hi = mid;
    }
    level = (lo + hi) / 2;
    poly = clipBelow(rot, level);
  }
  const mp = poly.length >= 3 ? massProps(poly) : { centroid: { x: lip.x, y: floor }, polarMoment: 0 };
  return {
    volume: retained,
    excess,
    level,
    poly,
    centroid: mp.centroid,
    polarMoment: mp.polarMoment,
    capacity: cap,
    lip,
    lipSide,
    surfaceWidth: Math.max(widthAt(rot, level - 1e-9), 1e-3),
  };
}

/** 2D weir discharge (m²/s) for head `H` above the lip. */
export function weirRate(head: number, cd: number, g: number): number {
  return head <= 0 ? 0 : (2 / 3) * cd * Math.sqrt(2 * g) * Math.pow(head, 1.5);
}
