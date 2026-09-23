import type { BucketSpec } from "../src/physics/bucketModel";

/** A known-good bucket from the parameter sweep: tips at ~80% full, dumps nearly dry. */
export function goodSpec(overrides: Partial<BucketSpec> = {}): BucketSpec {
  return {
    id: "b1",
    shape: { kind: "round", width: 1.2, height: 1.0 },
    pivot: { x: 0, y: 3 },
    pivotLocal: { x: 0.05, y: 0.25 },
    shellMass: 60,
    ballast: 50,
    ballastLocal: { x: 0.6, y: 0 },
    damping: 30,
    thMin: 0,
    thMax: 1.55,
    restitution: 0.2,
    wall: 0.05,
    color: "#e53935",
    ...overrides,
  };
}
