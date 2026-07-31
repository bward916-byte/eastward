// Playable intro (§2): cold open → flight east with the guardian → the bridge
// separation beat → farewell → tutorial stretch (walk/run/jump over a log) →
// fade into the meadow. Never takes control away for long — the fiction IS
// the tutorial. Beats trigger off player position and timers.

import { bus } from '../core/EventBus.js';
import { BRIDGE_W, BRIDGE_E, BRIDGE_Y, LOG_W, LOG_E, LOG_TOP } from './IntroTerrain.js';

const BEATS = ['FLIGHT', 'AT_BRIDGE', 'CROSSING', 'COLLAPSE', 'FAREWELL', 'TUTORIAL', 'FADEOUT', 'DONE'];

export class IntroSequence {
  constructor(player, terrain, dialogue, camera, guardian) {
    this.player = player;
    this.terrain = terrain;
    this.dialogue = dialogue;
    this.camera = camera;
    this.guardian = guardian;
    this.beat = 'FLIGHT';
    this.beatTime = 0;
    this.collapseT = 0;    // plank-fall animation
    this.shake = 0;
    this.fade = 0;
    this.onComplete = null;
    this._spoke = new Set();

    this._speak('flight', ["Stay close. Keep moving — east, always east."],
      { speaker: '???', autoMs: 2600 });
  }

  _speak(key, lines, opts) {
    if (this._spoke.has(key)) return;
    this._spoke.add(key);
    return this.dialogue.say(lines, opts);
  }

  _setBeat(b) { this.beat = b; this.beatTime = 0; }

  update(dt) {
    this.beatTime += dt;
    const p = this.player;
    this.guardian.update(dt);
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 1.6);

    switch (this.beat) {
      case 'FLIGHT':
        // guardian keeps just ahead, urging east; stops short of the bridge
        this.guardian.setTarget(Math.min(p.x + 95, BRIDGE_W - 35));
        if (p.x > BRIDGE_W - 220) this._setBeat('AT_BRIDGE');
        break;

      case 'AT_BRIDGE':
        this.guardian.setTarget(BRIDGE_W - 30);
        this._speak('bridge', ["The bridge — cross it! Go, quickly!"],
          { speaker: '???', autoMs: 2400 });
        this._setBeat('CROSSING');
        break;

      case 'CROSSING':
        if (p.x > BRIDGE_E + 10) {
          this.terrain.bridgeIntact = false;       // it goes down behind the child
          p.minX = BRIDGE_E + 12;                  // no way back
          p.maxX = BRIDGE_E + 240;                 // held in the moment until farewell ends
          this.collapseT = 0;
          this.shake = 1;
          this.camera.focusX = (BRIDGE_W + BRIDGE_E) / 2; // hold on the gap + silhouette
          this._setBeat('COLLAPSE');
        }
        break;

      case 'COLLAPSE':
        this.collapseT += dt;
        if (this.beatTime > 1.1) {
          this._setBeat('FAREWELL');
          this._speak('farewell', [
            "KEEP GOING — EAST!",
            "Past the mountains, where the sun rises — we'll find you there.",
            "GO!",
          ], { speaker: '???', autoMs: 2200 }).then(() => { this._farewellDone = true; });
        }
        break;

      case 'FAREWELL':
        this.collapseT += dt;
        if (this._farewellDone) {
          this.guardian.alpha = Math.max(0, this.guardian.alpha - dt * 0.55);
          if (this.guardian.alpha <= 0) {
            this.camera.focusX = null;             // the path forward is all that's left
            this.player.maxX = Infinity;
            this._setBeat('TUTORIAL');
          }
        }
        break;

      case 'TUTORIAL':
        if (p.x > 1980) { this._setBeat('FADEOUT'); }
        break;

      case 'FADEOUT':
        this.fade = Math.min(1, this.fade + dt * 0.9);
        if (this.fade >= 1) {
          this._setBeat('DONE');
          bus.emit('introComplete');
          this.onComplete?.();
        }
        break;
    }
  }

  // ---- world-space props: bridge, log, tutorial prompts ----
  renderWorld(ctx) {
    this._renderBridge(ctx);
    this._renderLog(ctx);
    this.guardian.render(ctx);
    if (this.beat === 'TUTORIAL' || this.beat === 'FADEOUT') {
      this._prompt(ctx, 1150, '← → to walk');
      this._prompt(ctx, 1360, 'hold → to run');
      this._prompt(ctx, LOG_W - 55, '↑ to jump');
    } else if (this.beat === 'FLIGHT' || this.beat === 'CROSSING') {
      this._prompt(ctx, this.player.x, null); // no prompts during the flight
    }
  }

  _renderBridge(ctx) {
    const planks = 9;
    const span = BRIDGE_E - BRIDGE_W;
    for (let i = 0; i < planks; i++) {
      const px = BRIDGE_W + (i + 0.5) * (span / planks);
      let py = BRIDGE_Y + 2, rot = 0, alpha = 1;
      if (!this.terrain.bridgeIntact) {
        const t = Math.max(0, this.collapseT - i * 0.06);
        py += t * t * 700;                          // planks drop with slight cascade
        rot = t * (i % 2 ? 2.2 : -1.8);
        alpha = Math.max(0, 1 - t * 0.7);
        if (alpha <= 0) continue;
      }
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(px, py);
      ctx.rotate(rot);
      ctx.fillStyle = '#4a3a28';
      ctx.fillRect(-span / planks / 2 + 1, -3, span / planks - 2, 6);
      ctx.restore();
    }
    // rope rails while intact, snapped tails after
    ctx.strokeStyle = '#5a4a34';
    ctx.lineWidth = 2;
    if (this.terrain.bridgeIntact) {
      ctx.beginPath();
      ctx.moveTo(BRIDGE_W - 4, BRIDGE_Y - 22);
      ctx.quadraticCurveTo((BRIDGE_W + BRIDGE_E) / 2, BRIDGE_Y - 12, BRIDGE_E + 4, BRIDGE_Y - 22);
      ctx.stroke();
    } else {
      const sway = Math.sin(this.collapseT * 3) * 6;
      for (const [ax, dir] of [[BRIDGE_W - 4, 1], [BRIDGE_E + 4, -1]]) {
        ctx.beginPath();
        ctx.moveTo(ax, BRIDGE_Y - 22);
        ctx.quadraticCurveTo(ax + dir * 10, BRIDGE_Y + 30, ax + dir * (4 + sway * dir), BRIDGE_Y + 70);
        ctx.stroke();
      }
    }
  }

  _renderLog(ctx) {
    const cx = (LOG_W + LOG_E) / 2;
    const groundY = 520;
    ctx.fillStyle = '#4d3b26';
    ctx.strokeStyle = '#33271a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(cx, (LOG_TOP + groundY) / 2 + 2, (LOG_E - LOG_W) / 2 + 4, (groundY - LOG_TOP) / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = '#5f4a30';
    ctx.beginPath();
    ctx.ellipse(cx, (LOG_TOP + groundY) / 2 + 2, 6, 9, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  _prompt(ctx, x, text) {
    if (!text) return;
    const y = this.terrain.groundYAt(x) - 64;
    ctx.font = '13px "Trebuchet MS", sans-serif';
    const w = ctx.measureText(text).width + 18;
    ctx.fillStyle = 'rgba(12, 16, 10, 0.62)';
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - 13, w, 22, 10);
    ctx.fill();
    ctx.fillStyle = 'rgba(240, 236, 214, 0.92)';
    ctx.textAlign = 'center';
    ctx.fillText(text, x, y + 3);
    ctx.textAlign = 'left';
  }

  // ---- screen-space mood: darkness, distant fire to the west, shake, fade ----
  renderOverlay(ctx, camera) {
    const w = camera.viewW, h = camera.viewH;
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // night dimming
    ctx.fillStyle = 'rgba(8, 12, 24, 0.34)';
    ctx.fillRect(0, 0, w, h);
    // burning horizon behind (west) — the chaos left unspecified (§2)
    const glow = ctx.createLinearGradient(0, 0, w * 0.5, 0);
    const flicker = 0.16 + Math.sin(performance.now() / 260) * 0.03;
    glow.addColorStop(0, `rgba(214, 92, 40, ${flicker})`);
    glow.addColorStop(1, 'rgba(214, 92, 40, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w * 0.5, h);
    // vignette
    const v = ctx.createRadialGradient(w / 2, h / 2, h * 0.42, w / 2, h / 2, h * 0.95);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.4)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, w, h);
    // fade to black on completion
    if (this.fade > 0) {
      ctx.fillStyle = `rgba(4, 6, 10, ${this.fade})`;
      ctx.fillRect(0, 0, w, h);
    }
  }

  /** Camera shake offset, applied by main before world rendering. */
  shakeOffset() {
    if (this.shake <= 0) return [0, 0];
    const s = this.shake * this.shake * 9;
    return [(Math.random() - 0.5) * s, (Math.random() - 0.5) * s];
  }
}
