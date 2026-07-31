// Baseline weather (§13.3): clear / gusty / rain / fog, weighted per biome,
// holding each state 40–90s with smooth level crossfades. Rain wets footing
// (mild speed penalty via speedMod), fog reduces visibility, gusty boosts the
// WindSystem. Major set-piece events (Storm/Sandstorm/Blizzard/Squall) layer
// on later — this system owns the state machine they'll extend, and already
// emits the EventBus signals audio listens for.

import { bus } from '../core/EventBus.js';
import { clamp, damp } from '../core/utils.js';

const STATES = {
  clear:    { rain: 0, fog: 0, windBoost: 0, snow: 0 },
  gust:     { rain: 0, fog: 0, windBoost: 0.5, snow: 0 },
  rain:     { rain: 0.9, fog: 0.18, windBoost: 0.22, snow: 0 },
  fog:      { rain: 0, fog: 0.85, windBoost: -0.05, snow: 0 },
  snowfall: { rain: 0, fog: 0.12, windBoost: 0.15, snow: 0.55 },
  blizzard: { rain: 0, fog: 0.45, windBoost: 0.85, snow: 0.95 },  // §M.2 major event
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
    this.snowLevel = 0;
    this.drops = null;
    this.flakes = null;
  }

  setBiome(def) {
    this.weights = def ?? { clear: 1 };
    this.state = 'clear';
    this.timer = 15 + Math.random() * 20;
    bus.emit('weatherChanged', { state: this.state });
  }

  /** Force a state (demo mode / scripted set pieces). */
  force(state, holdSeconds = 999) {
    if (!STATES[state]) return;
    this.state = state;
    this.timer = holdSeconds;
    bus.emit('weatherChanged', { state });
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
    this.snowLevel = damp(this.snowLevel, target.snow ?? 0, 0.4, dt);

    if (this.snowLevel > 0.02) {
      if (!this.flakes) {
        this.flakes = Array.from({ length: 130 }, () => ({
          x: Math.random(), y: Math.random(), spd: 55 + Math.random() * 85, ph: Math.random() * 7,
        }));
      }
      const w2 = camera.viewW, h2 = camera.viewH;
      for (const f of this.flakes) {
        f.y += f.spd * dt / h2;
        f.x += (wind.value * 260 + Math.sin(f.ph + f.y * 9) * 22) * dt / w2;
        if (f.y > 1) { f.y -= 1.03; f.x = Math.random(); }
        if (f.x > 1.05) f.x -= 1.1; else if (f.x < -0.05) f.x += 1.1;
      }
    }

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

  /** Blizzard raises effective snow depth a tier while raging (§M.2). */
  get snowBoost() { return this.state === 'blizzard' && this.snowLevel > 0.5 ? 1 : 0; }

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

    if (this.snowLevel > 0.02 && this.flakes) {
      ctx.fillStyle = `rgba(240, 246, 252, ${0.5 * this.snowLevel})`;
      const visible = Math.floor(130 * clamp(this.snowLevel, 0, 1));
      for (let i = 0; i < visible; i++) {
        const f = this.flakes[i];
        ctx.beginPath();
        ctx.arc(f.x * w, f.y * h, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
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
