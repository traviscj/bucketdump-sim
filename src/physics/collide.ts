import type { Vec } from "../geom/vec";

/** Result of resolving a moving point against a static collider. */
export interface Hit {
  /** Contact normal (unit, pointing away from the collider). */
  nx: number;
  ny: number;
}

/**
 * Push a particle of radius r at (x,y) out of a circle, returning the
 * normal if it was touching. Mutates nothing; the caller reflects velocity.
 */
export function circleContact(x: number, y: number, r: number, cx: number, cy: number, cr: number) {
  const dx = x - cx;
  const dy = y - cy;
  const rr = r + cr;
  const d2 = dx * dx + dy * dy;
  if (d2 >= rr * rr || d2 === 0) return null;
  const d = Math.sqrt(d2);
  return { nx: dx / d, ny: dy / d, depth: rr - d };
}

/** Contact of a disc with a segment ab (two-sided). */
export function segmentContact(x: number, y: number, r: number, a: Vec, b: Vec) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const l2 = abx * abx + aby * aby;
  let t = l2 > 0 ? ((x - a.x) * abx + (y - a.y) * aby) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const px = a.x + abx * t;
  const py = a.y + aby * t;
  const dx = x - px;
  const dy = y - py;
  const d2 = dx * dx + dy * dy;
  if (d2 >= r * r) return null;
  const d = Math.sqrt(d2);
  if (d < 1e-9) {
    // Exactly on the line: use the segment's left normal.
    const l = Math.sqrt(l2) || 1;
    return { nx: -aby / l, ny: abx / l, depth: r };
  }
  return { nx: dx / d, ny: dy / d, depth: r - d };
}

/** Do segments p0→p1 and a→b intersect? */
export function segmentsCross(p0: Vec, p1: Vec, a: Vec, b: Vec): boolean {
  const d1 = orient(a, b, p0);
  const d2 = orient(a, b, p1);
  const d3 = orient(p0, p1, a);
  const d4 = orient(p0, p1, b);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

const orient = (a: Vec, b: Vec, c: Vec): number => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

/**
 * Reflect velocity (vx,vy) off a surface with normal n and surface velocity
 * (sx,sy): normal component bounces with restitution e, tangential keeps
 * (1−friction). Returns the new velocity.
 */
export function reflect(vx: number, vy: number, nx: number, ny: number, e: number, friction: number, sx = 0, sy = 0) {
  const rx = vx - sx;
  const ry = vy - sy;
  const vn = rx * nx + ry * ny;
  if (vn >= 0) return { vx, vy };
  const tx = rx - vn * nx;
  const ty = ry - vn * ny;
  return {
    vx: sx + tx * (1 - friction) - e * vn * nx,
    vy: sy + ty * (1 - friction) - e * vn * ny,
  };
}
