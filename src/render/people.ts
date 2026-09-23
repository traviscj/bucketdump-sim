import type { Person } from "../world/world";
import { hash, shade } from "./color";
import type { View } from "./view";

const SKIN = ["#f1c27d", "#e0ac69", "#c68642", "#8d5524", "#ffdbac"];

/** A cartoon swimmer: arms go up and the mouth goes "O!" when hit; darkens and drips as they get wet. */
export function drawPerson(ctx: CanvasRenderingContext2D, view: View, p: Person, time: number): void {
  const h = p.spec.height;
  const x = view.sx(p.spec.x);
  const gy = view.sy(0);
  const s = view.scale;
  const headR = h * 0.1 * s;
  const bodyTop = gy - h * 0.78 * s;
  const bodyW = p.width * s;
  const startled = time - p.lastHit < 0.6;
  const hop = startled ? Math.abs(Math.sin(time * 18)) * 0.04 * s : 0;

  ctx.save();
  ctx.translate(0, -hop);
  // Legs.
  ctx.strokeStyle = "#333";
  ctx.lineWidth = Math.max(2, s * 0.05);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x - bodyW * 0.2, gy - h * 0.4 * s);
  ctx.lineTo(x - bodyW * 0.25, gy);
  ctx.moveTo(x + bodyW * 0.2, gy - h * 0.4 * s);
  ctx.lineTo(x + bodyW * 0.25, gy);
  ctx.stroke();
  // Arms: up when startled.
  const armY = startled ? bodyTop - h * 0.15 * s : bodyTop + h * 0.3 * s;
  ctx.beginPath();
  ctx.moveTo(x - bodyW * 0.45, bodyTop + h * 0.05 * s);
  ctx.lineTo(x - bodyW * 0.8, armY);
  ctx.moveTo(x + bodyW * 0.45, bodyTop + h * 0.05 * s);
  ctx.lineTo(x + bodyW * 0.8, armY);
  ctx.stroke();
  // Torso (swimsuit colour, darkens as it gets wet).
  ctx.fillStyle = shade(p.spec.color, -0.4 * p.wet);
  ctx.beginPath();
  ctx.roundRect(x - bodyW / 2, bodyTop, bodyW, h * 0.42 * s, bodyW * 0.3);
  ctx.fill();
  // Head.
  const hx = x;
  const hy = bodyTop - headR * 1.05;
  ctx.fillStyle = SKIN[Math.abs(hash(p.spec.id)) % SKIN.length];
  ctx.beginPath();
  ctx.arc(hx, hy, headR, 0, Math.PI * 2);
  ctx.fill();
  // Face.
  ctx.fillStyle = "#222";
  ctx.beginPath();
  ctx.arc(hx - headR * 0.35, hy - headR * 0.15, Math.max(1, headR * 0.12), 0, Math.PI * 2);
  ctx.arc(hx + headR * 0.35, hy - headR * 0.15, Math.max(1, headR * 0.12), 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#222";
  ctx.lineWidth = Math.max(1, headR * 0.12);
  ctx.beginPath();
  if (startled) {
    ctx.arc(hx, hy + headR * 0.35, headR * 0.22, 0, Math.PI * 2); // "O!"
  } else {
    ctx.arc(hx, hy + headR * 0.15, headR * 0.4, 0.15 * Math.PI, 0.85 * Math.PI); // smile
  }
  ctx.stroke();
  // Wet: blue sheen + drips.
  if (p.wet > 0.05) {
    ctx.fillStyle = `rgba(58,160,255,${0.35 * p.wet})`;
    ctx.beginPath();
    ctx.arc(hx, hy, headR * 1.05, Math.PI, 0);
    ctx.fill();
    const drips = Math.ceil(p.wet * 3);
    ctx.fillStyle = "#3aa0ff";
    for (let k = 0; k < drips; k++) {
      const phase = (time * 1.5 + k * 0.37) % 1;
      const dx = (k - (drips - 1) / 2) * bodyW * 0.4;
      ctx.beginPath();
      ctx.arc(x + dx, bodyTop + h * 0.42 * s + phase * h * 0.35 * s, Math.max(1.5, s * 0.02), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

