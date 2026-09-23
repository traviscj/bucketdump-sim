import { type Polygon, area } from "../geom/polygon";
import { type Vec, rotate } from "../geom/vec";
import { DEPTH, G } from "./constants";
import { type FluidState, solveFluid } from "./fluid";
import { type ShapeSpec, cavityPolygon, wallSegments } from "./shapes";

/** Static description of a bucket: everything but its motion state. */
export interface BucketSpec {
  id: string;
  shape: ShapeSpec;
  /** Axle position in the world. */
  pivot: Vec;
  /** Axle position in the bucket's local frame (origin = inside bottom centre). */
  pivotLocal: Vec;
  /** Mass of the bucket shell, kg. */
  shellMass: number;
  /** Counterweight mass (kg) at `ballastLocal`. Heavier = harder to tip. */
  ballast: number;
  ballastLocal?: Vec;
  /** Bearing viscous friction, N·m·s. */
  damping: number;
  /** Mechanical stops, radians (CCW positive). */
  thMin: number;
  thMax: number;
  restitution: number;
  wall: number;
  color: string;
}

export interface TorqueEval {
  /** Net gravitational torque about the pivot (N·m, CCW +). */
  tau: number;
  /** Moment of inertia about the pivot, kg·m². */
  inertia: number;
  /** Total mass and combined centre of mass (rotated-local, pivot-relative). */
  mass: number;
  com: Vec;
  fluid: FluidState;
  /** Fluid mass including the excess above the lip. */
  fluidMass: number;
}

/**
 * Precomputes shell mass properties and evaluates torque/inertia for a given
 * tilt and fill. Pure: used by both the live bucket and the offline analysis.
 */
export class BucketModel {
  readonly cavity: Polygon;
  readonly maxCapacity: number;
  /** Shell COM and inertia about the local origin. */
  private readonly shellCom: Vec;
  private readonly shellInertiaOrigin: number;
  readonly ballastLocal: Vec;

  constructor(readonly spec: BucketSpec) {
    this.cavity = cavityPolygon(spec.shape);
    this.maxCapacity = area(this.cavity);
    this.ballastLocal = spec.ballastLocal ?? { x: 0, y: -spec.wall * 1.5 };

    // Thin-walled shell: uniform linear density along the wall polyline.
    const segs = wallSegments(this.cavity);
    const lens = segs.map(([a, b]) => Math.hypot(b.x - a.x, b.y - a.y));
    const total = lens.reduce((s, l) => s + l, 0);
    const lam = spec.shellMass / total;
    let cx = 0;
    let cy = 0;
    let io = 0;
    segs.forEach(([a, b], i) => {
      const m = lam * lens[i];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      cx += m * mid.x;
      cy += m * mid.y;
      io += m * (lens[i] ** 2 / 12 + mid.x ** 2 + mid.y ** 2);
    });
    this.shellCom = { x: cx / spec.shellMass, y: cy / spec.shellMass };
    this.shellInertiaOrigin = io;
  }

  /** Solve the fluid and sum torques at tilt `th` holding `volume` of density `rho`. */
  evaluate(th: number, volume: number, rho: number, dropExcess = false): TorqueEval {
    const { spec } = this;
    let fluid = solveFluid(this.cavity, th, volume);
    // Quasi-static analysis: anything above the lip has already poured away.
    if (dropExcess && fluid.excess > 0) fluid = { ...fluid, excess: 0 };
    const pr = rotate(spec.pivotLocal, th);
    const rel = (p: Vec): Vec => ({ x: p.x - pr.x, y: p.y - pr.y });

    const shellR = rel(rotate(this.shellCom, th));
    const ballR = rel(rotate(this.ballastLocal, th));
    const wR = rel(fluid.centroid);
    const exR = rel(fluid.lip);

    const kgPerArea = rho * DEPTH;
    const mw = fluid.volume * kgPerArea;
    const mx = fluid.excess * kgPerArea;
    const ms = spec.shellMass;
    const mb = spec.ballast;

    const mass = ms + mb + mw + mx;
    const com = {
      x: (ms * shellR.x + mb * ballR.x + mw * wR.x + mx * exR.x) / mass,
      y: (ms * shellR.y + mb * ballR.y + mw * wR.y + mx * exR.y) / mass,
    };
    const tau = -G * mass * com.x;

    // Parallel axis: shell inertia about origin → about its COM → about the pivot.
    const shellCom2 = this.shellCom.x ** 2 + this.shellCom.y ** 2;
    const shellI = this.shellInertiaOrigin - ms * shellCom2 + ms * (shellR.x ** 2 + shellR.y ** 2);
    // Fluid: the free surface doesn't co-rotate, so count only half its own spin inertia.
    const fluidSpin = fluid.volume > 0 ? 0.5 * kgPerArea * fluid.polarMoment : 0;
    const inertia =
      shellI +
      mb * (ballR.x ** 2 + ballR.y ** 2) +
      mw * (wR.x ** 2 + wR.y ** 2) +
      fluidSpin +
      mx * (exR.x ** 2 + exR.y ** 2) +
      1e-3;

    return { tau, inertia, mass, com, fluid, fluidMass: mw + mx };
  }
}
