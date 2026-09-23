import { describe, expect, it } from "vitest";
import { circleContact, reflect, segmentContact, segmentsCross } from "../src/physics/collide";
import { ParticlePool } from "../src/physics/particles";

describe("ParticlePool", () => {
  it("emits, kills by swap, and tracks volume", () => {
    const p = new ParticlePool(4);
    p.emit(0, 0, 0, 0, 1, "water");
    p.emit(1, 0, 0, 0, 2, "sand");
    p.emit(2, 0, 0, 0, 3, "water");
    p.kill(0);
    expect(p.count).toBe(2);
    expect(p.x[0]).toBe(2);
    expect(p.totalVolume()).toBe(5);
    expect(p.material(1)).toBe("sand");
  });

  it("recycles when full and reports the dropped volume", () => {
    const p = new ParticlePool(2);
    p.emit(0, 0, 0, 0, 1, "water");
    p.emit(0, 0, 0, 0, 1, "water");
    p.emit(0, 0, 0, 0, 5, "water");
    expect(p.count).toBe(2);
    expect(p.dropped).toBe(1);
    expect(p.totalVolume()).toBe(6);
  });
});

describe("collide", () => {
  it("circle contact normal points outward", () => {
    const c = circleContact(0.9, 0, 0.2, 0, 0, 1)!;
    expect(c.nx).toBeCloseTo(1);
    expect(c.depth).toBeCloseTo(0.3);
    expect(circleContact(2, 0, 0.2, 0, 0, 1)).toBeNull();
  });

  it("segment contact", () => {
    const c = segmentContact(0.5, 0.05, 0.1, { x: 0, y: 0 }, { x: 1, y: 0 })!;
    expect(c.ny).toBeCloseTo(1);
    expect(c.depth).toBeCloseTo(0.05);
  });

  it("segments cross", () => {
    expect(segmentsCross({ x: 0, y: -1 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 1, y: 0 })).toBe(true);
    expect(segmentsCross({ x: 2, y: -1 }, { x: 2, y: 1 }, { x: -1, y: 0 }, { x: 1, y: 0 })).toBe(false);
  });

  it("reflect bounces the normal component with restitution", () => {
    const r = reflect(1, -2, 0, 1, 0.5, 0);
    expect(r.vx).toBeCloseTo(1);
    expect(r.vy).toBeCloseTo(1);
    // separating velocities are untouched
    expect(reflect(0, 1, 0, 1, 0.5, 0).vy).toBe(1);
  });
});
