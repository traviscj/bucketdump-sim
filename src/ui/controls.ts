import type { App } from "../app";
import { MATERIALS, MATERIAL_IDS } from "../physics/materials";

/** Build the kid control panel: one big valve lever per pipe, plus DUMP / slow-mo / pause. */
export function renderControls(app: App, host: HTMLElement): void {
  host.replaceChildren();
  app.world.pipes.forEach((pipe, i) => {
    const box = el("div", "valve");
    const label = el("label");
    const name = el("span");
    name.textContent = app.world.pipes.length > 1 ? `Pipe ${i + 1}` : "Water";
    const mat = el("button", "mat") as HTMLButtonElement;
    mat.title = "Change what comes out";
    const setMat = () => {
      mat.textContent = MATERIALS[pipe.material].emoji;
      name.textContent = `${app.world.pipes.length > 1 ? `${i + 1}: ` : ""}${MATERIALS[pipe.material].name}`;
    };
    setMat();
    mat.onclick = () => {
      pipe.material = MATERIAL_IDS[(MATERIAL_IDS.indexOf(pipe.material) + 1) % MATERIAL_IDS.length];
      setMat();
      app.sound.click();
    };
    label.append(name, mat);
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = "1";
    slider.step = "0.01";
    slider.value = String(pipe.valve);
    slider.setAttribute("aria-label", `Valve ${i + 1}`);
    slider.oninput = () => {
      pipe.valve = Number(slider.value);
    };
    box.append(label, slider);
    host.append(box);
  });

  const dump = bigButton("DUMP!", "dump", () => {
    app.dumpAll();
  });
  const slow = bigButton("🐢 slow", "slow", () => {
    app.setSlow(!app.slow);
    slow.setAttribute("aria-pressed", String(app.slow));
  });
  slow.setAttribute("aria-pressed", String(app.slow));
  const pause = bigButton(app.world.paused ? "▶" : "⏸", app.world.paused ? "go" : "pause", () => {
    app.world.paused = !app.world.paused;
    pause.textContent = app.world.paused ? "▶" : "⏸";
    pause.className = `bigbtn ${app.world.paused ? "go" : "pause"}`;
  });
  const reset = bigButton("↺", "pause", () => app.reload());
  reset.title = "Start over";
  host.append(dump, slow, pause, reset);
}

function bigButton(text: string, cls: string, onClick: () => void): HTMLButtonElement {
  const b = el("button", `bigbtn ${cls}`) as HTMLButtonElement;
  b.textContent = text;
  b.onclick = onClick;
  return b;
}

export function el(tag: string, cls?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}
