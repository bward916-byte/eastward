// Web Audio foundation (Amendment 03 §J): owns the context, master gain, and
// the two child buses — musicBus and ambientBus — that MusicManager and
// AmbientManager connect to. Nothing else touches the raw context.
// Created suspended; init() is called from the first user gesture (browser
// autoplay policy). Mute preference persists.

const MUTE_KEY = 'eastward.muted';

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicBus = null;
    this.ambientBus = null;
    this.muted = localStorage.getItem(MUTE_KEY) === '1';
  }

  get ready() { return !!this.ctx; }
  get now() { return this.ctx ? this.ctx.currentTime : 0; }

  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    this.master.connect(this.ctx.destination);

    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = 0.55;
    this.musicBus.connect(this.master);

    this.ambientBus = this.ctx.createGain();
    this.ambientBus.gain.value = 0.7;
    this.ambientBus.connect(this.master);

    this.ctx.resume();
  }

  /** Smooth gain ramp helper shared by both managers (§H.3). */
  ramp(param, target, seconds) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    param.cancelScheduledValues(t);
    param.setValueAtTime(param.value, t);
    param.linearRampToValueAtTime(target, t + Math.max(0.01, seconds));
  }

  toggleMute() {
    this.muted = !this.muted;
    localStorage.setItem(MUTE_KEY, this.muted ? '1' : '0');
    if (this.master) this.ramp(this.master.gain, this.muted ? 0 : 0.9, 0.15);
    return this.muted;
  }

  midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  /** 2s looping white-noise buffer (wind, weather beds). */
  makeNoiseBuffer() {
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }
}
