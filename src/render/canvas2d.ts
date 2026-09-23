import { transform } from "../geom/polygon";
import type { Bucket } from "../physics/bucket";
import { MATERIALS, MATERIAL_IDS, dominant } from "../physics/materials";
import { wallOutline } from "../physics/shapes";
import { contentBox } from "../world/scenario";
import type { SimEvent, World } from "../world/world";
import { hexA, shade } from "./color";
import { drawDebug } from "./debugOverlay";
import { drawPerson } from "./people";
import { View } from "./view";

export interface RenderOptions {
  transparent: boolean;
  debug: boolean;
  rainbow: boolean;
  /** Highlighted bucket (hover / selected in the designer). */
  selected?: string | null;
}

interface Effect {
  kind: "ring" | "bang";
  x: number;
  y: number;
  t0: number;
  size: number;
  color: string;
}

const SKY_TOP = "#6ec6ff";
const SKY_BOTTOM = "#d8f1ff";
const GROUND = "#8fa3b3";
const FRAME = "#f5b700";
const PIPE = "#9aa4b2";

/** Canvas 2D painter for a World. Holds only cosmetic state (effects, puddles). */
export class Renderer2D {
  readonly view = new View();
  private readonly ctx: CanvasRenderingContext2D;
  private effects: Effect[] = [];
  /** Wet-ground intensity per 0.25 m bin, decays over time. */
  private puddles = new Float32Array(80);
  private dpr = 1;

  constructor(readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas unavailable");
    this.ctx = ctx;
  }

  resize(cssW: number, cssH: number, world: World): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(cssW * this.dpr);
    this.canvas.height = Math.round(cssH * this.dpr);
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    this.view.fit(contentBox(world.scenario), cssW, cssH, 6);
  }

  onEvent(e: SimEvent, world: World, now: number): void {
    if (e.type === "splash") {
      const bin = Math.floor((e.x + 10) * 4);
      if (bin >= 0 && bin < this.puddles.length) this.puddles[bin] = Math.min(1, this.puddles[bin] + e.volume * 40);
      if (this.effects.length < 60 && Math.random() < 0.25) {
        this.effects.push({ kind: "ring", x: e.x, y: 0, t0: now, size: 0.2 + Math.min(0.6, e.speed * 0.06), color: MATERIALS[e.material].color });
      }
    } else if (e.type === "tip") {
      const b = world.bucket(e.bucket);
      if (b) this.effects.push({ kind: "bang", x: b.spec.pivot.x, y: b.spec.pivot.y + 1.2, t0: now, size: 1, color: "#fff" });
    }
  }

  draw(world: World, opts: RenderOptions, now: number): void {
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawBackground();
    for (const b of world.buckets) this.drawFrame(b, now);
    for (const r of world.scenario.ramps) this.drawRamp(r.a, r.b);
    for (const p of world.scenario.pegs) this.drawPeg(p.x, p.y, p.r);
    for (const p of world.people) drawPerson(this.ctx, this.view, p, world.time);
    for (const b of world.buckets) this.drawBucket(b, opts, now);
    this.drawParticles(world, opts, now);
    for (const p of world.pipes) this.drawPipe(p.x, p.y, p.angle, p.valve * world.master, p.color, now);
    this.drawEffects(now);
    if (opts.debug) for (const b of world.buckets) drawDebug(this.ctx, this.view, b);
  }

  // ————— scenery —————

  private drawBackground(): void {
    const { ctx, view } = this;
    const g = ctx.createLinearGradient(0, 0, 0, view.height);
    g.addColorStop(0, SKY_TOP);
    g.addColorStop(1, SKY_BOTTOM);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, view.width, view.height);

    // Sun, top-right.
    ctx.fillStyle = "#fff6b0";
    ctx.beginPath();
    ctx.arc(view.width - 40, 40, 22, 0, Math.PI * 2);
    ctx.fill();

    // Splash-pad ground with tile joints and wet patches.
    const gy = view.sy(0);
    ctx.fillStyle = GROUND;
    ctx.fillRect(0, gy, view.width, view.height - gy);
    ctx.strokeStyle = "#7d91a1";
    ctx.lineWidth = 1;
    const vis = view.visible();
    for (let x = Math.floor(vis.minX); x <= vis.maxX; x += 1) {
      ctx.beginPath();
      ctx.moveTo(view.sx(x), gy);
      ctx.lineTo(view.sx(x), view.height);
      ctx.stroke();
    }
    for (let i = 0; i < this.puddles.length; i++) {
      const w = this.puddles[i];
      if (w < 0.02) continue;
      this.puddles[i] *= 0.997;
      const x = i / 4 - 10;
      ctx.fillStyle = `rgba(40,90,140,${0.45 * w})`;
      ctx.beginPath();
      ctx.ellipse(view.sx(x + 0.125), gy + 3, view.scale * 0.3, 4, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /**
   * Gantry: two posts straddling the bucket (behind it, in depth) carrying the
   * axle, with a warning beacon on top of the taller post.
   */
  private drawFrame(b: Bucket, now: number): void {
    const { ctx, view } = this;
    const { pivot, shape } = b.spec;
    const half = Math.hypot(shape.width / 2, shape.height) * 0.75 + 0.1;
    const xl = view.sx(pivot.x - half);
    const xr = view.sx(pivot.x + half);
    const py = view.sy(pivot.y);
    const gy = view.sy(0);
    // Muted: the gantry is behind everything else, in depth.
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = FRAME;
    ctx.lineCap = "round";
    ctx.lineWidth = Math.max(3, view.scale * 0.07);
    ctx.beginPath();
    ctx.moveTo(xl, gy);
    ctx.lineTo(xl, py);
    ctx.moveTo(xr, gy);
    ctx.lineTo(xr, py);
    ctx.stroke();
    // Axle bar (thinner, darker: it's further back).
    ctx.strokeStyle = shade(FRAME, -0.35);
    ctx.lineWidth = Math.max(2, view.scale * 0.05);
    ctx.beginPath();
    ctx.moveTo(xl, py);
    ctx.lineTo(xr, py);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Beacon on a mast above the left post: dark → flashing red as the warning rises.
    const w = b.warning;
    const top = view.sy(pivot.y + 0.5);
    ctx.strokeStyle = "#555";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(xl, py);
    ctx.lineTo(xl, top);
    ctx.stroke();
    const flash = w > 0 && Math.sin(now * (6 + 14 * w)) > 0;
    const r = Math.max(4, view.scale * 0.1);
    if (flash) {
      const halo = ctx.createRadialGradient(xl, top, 0, xl, top, r * 5);
      halo.addColorStop(0, `rgba(255,60,40,${0.6 * w + 0.2})`);
      halo.addColorStop(1, "rgba(255,60,40,0)");
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(xl, top, r * 5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = flash ? "#ff3b30" : w > 0 ? "#8a2a22" : "#3a3a3a";
    ctx.beginPath();
    ctx.arc(xl, top, r, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawRamp(a: { x: number; y: number }, b: { x: number; y: number }): void {
    const { ctx, view } = this;
    ctx.strokeStyle = "#e76f51";
    ctx.lineWidth = Math.max(4, view.scale * 0.08);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(view.sx(a.x), view.sy(a.y));
    ctx.lineTo(view.sx(b.x), view.sy(b.y));
    ctx.stroke();
  }

  private drawPeg(x: number, y: number, r: number): void {
    const { ctx, view } = this;
    const sx = view.sx(x);
    const sy = view.sy(y);
    const sr = Math.max(2, r * view.scale);
    ctx.fillStyle = "#264653";
    ctx.beginPath();
    ctx.arc(sx, sy, sr, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.beginPath();
    ctx.arc(sx - sr * 0.3, sy - sr * 0.3, sr * 0.35, 0, Math.PI * 2);
    ctx.fill();
  }

  /** Pipe comes down from the top of the screen, bends to `angle`, with a valve wheel. */
  private drawPipe(x: number, y: number, angle: number, valve: number, color: string, now: number): void {
    const { ctx, view } = this;
    const ox = view.sx(x);
    const oy = view.sy(y);
    const w = Math.max(6, view.scale * 0.16);
    const back = { x: -Math.cos(angle) * 0.35, y: -Math.sin(angle) * 0.35 };
    const elbow = { x: view.sx(x + back.x), y: view.sy(y + back.y) };
    ctx.strokeStyle = color || PIPE;
    ctx.lineWidth = w;
    ctx.lineCap = "butt";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(elbow.x, -10);
    ctx.lineTo(elbow.x, elbow.y);
    ctx.lineTo(ox, oy);
    ctx.stroke();
    // Nozzle lip.
    ctx.strokeStyle = "#5c6670";
    ctx.lineWidth = w * 1.3;
    ctx.beginPath();
    const nx = Math.cos(angle) * 3;
    const ny = -Math.sin(angle) * 3;
    ctx.moveTo(ox - nx, oy - ny);
    ctx.lineTo(ox, oy);
    ctx.stroke();
    // Valve wheel: spins while open.
    const vy = Math.max(elbow.y - view.scale * 0.6, 18);
    const R = Math.max(7, view.scale * 0.14);
    ctx.save();
    ctx.translate(elbow.x, vy);
    ctx.rotate(now * valve * 3);
    ctx.strokeStyle = valve > 0 ? "#e63946" : "#7a1f25";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    for (let k = 0; k < 3; k++) {
      const a = (k * Math.PI) / 3;
      ctx.moveTo(Math.cos(a) * R, Math.sin(a) * R);
      ctx.lineTo(-Math.cos(a) * R, -Math.sin(a) * R);
    }
    ctx.stroke();
    ctx.restore();
  }

  // ————— buckets —————

  private drawBucket(b: Bucket, opts: RenderOptions, now: number): void {
    const { ctx, view } = this;
    const pose = b.pose;
    const toS = (p: { x: number; y: number }) => ({ x: view.sx(p.x), y: view.sy(p.y) });
    const path = (poly: { x: number; y: number }[]) => {
      ctx.beginPath();
      poly.forEach((p, i) => {
        const s = toS(p);
        if (i === 0) ctx.moveTo(s.x, s.y);
        else ctx.lineTo(s.x, s.y);
      });
      ctx.closePath();
    };
    const cavity = transform(b.model.cavity, pose);
    const outline = transform(wallOutline(b.model.cavity, b.spec.wall), pose);
    const fluid = b.last.fluid;
    const fluidWorld = fluid.poly.map((p) => ({ x: p.x + pose.x, y: p.y + pose.y }));
    const mat = MATERIALS[dominant(b.mix)];
    const fluidColor = opts.rainbow ? `hsl(${(now * 60) % 360},90%,60%)` : mat.color;

    if (opts.transparent) {
      // Glass: faint tint, fluid visible, level gauge ticks.
      ctx.fillStyle = "rgba(255,255,255,0.18)";
      path(cavity);
      ctx.fill();
      if (fluidWorld.length >= 3) {
        ctx.fillStyle = fluidColor;
        ctx.globalAlpha = 0.85;
        path(fluidWorld);
        ctx.fill();
        ctx.globalAlpha = 1;
        this.drawSurface(fluidWorld, fluid.level + pose.y);
      }
      ctx.fillStyle = hexA(b.spec.color, 0.45);
      path(outline);
      ctx.fill("evenodd");
      ctx.strokeStyle = b.spec.color;
      ctx.lineWidth = 2;
      path(outline);
      ctx.stroke();
      this.drawGaugeTicks(b);
    } else {
      // Painted steel: back wall darker, fluid hidden except what peeks over the lip.
      ctx.fillStyle = shade(b.spec.color, -0.35);
      path(cavity);
      ctx.fill();
      if (fluidWorld.length >= 3) {
        ctx.save();
        ctx.fillStyle = fluidColor;
        path(fluidWorld);
        ctx.clip();
        // Only a sliver near the free surface shows through the open mouth.
        const lvl = view.sy(fluid.level + pose.y);
        ctx.fillRect(0, lvl - 1, view.width, Math.max(3, view.scale * 0.06));
        ctx.restore();
      }
      ctx.fillStyle = b.spec.color;
      path(outline);
      ctx.fill();
      // Front face covers the cavity (it's opaque!); stripes for style.
      ctx.save();
      path(cavity);
      ctx.clip();
      ctx.fillStyle = b.spec.color;
      path(cavity);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = Math.max(2, view.scale * 0.06);
      const h = b.spec.shape.height;
      for (const f of [0.3, 0.7]) {
        const a = toS(b.toWorld({ x: -b.spec.shape.width, y: h * f }));
        const c = toS(b.toWorld({ x: b.spec.shape.width, y: h * f }));
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(c.x, c.y);
        ctx.stroke();
      }
      ctx.restore();
      ctx.strokeStyle = shade(b.spec.color, -0.4);
      ctx.lineWidth = 2;
      path(outline);
      ctx.stroke();
    }

    // Counterweight block on a rod from the bucket's bottom.
    const bw = toS(b.toWorld(b.model.ballastLocal));
    const root = toS(b.toWorld({ x: 0, y: -b.spec.wall / 2 }));
    ctx.strokeStyle = "#37474f";
    ctx.lineWidth = Math.max(2, view.scale * 0.04);
    ctx.beginPath();
    ctx.moveTo(root.x, root.y);
    ctx.lineTo(bw.x, bw.y);
    ctx.stroke();
    const bs = Math.max(5, Math.sqrt(b.spec.ballast / 30) * view.scale * 0.12);
    ctx.save();
    ctx.translate(bw.x, bw.y);
    ctx.rotate(-b.th);
    ctx.fillStyle = "#37474f";
    ctx.fillRect(-bs / 2, -bs / 2, bs, bs);
    ctx.restore();

    // Axle.
    const ax = toS(b.spec.pivot);
    ctx.fillStyle = "#222";
    ctx.beginPath();
    ctx.arc(ax.x, ax.y, Math.max(3, view.scale * 0.06), 0, Math.PI * 2);
    ctx.fill();

    if (opts.selected === b.spec.id) {
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      path(outline);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  /** Highlight line along the free surface. */
  private drawSurface(fluidWorld: { x: number; y: number }[], level: number): void {
    const { ctx, view } = this;
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of fluidWorld) {
      if (Math.abs(p.y - level) < 1e-6) {
        lo = Math.min(lo, p.x);
        hi = Math.max(hi, p.x);
      }
    }
    if (!Number.isFinite(lo)) return;
    ctx.strokeStyle = "rgba(255,255,255,0.8)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(view.sx(lo), view.sy(level));
    ctx.lineTo(view.sx(hi), view.sy(level));
    ctx.stroke();
  }

  /** Tick marks every 25% of the upright capacity, plus a red one at the tip volume. */
  private drawGaugeTicks(b: Bucket): void {
    const { ctx, view } = this;
    const c = b.model.cavity;
    const right = c[c.length - 1];
    const h = b.spec.shape.height;
    ctx.strokeStyle = "rgba(0,0,0,0.45)";
    ctx.lineWidth = 1;
    for (const f of [0.25, 0.5, 0.75]) {
      const a = b.toWorld({ x: right.x - 0.02, y: h * f });
      const d = b.toWorld({ x: right.x - 0.12, y: h * f });
      ctx.beginPath();
      ctx.moveTo(view.sx(a.x), view.sy(a.y));
      ctx.lineTo(view.sx(d.x), view.sy(d.y));
      ctx.stroke();
    }
  }

  // ————— particles & people —————

  private drawParticles(world: World, opts: RenderOptions, now: number): void {
    const { ctx, view } = this;
    const P = world.particles;
    ctx.lineCap = "round";
    // Batch by (material, colour) so each group is one stroke call.
    for (let m = 0; m < MATERIAL_IDS.length; m++) {
      const mat = MATERIALS[MATERIAL_IDS[m]];
      const colors = opts.rainbow ? 6 : (mat.palette?.length ?? 1);
      const liquid = mat.restitution < 0.3;
      for (let c = 0; c < colors; c++) {
        ctx.beginPath();
        let any = false;
        for (let i = 0; i < P.count; i++) {
          if (P.mat[i] !== m || P.tint[i] % colors !== c) continue;
          any = true;
          const x = view.sx(P.x[i]);
          const y = view.sy(P.y[i]);
          // Liquids draw as short streaks along their velocity; solids as dots.
          const k = liquid ? 0.025 * view.scale : 0;
          ctx.moveTo(x, y);
          ctx.lineTo(x - P.vx[i] * k + 0.01, y + P.vy[i] * k);
        }
        if (!any) continue;
        ctx.strokeStyle = opts.rainbow ? `hsl(${(c * 60 + now * 90) % 360},90%,60%)` : (mat.palette?.[c] ?? mat.color);
        ctx.globalAlpha = liquid ? 0.85 : 1;
        ctx.lineWidth = Math.max(2, mat.radius * 2 * view.scale * (liquid ? 0.9 : 1));
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
  }

  private drawEffects(now: number): void {
    const { ctx, view } = this;
    this.effects = this.effects.filter((e) => now - e.t0 < (e.kind === "bang" ? 0.9 : 0.6));
    for (const e of this.effects) {
      const age = now - e.t0;
      if (e.kind === "ring") {
        const k = age / 0.6;
        ctx.strokeStyle = hexA(e.color, 0.7 * (1 - k));
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(view.sx(e.x), view.sy(e.y), e.size * view.scale * (0.3 + k), 3 + 4 * k, 0, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        // Comic "SPLOOSH!" burst when a bucket tips.
        const k = age / 0.9;
        ctx.save();
        ctx.translate(view.sx(e.x), view.sy(e.y));
        ctx.scale(0.6 + k * 0.6, 0.6 + k * 0.6);
        ctx.globalAlpha = 1 - k;
        ctx.font = `900 ${Math.max(16, view.scale * 0.45)}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.lineWidth = 5;
        ctx.strokeStyle = "#1d3557";
        ctx.strokeText("SPLOOSH!", 0, 0);
        ctx.fillStyle = "#ffd60a";
        ctx.fillText("SPLOOSH!", 0, 0);
        ctx.restore();
      }
    }
  }
}
