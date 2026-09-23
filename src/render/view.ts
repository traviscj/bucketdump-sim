import type { Vec } from "../geom/vec";
import type { ViewBox } from "../world/scenario";

/** Uniform world↔screen transform (CSS pixels, y up in the world, y down on screen). */
export class View {
  scale = 50;
  ox = 0;
  oy = 0;
  width = 0;
  height = 0;

  /** Fit `box` inside a w×h viewport with `pad` CSS px margin, centred. */
  fit(box: ViewBox, w: number, h: number, pad = 8): void {
    this.width = w;
    this.height = h;
    const bw = box.maxX - box.minX;
    const bh = box.maxY - box.minY;
    this.scale = Math.max(1, Math.min((w - 2 * pad) / bw, (h - 2 * pad) / bh));
    const cx = (box.minX + box.maxX) / 2;
    // Bottom-align: the ground should sit at the bottom edge, extra room goes to the sky.
    this.ox = w / 2 - cx * this.scale;
    this.oy = h - pad + box.minY * this.scale;
  }

  sx(x: number): number {
    return this.ox + x * this.scale;
  }

  sy(y: number): number {
    return this.oy - y * this.scale;
  }

  toScreen(p: Vec): Vec {
    return { x: this.sx(p.x), y: this.sy(p.y) };
  }

  toWorld(sx: number, sy: number): Vec {
    return { x: (sx - this.ox) / this.scale, y: (this.oy - sy) / this.scale };
  }

  /** Visible world rectangle (may exceed the fitted box on the long axis). */
  visible(): ViewBox {
    const a = this.toWorld(0, this.height);
    const b = this.toWorld(this.width, 0);
    return { minX: a.x, minY: a.y, maxX: b.x, maxY: b.y };
  }
}
