// Ambient SFX layer (Amendment 03 §I) — separate from music, on its own bus.
// Currently synthesized: wind bed (filtered noise whose gain will be driven
// live by WindSystem in Phase 4 — until then, each biome's authored windBase),
// and locomotion-cadenced footsteps per §I.2 (walk/run/climb each have their
// own cadence and character; surface variants expand when biomes carry ground
// materials). Wildlife/day-night beds and weather SFX join in Phase 4.

export class AmbientManager {
  constructor(engine) {
    this.engine = engine;
    this.windGain = null;
    this.windFilter = null;
    this.windBase = 0.1;
    this.windLive = 0;         // Phase 4: WindSystem writes this each frame
    this._stepAcc = 0;
    this.rainGain = null;
  }

  start(audioDef) {
    const e = this.engine;
    if (!e.ready) return;
    this.windBase = audioDef?.windBase ?? 0.1;
    if (!this.windGain) {
      const src = e.ctx.createBufferSource();
      src.buffer = e.makeNoiseBuffer();
      src.loop = true;
      this.windFilter = e.ctx.createBiquadFilter();
      this.windFilter.type = 'lowpass';
      this.windFilter.frequency.value = 420;
      this.windGain = e.ctx.createGain();
      this.windGain.gain.value = 0;
      src.connect(this.windFilter);
      this.windFilter.connect(this.windGain);
      this.windGain.connect(e.ambientBus);
      src.start();
    }
    e.ramp(this.windGain.gain, this.windBase, 2.5);
  }

  setBiome(audioDef) {
    if (!this.engine.ready || !this.windGain) return;
    this.windBase = audioDef?.windBase ?? 0.1;
    this.engine.ramp(this.windGain.gain, this.windBase + this.windLive, 2.5);
  }

  /** Rain patter bed (§I.2 weather SFX), level 0..1. */
  setRain(level) {
    const e = this.engine;
    if (!e.ready) return;
    if (!this.rainGain) {
      const src = e.ctx.createBufferSource();
      src.buffer = e.makeNoiseBuffer();
      src.loop = true;
      const bp = e.ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 3200; bp.Q.value = 0.5;
      this.rainGain = e.ctx.createGain();
      this.rainGain.gain.value = 0;
      src.connect(bp); bp.connect(this.rainGain); this.rainGain.connect(e.ambientBus);
      src.start();
    }
    e.ramp(this.rainGain.gain, level * 0.22, 1.2);
  }

  /** Live wind strength 0..1 from WindSystem (§I.2). */
  setWind(strength) {
    this.windLive = strength * 0.4;
    if (this.windGain) {
      this.engine.ramp(this.windGain.gain, this.windBase + this.windLive, 0.6);
      this.engine.ramp(this.windFilter.frequency, 420 + strength * 900, 0.6);
    }
  }

  update(dt, player) {
    if (!this.engine.ready) return;
    // footstep cadence by locomotion state (§I.2)
    let rate = 0, kind = 'soft';
    switch (player.state) {
      case 'WALK': rate = 2.1; break;
      case 'RUN': rate = 3.4; kind = 'firm'; break;
      case 'CLIMB': rate = 1.5; kind = 'scuff'; break;
      case 'SLIDE': rate = 6; kind = 'scuff'; break;
    }
    if (rate === 0 || !player.grounded && player.state !== 'CLIMB') { this._stepAcc = 0; return; }
    this._stepAcc += dt * rate;
    if (this._stepAcc >= 1) {
      this._stepAcc -= 1;
      this._footstep(kind);
    }
  }

  _footstep(kind) {
    const e = this.engine;
    const t = e.now;
    const src = e.ctx.createBufferSource();
    src.buffer = e.makeNoiseBuffer();
    const f = e.ctx.createBiquadFilter();
    const g = e.ctx.createGain();
    if (kind === 'firm') {
      f.type = 'lowpass'; f.frequency.value = 900;
      g.gain.setValueAtTime(0.11, t);
    } else if (kind === 'scuff') {
      f.type = 'bandpass'; f.frequency.value = 1400;
      g.gain.setValueAtTime(0.05, t);
    } else {
      f.type = 'lowpass'; f.frequency.value = 650;
      g.gain.setValueAtTime(0.07, t);
    }
    g.gain.exponentialRampToValueAtTime(0.001, t + (kind === 'scuff' ? 0.12 : 0.07));
    src.connect(f); f.connect(g); g.connect(e.ambientBus);
    src.start(t);
    src.stop(t + 0.15);
  }
}
