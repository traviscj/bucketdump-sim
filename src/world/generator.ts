import { type RandomOptions, generate } from "./random";
import type { Scenario } from "./scenario";

type Pending = { resolve: (s: Scenario) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };

/**
 * Promise wrapper around the generator worker, with a hard timeout and a
 * synchronous fallback if workers are unavailable.
 */
export class Generator {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();

  constructor() {
    try {
      this.worker = new Worker(new URL("./generator.worker.ts", import.meta.url), { type: "module" });
      this.worker.onmessage = (e: MessageEvent<{ id: number; scenario?: Scenario; error?: string }>) => {
        const p = this.pending.get(e.data.id);
        if (!p) return;
        this.pending.delete(e.data.id);
        clearTimeout(p.timer);
        if (e.data.scenario) p.resolve(e.data.scenario);
        else p.reject(new Error(e.data.error ?? "generator failed"));
      };
    } catch {
      this.worker = null;
    }
  }

  make(seed: number, opts: RandomOptions = {}, timeoutMs = 20000): Promise<Scenario> {
    if (!this.worker) return Promise.resolve(generate(seed, opts));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("generator timed out"));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.worker!.postMessage({ id, seed, opts });
    });
  }

  dispose(): void {
    for (const p of this.pending.values()) clearTimeout(p.timer);
    this.pending.clear();
    this.worker?.terminate();
  }
}
