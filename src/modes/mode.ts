import type { App } from "../app";
import type { SimEvent } from "../world/world";

/** A mode layers behaviour on top of the shared sim loop (demo playlist, splash'em game, designer…). */
export interface Mode {
  id: string;
  label: string;
  enter(app: App): void;
  exit(app: App): void;
  /** Called every frame with wall-clock dt (seconds). */
  update?(app: App, dt: number): void;
  onEvent?(app: App, e: SimEvent): void;
  /** Pointer handling; return true to swallow the default (tap-to-shove). */
  pointerDown?(app: App, x: number, y: number): boolean;
  pointerMove?(app: App, x: number, y: number): void;
  pointerUp?(app: App): void;
  /** Big friendly heads-up text over the scene. */
  hud?(app: App): string;
}

export const playMode: Mode = {
  id: "play",
  label: "▶ play",
  enter() {},
  exit() {},
};
