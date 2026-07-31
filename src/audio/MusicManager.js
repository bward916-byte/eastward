// Adaptive layered music (Amendment 03 §H) — currently GENERATIVE: each biome
// authors a small "audio" block in its biomes/*.json (root note, scale, chord,
// tempo, brightness, pluck density) and this manager synthesizes the stems
// live via Web Audio. When recorded .ogg stems exist later, only the voice
// construction here changes — the layer/gain/crossfade API and EventBus wiring
// stay identical.
//
// Layers per biome (§H.2): base (pad + plucks, always on), tension (low drone,
// gain 0 until "challengeApproaching"), combat (pulse, gain 0 until
// "combatStarted"). Town/cave layers arrive with their systems. Biome changes
// crossfade whole layer-sets (§H.3). Checkpoint saves get a soft chime sting.

import { bus } from '../core/EventBus.js';

const SCALES = {
  majorPent: [0, 2, 4, 7, 9],
  minorPent: [0, 3, 5, 7, 10],
};
const XFADE = 3.0;

export class MusicManager {
  constructor(engine) {
    this.engine = engine;
    this.current = null;      // active BiomeMusic
    this.previous = null;

    bus.on('challengeApproaching', () => this.setLayer('tension', 0.7, 2.5));
    bus.on('challengePassed', () => this.setLayer('tension', 0, 3));
    bus.on('combatStarted', () => this.setLayer('combat', 0.85, 1.2));
    bus.on('combatEnded', () => this.setLayer('combat', 0, 3));
    bus.on('gameSaved', () => this.sting('checkpoint'));
  }

  playBiome(audioDef, id) {
    if (!this.engine.ready || !audioDef) return;
    if (this.current?.id === id) return;
    if (this.previous) this.previous.dispose(0.1);
    this.previous = this.current;
    if (this.previous) {
      this.engine.ramp(this.previous.out.gain, 0, XFADE);
      setTimeout(() => { this.previous?.dispose(0.5); this.previous = null; }, XFADE * 1000 + 600);
    }
    this.current = new BiomeMusic(this.engine, audioDef, id);
    this.engine.ramp(this.current.out.gain, 1, XFADE);
  }

  setLayer(name, level, seconds = 2) {
    this.current?.setLayer(name, level, seconds);
  }

  sting(kind) {
    const e = this.engine;
    if (!e.ready) return;
    if (kind === 'checkpoint') {
      // soft two-note bell: root + fifth an octave up
      const root = (this.current?.def.root ?? 57) + 12;
      [[root, 0], [root + 7, 0.22]].forEach(([m, dt]) => {
        const t = e.now + dt;
        const osc = e.ctx.createOscillator();
        const harm = e.ctx.createOscillator();
        const g = e.ctx.createGain();
        osc.frequency.value = e.midiToFreq(m);
        harm.frequency.value = e.midiToFreq(m) * 2.01;
        osc.type = 'sine'; harm.type = 'sine';
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.16, t + 0.015);
        g.gain.exponentialRampToValueAtTime(0.001, t + 1.6);
        const hg = e.ctx.createGain(); hg.gain.value = 0.25;
        osc.connect(g); harm.connect(hg); hg.connect(g);
        g.connect(e.musicBus);
        osc.start(t); harm.start(t);
        osc.stop(t + 1.8); harm.stop(t + 1.8);
      });
    }
  }
}

class BiomeMusic {
  constructor(engine, def, id) {
    this.engine = engine;
    this.def = def;
    this.id = id;
    const e = engine;

    this.out = e.ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(e.musicBus);

    this.layers = {};
    this._buildPad(def);
    this._buildTension(def);
    this._buildCombat(def);
    this._startPlucks(def);
  }

  _layerGain(name, initial) {
    const g = this.engine.ctx.createGain();
    g.gain.value = initial;
    g.connect(this.out);
    this.layers[name] = g;
    return g;
  }

  // Base pad: detuned triangle chord through a lowpass, slow breathing LFO
  _buildPad(def) {
    const e = this.engine;
    const g = this._layerGain('base', 0.5);
    const lp = e.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = def.brightness ?? 1200;
    lp.connect(g);

    this._nodes = [];
    for (const m of def.chord) {
      for (const det of [-4, 4]) {
        const o = e.ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = e.midiToFreq(m);
        o.detune.value = det;
        const og = e.ctx.createGain();
        og.gain.value = 0.05;
        o.connect(og); og.connect(lp);
        o.start();
        this._nodes.push(o);
      }
    }
    const lfo = e.ctx.createOscillator();
    const lfoG = e.ctx.createGain();
    lfo.frequency.value = 0.07;
    lfoG.gain.value = 0.12;
    lfo.connect(lfoG); lfoG.connect(g.gain);
    lfo.start();
    this._nodes.push(lfo);
  }

  // Tension layer (§H.2): sub-octave drone, silent until an event raises it
  _buildTension(def) {
    const e = this.engine;
    const g = this._layerGain('tension', 0);
    const lp = e.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 300;
    lp.connect(g);
    for (const [type, m, vol] of [['sine', def.root - 24, 0.2], ['sawtooth', def.root - 12, 0.05]]) {
      const o = e.ctx.createOscillator();
      o.type = type;
      o.frequency.value = e.midiToFreq(m);
      const og = e.ctx.createGain(); og.gain.value = vol;
      o.connect(og); og.connect(lp);
      o.start();
      this._nodes.push(o);
    }
  }

  // Combat layer (§H.2): rhythmic pulse at double-time, silent by default
  _buildCombat(def) {
    const e = this.engine;
    const g = this._layerGain('combat', 0);
    const o = e.ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = e.midiToFreq(def.root - 12);
    const og = e.ctx.createGain(); og.gain.value = 0;
    const lfo = e.ctx.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = (def.tempo ?? 64) / 60 * 2;
    const lfoG = e.ctx.createGain(); lfoG.gain.value = 0.08;
    lfo.connect(lfoG); lfoG.connect(og.gain);
    const lp = e.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 700;
    o.connect(og); og.connect(lp); lp.connect(g);
    o.start(); lfo.start();
    this._nodes.push(o, lfo);
  }

  // Sparse plucked melody from the biome's scale — lookahead scheduler
  _startPlucks(def) {
    const e = this.engine;
    const g = this._layerGain('plucks', 0.6);
    const scale = SCALES[def.mode] ?? SCALES.majorPent;
    const beat = 60 / (def.tempo ?? 64);
    let nextT = e.now + 1;
    this._pluckTimer = setInterval(() => {
      while (nextT < e.now + 0.4) {
        if (Math.random() < (def.pluckDensity ?? 0.4)) {
          const deg = scale[Math.floor(Math.random() * scale.length)];
          const oct = Math.random() < 0.3 ? 24 : 12;
          const m = def.root + deg + oct;
          const t = nextT;
          const o = e.ctx.createOscillator();
          o.type = 'triangle';
          o.frequency.value = e.midiToFreq(m);
          const og = e.ctx.createGain();
          og.gain.setValueAtTime(0, t);
          og.gain.linearRampToValueAtTime(0.09, t + 0.012);
          og.gain.exponentialRampToValueAtTime(0.001, t + 1.4);
          const pan = e.ctx.createStereoPanner?.() ?? null;
          if (pan) {
            pan.pan.value = (Math.random() - 0.5) * 0.9;
            o.connect(og); og.connect(pan); pan.connect(g);
          } else { o.connect(og); og.connect(g); }
          o.start(t); o.stop(t + 1.6);
        }
        nextT += beat * (Math.random() < 0.35 ? 0.5 : 1);
      }
    }, 120);
  }

  setLayer(name, level, seconds) {
    const g = this.layers[name];
    if (g) this.engine.ramp(g.gain, level, seconds);
  }

  dispose(after = 0) {
    clearInterval(this._pluckTimer);
    setTimeout(() => {
      for (const n of this._nodes ?? []) { try { n.stop(); } catch {} }
      try { this.out.disconnect(); } catch {}
    }, after * 1000);
  }
}
