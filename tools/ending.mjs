/**
 * Reunion ending tests (§2).
 *
 *   npm run test:ending
 *
 * The ending is the payoff for every system in the game — the aging clock, the
 * Journal, the party — so its job is to READ DIFFERENTLY depending on the state
 * the player arrives in. A run that reaches the water as a Youth having helped
 * nobody must not get the same scene as an Elder arriving with five friends.
 *
 * Note on units: PlayerRig keyframes run Child at ageDays 0 to Elder at
 * ageDays 20 — a whole life in ~20 in-game days. Feeding this anything like a
 * real day count pins every run to Elder.
 */
import { readFileSync } from 'fs';
import { journal } from '../src/core/Journal.js';
import { bus } from '../src/core/EventBus.js';
import { TerrainSpline } from '../src/world/TerrainSpline.js';
import { EndingSequence, FIRE_X } from '../src/world/EndingSequence.js';

global.performance = global.performance ?? { now: () => Date.now() };

const results = [];
const check = (label, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};

const b = JSON.parse(readFileSync('data/biomes/rivermouth.json', 'utf8'));
const terrain = new TerrainSpline(b);

function play(ageDays, setup = () => {}) {
  journal.clear();
  setup(journal);
  const said = [];
  const dialogue = {
    blocking: false,
    say: (lines) => { said.push(...lines); return Promise.resolve(); },
    ask: async () => 0,
  };
  const player = { x: FIRE_X - 420, y: terrain.groundYAt(FIRE_X - 420), vx: 0,
                   facing: 1, minX: 40, ageDays };
  const camera = { focusX: null };
  const e = new EndingSequence(player, terrain, dialogue, camera, journal);
  let done = false;
  e.onComplete = () => { done = true; };
  let completed = null;
  bus.on('journeyComplete', (d) => { completed = d; });
  const beats = new Set();
  for (let i = 0; i < 120 * 90 && !done; i++) {
    if (player.x < FIRE_X - 60 && e.beat !== 'MEETING') player.x += 90 / 120;
    e.update(1 / 120);
    beats.add(e.beat);
  }
  return { done, completed, said, beats, e, player };
}

// --- reaches its conclusion from every life stage ---------------------------
const runs = {
  youth: play(3.2),
  adult: play(7, (j) => { j.addFriend('mira'); j.mark('kindness', 1); }),
  middle: play(14, (j) => { j.addFriend('bram'); j.mark('oath', 'sworn'); }),
  elder: play(22, (j) => {
    ['mira', 'corran', 'bram', 'sela', 'fen'].forEach((f) => j.addFriend(f));
    j.mark('kindness', 3); j.mark('corran', 'saved');
    j.mark('oath', 'sworn'); j.mark('hordes_cleared', 6);
  }),
};
for (const [name, r] of Object.entries(runs)) {
  check(`${name.padEnd(6)} run completes`, r.done && !!r.completed,
    r.completed ? `${r.completed.years}y as ${r.completed.stage}` : 'never completed');
}

// --- the sequence actually walks its beats ----------------------------------
{
  const want = ['APPROACH', 'SEEN', 'MEETING', 'SETTLE', 'EPILOGUE', 'DONE'];
  const got = [...runs.elder.beats];
  check('runs every beat in order', want.every((b2) => got.includes(b2)), got.join(' -> '));
  check('epilogue card fully faded in', runs.elder.e.epilogueT >= 1);
  check('party is halted before the fire', runs.elder.e.partyHalt !== null
    && runs.elder.e.partyHalt < FIRE_X, String(runs.elder.e.partyHalt));
}

// --- it reads differently per state -----------------------------------------
{
  const scripts = Object.values(runs).map((r) => r.said.join('|'));
  check('four states give four distinct scenes', new Set(scripts).size === 4,
    `${new Set(scripts).size} distinct`);

  const stages = Object.values(runs).map((r) => r.completed.stage);
  check('life stage varies with age', new Set(stages).size === 4, stages.join(', '));

  check('a lone arrival is acknowledged as lone',
    runs.youth.said.some((l) => /empty road|alone/i.test(l)));
  check('companions are named at the fire',
    runs.elder.said.some((l) => /Mira/.test(l) && /Fen/.test(l)));
  check('saving Corran pays off here',
    runs.elder.said.some((l) => /Corran tells her/.test(l)));
  check('the oathstone pays off here',
    runs.middle.said.some((l) => /oathstone/i.test(l)));
  check('years lived scale with age',
    runs.youth.completed.years < runs.adult.completed.years
      && runs.adult.completed.years < runs.elder.completed.years,
    Object.values(runs).map((r) => r.completed.years + 'y').join(' < '));
}

// --- the biome is wired for it ----------------------------------------------
{
  check('rivermouth is flagged as the journey end', b.journeyEnd === true);
  check('the fire is inside the walkable end', FIRE_X < (b.endX ?? 0),
    `fire ${FIRE_X}, endX ${b.endX}`);
  const last = b.terrain.points.at(-1)[0];
  check('the fire is inside the authored terrain', FIRE_X < last, `terrain ends ${last}`);
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
