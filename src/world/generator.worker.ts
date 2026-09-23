/// <reference lib="webworker" />
import { type RandomOptions, generate } from "./random";

/** Off-main-thread scene generation: tuning + headless validation take ~1 s. */
self.onmessage = (e: MessageEvent<{ id: number; seed: number; opts: RandomOptions }>) => {
  const { id, seed, opts } = e.data;
  try {
    self.postMessage({ id, scenario: generate(seed, opts) });
  } catch (err) {
    self.postMessage({ id, error: String(err) });
  }
};
