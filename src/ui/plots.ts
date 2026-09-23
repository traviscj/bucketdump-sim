import type { App, Panel } from "../app";
import { landscape } from "../analysis/stiffness";
import type { Bucket } from "../physics/bucket";
import { toLitres } from "../physics/constants";

const HZ = 12;
const DEG = 180 / Math.PI;
const INK = "#d7dde3";
const DIM = "#6b7580";
const GRID = "#222a33";
const STABLE = "#3fb950";
const UNSTABLE = "#f85149";
const TRACE = ["#ffd60a", "#4cc9f0", "#f72585", "#80ed99", "#ff9f1c", "#b8b8ff"];

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The ∂ panel — small multiples for the selected bucket:
 *  [hysteresis θ*(V) + live trajectory] [energy landscape U(θ) w/ ball] [phase portrait (θ, ω)]
 *  [θ(t) and V(t) traces for every bucket]
 */
export class Plots implements Panel {
  private readonly ctx: CanvasRenderingContext2D;
  private last = 0;

  constructor(
    private readonly host: HTMLElement,
    private readonly canvas: HTMLCanvasElement,
    private readonly eqs: HTMLElement,
  ) {
    this.ctx = canvas.getContext("2d")!;
    // Tap the panel to cycle which bucket the big plots show.
    canvas.addEventListener("pointerdown", () => this.cycle?.());
  }

  private cycle: (() => void) | null = null;

  update(app: App, now: number): void {
    if (this.host.hidden || now - this.last < 1 / HZ) return;
    this.last = now;
    const { canvas, ctx } = this;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.font = "10px ui-monospace, Menlo, monospace";

    const buckets = app.world.buckets;
    if (!buckets.length) return;
    const sel = buckets.find((b) => b.spec.id === app.selected) ?? buckets[0];
    this.cycle = () => {
      const i = buckets.indexOf(sel);
      app.selected = buckets[(i + 1) % buckets.length].spec.id;
    };

    this.equations(app, sel);
    const top = Math.round(H * 0.62);
    const third = W / 3;
    this.hysteresis(app, sel, { x: 0, y: 0, w: third, h: top });
    this.energy(sel, { x: third, y: 0, w: third, h: top });
    this.phase(app, sel, { x: 2 * third, y: 0, w: third, h: top });
    this.traces(app, { x: 0, y: top, w: W, h: H - top });
  }

  /** The governing equations with the selected bucket's live numbers plugged in. */
  private equations(app: App, b: Bucket): void {
    const ev = b.last;
    const h = b.analysis;
    const q = app.world.pipes.reduce((s, p) => s + p.flow * p.valve * app.world.master, 0);
    const f = (v: number, d = 0) => v.toFixed(d);
    const L = (v: number) => toLitres(v).toFixed(0);
    this.eqs.innerHTML = [
      `<i>${b.spec.id}</i>  I(θ,V)·θ̈ = τ(θ,V) − c·θ̇ + τ_push      ${f(ev.inertia)}·θ̈ = ${f(ev.tau)} − ${f(b.spec.damping)}·${f(b.om, 2)}`,
      `     V̇ = q_in − q_weir,  q_weir = ⅔·Cd·√(2g)·H^³ᐟ²      q_in ≤ ${L(q)} L/s   q_weir = ${L(b.lastSpillRate)} L/s   V = ${L(b.volume)} L`,
      `     τ = −g·Σmᵢ·xᵢ   free surface ⟂ g   C(θ) = ${L(ev.fluid.capacity)} L   fold: V_tip = ${h.vTip ? L(h.vTip) : "—"} L → V_ret = ${h.vRet != null ? L(h.vRet) : "—"} L`,
    ].join("\n");
  }

  // ————— frames —————

  private frame(r: Rect, title: string): Rect {
    const { ctx } = this;
    ctx.strokeStyle = GRID;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    ctx.fillStyle = DIM;
    ctx.textAlign = "left";
    ctx.fillText(title, r.x + 4, r.y + 11);
    return { x: r.x + 30, y: r.y + 16, w: r.w - 36, h: r.h - 30 };
  }

  private axes(p: Rect, xl: string, x0: number, x1: number, yl: string, y0: number, y1: number): void {
    const { ctx } = this;
    ctx.fillStyle = DIM;
    ctx.textAlign = "right";
    ctx.fillText(y1.toFixed(0), p.x - 2, p.y + 8);
    ctx.fillText(y0.toFixed(0), p.x - 2, p.y + p.h);
    ctx.save();
    ctx.translate(p.x - 22, p.y + p.h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.fillText(yl, 0, 0);
    ctx.restore();
    ctx.textAlign = "left";
    ctx.fillText(x0.toFixed(0), p.x, p.y + p.h + 11);
    ctx.textAlign = "right";
    ctx.fillText(`${xl} ${x1.toFixed(0)}`, p.x + p.w, p.y + p.h + 11);
    ctx.strokeStyle = GRID;
    ctx.strokeRect(p.x, p.y, p.w, p.h);
  }

  // ————— hysteresis: equilibrium set θ*(V) and the live loop —————

  private hysteresis(app: App, b: Bucket, r: Rect): void {
    const { ctx } = this;
    const h = b.analysis;
    const p = this.frame(r, `${b.spec.id} θ*(V) hysteresis · ${h.verdict}`);
    const vMax = toLitres(h.vMax);
    const { thMin, thMax } = b.spec;
    const X = (v: number) => p.x + (toLitres(v) / vMax) * p.w;
    const Y = (th: number) => p.y + p.h - ((th - thMin) / (thMax - thMin || 1)) * p.h;
    this.axes(p, "V L", 0, vMax, "θ °", thMin * DEG, thMax * DEG);

    for (const e of h.points) {
      ctx.fillStyle = e.stable ? STABLE : UNSTABLE;
      ctx.globalAlpha = e.stop ? 0.5 : 0.9;
      ctx.fillRect(X(e.v) - 1, Y(e.th) - 1, 2, 2);
    }
    ctx.globalAlpha = 1;
    // Fold / return markers.
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1;
    for (const [v, label, color] of [
      [h.vTip, "tip", UNSTABLE],
      [h.vRet, "ret", STABLE],
    ] as const) {
      if (v == null) continue;
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(X(v), p.y);
      ctx.lineTo(X(v), p.y + p.h);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.textAlign = "center";
      ctx.fillText(label, X(v), p.y + 8);
    }
    ctx.setLineDash([]);
    // Live trajectory from the recorder.
    const ring = app.recorder.traces.get(b.spec.id);
    if (ring && ring.size > 1) {
      ctx.strokeStyle = TRACE[0];
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      const start = Math.max(0, ring.size - 600);
      for (let k = start; k < ring.size; k++) {
        const x = X(ring.get("v", k));
        const y = Y(ring.get("th", k));
        if (k === start) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(X(b.volume), Y(b.th), 3.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // ————— energy landscape with a rolling ball —————

  private energy(b: Bucket, r: Rect): void {
    const { ctx } = this;
    const p = this.frame(r, `U(θ) @ V=${toLitres(b.last.fluid.volume).toFixed(0)} L  (ball = bucket)`);
    const { th, u } = landscape(b, b.last.fluid.volume, 60);
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of u) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    const span = hi - lo || 1;
    const X = (t: number) => p.x + ((t - th[0]) / (th[th.length - 1] - th[0] || 1)) * p.w;
    const Y = (v: number) => p.y + p.h - ((v - lo) / span) * p.h;
    this.axes(p, "θ °", th[0] * DEG, th[th.length - 1] * DEG, "U J", lo, hi);
    ctx.strokeStyle = "#4cc9f0";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    th.forEach((t, i) => (i ? ctx.lineTo(X(t), Y(u[i])) : ctx.moveTo(X(t), Y(u[i]))));
    ctx.stroke();
    ctx.lineWidth = 1;
    // The ball sits on the curve at the current angle.
    const i = Math.max(0, Math.min(th.length - 1, Math.round(((b.th - th[0]) / (th[th.length - 1] - th[0] || 1)) * (th.length - 1))));
    ctx.fillStyle = b.spec.color;
    ctx.beginPath();
    ctx.arc(X(b.th), Y(u[i]) - 5, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  // ————— phase portrait —————

  private phase(app: App, b: Bucket, r: Rect): void {
    const { ctx } = this;
    const p = this.frame(r, `${b.spec.id} phase (θ, ω)`);
    const ring = app.recorder.traces.get(b.spec.id);
    const { thMin, thMax } = b.spec;
    let wmax = 1;
    if (ring) {
      const [a, c] = ring.extent("om");
      wmax = Math.max(1, Math.abs(a), Math.abs(c));
    }
    const X = (t: number) => p.x + ((t - thMin) / (thMax - thMin || 1)) * p.w;
    const Y = (w: number) => p.y + p.h / 2 - (w / wmax) * (p.h / 2);
    this.axes(p, "θ °", thMin * DEG, thMax * DEG, "ω r/s", -wmax, wmax);
    ctx.strokeStyle = GRID;
    ctx.beginPath();
    ctx.moveTo(p.x, Y(0));
    ctx.lineTo(p.x + p.w, Y(0));
    ctx.stroke();
    if (!ring || ring.size < 2) return;
    const start = Math.max(0, ring.size - 900);
    for (let k = start + 1; k < ring.size; k++) {
      // Older samples fade out.
      ctx.strokeStyle = TRACE[1];
      ctx.globalAlpha = 0.15 + (0.85 * (k - start)) / (ring.size - start);
      ctx.beginPath();
      ctx.moveTo(X(ring.get("th", k - 1)), Y(ring.get("om", k - 1)));
      ctx.lineTo(X(ring.get("th", k)), Y(ring.get("om", k)));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // ————— time traces, all buckets —————

  private traces(app: App, r: Rect): void {
    const { ctx } = this;
    const p = this.frame(r, "θ(t) solid · V(t) dotted · last 60 s");
    const rings = [...app.recorder.traces.entries()];
    if (!rings.length) return;
    const tEnd = app.world.time;
    const t0 = Math.max(0, tEnd - 60);
    const X = (t: number) => p.x + ((t - t0) / Math.max(1, tEnd - t0)) * p.w;
    const vMax = Math.max(...app.world.buckets.map((b) => b.model.maxCapacity));
    const thSpan = Math.max(...app.world.buckets.map((b) => Math.max(Math.abs(b.spec.thMin), Math.abs(b.spec.thMax))));
    this.axes(p, "t s", t0, tEnd, "", 0, 1);
    rings.forEach(([id, ring], idx) => {
      const color = TRACE[idx % TRACE.length];
      const b = app.world.bucket(id);
      const sign = b && b.spec.thMax > 0 ? 1 : -1;
      const series: ["th" | "v", number[]][] = [
        ["th", []],
        ["v", [2, 2]],
      ];
      for (const [col, dash] of series) {
        ctx.strokeStyle = color;
        ctx.setLineDash(dash);
        ctx.beginPath();
        for (let k = 0; k < ring.size; k++) {
          const t = ring.get("t", k);
          if (t < t0) continue;
          const v = col === "th" ? (sign * ring.get("th", k)) / thSpan : ring.get("v", k) / vMax;
          const y = p.y + p.h - v * p.h;
          if (k === 0 || ring.get("t", k - 1) < t0) ctx.moveTo(X(t), y);
          else ctx.lineTo(X(t), y);
        }
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.fillStyle = color;
      ctx.textAlign = "left";
      ctx.fillText(id, p.x + 4 + idx * 40, p.y + 9);
    });
    ctx.fillStyle = INK;
  }
}
