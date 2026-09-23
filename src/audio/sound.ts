import type { MaterialId } from "../physics/materials";

/**
 * All sounds are synthesised with WebAudio — no asset files. The context is
 * created lazily on the first user gesture (mobile browsers require it).
 */
export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  muted = false;
  /** Throttle so a 500-particle dump is one splash, not 500. */
  private lastSplash = 0;
  private lastImpact = new Map<string, number>();

  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.6;
    this.master.connect(this.ctx.destination);
    // One second of white noise, reused for splashes/shhh.
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.6, this.ctx.currentTime, 0.02);
  }

  private get ready(): boolean {
    return !!this.ctx && !!this.master && !this.muted && this.ctx.state === "running";
  }

  /** A struck bell: a few inharmonic partials with exponential decay. `pitch` scales the fundamental. */
  ding(pitch = 1, when = 0): void {
    if (!this.ready) return;
    const ctx = this.ctx!;
    const t0 = ctx.currentTime + when;
    const f0 = 1046 * pitch; // C6
    const partials: [number, number, number][] = [
      [1, 0.5, 1.2],
      [2.76, 0.25, 0.6],
      [5.4, 0.12, 0.3],
      [0.5, 0.15, 1.0],
    ];
    for (const [ratio, amp, decay] of partials) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = f0 * ratio;
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(amp * 0.35, t0 + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);
      o.connect(g).connect(this.master!);
      o.start(t0);
      o.stop(t0 + decay + 0.05);
    }
  }

  /** "ding ding ding" — three quick strikes. */
  dingDingDing(urgency: number): void {
    const gap = 0.22 - 0.08 * urgency;
    const pitch = 1 + 0.12 * urgency;
    for (let k = 0; k < 3; k++) this.ding(pitch, k * gap);
  }

  private noiseBurst(dur: number, freq: number, q: number, gain: number, sweepTo?: number): void {
    if (!this.ready || !this.noise) return;
    const ctx = this.ctx!;
    const t0 = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.setValueAtTime(freq, t0);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(this.master!);
    src.start(t0, Math.random() * 0.5);
    src.stop(t0 + dur + 0.05);
  }

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, gain: number): void {
    if (!this.ready) return;
    const ctx = this.ctx!;
    const t0 = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(this.master!);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  /** Big whoosh when a bucket tips; bigger volume → longer, lower. */
  whoosh(volume: number): void {
    const size = Math.min(1, volume / 1.5);
    this.noiseBurst(0.8 + size, 1400, 0.7, 0.5 + 0.4 * size, 250);
  }

  /** Impact of stuff hitting the ground; called per event but throttled. */
  impact(material: MaterialId, volume: number, speed: number): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const loud = Math.min(1, volume * 200 * (speed / 5));
    switch (material) {
      case "water":
      case "slime": {
        if (now - this.lastSplash < 0.09) return;
        this.lastSplash = now;
        const f = material === "slime" ? 350 : 900 + Math.random() * 900;
        this.noiseBurst(0.18 + Math.random() * 0.2, f, 1.2, 0.08 + 0.25 * loud, f * 0.5);
        return;
      }
      case "sand":
        if (now - this.lastSplash < 0.12) return;
        this.lastSplash = now;
        this.noiseBurst(0.3, 4000, 0.5, 0.06 + 0.1 * loud);
        return;
      default: {
        const last = this.lastImpact.get(material) ?? 0;
        if (now - last < 0.05) return;
        this.lastImpact.set(material, now);
        if (material === "balls") this.tone("sine", 500 + Math.random() * 400, 180, 0.18, 0.12 + 0.2 * loud);
        else this.tone("triangle", 1800 + Math.random() * 900, 900, 0.05, 0.12 + 0.2 * loud); // acorn clack
      }
    }
  }

  /** Bucket slamming into a stop. */
  thunk(speed: number): void {
    this.tone("sine", 140, 45, 0.25, Math.min(0.8, 0.2 + speed * 0.12));
  }

  /** Little "wheee" when someone gets soaked. */
  squeal(): void {
    const f = 700 + Math.random() * 500;
    this.tone("sine", f, f * 1.8, 0.25, 0.1);
  }

  /** Cheer = a swell of filtered noise. */
  cheer(): void {
    this.noiseBurst(1.6, 2200, 0.4, 0.25, 1400);
  }

  click(): void {
    this.tone("square", 900, 600, 0.03, 0.05);
  }
}
