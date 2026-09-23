import type { App } from "../app";
import type { Vec } from "../geom/vec";
import type { BucketSpec } from "../physics/bucketModel";
import { toLitres } from "../physics/constants";
import { MATERIAL_IDS, MATERIALS, type MaterialId } from "../physics/materials";
import { SHAPE_KINDS, type ShapeKind } from "../physics/shapes";
import { type BucketRecipe, buildBucket, returnsWhileFed } from "../world/buildBucket";
import { BUCKET_COLORS, PERSON_COLORS, pegField, pipeOver } from "../world/presets";
import type { Scenario } from "../world/scenario";
import { buttons, checkRow, colorRow, heading, numberRow, row, selectRow } from "../ui/form";
import type { Mode } from "./mode";

type Selection =
  | { kind: "bucket"; id: string }
  | { kind: "pipe"; id: string }
  | { kind: "person"; id: string }
  | { kind: "peg"; index: number }
  | null;

interface Drag {
  sel: NonNullable<Selection>;
  /** Pointer offset from the object's anchor, in world units. */
  dx: number;
  dy: number;
}

const GRAB = 0.35; // m

/**
 * Design mode: drag things around, edit them in the inspector, add/remove,
 * share. Edits land in `app.scenario` (the source of truth for ↺ and the URL);
 * geometry edits also restart the sim so the change is felt immediately.
 */
export class DesignMode implements Mode {
  readonly id = "design";
  readonly label = "✏️ design";
  private sel: Selection = null;
  private drag: Drag | null = null;
  /** Keep ballast auto-tuned to a target tip fill (per bucket id). */
  private autoTune = new Map<string, boolean>();

  constructor(private readonly panel: HTMLElement) {}

  enter(app: App): void {
    this.panel.hidden = false;
    app.toggles.debug = true;
    this.inspect(app);
  }

  exit(app: App): void {
    this.panel.hidden = true;
    app.selected = null;
    app.toggles.debug = false;
  }

  hud(): string {
    return this.drag ? "" : "✏️ drag things · tap to edit";
  }

  // ————— picking & dragging —————

  pointerDown(app: App, sx: number, sy: number): boolean {
    const p = app.renderer.view.toWorld(sx, sy);
    const w = app.world;
    const near = (a: Vec) => Math.hypot(a.x - p.x, a.y - p.y) < GRAB;
    let sel: Selection = null;
    let anchor: Vec = p;
    const pipe = w.pipes.find((q) => near(q));
    const person = w.people.find((q) => Math.abs(q.spec.x - p.x) < q.width && p.y > 0 && p.y < q.spec.height);
    const bucket = app.bucketAt(sx, sy);
    const peg = w.scenario.pegs.findIndex((q) => near(q));
    if (pipe) {
      sel = { kind: "pipe", id: pipe.id };
      anchor = pipe;
    } else if (bucket) {
      sel = { kind: "bucket", id: bucket.spec.id };
      anchor = bucket.spec.pivot;
    } else if (person) {
      sel = { kind: "person", id: person.spec.id };
      anchor = { x: person.spec.x, y: 0 };
    } else if (peg >= 0) {
      sel = { kind: "peg", index: peg };
      anchor = w.scenario.pegs[peg];
    }
    this.sel = sel;
    app.selected = sel?.kind === "bucket" ? sel.id : null;
    this.drag = sel ? { sel, dx: anchor.x - p.x, dy: anchor.y - p.y } : null;
    this.inspect(app);
    return true;
  }

  pointerMove(app: App, sx: number, sy: number): void {
    if (!this.drag) return;
    const p = app.renderer.view.toWorld(sx, sy);
    const x = snap(p.x + this.drag.dx);
    const y = Math.max(0, snap(p.y + this.drag.dy));
    // Move the live object *and* its scenario twin so ↺/share keep the edit.
    for (const sc of [app.world.scenario, app.scenario]) move(sc, this.drag.sel, x, y);
    // People are mirrored in World.people specs (same objects as world.scenario).
  }

  pointerUp(app: App): void {
    if (!this.drag) return;
    this.drag = null;
    app.writeUrl();
    this.inspect(app);
  }

  // ————— inspector —————

  private inspect(app: App): void {
    const P = this.panel;
    P.replaceChildren();
    P.append(
      heading(`✏️ ${app.scenario.name}`),
      buttons(
        ["+ bucket", () => this.addBucket(app)],
        ["+ pipe", () => this.addPipe(app)],
        ["+ person", () => this.addPerson(app)],
        ["+ pegs", () => this.addPegs(app)],
        ["🗑", () => this.remove(app), "Delete selected"],
        ["🔗 share", () => this.share(app), "Copy a link to this park"],
        ["⌫ clear", () => this.clear(app), "Start from an empty park"],
      ),
    );
    const s = this.sel;
    if (!s) {
      P.append(row("tip", document.createTextNode("tap a bucket, pipe, person or peg")));
      return;
    }
    if (s.kind === "bucket") this.inspectBucket(app, s.id);
    else if (s.kind === "pipe") this.inspectPipe(app, s.id);
    else if (s.kind === "person") P.append(heading(`person ${s.id}`), row("", document.createTextNode("drag to move")));
    else P.append(heading(`peg ${s.index}`));
  }

  private inspectBucket(app: App, id: string): void {
    const spec = app.scenario.buckets.find((b) => b.id === id);
    const live = app.world.bucket(id);
    if (!spec || !live) return;
    const P = this.panel;
    const h = live.analysis;
    const auto = this.autoTune.get(id) ?? true;
    const tipAt = h.vTip ? h.vTip / live.model.maxCapacity : 0.7;
    const fed = returnsWhileFed(spec, live.density);
    const verdict = document.createElement("div");
    verdict.className = `verdict ${h.verdict === "works" ? "ok" : "bad"}`;
    verdict.innerHTML =
      h.verdict === "works"
        ? `✓ works · tips at ${(100 * tipAt).toFixed(0)}% (${toLitres(h.vTip!).toFixed(0)} L) · returns ≤ ${toLitres(h.vRet ?? 0).toFixed(0)} L${fed ? "" : " · <span class='warn'>a strong pipe can pin it tipped</span>"}`
        : { overflows: "✗ overflows: brims over before it tips (less counterweight or lower axle)", stuck: "✗ stuck: flops over and stays (more counterweight or earlier stop)", unstable: "✗ unstable: won't sit upright empty" }[
            h.verdict
          ];
    const pours = spec.thMax > 0 ? "left" : "right";
    const rebuild = (r: Partial<BucketRecipe>) => this.rebuildBucket(app, spec, { ...recipeOf(spec, tipAt), ...r });
    const patch = (f: (b: BucketSpec) => void) => {
      f(spec);
      this.autoTune.set(id, false);
      this.reload(app);
    };

    P.append(
      heading(`🪣 bucket ${id}`),
      verdict,
      selectRow("shape", spec.shape.kind, SHAPE_KINDS, (kind: ShapeKind) => rebuild({ kind })),
      selectRow("pours", pours, ["left", "right"] as const, (p) => rebuild({ pours: p })),
      numberRow({ label: "width", value: spec.shape.width, min: 0.5, max: 2.6, step: 0.05, unit: "m", onChange: (width) => rebuild({ width }) }),
      numberRow({ label: "height", value: spec.shape.height, min: 0.4, max: 1.8, step: 0.05, unit: "m", onChange: (height) => rebuild({ height }) }),
      colorRow("colour", spec.color, (color) => {
        spec.color = color;
        live.spec.color = color;
        app.writeUrl();
      }),
      checkRow("auto-tune", auto, (v) => {
        this.autoTune.set(id, v);
        if (v) rebuild({});
        else this.inspect(app);
      }, "solve counterweight"),
    );
    if (auto) {
      P.append(numberRow({ label: "tip at", value: Math.round(tipAt * 100), min: 30, max: 90, step: 1, unit: "%", onChange: (v) => rebuild({ tipAt: v / 100 }) }));
    } else {
      P.append(
        numberRow({ label: "ballast", value: spec.ballast, min: 0, max: 600, step: 1, unit: "kg", onChange: (v) => patch((b) => (b.ballast = v)) }),
        numberRow({ label: "shell", value: spec.shellMass, min: 5, max: 400, step: 1, unit: "kg", onChange: (v) => patch((b) => (b.shellMass = v)) }),
        numberRow({
          label: "axle ↑",
          value: spec.pivotLocal.y / spec.shape.height,
          min: 0,
          max: 1,
          step: 0.01,
          onChange: (v) => patch((b) => (b.pivotLocal = { ...b.pivotLocal, y: v * b.shape.height })),
        }),
        numberRow({
          label: "axle ↔",
          value: spec.pivotLocal.x / spec.shape.width,
          min: -0.3,
          max: 0.3,
          step: 0.005,
          onChange: (v) => patch((b) => (b.pivotLocal = { ...b.pivotLocal, x: v * b.shape.width })),
        }),
        numberRow({
          label: "stop",
          value: Math.abs(spec.thMax || spec.thMin) * (180 / Math.PI),
          min: 20,
          max: 175,
          step: 1,
          unit: "°",
          onChange: (v) =>
            patch((b) => {
              const r = (v * Math.PI) / 180;
              if (b.thMax > 0) b.thMax = r;
              else b.thMin = -r;
            }),
        }),
        numberRow({ label: "friction", value: spec.damping, min: 0, max: 400, step: 1, unit: "", onChange: (v) => patch((b) => (b.damping = v)) }),
      );
    }
  }

  private inspectPipe(app: App, id: string): void {
    const pipe = app.scenario.pipes.find((p) => p.id === id);
    const live = app.world.pipes.find((p) => p.id === id);
    if (!pipe || !live) return;
    type Pipe = NonNullable<typeof pipe>;
    const both = (f: (p: Pipe) => void) => {
      f(pipe);
      f(live);
      app.writeUrl();
      app.renderControls();
    };
    this.panel.append(
      heading(`🚰 pipe ${id}`),
      selectRow("fill", pipe.material, MATERIAL_IDS, (m: MaterialId) => both((p) => (p.material = m))),
      numberRow({ label: "max flow", value: toLitres(pipe.flow), min: 10, max: 400, step: 5, unit: "L/s", onChange: (v) => both((p) => (p.flow = v / toLitres(1))) }),
      numberRow({
        label: "angle",
        value: Math.round((pipe.angle * 180) / Math.PI),
        min: -180,
        max: 0,
        step: 5,
        unit: "°",
        onChange: (v) => both((p) => (p.angle = (v * Math.PI) / 180)),
      }),
      numberRow({ label: "speed", value: pipe.speed, min: 0.2, max: 6, step: 0.1, unit: "m/s", onChange: (v) => both((p) => (p.speed = v)) }),
    );
  }

  // ————— edits —————

  private rebuildBucket(app: App, spec: BucketSpec, r: BucketRecipe): void {
    const idx = app.scenario.buckets.findIndex((b) => b.id === spec.id);
    const auto = this.autoTune.get(spec.id) ?? true;
    const built = buildBucket({ ...r, density: MATERIALS[this.fillOf(app)].density });
    // Manual mode keeps the user's counterweight; auto mode takes the solved one.
    const next = auto ? built.spec : { ...built.spec, ballast: spec.ballast };
    app.scenario.buckets[idx] = next;
    this.reload(app);
  }

  /** Material the scene mostly pours (for tuning density). */
  private fillOf(app: App): MaterialId {
    return app.scenario.pipes[0]?.material ?? "water";
  }

  private reload(app: App): void {
    const valves = app.world.pipes.map((p) => p.valve);
    app.load(app.scenario);
    app.world.pipes.forEach((p, i) => (p.valve = valves[i] ?? p.valve));
    app.renderControls();
    app.selected = this.sel?.kind === "bucket" ? this.sel.id : null;
    this.inspect(app);
  }

  private addBucket(app: App): void {
    const id = uniqueId("b", app.scenario.buckets.map((b) => b.id));
    const x = freeX(app.scenario);
    const built = buildBucket({
      id,
      pivot: { x, y: 4 },
      kind: "rect",
      width: 1.2,
      height: 0.9,
      pours: x > 0 ? "left" : "right",
      tipAt: 0.7,
      color: BUCKET_COLORS[app.scenario.buckets.length % BUCKET_COLORS.length],
      density: MATERIALS[this.fillOf(app)].density,
    });
    app.scenario.buckets.push(built.spec);
    app.scenario.pipes.push(pipeOver(built.spec, uniqueId("p", app.scenario.pipes.map((p) => p.id))));
    this.sel = { kind: "bucket", id };
    this.reload(app);
  }

  private addPipe(app: App): void {
    app.scenario.pipes.push({
      id: uniqueId("p", app.scenario.pipes.map((p) => p.id)),
      x: freeX(app.scenario),
      y: 6.5,
      angle: -Math.PI / 2,
      flow: 0.12,
      valve: 0.7,
      speed: 1.2,
      material: this.fillOf(app),
      color: "#9aa4b2",
    });
    this.reload(app);
  }

  private addPerson(app: App): void {
    const id = uniqueId("p", app.scenario.people.map((p) => p.id));
    app.scenario.people.push({ id, x: (Math.random() - 0.5) * 8, height: 0.9 + Math.random() * 0.9, color: PERSON_COLORS[app.scenario.people.length % PERSON_COLORS.length] });
    this.reload(app);
  }

  private addPegs(app: App): void {
    app.scenario.pegs.push(...pegField(-1.5, 1.5, 1.2, 2.6, 4, 6));
    this.reload(app);
  }

  private remove(app: App): void {
    const s = this.sel;
    const sc = app.scenario;
    if (!s) return;
    if (s.kind === "bucket") sc.buckets = sc.buckets.filter((b) => b.id !== s.id);
    if (s.kind === "pipe") sc.pipes = sc.pipes.filter((p) => p.id !== s.id);
    if (s.kind === "person") sc.people = sc.people.filter((p) => p.id !== s.id);
    if (s.kind === "peg") sc.pegs.splice(s.index, 1);
    this.sel = null;
    this.reload(app);
  }

  private clear(app: App): void {
    Object.assign(app.scenario, { name: "My Water Park", buckets: [], pipes: [], pegs: [], ramps: [], people: [] });
    this.sel = null;
    this.reload(app);
  }

  private share(app: App): void {
    app.writeUrl();
    void navigator.clipboard?.writeText(location.href).catch(() => {});
    app.hud.innerHTML = "🔗 link copied!";
  }
}

function move(sc: Scenario, sel: NonNullable<Selection>, x: number, y: number): void {
  if (sel.kind === "bucket") {
    const b = sc.buckets.find((q) => q.id === sel.id);
    if (b) b.pivot = { x, y: Math.max(y, 0.8) };
  } else if (sel.kind === "pipe") {
    const p = sc.pipes.find((q) => q.id === sel.id);
    if (p) Object.assign(p, { x, y: Math.max(y, 0.5) });
  } else if (sel.kind === "person") {
    const p = sc.people.find((q) => q.id === sel.id);
    if (p) p.x = x;
  } else {
    const p = sc.pegs[sel.index];
    if (p) Object.assign(p, { x, y });
  }
}

/** Reconstruct a recipe from a built spec, so edits can re-run the tuner. */
export function recipeOf(spec: BucketSpec, tipAt: number): BucketRecipe {
  return {
    id: spec.id,
    pivot: spec.pivot,
    kind: spec.shape.kind,
    width: spec.shape.width,
    height: spec.shape.height,
    ratio: spec.shape.ratio,
    pours: spec.thMax > 0 ? "left" : "right",
    tipAt,
    pivotHeight: spec.pivotLocal.y / spec.shape.height,
    pivotOffset: Math.abs(spec.pivotLocal.x) / spec.shape.width,
    color: spec.color,
  };
}

const snap = (v: number) => Math.round(v * 20) / 20;

function uniqueId(prefix: string, taken: string[]): string {
  for (let i = 1; ; i++) if (!taken.includes(`${prefix}${i}`)) return `${prefix}${i}`;
}

/** An x position away from existing buckets. */
function freeX(sc: Scenario): number {
  const xs = sc.buckets.map((b) => b.pivot.x);
  let best = 0;
  let bestD = -1;
  for (let x = -3.5; x <= 3.5; x += 0.5) {
    const d = Math.min(...xs.map((b) => Math.abs(b - x)), 99);
    if (d > bestD) {
      bestD = d;
      best = x;
    }
  }
  return best;
}
