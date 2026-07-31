// Camera: follows the player with an east bias (player sits left-of-center so
// more of the road ahead is visible), plus the dynamic zoom system from §3.4.
// Phase 1 has no flagged encounter objects yet, so `desiredZoom` is driven by
// locomotion state + time-spent-fast; the flagged-object hook is stubbed for
// Phase 5 (EncounterManager) to feed later.

import { damp, clamp } from './utils.js';

export const ZOOM = { CLOSE: 1.25, NORMAL: 1.0, WIDE: 0.72 };

const WIDE_AFTER = 4.5;   // seconds of sustained fast travel before widening (§3.4)
const ZOOM_RATE = 1.6;    // lerp convergence rate (capped, never snaps)

export class Camera {
  constructor(viewW, viewH) {
    this.viewW = viewW;
    this.viewH = viewH;
    this.x = 0;               // world x at screen center
    this.y = 0;
    this.zoom = ZOOM.NORMAL;
    this._desiredZoom = ZOOM.NORMAL;
    this._fastTimer = 0;
    this.eastBias = 0.16;     // fraction of view width the player sits left of center
  }

  resize(w, h) { this.viewW = w; this.viewH = h; }

  /** Phase-5 hook: nearest Adventure/Interest/Challenge/NPC distance (world px). */
  nearestFlaggedDistance() { return Infinity; }

  update(dt, player) {
    // --- desired zoom (§3.4) ---
    const fast = player.state === 'RUN' || player.state === 'SPRINT';
    if (fast && Math.abs(player.vx) > 1) this._fastTimer += dt;
    else this._fastTimer = 0;

    const flaggedNear = this.nearestFlaggedDistance() < 500;
    if (flaggedNear || player.state === 'IDLE' || player.state === 'WALK') {
      this._desiredZoom = ZOOM.NORMAL;
    } else if (this._fastTimer > WIDE_AFTER) {
      this._desiredZoom = ZOOM.WIDE;
    }
    // (CLOSE tier reserved for dialogue/lockpicking/combat focus in later phases)

    this.zoom = damp(this.zoom, this._desiredZoom, ZOOM_RATE, dt);

    // --- follow with east bias ---
    const targetX = player.x + this.viewW * this.eastBias / this.zoom;
    const targetY = player.y - this.viewH * 0.12 / this.zoom;
    this.x = damp(this.x, targetX, 6, dt);
    this.y = damp(this.y, targetY, 4, dt);
  }

  /** Apply this camera's transform to a 2D context. */
  applyTransform(ctx) {
    ctx.setTransform(
      this.zoom, 0, 0, this.zoom,
      this.viewW / 2 - this.x * this.zoom,
      this.viewH / 2 - this.y * this.zoom
    );
  }

  worldLeft()  { return this.x - this.viewW / 2 / this.zoom; }
  worldRight() { return this.x + this.viewW / 2 / this.zoom; }
}
