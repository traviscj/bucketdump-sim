import "./style.css";
import { App } from "./app";
import { playMode } from "./modes/mode";
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
renderTopbar(app, $("#bar"), { modes: [playMode] });
app.start();

// Handy for poking at the sim from devtools.
(window as unknown as { app: App }).app = app;
