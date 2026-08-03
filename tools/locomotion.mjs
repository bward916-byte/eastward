/**
 * Locomotion / stamina regression tests.
 *
 *   npm run test:locomotion
 *
 * Module-level sim (no DOM) — drives the real Player against real biome
 * terrain with scripted inputs. These cases exist because of a shipped bug:
 * holding a direction into a climb-tier face pinned the player at the foot of
 * the hill in RUN, burning stamina AND endurance for zero distance, until they
 * could no longer meet the stamina > 1 needed to start the climb.
 *
 * Related and worse: EXHAUSTED regenerated nothing at all, so once stamina and
 * endurance both reached zero the journey could not continue by any means.
 */
import { readFileSync } from 'fs';
import { TerrainSpline } from '../src/world/TerrainSpline.js';
import { Player } from '../src/entities/Player.js';

const results = [];
const check = (label, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};

const biome = (id) => JSON.parse(readFileSync(`data/biomes/${id}.json`, 'utf8'));
const mkInput = (o = {}) => ({
  moveDir: 0, holdDuration: 0, jumpPressed: false, jumpHeld: false,
  interactPressed: false, crouch: false, ...o,
});

function sim(terrain, startX, seconds, driver) {
  const p = new Player(startX, terrain);
  p.y = terrain.groundYAt(startX);
  p.prevX = p.x; p.prevY = p.y;
  const input = mkInput();
  const seen = new Set();
  for (let i = 0; i < 120 * seconds; i++) {
    driver(input, i / 120, p);
    if (input.moveDir !== 0) input.holdDuration += 1 / 120; else input.holdDuration = 0;
    p.update(1 / 120, input, terrain);
    seen.add(p.state);
  }
  return { p, seen };
}

// --- terrain fixtures --------------------------------------------------------
const high = new TerrainSpline(biome('mountain-high'));
let face = null;
for (let x = 200; x < 7000; x += 5) {
  if (high.tierAt(x) === 'climb' && high.tierAt(x - 60) === 'walk') { face = x; break; }
}
const meadow = new TerrainSpline(biome('meadow'));
let flat = null;
for (let x = 300; x < 4000; x += 10) {
  if (high.tierAt(x) !== 'climb' && meadow.tierAt(x) === 'walk' && meadow.tierAt(x + 400) === 'walk') { flat = x; break; }
}

// --- 1. pinned at a climb face must not drain -------------------------------
{
  const { p } = sim(high, face - 60, 45, (inp) => { inp.moveDir = 1; });
  check('pinned at a face does not enter RUN', p.state !== 'RUN', `state ${p.state}`);
  check('pinned at a face keeps stamina', p.stamina > 50, `stamina ${p.stamina.toFixed(1)}`);
  check('pinned at a face keeps endurance', p.endurance > 95, `endurance ${p.endurance.toFixed(1)}`);
  check('pinned player can still start a climb', p.stamina > 1);
  check('climb hint asks for the climb input', p.climbHint === 1, `hint ${p.climbHint}`);
}

// --- 2. holding Up at the face still climbs ---------------------------------
{
  const { p, seen } = sim(high, face - 60, 30, (inp) => { inp.moveDir = 1; inp.jumpHeld = true; });
  check('holding Up climbs the face', seen.has('CLIMB'));
  check('climb makes real progress east', p.x > face + 200, `x ${p.x.toFixed(0)}`);
  check('climb hint hidden while climbing', p.climbHint === 0, `hint ${p.climbHint}`);
}

// --- 3. running on open ground is unaffected --------------------------------
{
  const { p, seen } = sim(meadow, flat, 6, (inp) => { inp.moveDir = 1; });
  check('still reaches RUN on flat ground', seen.has('RUN'));
  check('running still costs stamina', p.stamina < 100, `stamina ${p.stamina.toFixed(1)}`);
  check('running still covers ground', p.x > flat + 700, `moved ${(p.x - flat).toFixed(0)}px`);
}

// --- 4. EXHAUSTED must be escapable -----------------------------------------
{
  const p = new Player(1000, meadow);
  p.y = meadow.groundYAt(1000);
  p.stamina = 0; p.endurance = 0;
  const idle = mkInput();
  for (let i = 0; i < 120 * 20; i++) p.update(1 / 120, idle, meadow);
  check('EXHAUSTED recovers by resting', p.stamina > 1 && p.endurance > 1,
    `stamina ${p.stamina.toFixed(1)}, endurance ${p.endurance.toFixed(1)}`);
  check('EXHAUSTED is not an absorbing state', p.state !== 'EXHAUSTED', `state ${p.state}`);
}

// --- 4b. a tired player must not be admitted to a climb they cannot finish --
{
  const p = new Player(face - 60, high);
  p.y = high.groundYAt(p.x); p.prevX = p.x; p.prevY = p.y;
  const cost = p.climbEntryCost(high, 1);
  check('climb entry cost is computed from the face', cost > 0, `cost ${cost.toFixed(1)}`);
  p.stamina = Math.max(0, cost - 5);          // just short
  const inp = mkInput({ moveDir: 1, jumpHeld: true, holdDuration: 1 });
  // The invariant is per-frame, not per-run: standing there regenerates, so of
  // course the climb starts eventually — that is the intended recovery. What
  // must never happen is entering CLIMB on a frame where stamina < cost.
  let violations = 0, sawTooTired = false;
  for (let i = 0; i < 120 * 4; i++) {
    const before = p.stamina;
    const wasClimbing = p.state === 'CLIMB';
    const need = p.climbEntryCost(high, 1);
    if (before < need) sawTooTired = true;
    p.update(1 / 120, inp, high);
    // only ENTRY is gated — an in-progress climb is allowed to run the tank
    // down and slip, which is the intended failure mode
    if (!wasClimbing && p.state === 'CLIMB' && before < need) violations++;
  }
  check('never ENTERS a climb it cannot afford', violations === 0, `${violations} entry(s)`);
  check('the too-tired state was actually exercised', sawTooTired);
  // and resting must actually resolve it
  const idle = mkInput();
  for (let i = 0; i < 120 * 20; i++) p.update(1 / 120, idle, high);
  const after = sim(high, p.x, 25, (inp2) => { inp2.moveDir = 1; inp2.jumpHeld = true; });
  check('after resting the same face is climbable', after.seen.has('CLIMB'));
}

// --- 5. no free-roam biome strands a walker at a face it cannot pass -------
// The intro is excluded deliberately: it is a scripted scene using IntroTerrain,
// where the "climb" spans are the ravine (flat while the bridge stands) and the
// tutorial log, which is meant to be JUMPED, not climbed.
{
  const M = JSON.parse(readFileSync('data/manifest.json', 'utf8'));
  let worst = null;
  for (const id of M.biomes) {
    if (id === 'intro') continue;
    const b = biome(id);
    if (!b.terrain) continue;
    const t = new TerrainSpline(b);
    const maxX = b.terrain.points.at(-1)[0];
    for (let x = 60; x < maxX - 40; x += 40) {
      if (t.tierAt(x) !== 'climb') continue;
      const { p } = sim(t, Math.max(60, x - 70), 12,
        (inp) => { inp.moveDir = 1; inp.jumpHeld = true; });
      if (p.x < x) { worst = `${id} @ ${x} (reached ${p.x.toFixed(0)})`; break; }
    }
    if (worst) break;
  }
  check('every climb face is passable holding Up', worst === null, worst ?? '');
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
