import type { App, Panel } from "../app";
import { stability } from "../analysis/stiffness";
import { toLitres } from "../physics/constants";
import { MATERIALS } from "../physics/materials";

const DEG = 180 / Math.PI;
const HZ = 8;

const fmt = (v: number, d = 0, w = 0) => (Number.isFinite(v) ? v.toFixed(d) : "—").padStart(w);

/** htop-style table of every bucket, pipe and global counter. Refreshes at 8 Hz. */
export class Dashboard implements Panel {
  private last = 0;
  private frames = 0;
  private fps = 0;
  private fpsT = 0;

  constructor(private readonly host: HTMLElement) {}

  update(app: App, now: number): void {
    this.frames++;
    if (now - this.fpsT >= 1) {
      this.fps = this.frames / (now - this.fpsT);
      this.frames = 0;
      this.fpsT = now;
    }
    if (this.host.hidden || now - this.last < 1 / HZ) return;
    this.last = now;
    const w = app.world;

    const rows = w.buckets
      .map((b) => {
        const h = b.analysis;
        const s = stability(b);
        // Resting on a mechanical stop, the linearisation is meaningless.
        const onStop = b.th <= b.spec.thMin + 1e-6 || b.th >= b.spec.thMax - 1e-6;
        const fill = b.volume / b.model.maxCapacity;
        const tipFrac = h.vTip ? b.volume / h.vTip : 0;
        const warnCls = b.phase === "dumping" ? "bad" : tipFrac > 0.9 ? "warn" : "";
        const verdictCls = h.verdict === "works" ? "ok" : "bad";
        return `<tr class="${app.selected === b.spec.id ? "sel" : ""}">
          <td>${b.spec.id}</td><td class="${warnCls}">${b.phase === "dumping" ? "DUMP" : "fill"}</td>
          <td class="n">${fmt(toLitres(b.volume))}</td><td class="n">${fmt(toLitres(h.vTip ?? NaN))}</td>
          <td class="n ${warnCls}">${fmt(100 * tipFrac)}</td><td class="n">${fmt(100 * fill)}</td>
          <td class="n">${fmt(b.th * DEG, 1)}</td><td class="n">${fmt(b.om, 2)}</td>
          <td class="n">${fmt(b.last.tau)}</td><td class="n">${fmt(b.last.inertia)}</td>
          ${
            onStop
              ? `<td class="n dim">stop</td><td class="n dim">stop</td><td class="n dim">—</td>`
              : `<td class="n ${s.k < 0 ? "bad" : ""}">${fmt(s.k)}</td><td class="n ${s.gm < 0 ? "bad" : ""}">${fmt(100 * s.gm, 1)}</td>
                 <td class="n">${fmt(s.period, 2)}</td>`
          }<td class="n">${fmt(b.last.mass)}</td>
          <td class="n">${fmt(toLitres(b.lastSpillRate))}</td><td class="n">${b.dumps}</td>
          <td class="n">${fmt(toLitres(b.lastTipVolume))}</td>
          <td class="${verdictCls}">${h.verdict}</td><td class="n">${fmt(toLitres(h.vRet ?? NaN))}</td>
          <td class="n">${fmt((h.thDump ?? NaN) * DEG)}</td>
        </tr>`;
      })
      .join("");

    const pipes = w.pipes
      .map(
        (p) =>
          `<tr><td>${p.id}</td><td>${MATERIALS[p.material].emoji} ${p.material}</td><td class="n">${fmt(100 * p.valve)}</td>
           <td class="n">${fmt(toLitres(p.flow * p.valve * w.master), 1)}</td><td class="n">${fmt(p.x, 2)}</td><td class="n">${fmt(p.y, 2)}</td></tr>`,
      )
      .join("");

    const st = w.stats;
    const held = w.buckets.reduce((s, b) => s + b.volume, 0);
    this.host.innerHTML = `
      <table>
        <tr><th>bkt</th><th>st</th><th>V L</th><th>Vtip L</th><th>%tip</th><th>%cap</th><th>θ °</th><th>ω r/s</th>
            <th>τ N·m</th><th>I kg·m²</th><th>k N·m/r</th><th>GM cm</th><th>T s</th><th>M kg</th><th>q L/s</th>
            <th>#</th><th>Vlift L</th><th>verdict</th><th>Vret L</th><th>θd °</th></tr>
        ${rows}
      </table>
      <table style="margin-top:3px">
        <tr><th>pipe</th><th>fill</th><th>valve %</th><th>L/s</th><th>x m</th><th>y m</th></tr>${pipes}
      </table>
      <div class="kv">
        <b>t</b><span>${fmt(w.time, 1)} s</span><b>fps</b><span>${fmt(this.fps)}</span>
        <b>particles</b><span>${w.particles.count}/${w.particles.cap}</span><b>score</b><span>${w.score}</span>
        <b>poured</b><span>${fmt(toLitres(st.poured))} L</span><b>held</b><span>${fmt(toLitres(held))} L</span>
        <b>ground</b><span>${fmt(toLitres(st.grounded))} L</span><b>soaked</b><span>${fmt(toLitres(st.soaked))} L</span>
        <b>lost</b><span>${fmt(toLitres(st.lost + w.particles.dropped))} L</span><b>speed</b><span>${app.slow ? "¼×" : "1×"}</span>
      </div>`;
  }
}
