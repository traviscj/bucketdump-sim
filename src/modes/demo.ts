import type { App } from "../app";
import { randomSeed } from "../world/rng";
import { PRESETS } from "../world/presets";
import type { Scenario } from "../world/scenario";
import type { Mode } from "./mode";

/** Seconds a scene can run before we move on even if something never dumped. */
const MAX_SCENE = 50;
const DUMPS_PER_BUCKET = 2;

/**
 * Hands-off playlist: alternates hand-made presets and freshly generated
 * random scenes, runs each until every bucket has dumped a couple of times,
 * then moves on. The next random scene is prepared in the worker meanwhile.
 */
export class DemoMode implements Mode {
  readonly id = "demo";
  readonly label = "📺 demo";
  private started = 0;
  private count = 0;
  private next: Scenario | null = null;
  private fetching = false;
  private active = false;

  enter(app: App): void {
    this.active = true;
    this.count = 0;
    this.prefetch(app);
    this.show(app, PRESETS[Math.floor(Math.random() * PRESETS.length)].build());
  }

  exit(): void {
    this.active = false;
  }

  private prefetch(app: App): void {
    if (this.fetching || this.next) return;
    this.fetching = true;
    app.generator
      .make(randomSeed())
      .then((sc) => {
        if (this.active) this.next = sc;
      })
      .catch(() => {})
      .finally(() => (this.fetching = false));
  }

  private show(app: App, sc: Scenario): void {
    app.load(sc, { updateUrl: false });
    for (const p of app.world.pipes) p.valve = 0.8 + 0.2 * Math.random();
    app.renderControls();
    this.started = app.world.time;
    this.count++;
  }

  private done(app: App): boolean {
    const w = app.world;
    const elapsed = w.time - this.started;
    if (elapsed > MAX_SCENE) return true;
    // Let the last dump finish splashing before cutting away.
    return elapsed > 8 && w.buckets.every((b) => b.dumps >= DUMPS_PER_BUCKET && b.phase === "filling");
  }

  update(app: App): void {
    if (!this.done(app)) return;
    // Odd turns: a random scene (if the worker has one ready), else a preset.
    const useRandom = this.count % 2 === 1 && this.next;
    const sc = useRandom ? this.next! : PRESETS[Math.floor(Math.random() * PRESETS.length)].build();
    if (useRandom) this.next = null;
    this.show(app, sc);
    this.prefetch(app);
  }

  hud(app: App): string {
    const w = app.world;
    const left = Math.max(0, MAX_SCENE - (w.time - this.started));
    const dumps = w.buckets.reduce((s, b) => s + Math.min(b.dumps, DUMPS_PER_BUCKET), 0);
    const goal = w.buckets.length * DUMPS_PER_BUCKET;
    return `📺 ${w.scenario.name}<small>${"💦".repeat(dumps)}${"·".repeat(Math.max(0, goal - dumps))} · ${left.toFixed(0)}s</small>`;
  }
}
