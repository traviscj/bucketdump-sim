import { describe, expect, it } from "vitest";
import { area, clipBelow, closestOnSegment, contains, massProps, signedArea, transform } from "../src/geom/polygon";
import { rotate, toLocal, toWorld } from "../src/geom/vec";

const square = [
  { x: 0, y: 0 },
  { x: 2, y: 0 },
  { x: 2, y: 2 },
  { x: 0, y: 2 },
];

describe("polygon", () => {
  it("computes signed area by winding", () => {
    expect(signedArea(square)).toBeCloseTo(4);
    expect(signedArea([...square].reverse())).toBeCloseTo(-4);
  });

  it("computes centroid and polar moment of a square", () => {
    const mp = massProps(square);
    expect(mp.area).toBeCloseTo(4);
    expect(mp.centroid.x).toBeCloseTo(1);
    expect(mp.centroid.y).toBeCloseTo(1);
    // J = (b h / 12)(b² + h²) = (4/12)(8)
    expect(mp.polarMoment).toBeCloseTo(8 / 3);
  });

  it("massProps is winding-independent", () => {
    const a = massProps(square);
    const b = massProps([...square].reverse());
    expect(b.area).toBeCloseTo(a.area);
    expect(b.polarMoment).toBeCloseTo(a.polarMoment);
    expect(b.centroid.x).toBeCloseTo(a.centroid.x);
  });

  it("triangle centroid is the vertex mean", () => {
    const tri = [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 0, y: 3 },
    ];
    const mp = massProps(tri);
    expect(mp.centroid.x).toBeCloseTo(1);
    expect(mp.centroid.y).toBeCloseTo(1);
  });

  it("clips below a horizontal line", () => {
    expect(area(clipBelow(square, 0.5))).toBeCloseTo(1);
    expect(area(clipBelow(square, 5))).toBeCloseTo(4);
    expect(area(clipBelow(square, -1))).toBeCloseTo(0);
  });

  it("clips a non-convex U shape into two exact pieces", () => {
    // U: two 1-wide arms of height 3 on a 3-wide, 1-tall base
    const u = [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 3 },
      { x: 2, y: 3 },
      { x: 2, y: 1 },
      { x: 1, y: 1 },
      { x: 1, y: 3 },
      { x: 0, y: 3 },
    ];
    expect(area(clipBelow(u, 2))).toBeCloseTo(3 + 2);
  });

  it("point in polygon", () => {
    expect(contains(square, { x: 1, y: 1 })).toBe(true);
    expect(contains(square, { x: 3, y: 1 })).toBe(false);
  });

  it("transform preserves area", () => {
    const t = transform(square, { x: 5, y: -2, th: 0.7 });
    expect(area(t)).toBeCloseTo(4);
  });

  it("closest point on segment clamps", () => {
    const r = closestOnSegment({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 1 });
    expect(r.t).toBe(1);
    expect(r.pt.x).toBe(1);
  });
});

describe("vec", () => {
  it("rotates CCW", () => {
    const r = rotate({ x: 1, y: 0 }, Math.PI / 2);
    expect(r.x).toBeCloseTo(0);
    expect(r.y).toBeCloseTo(1);
  });
  it("toLocal inverts toWorld", () => {
    const pose = { x: 1, y: 2, th: 1.1 };
    const p = { x: 0.3, y: -4 };
    const q = toLocal(pose, toWorld(pose, p));
    expect(q.x).toBeCloseTo(p.x);
    expect(q.y).toBeCloseTo(p.y);
  });
});
