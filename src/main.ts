import "./style.css";
import { App } from "./app";
import { DemoMode } from "./modes/demo";
import { DesignMode } from "./modes/designer";
import { playMode } from "./modes/mode";
import { SplashemMode } from "./modes/splashem";
import { randomSeed } from "./world/rng";
import { Dashboard } from "./ui/dashboard";
import { Plots } from "./ui/plots";
import { renderTopbar } from "./ui/topbar";
import { PRESETS, presetById } from "./world/presets";
import { decodeScenario } from "./world/scenario";

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

const app = new App($("#canvas2d"), $("#stage"), $("#controls"), $("#hud"));

/** #s=<encoded scenario> or #p=<preset id>; default: the Big Bucket. */
function initialScenario() {
  const params = new URLSearchParams(location.hash.slice(1));
  const code = params.get("s");
  if (code) {
    const sc = decodeScenario(code);
    if (sc) return { sc, hash: undefined };
  }
  const preset = presetById(params.get("p") ?? "") ?? PRESETS[0];
  return { sc: preset.build(), hash: `p=${preset.id}` };
}

const init = initialScenario();
app.load(init.sc, { hash: init.hash });

/** Load a generated scene (off-thread); `r=<seed>` in the URL reproduces it. */
function loadRandom(seed = randomSeed()): void {
  app.hud.innerHTML = "🎲 mixing up a new one…";
  app.generator
    .make(seed)
    .then((sc) => {
      if (app.mode !== playMode) app.setMode(playMode);
      app.load(sc, { hash: `r=${seed}` });
      topbar();
    })
    .catch(() => (app.hud.innerHTML = ""));
}
const seedParam = new URLSearchParams(location.hash.slice(1)).get("r");
if (seedParam) loadRandom(Number(seedParam) >>> 0);
const dash = $("#dash");
const diffeq = $("#diffeq");
app.panels.push(new Dashboard(dash), new Plots(diffeq, $<HTMLCanvasElement>("#plots"), $("#eqs")));
/** The 3D view is lazy-loaded: three.js only downloads the first time it's used. */
async function toggle3D(btn: HTMLButtonElement): Promise<void> {
  const host = $("#three-host");
  const canvas = $("#canvas2d");
  if (app.altView) {
    app.altView.dispose();
    app.altView = null;
    host.hidden = true;
    canvas.hidden = false;
  } else {
    btn.textContent = "🧊 …";
    const { View3D } = await import("./render/three3d");
    host.hidden = false;
    canvas.hidden = true;
    app.altView = new View3D(host, app);
    btn.textContent = "🧊 3D";
  }
  btn.setAttribute("aria-pressed", String(!!app.altView));
}

const modes = [playMode, new DemoMode(), new SplashemMode(), new DesignMode($("#designer"))];
function topbar(): void {
  renderTopbar(app, $("#bar"), {
    modes,
    randomButton: { label: "🎲 random", title: "Make up a new water park", onClick: () => loadRandom() },
    extraButtons: [
      { label: "🧊 3D", title: "3D view (drag to orbit)", onClick: (btn) => void toggle3D(btn) },
      { label: "⛶", title: "Fullscreen", onClick: () => void toggleFullscreen() },
    ],
    onToggle: (key, on) => {
      if (key === "dash") dash.hidden = !on;
      if (key === "diffeq") diffeq.hidden = !on;
    },
  });
}
topbar();
app.start();

// Handy for poking at the sim from devtools.
(window as unknown as { app: App }).app = app;

function toggleFullscreen(): Promise<void> {
  if (document.fullscreenElement) return document.exitFullscreen();
  return document.documentElement.requestFullscreen?.().catch(() => {}) ?? Promise.resolve();
}

/** Keyboard shortcuts: each just presses the matching on-screen button, so UI state stays in sync. */
const KEYS: Record<string, string> = {
  " ": "#controls .dump",
  s: "#controls .slow",
  p: "#controls .bigbtn.pause, #controls .bigbtn.go",
  r: "#modes button[title^='Make up']",
  g: "#toggles button[title='Transparent buckets']",
  c: "#toggles button[title^='Show centres']",
  b: "#toggles button[title='Dashboard']",
  d: "#toggles button[title^='Traces']",
  m: "#toggles button[title='Mute']",
  "3": "#toggles button[title^='3D']",
  f: "#toggles button[title='Fullscreen']",
};
window.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.metaKey || e.ctrlKey) return;
  const sel = KEYS[e.key.toLowerCase()];
  if (!sel) return;
  e.preventDefault();
  app.sound.unlock();
  document.querySelector<HTMLButtonElement>(sel)?.click();
});
