import type { App } from "../app";
import { randomSeed } from "../world/rng";
import type { SimEvent } from "../world/world";
import type { Mode } from "./mode";

const ROUND_SECONDS = 60;
const SOAKED = 0.8;
const BEST_KEY = "bigbucket.splashem.best";

interface Walker {
  vx: number;
  pause: number;
}

/**
 * Splash'em! A crowd wanders the splash pad; the operator times the dumps to
 * soak as many people as possible before the clock runs out.
 */
export class SplashemMode implements Mode {
  readonly id = "splash";
  readonly label = "🎯 splash'em";
  private walkers: Walker[] = [];
  private roundStart = 0;
  private over = false;
  private loading = false;
  private best = 0;
  private active = false;
  private lastSoaked = 0;

  enter(app: App): void {
    this.active = true;
    this.best = readBest();
    this.newRound(app);
  }

  exit(): void {
    this.active = false;
  }

  private newRound(app: App): void {
    this.loading = true;
    this.over = false;
    app.generator
      .make(randomSeed(), { people: [7, 10] })
      .then((sc) => {
        if (!this.active) return;
        app.load({ ...sc, name: `Splash'em: ${sc.name}` }, { updateUrl: false });
        for (const p of app.world.pipes) p.valve = 0.6;
        app.renderControls();
        this.walkers = app.world.people.map(() => ({ vx: (Math.random() < 0.5 ? -1 : 1) * (0.25 + Math.random() * 0.4), pause: 0 }));
        this.roundStart = app.world.time;
        this.lastSoaked = 0;
      })
      .finally(() => (this.loading = false));
  }

  update(app: App, dt: number): void {
    if (this.loading || !this.walkers.length) return;
    const w = app.world;
    const remaining = ROUND_SECONDS - (w.time - this.roundStart);
    if (!this.over && remaining <= 0) this.finish(app);
    if (this.over) return;
    const { minX, maxX } = w.renderBounds();
    // Wander: walk, occasionally pause or turn around; soaked people run for it.
    w.people.forEach((p, i) => {
      const k = this.walkers[i];
      if (!k) return;
      if (k.pause > 0) {
        k.pause -= dt;
        return;
      }
      if (Math.random() < dt * 0.15) k.pause = 0.5 + Math.random() * 1.5;
      if (Math.random() < dt * 0.1) k.vx = -k.vx;
      const speed = p.wet > SOAKED ? 2.2 : 1;
      p.spec.x += k.vx * speed * dt * (app.slow ? 0.25 : 1);
      if (p.spec.x < minX + 0.4 || p.spec.x > maxX - 0.4) {
        k.vx = -k.vx;
        p.spec.x = Math.max(minX + 0.4, Math.min(maxX - 0.4, p.spec.x));
      }
    });
    const soaked = w.people.filter((p) => p.wet > SOAKED).length;
    if (soaked > this.lastSoaked) app.sound.squeal();
    this.lastSoaked = soaked;
  }

  private finish(app: App): void {
    this.over = true;
    for (const p of app.world.pipes) p.valve = 0;
    app.renderControls();
    app.sound.cheer();
    const score = app.world.score;
    if (score > this.best) {
      this.best = score;
      writeBest(score);
    }
    setTimeout(() => this.active && this.over && this.newRound(app), 7000);
  }

  onEvent(_app: App, _e: SimEvent): void {}

  hud(app: App): string {
    if (this.loading) return "🎯 Splash'em!<small>getting the crowd ready…</small>";
    const w = app.world;
    const soaked = w.people.filter((p) => p.wet > SOAKED).length;
    if (this.over) {
      return `🎉 Soaked ${soaked} of ${w.people.length}!<small>score ${w.score} · best ${this.best} · next round soon</small>`;
    }
    const left = Math.max(0, ROUND_SECONDS - (w.time - this.roundStart));
    return `💦 ${w.score}  ·  ${soaked}/${w.people.length} soaked  ·  ${Math.ceil(left)}s<small>tap a bucket to dump it on them!</small>`;
  }
}

function readBest(): number {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}

function writeBest(v: number): void {
  try {
    localStorage.setItem(BEST_KEY, String(v));
  } catch {
    /* private mode: best score just isn't remembered */
  }
}
