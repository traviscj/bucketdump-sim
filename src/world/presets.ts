import { MATERIALS, type MaterialId } from "../physics/materials";
import { type BucketRecipe, buildBucket, pourX } from "./buildBucket";
import type { BucketSpec } from "../physics/bucketModel";
import { Rng } from "./rng";
import type { PegSpec, PersonSpec, PipeSpec, RampSpec, Scenario } from "./scenario";

/** Kid-bright palette for buckets. */
export const BUCKET_COLORS = ["#ff3b30", "#ff9500", "#ffcc00", "#34c759", "#00c7be", "#007aff", "#af52de", "#ff2d55"];
export const PERSON_COLORS = ["#ff6b6b", "#ffd166", "#06d6a0", "#118ab2", "#ef476f", "#8338ec", "#fb5607", "#3a86ff"];

export interface PresetInfo {
  id: string;
  name: string;
  emoji: string;
  build: () => Scenario;
}

type R = Omit<BucketRecipe, "color"> & { color?: string };

function buckets(recipes: R[], material: MaterialId = "water") {
  return recipes.map(
    (r, i) => buildBucket({ color: BUCKET_COLORS[i % BUCKET_COLORS.length], density: MATERIALS[material].density, ...r }).spec,
  );
}

/**
 * A chain of buckets where each one sits under the previous one's pour.
 * Only the first recipe's pivot.x is used; the rest are placed automatically.
 */
export function cascade(recipes: R[], material: MaterialId = "water"): BucketSpec[] {
  const out: BucketSpec[] = [];
  recipes.forEach((r, i) => {
    let pivot = r.pivot;
    if (i > 0) {
      const prev = out[i - 1];
      const dir = prev.thMax > 0 ? -1 : 1; // left-pourers throw left
      // Centre the mouth a little past the lip: the pour carries some horizontal speed.
      const mouthX = pourX(prev) + dir * 0.25;
      const off = (r.pivotOffset ?? 0.04) * r.width * (r.pours === "left" ? 1 : -1);
      pivot = { x: mouthX + off, y: r.pivot.y };
    }
    out.push(buckets([{ ...r, pivot, color: r.color ?? BUCKET_COLORS[i % BUCKET_COLORS.length] }], material)[0]);
  });
  return out;
}

/** A pipe centred over the bucket mouth, `drop` metres above the rim. */
export function pipeOver(
  b: { pivot: { x: number; y: number }; pivotLocal: { x: number; y: number }; shape: { height: number } },
  id: string,
  opts: { flow?: number; material?: MaterialId; drop?: number; dx?: number; color?: string } = {},
): PipeSpec {
  const cx = b.pivot.x - b.pivotLocal.x + (opts.dx ?? 0);
  const rim = b.pivot.y - b.pivotLocal.y + b.shape.height;
  return {
    id,
    x: cx,
    y: rim + (opts.drop ?? 0.9),
    angle: -Math.PI / 2,
    flow: opts.flow ?? 0.12,
    valve: 0.7,
    speed: 1.2,
    material: opts.material ?? "water",
    color: opts.color ?? "#9aa4b2",
  };
}

export function crowd(xs: number[], seed = 7): PersonSpec[] {
  const rng = new Rng(seed);
  return xs.map((x, i) => ({
    id: `p${i + 1}`,
    x,
    height: rng.chance(0.4) ? rng.range(0.9, 1.2) : rng.range(1.5, 1.85),
    color: PERSON_COLORS[i % PERSON_COLORS.length],
  }));
}

/** Triangular peg lattice: rows × cols between (x0,y0) and (x1,y1). */
export function pegField(x0: number, x1: number, y0: number, y1: number, rows: number, cols: number, r = 0.07): PegSpec[] {
  const pegs: PegSpec[] = [];
  for (let i = 0; i < rows; i++) {
    const y = y1 - ((y1 - y0) * i) / Math.max(1, rows - 1);
    const shift = i % 2 ? 0.5 : 0;
    for (let j = 0; j < cols - (i % 2); j++) {
      pegs.push({ x: x0 + ((x1 - x0) * (j + shift)) / Math.max(1, cols - 1), y, r });
    }
  }
  return pegs;
}

const VIEW = { minX: -5, maxX: 5, minY: -0.2, maxY: 7.4 };

function scene(name: string, parts: Partial<Scenario> & { buckets: Scenario["buckets"] }): Scenario {
  return { version: 1, name, seed: 1, pipes: [], pegs: [], ramps: [], people: [], view: VIEW, ...parts };
}

export const PRESETS: PresetInfo[] = [
  {
    id: "big",
    name: "Big Bucket",
    emoji: "🪣",
    build: () => {
      const [b] = buckets([
        { id: "big", pivot: { x: 0.6, y: 4.4 }, kind: "rect", width: 2.2, height: 1.5, pours: "left", tipAt: 0.75 },
      ]);
      return scene("Big Bucket", {
        buckets: [b],
        pipes: [pipeOver(b, "main", { flow: 0.3 })],
        people: crowd([-3.6, -2.7, -1.8, -0.9, 2.4, 3.4]),
      });
    },
  },
  {
    id: "cascade",
    name: "Cascade",
    emoji: "🪜",
    build: () => {
      const bs = cascade([
        { id: "top", pivot: { x: -3.2, y: 6.2 }, kind: "flared", width: 1.0, height: 0.8, pours: "right", tipAt: 0.75 },
        { id: "mid", pivot: { x: 0, y: 4.0 }, kind: "rect", width: 1.3, height: 1.0, pours: "right", tipAt: 0.6 },
        { id: "low", pivot: { x: 0, y: 1.9 }, kind: "round", width: 1.6, height: 1.0, pours: "right", tipAt: 0.6 },
      ]);
      return scene("Cascade", {
        buckets: bs,
        pipes: [pipeOver(bs[0], "p1", { flow: 0.1 })],
        people: crowd([2.8, 3.5, 4.2]),
      });
    },
  },
  {
    id: "plinko",
    name: "Plinko Splash",
    emoji: "🔻",
    build: () => {
      const bs = buckets([
        { id: "plink", pivot: { x: -1.2, y: 5.4 }, kind: "flared", width: 1.4, height: 1.0, pours: "right", tipAt: 0.7 },
      ]);
      return scene("Plinko Splash", {
        buckets: bs,
        pipes: [pipeOver(bs[0], "p1", { flow: 0.18 })],
        pegs: pegField(-1.2, 3.2, 1.4, 3.8, 6, 8),
        people: crowd([-2.6, -1.6, -0.6, 0.4, 1.4, 2.4, 3.4]),
      });
    },
  },
  {
    id: "twins",
    name: "Twin Tippers",
    emoji: "👯",
    build: () => {
      const bs = buckets([
        { id: "L", pivot: { x: -2.2, y: 4.3 }, kind: "round", width: 1.3, height: 1.0, pours: "left", tipAt: 0.7 },
        { id: "R", pivot: { x: 2.2, y: 4.3 }, kind: "round", width: 1.3, height: 1.0, pours: "right", tipAt: 0.7 },
      ]);
      return scene("Twin Tippers", {
        buckets: bs,
        pipes: [pipeOver(bs[0], "pL", { flow: 0.1 }), pipeOver(bs[1], "pR", { flow: 0.16 })],
        people: crowd([-4.2, -3.4, 0, 3.4, 4.2]),
      });
    },
  },
  {
    id: "acorns",
    name: "Acorn Avalanche",
    emoji: "🌰",
    build: () => {
      const bs = buckets(
        [{ id: "acorn", pivot: { x: -2.0, y: 5.2 }, kind: "vee", width: 1.4, height: 1.1, pours: "right", tipAt: 0.7 }],
        "acorns",
      );
      const ramps: RampSpec[] = [
        { a: { x: -1.0, y: 3.4 }, b: { x: 1.6, y: 2.6 } },
        { a: { x: 3.0, y: 1.9 }, b: { x: 0.8, y: 1.1 } },
      ];
      return scene("Acorn Avalanche", {
        buckets: bs,
        pipes: [pipeOver(bs[0], "p1", { flow: 0.14, material: "acorns", color: "#7a4a1d" })],
        ramps,
        people: crowd([-2.4, -1.4, 3.8]),
      });
    },
  },
  {
    id: "balls",
    name: "Ball Pit",
    emoji: "🔴",
    build: () => {
      const bs = buckets(
        [{ id: "balls", pivot: { x: 0.5, y: 5.0 }, kind: "round", width: 1.8, height: 1.2, pours: "left", tipAt: 0.7 }],
        "balls",
      );
      return scene("Ball Pit", {
        buckets: bs,
        pipes: [pipeOver(bs[0], "p1", { flow: 0.2, material: "balls", color: "#c44dff" })],
        pegs: pegField(-3.4, 0.2, 1.2, 3.2, 4, 6, 0.1),
        people: crowd([-3.8, -2.2, 3.0]),
      });
    },
  },
  {
    id: "slime",
    name: "Slime Time",
    emoji: "🟢",
    build: () => {
      const bs = buckets(
        [{ id: "slime", pivot: { x: 0.2, y: 4.2 }, kind: "scoop", width: 1.6, height: 1.2, pours: "right", tipAt: 0.7 }],
        "slime",
      );
      return scene("Slime Time", {
        buckets: bs,
        pipes: [pipeOver(bs[0], "p1", { flow: 0.15, material: "slime", color: "#3a8f2a" })],
        people: crowd([1.8, 2.5, 3.2, -3]),
      });
    },
  },
  {
    id: "tower",
    name: "Zig-Zag Tower",
    emoji: "🗼",
    build: () => {
      const bs = cascade([
        { id: "t1", pivot: { x: 0.2, y: 6.5 }, kind: "rect", width: 0.8, height: 0.6, pours: "right", tipAt: 0.8 },
        { id: "t2", pivot: { x: 0, y: 5.0 }, kind: "flared", width: 1.0, height: 0.7, pours: "left", tipAt: 0.6 },
        { id: "t3", pivot: { x: 0, y: 3.5 }, kind: "rect", width: 1.2, height: 0.8, pours: "right", tipAt: 0.6 },
        { id: "t4", pivot: { x: 0, y: 1.9 }, kind: "round", width: 1.4, height: 0.9, pours: "left", tipAt: 0.6 },
      ]);
      return scene("Zig-Zag Tower", {
        buckets: bs,
        pipes: [pipeOver(bs[0], "p1", { flow: 0.09 })],
        people: crowd([-3.5, -2.6, 3.4]),
      });
    },
  },
];

export const presetById = (id: string): PresetInfo | undefined => PRESETS.find((p) => p.id === id);
