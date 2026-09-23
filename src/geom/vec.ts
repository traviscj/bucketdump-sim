/** Minimal immutable 2D vector helpers. Plain objects keep the sim serialisable. */
export interface Vec {
  x: number;
  y: number;
}

export const vec = (x: number, y: number): Vec => ({ x, y });
export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec, s: number): Vec => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Vec, b: Vec): number => a.x * b.x + a.y * b.y;
/** z-component of the 3D cross product a×b. */
export const cross = (a: Vec, b: Vec): number => a.x * b.y - a.y * b.x;
export const len = (a: Vec): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y);
export const lerp = (a: Vec, b: Vec, t: number): Vec => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

/** Rotate `p` by angle `th` (radians, CCW) about the origin. */
export function rotate(p: Vec, th: number): Vec {
  const c = Math.cos(th);
  const s = Math.sin(th);
  return { x: c * p.x - s * p.y, y: s * p.x + c * p.y };
}

/** Rigid transform: rotate by `th` about the origin, then translate by `t`. */
export interface Pose {
  x: number;
  y: number;
  th: number;
}

export function toWorld(pose: Pose, p: Vec): Vec {
  const r = rotate(p, pose.th);
  return { x: r.x + pose.x, y: r.y + pose.y };
}

export function toLocal(pose: Pose, p: Vec): Vec {
  return rotate({ x: p.x - pose.x, y: p.y - pose.y }, -pose.th);
}

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
