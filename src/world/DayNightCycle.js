// Day/night cycle (§13.4): continuous phase 0..1 (0 = midnight), one full day
// = DAY_SECONDS real seconds. Drives sky blending + sun/moon in the parallax
// sky, plus a color-grade overlay here. Time of day persists in checkpoints.

import { clamp } from '../core/utils.js';

export const DAY_SECONDS = 600; // 10 real minutes per in-game day (tunable)

export class DayNightCycle {
  constructor(startPhase = 0.32) { // morning
    this.phase = startPhase;
  }

  update(dt) { this.phase = (this.phase + dt / DAY_SECONDS) % 1; }

  /** Sun altitude -1..1 (positive = above horizon). */
  get sunAlt() { return Math.sin((this.phase - 0.25) * Math.PI * 2); }

  /** Daylight 0..1 with soft dawn/dusk shoulders. */
  get light() {
    const t = clamp((this.sunAlt + 0.18) / 0.42, 0, 1);
    return t * t * (3 - 2 * t);
  }

  /** Warmth 0..1 near sunrise/sunset for golden-hour tinting. */
  get duskWarmth() {
    return clamp(1 - Math.abs(this.sunAlt) / 0.28, 0, 1) * clamp(this.light * 2, 0, 1);
  }

  /** Screen-space night color grade, drawn after the world. */
  renderOverlay(ctx, camera) {
    const dark = (1 - this.light) * 0.38;
    if (dark <= 0.01) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = `rgba(10, 16, 42, ${dark})`;
    ctx.fillRect(0, 0, camera.viewW, camera.viewH);
  }
}
