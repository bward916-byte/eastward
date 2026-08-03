/**
 * Journey traversability audit.
 *
 *   npm run test:journey
 *
 * Walks a simulated player from spawn to the exit of every biome, holding east
 * with Up down (so climbs engage) and jumping when progress stalls. Asserts the
 * journey can actually be completed — and separately, that no authored climb
 * face costs more stamina than a full bar can pay.
 *
 * This exists because the meadow — the FIRST biome — contained a soft-lock for
 * the entire life of the project. Arriving at the x~4300 face already drained
 * from the run, the player entered CLIMB, ran out partway up, slid back to the
 * foot, and repeated forever, because neither CLIMB nor SLIDE regenerated. No
 * per-face test caught it, because approached fresh and at rest the same face
 * is passable. Only walking the whole biome in one go reproduces it.
 *
 * The lesson generalises: locomotion bugs depend on the state you ARRIVE in.
 */
import { readFileSync } from 'fs';
import { TerrainSpline } from '../src/world/TerrainSpline.js';
import { Player } from '../src/entities/Player.js';

const CLIMB_SPEED = 70, CLIMB_DRAIN = 5.5, CLIMB_MIN = 45 * Math.PI / 180;
const STAMINA_MAX = 100;
const AFFORDABLE = STAMINA_MAX * 0.75;   // must be payable arriving less than fresh

const results = [];
const check = (label, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};

const M = JSON.parse(readFileSync('data/manifest.json', 'utf8'));
const biome = (id) => JSON.parse(readFileSync(`data/biomes/${id}.json`, 'utf8'));

/** Cost of the contiguous climb run starting at x, mirroring Player's CLIMB branch. */
function faceCost(t, x0, maxX) {
  let x = x0, total = 0, guard = 0;
  while (x < maxX && t.tierAt(x) === 'climb' && guard++ < 4000) {
    const a = Math.abs(t.slopeAt(x));
    const grade = Math.min(1, Math.max(0, (a - CLIMB_MIN) / (Math.PI / 2 - CLIMB_MIN)));
    const hspeed = CLIMB_SPEED * (1 - grade * 0.45) * Math.cos(a);
    if (hspeed <= 1) break;
    total += CLIMB_DRAIN * (0.6 + grade) * (1 / hspeed);
    x += 1;
  }
  return { cost: total, end: x };
}

function walkBiome(t, endX, budget = 260) {
  const p = new Player(60, t);
  p.y = t.groundYAt(60); p.prevX = p.x; p.prevY = p.y;
  const inp = { moveDir: 1, holdDuration: 0, jumpPressed: false, jumpHeld: true,
                interactPressed: false, crouch: false };
  let furthest = p.x, stalled = 0, stallAt = null, stallState = '';
  for (let i = 0; i < 120 * budget && p.x < endX; i++) {
    inp.holdDuration += 1 / 120;
    inp.jumpPressed = stalled > 0.8 && i % 30 === 0;
    p.update(1 / 120, inp, t);
    if (p.x > furthest + 0.5) { furthest = p.x; stalled = 0; }
    else {
      stalled += 1 / 120;
      if (stalled > 3 && !stallAt) { stallAt = p.x; stallState = p.state; }
    }
    if (stalled > 20) return { ok: false, x: p.x, stallAt, stallState };
  }
  return { ok: p.x >= endX, x: p.x, stallAt, stallState };
}

console.log('traversing every biome (hold east + Up, jump when stalled):\n');
for (const id of M.biomes) {
  const b = biome(id);
  if (!b.terrain) { console.log(`      ${id} — skipped, no terrain`); continue; }
  const t = new TerrainSpline(b);
  const endX = b.exitEast?.x ?? b.endX ?? b.terrain.points.at(-1)[0] - 40;
  const r = walkBiome(t, endX);
  check(`${id.padEnd(14)} traversable`, r.ok,
    r.ok ? `reached ${r.x.toFixed(0)}/${endX}`
         : `STALLED at x=${r.stallAt?.toFixed(0)} in ${r.stallState} (reached ${r.x.toFixed(0)}/${endX})`);
}

// Faces must be payable. The intro is exempt: its climb-tier spans are the
// ravine (flat while the bridge stands) and the tutorial log, meant to be
// jumped — neither is ever climbed.
console.log('\nclimb face affordability:\n');
const pricey = [];
for (const id of M.biomes) {
  if (id === 'intro') continue;
  const b = biome(id);
  if (!b.terrain) continue;
  const t = new TerrainSpline(b);
  const maxX = b.terrain.points.at(-1)[0];
  let x = 0;
  while (x < maxX) {
    if (t.tierAt(x) === 'climb') {
      const { cost, end } = faceCost(t, x, maxX);
      if (cost > AFFORDABLE) pricey.push(`${id} x${x}-${end} costs ${cost.toFixed(0)}`);
      x = end + 1;
    } else x += 5;
  }
}
check(`no face costs more than ${AFFORDABLE} stamina`, pricey.length === 0, pricey.join('; '));

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
