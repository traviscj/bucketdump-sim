import { describe, expect, it } from "vitest";
import { landscape, stability } from "../src/analysis/stiffness";
import { Bucket } from "../src/physics/bucket";
import { goodSpec } from "./fixtures";

describe("stability", () => {
  it("a hanging pendulum-like bucket is stable with a finite period", () => {
    // Free (no stop at rest) bucket hanging below its axle.
    const b = new Bucket(goodSpec({ pivotLocal: { x: 0, y: 0.8 }, ballastLocal: { x: 0, y: 0 }, thMin: -1, thMax: 1 }));
    const s = stability(b);
    expect(s.k).toBeGreaterThan(0);
    expect(s.gm).toBeGreaterThan(0);
    expect(Number.isFinite(s.period)).toBe(true);
  });

  it("landscape has its minimum at rest when empty and loses it when overfull", () => {
    const b = new Bucket(goodSpec());
    const empty = landscape(b, 0);
    // With the stop at θ=0 and torque into the stop, U increases away from it.
    expect(empty.u[empty.u.length - 1]).toBeGreaterThan(0);
    const full = landscape(b, b.analysis.vTip! * 1.05);
    // Just past the fold, U decreases off the stop: it rolls away (tips).
    expect(full.u[3]).toBeLessThan(0);
  });
});
