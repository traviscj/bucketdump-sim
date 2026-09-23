import type { BucketSpec } from "../physics/bucketModel";
import { type MaterialId, MATERIALS } from "../physics/materials";
import { SHAPE_KINDS, type ShapeKind } from "../physics/shapes";
import { BUCKET_COLORS, PERSON_COLORS, cascade, crowd, pegField, pipeOver } from "./presets";
import { Rng } from "./rng";
import type { PipeSpec, RampSpec, Scenario } from "./scenario";
import { World } from "./world";

const ADJECTIVES = ["Wobbly", "Giant", "Sneaky", "Speedy", "Silly", "Mega", "Tippy", "Splashy", "Bouncy", "Dizzy"];
const NOUNS = ["Buckets", "Dumpers", "Sploosh", "Waterfall", "Tipper", "Cascade", "Soaker", "Drencher"];

export interface RandomOptions {
  /** Number of people to add (the splash'em game wants a crowd). */
  people?: [number, number];
  /** Validate by headless simulation (slower, but only returns scenes that work). */
  validate?: boolean;
  maxTries?: number;
}

/** Radius a bucket sweeps around its axle. */
function sweep(b: BucketSpec): number {
  return Math.hypot(b.shape.width / 2 + Math.abs(b.pivotLocal.x), Math.max(b.pivotLocal.y, b.shape.height - b.pivotLocal.y)) + b.wall;
}

/** Buckets must not bump into each other, the ground, or leave the stage. */
export function layoutOk(buckets: BucketSpec[], halfWidth = 5): boolean {
  for (let i = 0; i < buckets.length; i++) {
    const a = buckets[i];
    const ra = sweep(a);
    if (a.pivot.y - ra < 0.1 || Math.abs(a.pivot.x) + ra * 0.6 > halfWidth) return false;
    for (let j = i + 1; j < buckets.length; j++) {
      const b = buckets[j];
      if (Math.hypot(a.pivot.x - b.pivot.x, a.pivot.y - b.pivot.y) < (ra + sweep(b)) * 0.8) return false;
    }
  }
  return true;
}

/** One attempt: may produce a scene that fails layout or validation. */
export function generateOnce(seed: number, opts: RandomOptions = {}): Scenario {
  const rng = new Rng(seed);
  const material: MaterialId = rng.chance(0.65) ? "water" : rng.pick(["acorns", "balls", "sand", "slime"] as const);
  const chains = rng.int(1, 2);
  const buckets: BucketSpec[] = [];
  const pipes: PipeSpec[] = [];
  let colorIdx = rng.int(0, BUCKET_COLORS.length - 1);

  for (let c = 0; c < chains; c++) {
    const len = chains === 1 ? rng.int(1, 3) : rng.int(1, 2);
    // Top of the chain high up; each link drops ~1.6–2.2 m.
    const x0 = chains === 1 ? rng.range(-2.5, 1.5) : c === 0 ? rng.range(-3.5, -1.5) : rng.range(1.5, 3.5);
    let y = rng.range(5.2, 6.2);
    const recipes = [];
    for (let k = 0; k < len; k++) {
      const kind: ShapeKind = rng.pick(SHAPE_KINDS);
      const width = rng.range(0.8, 1.2 + 0.25 * k);
      const height = rng.range(0.55, 1.0 + 0.1 * k);
      recipes.push({
        id: `b${buckets.length + k + 1}`,
        pivot: { x: x0, y },
        kind,
        width,
        height,
        // Chains zig-zag toward the middle of the stage.
        pours: (rng.chance(0.3) ? (k % 2 ? "left" : "right") : x0 < 0 ? "right" : "left") as "left" | "right",
        tipAt: rng.range(0.55, 0.85),
        color: BUCKET_COLORS[colorIdx++ % BUCKET_COLORS.length],
      });
      y -= rng.range(1.6, 2.1);
      if (y < 1.4) break;
    }
    const chain = cascade(recipes, material);
    buckets.push(...chain);
    pipes.push(
      pipeOver(chain[0], `p${pipes.length + 1}`, {
        flow: rng.range(0.07, 0.2),
        material,
        color: material === "water" ? "#9aa4b2" : MATERIALS[material].color,
      }),
    );
  }

  const pegs = rng.chance(0.35) ? pegField(rng.range(-3, -1), rng.range(1, 3), 1.2, rng.range(2.2, 3.2), rng.int(3, 5), rng.int(5, 8)) : [];
  const ramps: RampSpec[] = [];
  if (rng.chance(0.3)) {
    const x = rng.range(-3, 3);
    ramps.push({ a: { x: x - 1, y: rng.range(1.2, 2.4) }, b: { x: x + 1, y: rng.range(0.8, 2.0) } });
  }
  const [pmin, pmax] = opts.people ?? [2, 6];
  const n = rng.int(pmin, pmax);
  const people = crowd(
    Array.from({ length: n }, (_, i) => -4.3 + (8.6 * (i + 0.5)) / n + rng.range(-0.3, 0.3)),
    seed,
  ).map((p, i) => ({ ...p, color: PERSON_COLORS[(i + seed) % PERSON_COLORS.length] }));

  return {
    version: 1,
    name: `${rng.pick(ADJECTIVES)} ${rng.pick(NOUNS)} #${seed % 1000}`,
    seed,
    buckets,
    pipes,
    pegs,
    ramps,
    people,
    view: { minX: -5, maxX: 5, minY: -0.2, maxY: 7.4 },
  };
}

/** Run headless with valves wide open: every bucket must tip, the fed ones repeatedly. */
export function validates(sc: Scenario, seconds = 35): boolean {
  const world = new World(structuredClone(sc), 2500);
  for (const p of world.pipes) p.valve = 1;
  const tips = new Map<string, number>();
  for (let t = 0; t < seconds; t += 1 / 120) {
    world.step(1 / 120);
    for (const e of world.drainEvents()) if (e.type === "tip") tips.set(e.bucket, (tips.get(e.bucket) ?? 0) + 1);
  }
  return sc.buckets.every((b) => (tips.get(b.id) ?? 0) >= 1);
}

/** Deterministic in `seed`: tries seed, seed+1, … until a scene passes. */
export function generate(seed: number, opts: RandomOptions = {}): Scenario {
  const tries = opts.maxTries ?? 12;
  let fallback: Scenario | null = null;
  for (let k = 0; k < tries; k++) {
    const sc = generateOnce((seed + k * 7919) >>> 0, opts);
    if (!layoutOk(sc.buckets)) continue;
    fallback ??= sc;
    if (opts.validate === false || validates(sc)) return { ...sc, seed };
  }
  return fallback ?? generateOnce(seed, opts);
}
