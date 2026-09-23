import "./style.css";
import { App } from "./app";
import { DemoMode } from "./modes/demo";
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
app.panels.push(new Dashboard(dash), new Plots(diffeq, $<HTMLCanvasElement>("#plots")));
const modes = [playMode, new DemoMode(), new SplashemMode()];
function topbar(): void {
  renderTopbar(app, $("#bar"), {
    modes,
    randomButton: { label: "🎲 random", title: "Make up a new water park", onClick: () => loadRandom() },
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
