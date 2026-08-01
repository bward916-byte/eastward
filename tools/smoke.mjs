/**
 * Headless boot smoke test.
 *
 *   npm install && npm run smoke
 *
 * Boots the REAL game under jsdom with a stubbed canvas/audio context and a
 * fetch that serves data/ from disk, then drives the paths that only run on
 * rare transitions — resume from save, respawn after defeat, the demo tour
 * handing control back. Those paths are exactly where dead wiring hides: they
 * are not on the happy path, so a broken one can ship and sit for months.
 *
 * This exists because `restoreFromSnapshot` was CALLED in three places and
 * DEFINED in none. Respawn and demo-exit both threw ReferenceError in shipped
 * builds. Nothing caught it, because nothing ever booted the game outside a
 * browser. Add a case here whenever you add a transition.
 *
 * Exit code is non-zero if any case fails, so it can gate a deploy.
 */
import { JSDOM } from 'jsdom';
import { readFileSync } from 'fs';
import { performance as nodePerf } from 'perf_hooks';

const results = [];
const check = (label, ok, detail = '') => {
  results.push({ label, ok, detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};

// ---------------------------------------------------------------- environment
const dom = new JSDOM(readFileSync('index.html', 'utf8'), {
  url: 'https://local.test/', pretendToBeVisual: true,
});
const { window } = dom;

// jsdom has no canvas; a proxy sink absorbs every 2D call
const ctxStub = new Proxy({}, { get: (_t, k) => {
  if (k === 'canvas') return { width: 800, height: 450 };
  if (k === 'measureText') return () => ({ width: 10 });
  if (k === 'createLinearGradient' || k === 'createRadialGradient')
    return () => ({ addColorStop() {} });
  if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
  return () => {};
} });
window.HTMLCanvasElement.prototype.getContext = () => ctxStub;

// jsdom's own performance.now recurses infinitely once reassigned — use Node's
Object.defineProperty(window, 'performance', { value: nodePerf, configurable: true });
window.matchMedia = window.matchMedia || ((q) => ({
  matches: /landscape/.test(q), media: q, onchange: null,
  addEventListener() {}, removeEventListener() {},
  addListener() {}, removeListener() {}, dispatchEvent() { return false; },
}));

class AudioContextStub {
  constructor() { this.destination = {}; this.currentTime = 0; this.state = 'running'; }
  _param() { return { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {}, exponentialRampToValueAtTime() {} }; }
  createGain() { return { gain: this._param(), connect() {}, disconnect() {} }; }
  createOscillator() { return { frequency: this._param(), detune: this._param(), type: 'sine', connect() {}, start() {}, stop() {}, disconnect() {} }; }
  createBiquadFilter() { return { frequency: this._param(), Q: this._param(), type: 'lowpass', connect() {}, disconnect() {} }; }
  createBuffer() { return { getChannelData: () => new Float32Array(1024) }; }
  createBufferSource() { return { buffer: null, loop: false, playbackRate: this._param(), connect() {}, start() {}, stop() {}, disconnect() {} }; }
  createStereoPanner() { return { pan: this._param(), connect() {}, disconnect() {} }; }
  createDynamicsCompressor() { return { threshold: this._param(), knee: this._param(), ratio: this._param(), attack: this._param(), release: this._param(), connect() {}, disconnect() {} }; }
  createDelay() { return { delayTime: this._param(), connect() {}, disconnect() {} }; }
  createConvolver() { return { buffer: null, connect() {}, disconnect() {} }; }
  resume() { return Promise.resolve(); }
}

global.window = window;
global.document = window.document;
Object.defineProperty(global, 'navigator', { value: window.navigator, configurable: true });
global.location = window.location;
global.performance = nodePerf;
global.localStorage = window.localStorage;
global.matchMedia = window.matchMedia;
global.HTMLElement = window.HTMLElement;
global.Image = window.Image;
global.requestAnimationFrame = (cb) => setTimeout(() => cb(nodePerf.now()), 8);
global.cancelAnimationFrame = (id) => clearTimeout(id);
global.AudioContext = AudioContextStub;
global.webkitAudioContext = AudioContextStub;

global.fetch = async (url) => {
  const p = String(url).replace(/^.*?(data\/)/, 'data/');
  const body = readFileSync(p, 'utf8');
  return { ok: true, json: async () => JSON.parse(body), text: async () => body };
};
window.fetch = global.fetch;

const errors = [];
window.addEventListener('error', (e) => errors.push('window.error: ' + e.message));
process.on('unhandledRejection', (r) => errors.push('unhandledRejection: ' + (r?.stack ?? r)));
const consoleError = console.error;
console.error = (...a) => { errors.push('console.error: ' + a.join(' ')); consoleError(...a); };

const settle = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------- seeded journey
// Mid-journey: Far Slopes, party of four, Corran saved back in the Deepwood.
window.localStorage.setItem('eastward.save', JSON.stringify({
  version: 1, checkpointId: 'east-shrine', biome: 'mountain-east', savedAt: Date.now(),
  player: {
    x: 2400, facing: 1, stamina: 70, endurance: 65, health: 80, mana: 10,
    artifacts: 5, identified: 3, gold: 180, classId: 'fighter',
    skills: { accuracy: 1.5, fightSpeed: 1.3, autoDodge: 0.4, climbSkill: 1.1 },
    maxHealth: 120, xp: 2000, level: 6, ageDays: 180, injuries: ['bruise'],
  },
  world: {
    timeOfDay: 0.4, flags: ['east-relic-3'],
    journal: {
      d: ['fst-wounded=0', 'mdw-mira=0'],
      m: ['party=mira,corran,bram,sela', 'corran=saved', 'kindness=1'],
    },
  },
}));

// ------------------------------------------------------------------- run
await import('../src/main.js');
await settle(1200);

const { bus } = await import('../src/core/EventBus.js');
const { journal } = await import('../src/core/Journal.js');

check('boots without error', errors.length === 0, errors[0] ?? '');
check('party restored from save',
  journal.friends().join(',') === 'mira,corran,bram,sela',
  journal.friends().join(',') || '(none)');

window.document.getElementById('journey-btn')
  .dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
const roster = window.document.getElementById('party-roster').textContent;
check('roster panel renders the party', /Mira/.test(roster) && /Corran/.test(roster));
window.document.getElementById('journey-close')
  .dispatchEvent(new window.Event('pointerdown', { bubbles: true }));

// respawn after defeat — previously threw ReferenceError
let mark = errors.length;
bus.emit('playerDefeated', {});
await settle(2500);
check('respawn after defeat', errors.length === mark, errors.slice(mark).join(' | '));
check('party survives respawn',
  journal.friends().join(',') === 'mira,corran,bram,sela',
  journal.friends().join(','));

// demo tour start → exit, which also restores through the same path
mark = errors.length;
const demoBtn = window.document.getElementById('demo-btn');
if (demoBtn && !demoBtn.hidden) {
  demoBtn.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
  await settle(2500);
  window.document.getElementById('demo-exit')
    .dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
  await settle(2500);
  check('demo tour start and exit', errors.length === mark, errors.slice(mark).join(' | '));
  check('party survives the demo',
    journal.friends().join(',') === 'mira,corran,bram,sela',
    journal.friends().join(','));
} else {
  check('demo tour (skipped — SHOW_DEMO off)', true);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
