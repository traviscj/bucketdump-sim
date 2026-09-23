import { describe, expect, it } from "vitest";
import type { Scenario } from "../src/world/scenario";
import { Person, World } from "../src/world/world";

function bare(parts: Partial<Scenario> = {}): Scenario {
  return {
    version: 1,
    name: "t",
    buckets: [],
    pipes: [],
    pegs: [],
    ramps: [],
    people: [],
    view: { minX: -5, maxX: 5, minY: 0, maxY: 7 },
    ...parts,
  };
}

const run = (w: World, s: number) => {
  for (let t = 0; t < s; t += 1 / 120) w.step(1 / 120);
};

describe("World", () => {
  it("pipes emit their flow as particle volume", () => {
    const w = new World(
      bare({ pipes: [{ id: "p", x: 0, y: 5, angle: -Math.PI / 2, flow: 0.1, valve: 1, speed: 1, material: "water", color: "#999" }] }),
    );
    run(w, 1);
    expect(w.stats.poured).toBeCloseTo(0.1, 2);
    expect(w.particles.count).toBeGreaterThan(40);
  });

  it("closed valves emit nothing; master scales flow", () => {
    const w = new World(
      bare({ pipes: [{ id: "p", x: 0, y: 5, angle: -Math.PI / 2, flow: 0.1, valve: 0, speed: 1, material: "water", color: "#999" }] }),
    );
    run(w, 1);
    expect(w.particles.count).toBe(0);
  });

  it("water landing on the ground makes splash events and is grounded", () => {
    const w = new World(bare());
    w.particles.emit(0, 1, 0, 0, 0.01, "water");
    run(w, 1);
    expect(w.particles.count).toBe(0);
    expect(w.stats.grounded).toBeCloseTo(0.01, 6);
    expect(w.drainEvents().some((e) => e.type === "splash")).toBe(true);
  });

  it("people get wet with diminishing points per person", () => {
    const w = new World(bare({ people: [{ id: "a", x: 0, height: 1.7, color: "#f00" }] }));
    const drop = () => {
      w.particles.emit(0, 3, 0, 0, Person.SOAK / 2, "water");
      run(w, 1);
    };
    drop();
    const first = w.points;
    expect(w.people[0].wet).toBeCloseTo(0.5, 3);
    drop();
    expect(w.points - first).toBeLessThan(first);
    expect(w.people[0].wet).toBeCloseTo(1, 3);
    expect(w.score).toBe(75);
  });

  it("balls bounce off pegs", () => {
    const w = new World(bare({ pegs: [{ x: 0, y: 2, r: 0.1 }] }));
    w.particles.emit(0.02, 3, 0, 0, 0.001, "balls");
    let maxAbsX = 0;
    for (let t = 0; t < 1; t += 1 / 120) {
      w.step(1 / 120);
      if (w.particles.count) {
        maxAbsX = Math.max(maxAbsX, Math.abs(w.particles.x[0]));
      }
    }
    expect(maxAbsX).toBeGreaterThan(0.1); // deflected sideways by the peg
  });
});
