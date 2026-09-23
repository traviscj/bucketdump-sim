import { describe, expect, it } from "vitest";
import { area } from "../src/geom/polygon";
import { capacity, solveFluid, weirRate, widthAt } from "../src/physics/fluid";
import { SHAPE_KINDS, cavityPolygon, wallOutline } from "../src/physics/shapes";

const rect = cavityPolygon({ kind: "rect", width: 1, height: 2 });

describe("shapes", () => {
  it("every shape is CCW with the mouth as the closing edge", () => {
    for (const kind of SHAPE_KINDS) {
      const c = cavityPolygon({ kind, width: 1.2, height: 1 });
      expect(area(c)).toBeGreaterThan(0.2);
      // left rim is first, right rim last, both at the top
      expect(c[0].x).toBeLessThan(c[c.length - 1].x);
      expect(c[0].y).toBeGreaterThan(0.5);
      expect(c[c.length - 1].y).toBeGreaterThan(0.5);
    }
  });
  it("wall outline encloses more area than the cavity", () => {
    expect(area(wallOutline(rect, 0.05))).toBeGreaterThan(0.1);
  });
});

describe("fluid", () => {
  it("upright rectangle: level = V / width", () => {
    const f = solveFluid(rect, 0, 0.5);
    expect(f.level).toBeCloseTo(0.5, 6);
    expect(f.centroid.y).toBeCloseTo(0.25, 6);
    expect(f.capacity).toBeCloseTo(2);
    expect(f.excess).toBe(0);
  });

  it("conserves volume at arbitrary tilt", () => {
    for (const th of [-1.2, -0.4, 0.1, 0.6, 1.0]) {
      const cap = capacity(rect, th);
      const v = Math.min(0.6, cap * 0.9);
      const f = solveFluid(rect, th, v);
      expect(area(f.poly)).toBeCloseTo(v, 6);
    }
  });

  it("capacity shrinks with tilt and is symmetric for symmetric shapes", () => {
    expect(capacity(rect, 0.3)).toBeLessThan(capacity(rect, 0));
    expect(capacity(rect, 0.3)).toBeCloseTo(capacity(rect, -0.3), 9);
    // tilted past vertical: nothing held
    expect(capacity(rect, Math.PI * 0.75)).toBeCloseTo(0, 6);
  });

  it("rect capacity at small tilt matches the analytic trapezoid", () => {
    const th = 0.2;
    // Upright w×h tilted by θ holds w·h − (w² tanθ)/2 while the surface stays inside.
    expect(capacity(rect, th)).toBeCloseTo(2 - Math.tan(th) / 2, 6);
  });

  it("overfull splits into retained + excess, lip is the lower rim", () => {
    const f = solveFluid(rect, 0.5, 5);
    expect(f.volume).toBeCloseTo(f.capacity, 9);
    expect(f.excess).toBeCloseTo(5 - f.capacity, 9);
    // CCW tilt lowers the left rim
    expect(f.lipSide).toBe(-1);
  });

  it("free surface tilts the centroid toward the low side", () => {
    const f = solveFluid(rect, 0.3, 0.8);
    expect(f.centroid.x).toBeLessThan(-0.3 * 0.5); // further than rigid rotation alone
  });

  it("widthAt matches rect width", () => {
    expect(widthAt(rect, 1)).toBeCloseTo(1);
  });

  it("weir rate grows as H^1.5", () => {
    const r1 = weirRate(0.01, 0.6, 9.81);
    const r4 = weirRate(0.04, 0.6, 9.81);
    expect(r4 / r1).toBeCloseTo(8, 6);
    expect(weirRate(0, 0.6, 9.81)).toBe(0);
  });
});
