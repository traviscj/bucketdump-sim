import { describe, expect, it } from "vitest";
import { generate, generateOnce, layoutOk, validates } from "../src/world/random";
import { Rng } from "../src/world/rng";

describe("Rng", () => {
  it("is deterministic per seed", () => {
    const a = new Rng(42);
    const b = new Rng(42);
    expect([a.next(), a.next()]).toEqual([b.next(), b.next()]);
    expect(new Rng(43).next()).not.toBe(new Rng(42).next());
  });
});

describe("random scenes", () => {
  it("generateOnce is deterministic", () => {
    expect(JSON.stringify(generateOnce(123))).toBe(JSON.stringify(generateOnce(123)));
  });

  it("layoutOk rejects overlapping buckets", () => {
    const sc = generateOnce(5);
    const b = sc.buckets[0];
    expect(layoutOk([b, { ...b, id: "clone" }])).toBe(false);
  });

  for (const seed of [1, 2, 3, 4, 5]) {
    it(`seed ${seed}: generate() returns a validated, working scene`, () => {
      const sc = generate(seed);
      expect(sc.buckets.length).toBeGreaterThan(0);
      expect(sc.pipes.length).toBeGreaterThan(0);
      expect(layoutOk(sc.buckets)).toBe(true);
      expect(validates(sc)).toBe(true);
    }, 30000);
  }
});
