import { describe, expect, it } from "vitest";
import { buildBucket } from "../src/world/buildBucket";
import { SHAPE_KINDS } from "../src/physics/shapes";

describe("buildBucket", () => {
  for (const kind of SHAPE_KINDS) {
    for (const pours of ["left", "right"] as const) {
      it(`${kind} pouring ${pours} hits its target tip fill`, () => {
        const b = buildBucket({ id: "x", pivot: { x: 0, y: 4 }, kind, width: 1.2, height: 1, pours, tipAt: 0.7, color: "#f00" });
        expect(b.analysis.verdict).toBe("works");
        expect(b.returnsWhileFed).toBe(true);
        expect(b.tipAt).toBeGreaterThan(0.6);
        expect(b.tipAt).toBeLessThan(0.8);
        expect(Math.sign(b.analysis.thDump!)).toBe(pours === "left" ? 1 : -1);
      });
    }
  }
});
