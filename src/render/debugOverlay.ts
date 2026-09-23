import type { Bucket } from "../physics/bucket";
import type { View } from "./view";

/**
 * Dad-mode overlay for one bucket: fluid centroid, combined COM with a plumb
 * line, lever arm and a torque arc (sweep ∝ τ, green CCW / red CW), the lip,
 * the brim level at the current tilt, and a θ/τ/V readout.
 */
export function drawDebug(ctx: CanvasRenderingContext2D, view: View, b: Bucket): void {
  const ev = b.last;
  const pv = b.spec.pivot;
  const pose = b.pose;
  const dot = (x: number, y: number, r: number, color: string) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(view.sx(x), view.sy(y), r, 0, Math.PI * 2);
    ctx.fill();
  };
  // Fluid centroid (blue), combined COM (magenta ⊕), plumb line to the ground.
  if (ev.fluid.volume > 0) dot(ev.fluid.centroid.x + pose.x, ev.fluid.centroid.y + pose.y, 4, "#0050ff");
  const com = { x: pv.x + ev.com.x, y: pv.y + ev.com.y };
  ctx.strokeStyle = "#ff00c8";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(view.sx(com.x), view.sy(com.y));
  ctx.lineTo(view.sx(com.x), view.sy(0));
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(view.sx(com.x), view.sy(com.y), 7, 0, Math.PI * 2);
  ctx.moveTo(view.sx(com.x) - 7, view.sy(com.y));
  ctx.lineTo(view.sx(com.x) + 7, view.sy(com.y));
  ctx.moveTo(view.sx(com.x), view.sy(com.y) - 7);
  ctx.lineTo(view.sx(com.x), view.sy(com.y) + 7);
  ctx.stroke();
  // Lever arm from the pivot, and a torque arc whose sweep ∝ τ.
  ctx.strokeStyle = "#111";
  ctx.beginPath();
  ctx.moveTo(view.sx(pv.x), view.sy(pv.y));
  ctx.lineTo(view.sx(com.x), view.sy(pv.y));
  ctx.stroke();
  const sweep = Math.max(-2.5, Math.min(2.5, ev.tau / 800));
  const R = view.scale * 0.45;
  ctx.strokeStyle = ev.tau > 0 ? "#00a86b" : "#d62828";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(view.sx(pv.x), view.sy(pv.y), R, -Math.PI / 2, -Math.PI / 2 - sweep, sweep > 0);
  ctx.stroke();
  // Lip marker + where the bucket would brim at this tilt.
  dot(ev.fluid.lip.x + pose.x, ev.fluid.lip.y + pose.y, 3.5, "#ff9500");
  ctx.strokeStyle = "rgba(255,149,0,0.8)";
  ctx.setLineDash([2, 3]);
  ctx.beginPath();
  const ly = view.sy(ev.fluid.lip.y + pose.y);
  const half = b.spec.shape.width * 0.7 * view.scale;
  const cx = view.sx(b.toWorld({ x: 0, y: b.spec.shape.height / 2 }).x);
  ctx.moveTo(cx - half, ly);
  ctx.lineTo(cx + half, ly);
  ctx.stroke();
  ctx.setLineDash([]);
  // Readout.
  ctx.font = "11px ui-monospace, Menlo, monospace";
  ctx.fillStyle = "#111";
  ctx.textAlign = "left";
  const tx = view.sx(pv.x) + 10;
  const ty = view.sy(pv.y) + 16;
  ctx.fillText(`θ ${((b.th * 180) / Math.PI).toFixed(1).padStart(6)}°  τ ${ev.tau.toFixed(0).padStart(6)}`, tx, ty);
  ctx.fillText(`V ${(b.volume * 1000).toFixed(0).padStart(5)}  cap ${(ev.fluid.capacity * 1000).toFixed(0).padStart(5)}`, tx, ty + 12);
}
