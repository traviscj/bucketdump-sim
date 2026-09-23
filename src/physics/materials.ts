/** Fill materials. The bucket treats everything as a fluid; materials differ in
 *  density, how readily they pour over the lip, and how their particles fly. */
export type MaterialId = "water" | "acorns" | "balls" | "sand" | "slime";

export interface Material {
  id: MaterialId;
  name: string;
  emoji: string;
  /** Base colour; `palette` (if set) is sampled per particle instead. */
  color: string;
  palette?: string[];
  /** Bulk density, kg/m³. */
  density: number;
  /** Weir discharge coefficient — lower pours slower. */
  cd: number;
  /** Particle collision/visual radius (m) and the volume each particle carries (m²). */
  radius: number;
  particleVolume: number;
  restitution: number;
  /** Linear air drag, 1/s. */
  drag: number;
  /** Sound family for impacts. */
  sound: "splash" | "clack" | "boing" | "shh" | "squelch";
}

export const MATERIALS: Record<MaterialId, Material> = {
  water: {
    id: "water",
    name: "Water",
    emoji: "💧",
    color: "#3aa0ff",
    density: 1000,
    cd: 0.62,
    radius: 0.035,
    particleVolume: 0.0016,
    restitution: 0.15,
    drag: 0.05,
    sound: "splash",
  },
  acorns: {
    id: "acorns",
    name: "Acorns",
    emoji: "🌰",
    color: "#8a5a2b",
    palette: ["#8a5a2b", "#a0692f", "#6e4521", "#b5803f"],
    density: 650,
    cd: 0.35,
    radius: 0.06,
    particleVolume: 0.005,
    restitution: 0.45,
    drag: 0.02,
    sound: "clack",
  },
  balls: {
    id: "balls",
    name: "Ball pit",
    emoji: "🔴",
    color: "#ff4d4d",
    palette: ["#ff4d4d", "#ffd23f", "#3bceac", "#4d7cff", "#c44dff"],
    density: 250,
    cd: 0.4,
    radius: 0.08,
    particleVolume: 0.009,
    restitution: 0.8,
    drag: 0.03,
    sound: "boing",
  },
  sand: {
    id: "sand",
    name: "Sand",
    emoji: "🏖️",
    color: "#e2c07a",
    palette: ["#e2c07a", "#d4ae63", "#ecd29b"],
    density: 1600,
    cd: 0.28,
    radius: 0.025,
    particleVolume: 0.0012,
    restitution: 0.02,
    drag: 0.08,
    sound: "shh",
  },
  slime: {
    id: "slime",
    name: "Slime",
    emoji: "🟢",
    color: "#6cff4d",
    density: 1100,
    cd: 0.14,
    radius: 0.045,
    particleVolume: 0.0025,
    restitution: 0.0,
    drag: 0.4,
    sound: "squelch",
  },
};

export const MATERIAL_IDS = Object.keys(MATERIALS) as MaterialId[];

/** Volume-weighted mixture of materials held in a bucket. */
export type Mix = Partial<Record<MaterialId, number>>;

export function mixDensity(mix: Mix): number {
  let v = 0;
  let m = 0;
  for (const id of MATERIAL_IDS) {
    const f = mix[id] ?? 0;
    v += f;
    m += f * MATERIALS[id].density;
  }
  return v > 0 ? m / v : MATERIALS.water.density;
}

export function mixCd(mix: Mix): number {
  let v = 0;
  let c = 0;
  for (const id of MATERIAL_IDS) {
    const f = mix[id] ?? 0;
    v += f;
    c += f * MATERIALS[id].cd;
  }
  return v > 0 ? c / v : MATERIALS.water.cd;
}

/** Material with the largest share (for colouring the bucket contents). */
export function dominant(mix: Mix): MaterialId {
  let best: MaterialId = "water";
  let bv = -1;
  for (const id of MATERIAL_IDS) {
    if ((mix[id] ?? 0) > bv) {
      bv = mix[id] ?? 0;
      best = id;
    }
  }
  return best;
}

/** Sample a material from the mix with a uniform random `u ∈ [0,1)`. */
export function sampleMix(mix: Mix, u: number): MaterialId {
  let total = 0;
  for (const id of MATERIAL_IDS) total += mix[id] ?? 0;
  let acc = 0;
  for (const id of MATERIAL_IDS) {
    acc += (mix[id] ?? 0) / (total || 1);
    if (u < acc) return id;
  }
  return dominant(mix);
}
