import { describe, expect, it } from "vitest";
import { Recorder, Ring } from "../src/analysis/recorder";
import { View } from "../src/render/view";

describe("View", () => {
  const box = { minX: -5, maxX: 5, minY: 0, maxY: 5 };
  it("fits the box and round-trips", () => {
    const v = new View();
    v.fit(box, 1000, 1000, 0);
    expect(v.scale).toBe(100);
    const p = v.toWorld(v.sx(1.5), v.sy(2.5));
    expect(p.x).toBeCloseTo(1.5);
    expect(p.y).toBeCloseTo(2.5);
  });
  it("puts the ground at the bottom edge and centres horizontally", () => {
    const v = new View();
    v.fit(box, 800, 1200, 10);
    expect(v.sy(0)).toBeCloseTo(1190);
    expect(v.sx(0)).toBeCloseTo(400);
    expect(v.visible().maxY).toBeGreaterThan(5);
  });
});

describe("Ring", () => {
  it("keeps the newest samples in order", () => {
    const r = new Ring(["a"] as const, 3);
    for (let i = 1; i <= 5; i++) r.push({ a: i });
    expect(r.size).toBe(3);
    expect([0, 1, 2].map((k) => r.get("a", k))).toEqual([3, 4, 5]);
    expect(r.last("a")).toBe(5);
    expect(r.extent("a")).toEqual([3, 5]);
  });
});

describe("Recorder", () => {
  it("samples at its own rate regardless of call rate", () => {
    const rec = new Recorder(10, 5);
    const b = { spec: { id: "x" }, th: 0, om: 0, volume: 1, last: { tau: 0 }, lastSpillRate: 0 };
    for (let t = 0; t < 1; t += 1 / 120) rec.sample(t, [b]);
    expect(rec.traces.get("x")!.size).toBeGreaterThanOrEqual(10);
    expect(rec.traces.get("x")!.size).toBeLessThanOrEqual(11);
  });
});
