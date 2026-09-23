import { describe, expect, it } from "vitest";
import { World } from "../src/world/world";
import { PRESETS } from "../src/world/presets";
import { decodeScenario, encodeScenario } from "../src/world/scenario";

/** Headless run with every valve wide open. */
function simulate(world: World, seconds: number) {
  for (const p of world.pipes) p.valve = 1;
  const tips: Record<string, number> = {};
  for (let t = 0; t < seconds; t += 1 / 120) {
    world.step(1 / 120);
    for (const e of world.drainEvents()) if (e.type === "tip") tips[e.bucket] = (tips[e.bucket] ?? 0) + 1;
  }
  return tips;
}

describe("presets", () => {
  for (const preset of PRESETS) {
    it(`${preset.name}: every bucket dumps, volume is conserved`, () => {
      const sc = preset.build();
      const world = new World(sc);
      const tips = simulate(world, 60);
      for (const b of sc.buckets) expect(tips[b.id] ?? 0, `bucket ${b.id} tips`).toBeGreaterThanOrEqual(1);
      // The pipe-fed bucket must keep cycling (not get stuck tipped).
      expect(tips[sc.buckets[0].id], "first bucket cycles").toBeGreaterThanOrEqual(3);
      // Particle volumes are float32, so compare relatively.
      expect(Math.abs(world.accountedVolume() - world.stats.poured) / world.stats.poured).toBeLessThan(1e-5);
    }, 20000);
  }

  it("round-trips through the URL encoding", () => {
    const sc = PRESETS[1].build();
    const back = decodeScenario(encodeScenario(sc))!;
    expect(back.name).toBe(sc.name);
    expect(back.buckets).toHaveLength(sc.buckets.length);
    expect(back.buckets[0].pivot.x).toBeCloseTo(sc.buckets[0].pivot.x, 3);
  });

  it("rejects junk codes", () => {
    expect(decodeScenario("not-a-scenario")).toBeNull();
  });
});
