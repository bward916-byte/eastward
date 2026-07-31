// Baseline weather (§13.3): clear / gusty / rain / fog, weighted per biome,
// holding each state 40–90s with smooth level crossfades. Rain wets footing
// (mild speed penalty via speedMod), fog reduces visibility, gusty boosts the
// WindSystem. Major set-piece events (Storm/Sandstorm/Blizzard/Squall) layer
// on later — this system owns the state machine they'll extend, and already
// emits the EventBus signals audio listens for.

import { bus } from '../core/EventBus.js';
import { clamp, damp } from '../core/utils.js';

const STATES = {
  clear: { rain: 0, fog: 0, windBoost: 0 },
  gust:  { rain: 0, fog: 0, windBoost: 0.5 },
  rain:  { rain: 0.9, fog: 0.18, windBoost: 0.22 },
  fog:   { rain: 0, fog: 0.85, windBoost: -0.05 },
};
const RAIN_COUNT = 150;

export class WeatherSystem {
  constructor() {
    this.weights = { clear: 1 };
    this.state = 'clear';
    this.timer = 20;
    this.rainLevel = 0;
    this.fogLevel = 0;
    this.windBoost = 0;
    this.drops = null;
  }

  setBiome(def) {
    this.weights = def ?? { clear: 1 };
    this.state = 'clear';
    this.timer = 15 + Math.random() * 20;
    bus.emit('weatherChanged', { state: this.state });
  }

  _pickNext() {
    const entries = Object.entries(this.weights).filter(([k]) => STATES[k] && k !== this.state);
    const total = entries.reduce((s, [, w]) => s + w, 0);
    let r = Math.random() * total;
    for (const [k, w] of entries) { r -= w; if (r <= 0) return k; }
    return 'clear';
  }

  update(dt, wind, camera) {
    this.timer -= dt;
    if (this.timer <= 0) {
      this.state = this._pickNext();
      this.timer = 40 + Math.random() * 50;
      bus.emit('weatherChanged', { state: this.state });
    }
    const target = STATES[this.state];
    this.rainLevel = damp(this.rainLevel, target.rain, 0.5, dt);
    this.fogLevel = damp(this.fogLevel, target.fog, 0.5, dt);
    this.windBoost = damp(this.windBoost, target.windBoost, 0.5, dt);

    if (this.rainLevel > 0.02) {
      if (!this.drops) {
        this.drops = Array.from({ length: RAIN_COUNT }, () => ({
          x: Math.random(), y: Math.random(), spd: 620 + Math.random() * 260,
        }));
      }
      const w = camera.viewW, h = camera.viewH;
      const driftX = wind.value * 180;
      for (const d of this.drops) {
        d.y += d.spd * dt / h;
        d.x += driftX * dt / w;
        if (d.y > 1) { d.y -= 1.04; d.x = Math.random(); }
        if (d.x > 1.05) d.x -= 1.1; else if (d.x < -0.05) d.x += 1.1;
      }
    }
  }

  /** Wet-footing modifier (§13.3: mud slows Run). */
  get speedMod() { return 1 - this.rainLevel * 0.08; }

  render(ctx, camera, windValue) {
    const w = camera.viewW, h = camera.viewH;
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    if (this.rainLevel > 0.02 && this.drops) {
      const slant = windValue * 14;
      ctx.strokeStyle = `rgba(190, 210, 235, ${0.34 * this.rainLevel})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      const visible = Math.floor(RAIN_COUNT * clamp(this.rainLevel, 0, 1));
      for (let i = 0; i < visible; i++) {
        const d = this.drops[i];
        const x = d.x * w, y = d.y * h;
        ctx.moveTo(x, y);
        ctx.lineTo(x + slant, y + 13);
      }
      ctx.stroke();
    }

    if (this.fogLevel > 0.02) {
      const g = ctx.createLinearGradient(0, h * 0.25, 0, h);
      g.addColorStop(0, `rgba(210, 214, 218, ${0.12 * this.fogLevel})`);
      g.addColorStop(0.7, `rgba(198, 204, 208, ${0.42 * this.fogLevel})`);
      g.addColorStop(1, `rgba(198, 204, 208, ${0.28 * this.fogLevel})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
  }
}
