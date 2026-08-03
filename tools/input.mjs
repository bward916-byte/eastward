/**
 * Input latching tests.
 *
 *   npm run test:input
 *
 * Reported as "player gets stuck running after interactions". Cause: touchend
 * was the ONLY thing that cleared the movement keys. Mobile browsers fire
 * touchcancel instead of touchend whenever a gesture is interrupted — including
 * the DOM under the finger changing, which is exactly what an encounter opening
 * the dialogue box does mid-drag. The direction key stayed latched, so the
 * player ran at full speed with nothing touching the screen.
 *
 * Everything here is about input that must NOT survive: a held key or touch
 * outliving the thing that was holding it.
 */
import { JSDOM } from 'jsdom';

const results = [];
const check = (label, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};

const dom = new JSDOM(
  '<!doctype html><html><body><canvas id="c"></canvas><div id="dlg"></div></body></html>',
  { url: 'https://local.test/', pretendToBeVisual: true });
const { window } = dom;
global.window = window;
global.document = window.document;
Object.defineProperty(window, 'innerWidth', { value: 800, configurable: true });

const { InputManager } = await import('../src/core/InputManager.js');
const canvas = window.document.getElementById('c');

function touch(type, changed, { target = canvas, remaining = [] } = {}) {
  const e = new window.Event(type, { bubbles: true });
  Object.defineProperty(e, 'changedTouches', { value: changed });
  Object.defineProperty(e, 'touches', { value: remaining });
  Object.defineProperty(e, 'target', { value: target });
  window.dispatchEvent(e);
}
const settle = (input, secs = 1) => {
  for (let i = 0; i < secs * 60; i++) input.update(1 / 60);
};

function freshInput() {
  const input = new InputManager(window);
  input.touchBlocked = () => false;
  return input;
}

// --- 1. touchcancel must clear movement -------------------------------------
{
  const input = freshInput();
  touch('touchstart', [{ identifier: 1, clientX: 100 }]);
  touch('touchmove', [{ identifier: 1, clientX: 170 }]);
  input.update(1 / 60);
  check('drag produces movement', input.moveDir === 1, `moveDir ${input.moveDir}`);

  touch('touchcancel', [{ identifier: 1, clientX: 170 }]);
  settle(input, 2);
  check('touchcancel clears the held direction', input.moveDir === 0,
    `moveDir ${input.moveDir}, held ${input.holdDuration.toFixed(1)}s`);
}

// --- 2. touchend still works --------------------------------------------------
{
  const input = freshInput();
  touch('touchstart', [{ identifier: 2, clientX: 100 }]);
  touch('touchmove', [{ identifier: 2, clientX: 40 }]);
  input.update(1 / 60);
  check('drag west produces movement', input.moveDir === -1, `moveDir ${input.moveDir}`);
  touch('touchend', [{ identifier: 2, clientX: 40 }]);
  settle(input);
  check('touchend clears the held direction', input.moveDir === 0);
}

// --- 3. an empty touch list means nothing can be held ------------------------
// Guards a mismatched/duplicated identifier leaving a key latched.
{
  const input = freshInput();
  touch('touchstart', [{ identifier: 3, clientX: 100 }]);
  touch('touchmove', [{ identifier: 3, clientX: 180 }]);
  input.update(1 / 60);
  touch('touchend', [{ identifier: 99, clientX: 180 }], { remaining: [] });  // wrong id
  settle(input);
  check('empty touch list clears everything', input.moveDir === 0,
    `moveDir ${input.moveDir}`);
}

// --- 4. a dialogue opening mid-drag must not carry the drag through ---------
{
  const input = freshInput();
  let blocking = false;
  input.touchBlocked = () => blocking;
  touch('touchstart', [{ identifier: 4, clientX: 100 }]);
  touch('touchmove', [{ identifier: 4, clientX: 180 }]);
  input.update(1 / 60);
  check('moving into the encounter', input.moveDir === 1);

  blocking = true;                 // dialogue opens; touch input suppressed
  input.clearMovement();           // what main.js does on the blocking edge
  for (let i = 0; i < 180; i++) input.update(1 / 60);   // 3s of reading
  check('no movement accumulates during the dialogue', input.moveDir === 0
    && input.holdDuration === 0, `moveDir ${input.moveDir}, held ${input.holdDuration}`);

  blocking = false;                // dialogue closes
  settle(input);
  check('does not resume running when the dialogue closes', input.moveDir === 0,
    `moveDir ${input.moveDir}`);
}

// --- 5. backgrounding / blur must not latch keys ----------------------------
{
  const input = freshInput();
  window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight' }));
  input.update(1 / 60);
  check('keyboard movement registers', input.moveDir === 1);
  window.dispatchEvent(new window.Event('blur'));
  settle(input);
  check('blur clears held keys', input.moveDir === 0);

  window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight' }));
  input.update(1 / 60);
  window.dispatchEvent(new window.Event('pagehide'));
  settle(input);
  check('pagehide clears held keys', input.moveDir === 0);
}

// --- 6. holdDuration resets, so nothing resumes mid-run ---------------------
{
  const input = freshInput();
  touch('touchstart', [{ identifier: 6, clientX: 100 }]);
  touch('touchmove', [{ identifier: 6, clientX: 180 }]);
  for (let i = 0; i < 120; i++) input.update(1 / 60);      // 2s: well into RUN
  check('hold builds up while dragging', input.holdDuration > 1,
    `${input.holdDuration.toFixed(1)}s`);
  touch('touchcancel', [{ identifier: 6, clientX: 180 }]);
  input.update(1 / 60);
  check('hold resets on release', input.holdDuration === 0,
    `${input.holdDuration.toFixed(2)}s`);
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
