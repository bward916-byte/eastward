/**
 * Viewport / rotation tests.
 *
 *   npm run test:viewport
 *
 * Reproduces the reported bug: rotating portrait -> landscape hid the bottom
 * bar. #hud is anchored `bottom: 0` inside #game-root, which was sized with
 * 100dvh. Mobile browsers announce the orientation change BEFORE layout
 * settles, so the root kept the portrait height (~844px) while the visible
 * landscape viewport was ~390px — the HUD sat ~450px below the fold and was
 * clipped away by overflow: hidden.
 *
 * The core assertion is that a size reading taken at the moment of the event
 * is NOT trusted as final: the Viewport must re-measure as layout settles.
 */
import { JSDOM } from 'jsdom';

const results = [];
const check = (label, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};

const dom = new JSDOM('<!doctype html><html><body><div id="game-root"></div></body></html>',
  { url: 'https://local.test/', pretendToBeVisual: true });
const { window } = dom;

global.window = window;
global.document = window.document;
global.requestAnimationFrame = (cb) => setTimeout(() => cb(0), 4);

// a controllable visualViewport, as the real one is read-only
const listeners = { resize: [], scroll: [] };
const vv = {
  width: 390, height: 844,
  addEventListener: (t, f) => listeners[t]?.push(f),
  removeEventListener: (t, f) => {
    const a = listeners[t]; const i = a?.indexOf(f); if (i > -1) a.splice(i, 1);
  },
};
Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });

const setSize = (w, h) => { vv.width = w; vv.height = h; };
const appH = () => window.document.documentElement.style.getPropertyValue('--app-h');
const appW = () => window.document.documentElement.style.getPropertyValue('--app-w');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const { Viewport } = await import('../src/core/Viewport.js');

// --- 1. initial measurement --------------------------------------------------
let changes = [];
const viewport = new Viewport((w, h) => changes.push([w, h]));
check('publishes initial size', appH() === '844px' && appW() === '390px',
  `${appW()} x ${appH()}`);

// --- 2. rotation announced BEFORE dimensions update -------------------------
// This is the real mobile behaviour and the whole cause of the bug.
changes = [];
window.dispatchEvent(new window.Event('orientationchange'));
// dimensions are still portrait at this instant — a naive implementation
// records 844 here and never corrects it
await wait(30);
const during = appH();
setSize(844, 390);                       // layout settles a moment later
await wait(800);

check('does not freeze on the stale pre-rotation reading', appH() === '390px',
  `settled at ${appH()} (was ${during} mid-rotation)`);
check('width updated too', appW() === '844px', appW());
check('reported the change to the app', changes.some(([w, h]) => w === 844 && h === 390),
  JSON.stringify(changes));

// --- 3. the HUD would now be on-screen --------------------------------------
{
  const h = parseInt(appH(), 10);
  check('viewport height matches the visible landscape area', h === 390, `${h}px`);
  check('HUD anchor (bottom: 0) lands inside the visible area', h <= vv.height,
    `root ${h}px vs visible ${vv.height}px`);
}

// --- 4. late/no-event changes are still caught ------------------------------
// Browser chrome hiding fires only on visualViewport, not window resize.
changes = [];
setSize(844, 420);
listeners.resize.forEach((f) => f());
await wait(800);
check('tracks browser-chrome show/hide via visualViewport', appH() === '420px', appH());

// --- 5. garbage mid-rotation readings are ignored ---------------------------
changes = [];
setSize(0, 0);                            // some browsers report 0 briefly
window.dispatchEvent(new window.Event('resize'));
await wait(200);
check('ignores zero-size readings', appH() === '420px', appH());
setSize(844, 390);
await wait(800);
check('recovers after garbage reading', appH() === '390px', appH());

// --- 6. falls back when visualViewport is absent ----------------------------
{
  delete window.visualViewport;
  Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 640, configurable: true });
  const v2 = new Viewport(() => {});
  check('falls back to innerWidth/innerHeight', appH() === '640px' && appW() === '1024px',
    `${appW()} x ${appH()}`);
  v2.destroy();
}

viewport.destroy();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
