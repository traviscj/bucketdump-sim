import type { Vec } from "../geom/vec";
import type { BucketSpec } from "../physics/bucketModel";
import type { MaterialId } from "../physics/materials";

/** A faucet/pipe outlet. `valve` is the live control (0–1) scaled by `flow`. */
export interface PipeSpec {
  id: string;
  /** Outlet position. */
  x: number;
  y: number;
  /** Flow direction, radians (−π/2 = straight down). */
  angle: number;
  /** Max flow at valve=1, m²/s. */
  flow: number;
  valve: number;
  speed: number;
  material: MaterialId;
  color: string;
}

export interface PegSpec {
  x: number;
  y: number;
  r: number;
}

export interface RampSpec {
  a: Vec;
  b: Vec;
}

export interface PersonSpec {
  id: string;
  x: number;
  height: number;
  color: string;
}

export interface ViewBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface Scenario {
  version: 1;
  name: string;
  seed?: number;
  buckets: BucketSpec[];
  pipes: PipeSpec[];
  pegs: PegSpec[];
  ramps: RampSpec[];
  people: PersonSpec[];
  view: ViewBox;
}

/** Round every number to 3 decimals so shared URLs stay short. */
function compact(value: unknown): unknown {
  if (typeof value === "number") return Math.round(value * 1000) / 1000;
  if (Array.isArray(value)) return value.map(compact);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, compact(v)]));
  }
  return value;
}

export function encodeScenario(s: Scenario): string {
  const json = JSON.stringify(compact(s));
  const bytes = new TextEncoder().encode(json);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeScenario(code: string): Scenario | null {
  try {
    const b64 = code.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const s = JSON.parse(new TextDecoder().decode(bytes)) as Scenario;
    return isScenario(s) ? s : null;
  } catch {
    return null;
  }
}

function isScenario(s: unknown): s is Scenario {
  const o = s as Scenario;
  return (
    !!o &&
    o.version === 1 &&
    Array.isArray(o.buckets) &&
    Array.isArray(o.pipes) &&
    Array.isArray(o.pegs) &&
    Array.isArray(o.ramps) &&
    Array.isArray(o.people) &&
    typeof o.view === "object"
  );
}

export const cloneScenario = (s: Scenario): Scenario => structuredClone(s);
