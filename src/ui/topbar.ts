import type { App, Toggles } from "../app";
import type { Mode } from "../modes/mode";
import { PRESETS } from "../world/presets";

export interface TopbarOptions {
  modes: Mode[];
  /** Extra toggle handlers keyed by toggle name (e.g. to show/hide panels). */
  onToggle?: (key: keyof Toggles, on: boolean) => void;
  extraButtons?: { label: string; title: string; onClick: (btn: HTMLButtonElement) => void }[];
}

const TOGGLES: { key: keyof Toggles; label: string; title: string }[] = [
  { key: "transparent", label: "👁 glass", title: "Transparent buckets" },
  { key: "rainbow", label: "🌈", title: "Rainbow water" },
  { key: "debug", label: "⊕ com", title: "Show centres of mass, torque, lips" },
  { key: "dash", label: "▦ dash", title: "Dashboard" },
  { key: "diffeq", label: "∂ plots", title: "Traces, phase portrait, hysteresis" },
  { key: "muted", label: "🔇", title: "Mute" },
];

export function renderTopbar(app: App, bar: HTMLElement, opts: TopbarOptions): void {
  const presets = bar.querySelector<HTMLElement>("#presets")!;
  const modes = bar.querySelector<HTMLElement>("#modes")!;
  const toggles = bar.querySelector<HTMLElement>("#toggles")!;

  presets.replaceChildren(
    ...PRESETS.map((p) =>
      button(`${p.emoji} ${p.name}`, p.name, () => {
        if (app.mode.id !== "play" && app.mode.id !== "design") app.setMode(opts.modes[0]);
        app.load(p.build(), { hash: `p=${p.id}` });
        syncModes();
      }),
    ),
  );

  const modeButtons = opts.modes.map((m) =>
    button(m.label, m.id, () => {
      app.setMode(app.mode === m ? opts.modes[0] : m);
      syncModes();
    }),
  );
  const syncModes = () => modeButtons.forEach((b, i) => b.setAttribute("aria-pressed", String(app.mode === opts.modes[i])));
  syncModes();
  modes.replaceChildren(...modeButtons);

  toggles.replaceChildren(
    ...TOGGLES.map((t) => {
      const b = button(t.label, t.title, () => {
        app.toggles[t.key] = !app.toggles[t.key];
        b.setAttribute("aria-pressed", String(app.toggles[t.key]));
        if (t.key === "muted") app.sound.setMuted(app.toggles.muted);
        opts.onToggle?.(t.key, app.toggles[t.key]);
      });
      b.setAttribute("aria-pressed", String(app.toggles[t.key]));
      return b;
    }),
    ...(opts.extraButtons ?? []).map((x) => {
      const b = button(x.label, x.title, () => x.onClick(b));
      return b;
    }),
  );
}

function button(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.textContent = label;
  b.title = title;
  b.onclick = onClick;
  return b;
}
