import { contains, transform } from "./geom/polygon";
import { Recorder } from "./analysis/recorder";
import { Sound } from "./audio/sound";
import { wallOutline } from "./physics/shapes";
import { Renderer2D } from "./render/canvas2d";
import { type Mode, playMode } from "./modes/mode";
import { renderControls } from "./ui/controls";
import { Generator } from "./world/generator";
import { type Scenario, cloneScenario, encodeScenario } from "./world/scenario";
import { type SimEvent, World } from "./world/world";
import type { Bucket } from "./physics/bucket";

export interface Toggles {
  transparent: boolean;
  debug: boolean;
  rainbow: boolean;
  dash: boolean;
  diffeq: boolean;
  muted: boolean;
}

/** Anything that wants a per-frame refresh (dashboard, plots, 3D view). */
export interface Panel {
  update(app: App, now: number): void;
}

const SLOW_SCALE = 0.25;

/**
 * Owns the World and wires it to rendering, sound, UI and modes.
 * The frame loop is requestAnimationFrame-driven, so it parks itself while
 * the tab is hidden and resumes with a clamped dt.
 */
export class App {
  world!: World;
  /** The pristine scenario (so ↺ can restart it). */
  scenario!: Scenario;
  readonly renderer: Renderer2D;
  readonly sound = new Sound();
  readonly recorder = new Recorder(30, 60);
  readonly generator = new Generator();
  readonly toggles: Toggles = { transparent: true, debug: false, rainbow: false, dash: false, diffeq: false, muted: false };
  slow = false;
  mode: Mode = playMode;
  /** Optional alternate renderer (3D). When set, it draws instead of the 2D canvas. */
  altView: (Panel & { dispose(): void }) | null = null;
  readonly panels: Panel[] = [];
  selected: string | null = null;
  private nextDing = new Map<string, number>();
  private lastFrame = 0;
  private raf = 0;
  private listeners: (() => void)[] = [];
  private scenarioListeners: (() => void)[] = [];

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly stage: HTMLElement,
    readonly controls: HTMLElement,
    readonly hud: HTMLElement,
  ) {
    this.renderer = new Renderer2D(canvas);
    this.bindInput();
  }

  // ————— scenario lifecycle —————

  /**
   * Swap in a new scenario. `hash` is what goes in the URL: pass `p=<id>` for
   * an untouched preset; by default the whole scenario is encoded (shareable).
   */
  load(sc: Scenario, opts: { updateUrl?: boolean; hash?: string } = {}): void {
    this.scenario = cloneScenario(sc);
    this.world = new World(cloneScenario(sc));
    this.recorder.reset();
    this.nextDing.clear();
    this.selected = null;
    renderControls(this, this.controls);
    this.resize();
    if (opts.updateUrl !== false) this.writeUrl(opts.hash);
    for (const f of this.scenarioListeners) f();
  }

  /** Restart the current scenario (keeping live valve settings). */
  reload(): void {
    const valves = this.world.pipes.map((p) => p.valve);
    this.load(this.scenario, { updateUrl: false });
    this.world.pipes.forEach((p, i) => (p.valve = valves[i] ?? p.valve));
    renderControls(this, this.controls);
  }

  /** Rebuild the kid panel (after valves/pipes change programmatically). */
  renderControls(): void {
    renderControls(this, this.controls);
  }

  onScenarioChange(f: () => void): void {
    this.scenarioListeners.push(f);
  }

  writeUrl(hash = `s=${encodeScenario(this.scenario)}`): void {
    history.replaceState(null, "", `#${hash}`);
  }

  setMode(m: Mode): void {
    this.mode.exit(this);
    this.mode = m;
    m.enter(this);
  }

  setSlow(on: boolean): void {
    this.slow = on;
  }

  dumpAll(): void {
    this.sound.unlock();
    // Shove the fullest filling bucket; if none has much in it, shove them all.
    const filling = this.world.buckets.filter((b) => b.phase === "filling");
    const fullest = filling.sort((a, b) => b.volume / b.model.maxCapacity - a.volume / a.model.maxCapacity)[0];
    if (fullest && fullest.volume > 0.05 * fullest.model.maxCapacity) fullest.shove();
    else for (const b of filling) b.shove();
  }

  // ————— frame loop —————

  start(): void {
    const frame = (t: number) => {
      this.raf = requestAnimationFrame(frame);
      const now = t / 1000;
      const dt = this.lastFrame ? Math.min(0.1, now - this.lastFrame) : 0;
      this.lastFrame = now;
      this.tick(dt, now);
    };
    this.raf = requestAnimationFrame(frame);
    const onVis = () => {
      // rAF stops while hidden; forget the gap so we don't fast-forward.
      if (!document.hidden) this.lastFrame = 0;
    };
    document.addEventListener("visibilitychange", onVis);
    this.listeners.push(() => document.removeEventListener("visibilitychange", onVis));
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.generator.dispose();
    for (const off of this.listeners) off();
    this.listeners = [];
  }

  private tick(dt: number, now: number): void {
    const w = this.world;
    w.advance(dt, this.slow ? SLOW_SCALE : 1);
    this.mode.update?.(this, dt);
    for (const e of w.drainEvents()) this.handleEvent(e, now);
    this.recorder.sample(w.time, w.buckets);
    this.ding(now);
    if (this.altView) this.altView.update(this, now);
    else
      this.renderer.draw(
        w,
        { transparent: this.toggles.transparent, debug: this.toggles.debug, rainbow: this.toggles.rainbow, selected: this.selected },
        now,
      );
    for (const p of this.panels) p.update(this, now);
    const hud = this.mode.hud?.(this) ?? "";
    if (this.hud.innerHTML !== hud) this.hud.innerHTML = hud;
  }

  private handleEvent(e: SimEvent, now: number): void {
    this.renderer.onEvent(e, this.world, now);
    this.mode.onEvent?.(this, e);
    switch (e.type) {
      case "tip":
        this.sound.whoosh(e.volume);
        navigator.vibrate?.(80);
        break;
      case "thunk":
        this.sound.thunk(e.speed);
        break;
      case "splash":
        this.sound.impact(e.material, e.volume, e.speed);
        break;
      case "soak":
        if (Math.random() < 0.5) this.sound.squeal();
        break;
      case "reset":
        break;
    }
  }

  /** ding ding ding — faster and higher as a bucket nears its tip. */
  private ding(now: number): void {
    for (const b of this.world.buckets) {
      const w = b.warning;
      if (w <= 0) {
        this.nextDing.delete(b.spec.id);
        continue;
      }
      const next = this.nextDing.get(b.spec.id) ?? 0;
      if (now >= next) {
        this.sound.dingDingDing(w);
        this.nextDing.set(b.spec.id, now + 1.8 - 1.1 * w);
      }
    }
  }

  // ————— layout & input —————

  resize(): void {
    const r = this.stage.getBoundingClientRect();
    this.renderer.resize(Math.max(50, r.width), Math.max(50, r.height), this.world);
  }

  /** Bucket under a screen point (CSS px), with a little slop for small fingers. */
  bucketAt(sx: number, sy: number): Bucket | null {
    const p = this.renderer.view.toWorld(sx, sy);
    const slop = 16 / this.renderer.view.scale;
    for (const b of this.world.buckets) {
      const outline = transform(wallOutline(b.model.cavity, b.spec.wall + slop), b.pose);
      if (contains(outline, p) || contains(transform(b.model.cavity, b.pose), p)) return b;
    }
    return null;
  }

  private bindInput(): void {
    // The stage changes size with the window *and* when the control panel reflows.
    const ro = new ResizeObserver(() => this.world && this.resize());
    ro.observe(this.stage);
    this.listeners.push(() => ro.disconnect());

    const local = (e: PointerEvent) => {
      const r = this.canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    this.canvas.addEventListener("pointerdown", (e) => {
      this.sound.unlock();
      const { x, y } = local(e);
      this.canvas.setPointerCapture(e.pointerId);
      if (this.mode.pointerDown?.(this, x, y)) return;
      // Default: tap a bucket to shove it over early.
      const b = this.bucketAt(x, y);
      if (b) {
        b.shove();
        this.sound.click();
      }
    });
    this.canvas.addEventListener("pointermove", (e) => {
      const { x, y } = local(e);
      this.mode.pointerMove?.(this, x, y);
    });
    this.canvas.addEventListener("pointerup", () => this.mode.pointerUp?.(this));
    // Any first touch anywhere unlocks audio on iOS.
    window.addEventListener("pointerdown", () => this.sound.unlock(), { once: true });
  }
}
