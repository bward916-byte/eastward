// Wind (§3.6/§13.3): a continuous signed value -1..1 — positive blows EAST
// (a tailwind for the journey), negative is a headwind. Layered slow sines +
// occasional gust envelopes give it life; per-biome base/gustiness/prevailing
// come from biome data. Consumers: player speed modifier, foliage sway,
// weather particle drift, ambient wind audio.

import { clamp } from '../core/utils.js';

export class WindSystem {
  constructor() {
    this.t = 0;
    this.value = 0;
    this.base = 0.1;
    this.gustiness = 0.3;
    this.prevailing = 1;
    this._gust = 0;
    this._gustTarget = 0;
    this._nextGust = 8;
  }

  setBiome(def) {
    this.base = def?.base ?? 0.1;
    this.gustiness = def?.gustiness ?? 0.3;
    this.prevailing = def?.prevailing ?? 1;
  }

  update(dt, extraBoost = 0) {
    this.t += dt;
    this._nextGust -= dt;
    if (this._nextGust <= 0) {
      // a gust builds, holds briefly, releases
      this._gustTarget = (Math.random() * 0.7 + 0.2) * (Math.random() < 0.75 ? this.prevailing : -this.prevailing);
      this._nextGust = 14 + Math.random() * 26;
      setTimeout(() => { this._gustTarget = 0; }, (2500 + Math.random() * 3500));
    }
    this._gust += (this._gustTarget - this._gust) * Math.min(1, dt * 0.8);

    const drift = Math.sin(this.t * 0.11) * 0.35 + Math.sin(this.t * 0.043 + 2) * 0.25;
    this.value = clamp(
      this.base * this.prevailing + drift * this.gustiness + this._gust * this.gustiness + extraBoost * this.prevailing,
      -1, 1
    );
  }

  get strength() { return Math.abs(this.value); }

  /** §3.6: live speed modifier for a mover heading in dir (-1/0/1). */
  speedModFor(dir) {
    if (dir === 0) return 1;
    return clamp(1 + this.value * dir * 0.18, 0.76, 1.18);
  }
}
