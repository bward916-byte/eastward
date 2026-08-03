/**
 * Passage guarantee tests.
 *
 *   npm run test:passage
 *
 * Reported as "killed all wolves but stuck". Cause: bats are
 * targetableBy ['air'] and a Fighter targets ['ground'] only, so a Fighter can
 * never kill one. Every standalone bat encounter is authored `blocking: false`
 * for exactly that reason — but hordes always block, and four of them had whole
 * bat waves. A Fighter reached the barrier with nothing it could hit and stood
 * there permanently.
 *
 * The rule this file enforces: **a barrier may never hold on something the
 * player cannot resolve.** Not by class capability, not by a straggler left out
 * of reach. Passage is never the thing on the line.
 *
 * The opposite failure matters just as much: a failsafe that opens barriers too
 * eagerly makes every fight skippable. The last case here guards that.
 */
import { readFileSync } from 'fs';
import { journal } from '../src/core/Journal.js';
import { TerrainSpline } from '../src/world/TerrainSpline.js';
import { EncounterManager } from '../src/world/EncounterManager.js';

const results = [];
const check = (label, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};

const M = JSON.parse(readFileSync('data/manifest.json', 'utf8'));
const classes = JSON.parse(readFileSync('data/classes.json', 'utf8'));
const biome = (id) => JSON.parse(readFileSync(`data/biomes/${id}.json`, 'utf8'));

function mkPlayer(x, classId) {
  return { x, y: 0, vx: 0, facing: 1, gold: 0, artifacts: 0,
           health: 1e9, maxHealth: 1e9, classId, classDef: classes[classId],
           takeDamage() {} };
}
const stubDlg = { blocking: false, ask: async () => 0, say: async () => {} };

/** Fight an encounter as `classId`, killing only what that class can target. */
function fight(biomeId, encId, classId, { budget = 200 } = {}) {
  journal.clear();
  const b = biome(biomeId);
  const terrain = new TerrainSpline(b);
  const enc = b.encounters.find((e) => e.id === encId);
  const player = mkPlayer(enc.x - 200, classId);
  const em = new EncounterManager(b.encounters, terrain, player, stubDlg, b.endX);
  const e = em.encounters.find((x) => x.id === encId);
  const caps = classes[classId].targets;
  let g = 0;
  while (!e.resolved && g++ < 120 * budget) {
    em.update(1 / 120, { interactPressed: false });
    const alive = em.creatures.filter((c) => !c.dead
      && c.targetableBy.some((t) => caps.includes(t)));
    if (alive.length && g % 40 === 0) alive[0].takeDamage(999, player.x, null);
  }
  return { resolved: e.resolved, secs: g / 120, em, e, player };
}

// --- 1. every class can clear every blocking encounter ----------------------
{
  let stuck = [];
  for (const id of M.biomes) {
    const b = biome(id);
    for (const e of b.encounters ?? []) {
      const blocks = (e.type === 'creature' && e.blocking !== false) || e.type === 'horde';
      if (!blocks) continue;
      for (const cls of Object.keys(classes)) {
        const r = fight(id, e.id, cls);
        if (!r.resolved) stuck.push(`${id}/${e.id} as ${cls}`);
      }
    }
  }
  check('every class clears every blocking encounter', stuck.length === 0,
    stuck.slice(0, 4).join('; '));
}

// --- 2. every horde wave has something a ground-only class can fight --------
// Otherwise the failsafe carries a Fighter through content that is, for them,
// simply not there.
{
  const empty = [];
  for (const id of M.biomes) {
    for (const e of biome(id).encounters ?? []) {
      if (e.type !== 'horde') continue;
      e.waves.forEach((w, i) => {
        const groups = w.groups ?? [{ kind: w.kind, count: w.count }];
        const ground = groups.filter((g) => g.kind !== 'bat')
          .reduce((a, g) => a + (g.count ?? 0), 0);
        if (ground === 0) empty.push(`${e.id} wave ${i + 1}`);
      });
    }
  }
  check('no horde wave is all-flying', empty.length === 0, empty.join(', '));
}

// --- 3. an untargetable remainder does not hold the barrier -----------------
{
  const r = fight('mountain-cave', 'cave-horde', 'fighter');
  const batsLeft = r.em.creatures.filter((c) => !c.dead && c.kind === 'bat').length;
  check('fighter passes a horde with bats still alive', r.resolved && batsLeft > 0,
    `${batsLeft} bats left alive, resolved=${r.resolved}`);
}

// --- 4. a straggler out of reach does not hold the barrier ------------------
{
  journal.clear();
  const b = biome('rivermouth');
  const terrain = new TerrainSpline(b);
  const enc = b.encounters.find((e) => e.id === 'riv-wolves');
  const player = mkPlayer(enc.x - 200, 'thief');
  const em = new EncounterManager(b.encounters, terrain, player, stubDlg, b.endX);
  const e = em.encounters.find((x) => x.id === 'riv-wolves');
  for (let i = 0; i < 120 * 3; i++) em.update(1 / 120, { interactPressed: false });
  check('pack spawned', e.pack?.length > 0, `${e.pack?.length ?? 0}`);
  // kill all but one, then strand the survivor far up the road
  e.pack.slice(1).forEach((c) => c.takeDamage(999, player.x, null));
  e.pack[0].x = player.x - 4000;
  for (let i = 0; i < 120 * 3; i++) em.update(1 / 120, { interactPressed: false });
  check('a stranded survivor does not hold the barrier', e.resolved,
    `survivor ${Math.abs(e.pack[0].x - player.x).toFixed(0)}px away`);
}

// --- 5. the failsafe must NOT make normal fights skippable ------------------
{
  journal.clear();
  const b = biome('meadow');
  const terrain = new TerrainSpline(b);
  const enc = b.encounters.find((e) => e.id === 'mdw-wolves');
  const player = mkPlayer(enc.x - 200, 'fighter');
  const em = new EncounterManager(b.encounters, terrain, player, stubDlg, b.endX);
  const e = em.encounters.find((x) => x.id === 'mdw-wolves');
  for (let i = 0; i < 120 * 8; i++) em.update(1 / 120, { interactPressed: false });
  check('a live fightable pack still blocks', !e.resolved,
    `resolved=${e.resolved}, alive=${e.pack.filter((c) => !c.dead).length}`);
  e.pack.forEach((c) => c.takeDamage(999, player.x, null));
  for (let i = 0; i < 120; i++) em.update(1 / 120, { interactPressed: false });
  check('and opens once actually cleared', e.resolved);
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
