import { describe, expect, it } from "vitest";
import { analyze, equilibria } from "../src/analysis/equilibrium";
import { Bucket } from "../src/physics/bucket";
import { BucketModel } from "../src/physics/bucketModel";
import { goodSpec } from "./fixtures";

describe("BucketModel", () => {
  it("empty bucket rests against its stop", () => {
    const m = new BucketModel(goodSpec());
    expect(m.evaluate(0, 0, 1000).tau).toBeLessThan(0);
  });

  it("filling reverses the torque at the stop", () => {
    const m = new BucketModel(goodSpec());
    expect(m.evaluate(0, m.maxCapacity * 0.95, 1000).tau).toBeGreaterThan(0);
  });

  it("inertia grows with fill", () => {
    const m = new BucketModel(goodSpec());
    expect(m.evaluate(0, 0.8, 1000).inertia).toBeGreaterThan(m.evaluate(0, 0, 1000).inertia);
  });
});

describe("analysis", () => {
  it("finds a fold with a working verdict", () => {
    const m = new BucketModel(goodSpec());
    const h = analyze(m, 1000);
    expect(h.verdict).toBe("works");
    expect(h.vTip! / m.maxCapacity).toBeGreaterThan(0.6);
    expect(h.vTip! / m.maxCapacity).toBeLessThan(0.95);
    expect(h.thDump!).toBeGreaterThan(1);
    // hysteresis: returns only once it holds less than it tipped at
    expect(h.vRet!).toBeLessThan(h.vTip!);
  });

  it("a pivot way above the COM just brims over", () => {
    const m = new BucketModel(goodSpec({ pivotLocal: { x: 0.1, y: 0.9 }, ballast: 80 }));
    expect(analyze(m, 1000).verdict).toBe("overflows");
  });

  it("counts a root on a grid point exactly once", () => {
    const m = new BucketModel(goodSpec({ pivotLocal: { x: 0, y: 0.6 }, ballast: 0, thMin: -2, thMax: 2 }));
    const eqs = equilibria(m, 0, 1000, 160).filter((e) => Math.abs(e.th) < 0.05);
    expect(eqs).toHaveLength(1);
    expect(eqs[0].stable).toBe(true);
  });
});

describe("Bucket dynamics", () => {
  const DT = 1 / 240;

  /** Pour at `rate` m²/s for `seconds`; returns the bucket and total spilled. */
  function run(rate: number, seconds: number, spec = goodSpec()) {
    const b = new Bucket(spec);
    let spilled = 0;
    let maxTh = 0;
    for (let t = 0; t < seconds; t += DT) {
      if (b.phase === "filling") b.addFluid(rate * DT, "water");
      const s = b.step(DT);
      if (s) spilled += s.volume;
      maxTh = Math.max(maxTh, b.th);
    }
    return { b, spilled, maxTh };
  }

  it("sits still while partly full", () => {
    const { b } = run(0.05, 4);
    expect(b.dumps).toBe(0);
    expect(b.th).toBeCloseTo(0, 3);
  });

  it("tips, dumps, and comes back — repeatedly", () => {
    const { b, spilled, maxTh } = run(0.15, 40);
    expect(b.dumps).toBeGreaterThanOrEqual(2);
    expect(maxTh).toBeGreaterThan(1.2);
    expect(spilled).toBeGreaterThan(b.model.maxCapacity);
  });

  it("tips near the analytic fold volume", () => {
    const { b } = run(0.1, 15);
    const vTip = b.analysis.vTip!;
    expect(b.lastTipVolume).toBeGreaterThan(vTip * 0.95);
    expect(b.lastTipVolume).toBeLessThan(vTip * 1.1);
  });

  it("conserves volume: in = held + spilled", () => {
    const b = new Bucket(goodSpec());
    let added = 0;
    let spilled = 0;
    for (let i = 0; i < 240 * 20; i++) {
      b.addFluid(0.12 * DT, "water");
      added += 0.12 * DT;
      const s = b.step(DT);
      if (s) spilled += s.volume;
    }
    expect(b.volume + spilled).toBeCloseTo(added, 9);
  });

  it("warning ramps up before the tip", () => {
    const b = new Bucket(goodSpec());
    const vTip = b.analysis.vTip!;
    b.addFluid(vTip * 0.5, "water");
    expect(b.warning).toBe(0);
    b.addFluid(vTip * 0.45, "water");
    expect(b.warning).toBeGreaterThan(0.7);
  });

  it("a shove tips a half-full bucket", () => {
    const b = new Bucket(goodSpec());
    b.addFluid(b.analysis.vTip! * 0.6, "water");
    b.shove();
    let maxTh = 0;
    for (let i = 0; i < 240 * 3; i++) {
      b.step(DT);
      maxTh = Math.max(maxTh, b.th);
    }
    expect(maxTh).toBeGreaterThan(0.5);
  });

  it("mixing materials tracks fractions and density", () => {
    const b = new Bucket(goodSpec());
    b.addFluid(0.1, "water");
    b.addFluid(0.1, "sand");
    expect(b.mix.water).toBeCloseTo(0.5);
    expect(b.density).toBeCloseTo(1300);
  });

  it("mirrored bucket tips the other way", () => {
    const spec = goodSpec({
      shape: { kind: "round", width: 1.2, height: 1.0, mirror: true },
      pivotLocal: { x: -0.05, y: 0.25 },
      ballastLocal: { x: -0.6, y: 0 },
      thMin: -1.55,
      thMax: 0,
    });
    const { b } = run(0.15, 20, spec);
    expect(b.dumps).toBeGreaterThanOrEqual(1);
    expect(b.analysis.thDump!).toBeLessThan(-1);
  });
});

describe("overTheTop", () => {
  it("finds where the empty bucket flops over, and a stop past it is 'stuck'", async () => {
    const { overTheTop } = await import("../src/analysis/equilibrium");
    const m = new BucketModel(goodSpec());
    const ot = overTheTop(m, 1)!;
    expect(ot).toBeGreaterThan(1.6);
    expect(ot).toBeLessThan(1.9);
    expect(analyze(new BucketModel(goodSpec({ thMax: ot + 0.3 })), 1000).verdict).toBe("stuck");
  });
});
