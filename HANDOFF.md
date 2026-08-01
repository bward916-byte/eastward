# EASTWARD — Project Handoff

**Live:** https://bward916-byte.github.io/eastward/
**Repo:** https://github.com/bward916-byte/eastward
**Stack:** Vanilla JS (ES6 modules), Canvas 2D, Web Audio, DOM HUD. Zero dependencies, zero build step. Deploy = `git push` to `main` (GitHub Pages serves the repo root). Requires a static server locally (`python -m http.server`) because of module imports and JSON fetches.

A 2D side-scrolling journey game: one life, walked always east, searching for a lost family. The player ages continuously from Child to Elder over real play time. Built against a design spec plus Amendments 01–03 and 06–07 (§ references throughout the code point at those documents).

---

## Current State

Playable end-to-end: **Intro (playable separation sequence) → Sunfall Meadow → Hearthstead village (Rite of Passage class selection + five services) → The Deepwood → The Mountain Pass (branching: High Route or Under the Mountain) → The Far Slopes → journey-edge signpost.** All major systems live: aging, injuries, day/night, wind/weather (incl. blizzards and snow depth), fully automatic combat, XP/upgrades, checkpoint saves, portable save codes, adaptive generative audio, seamless crossfade biome transitions, ambient wildlife/props, an 11-stop scripted demo tour, and full mobile touch support.

## Repo Layout

```
index.html                 DOM shell: canvas, HUD bars, dialogue box, journey panel, demo UI
styles/styles.css          page/canvas layout, orientation gate
styles/hud.css             HUD, dialogue, buttons, panels, demo/biome labels
data/manifest.json         biome + class ID tables (APPEND-ONLY — save codes index into it)
data/classes.json          Thief / Wizard / Fighter definitions
data/biomes/*.json         one file per biome — ALL content is authored here
src/main.js                boot, scene orchestration, the game loop wiring, SHOW_DEMO flag
src/core/GameLoop.js       fixed timestep (120 Hz) + interpolated render
src/core/InputManager.js   keys + touch zones → intents (canvas-only touch, edge events)
src/core/Camera.js         east-biased follow, dynamic zoom (§3.4), focusX override
src/core/EventBus.js       shared pub/sub (the signal spine — see list below)
src/core/SaveManager.js    checkpoint-only saves, buildSnapshot, suspended guard
src/core/SaveCodeCodec.js  portable codes: bit-pack + CRC-16 + Base32, version 'E3'
src/core/OrientationGate.js landscape requirement (Amendment 02 §E)
src/core/utils.js          clamp/lerp/damp/lerpColor
src/entities/Player.js     locomotion state machine, stamina/endurance, combat, injuries
src/entities/PlayerRig.js  age keyframes → render params + age stat curve (§5, §F)
src/entities/Creature.js   wolf / boar / bat (flying) — targetableBy tags (§O/§Q)
src/entities/Projectile.js knives/bolts, light homing, willMiss sails wide
src/entities/TargetAcquisition.js shared auto-aim nearest-valid-target
src/entities/Guardian.js   intro guardian figure
src/systems/Dialogue.js    ground-anchored text box + choices (multi-event taps)
src/systems/CombatResolver.js Accuracy/FightSpeed/AutoDodge math (§T.5) — one place
src/systems/ExperienceManager.js XP from bus events, levelUp minor/major
src/systems/UpgradeResolver.js applies level-up grants incl. aging nudge (§U.3)
src/world/TerrainSpline.js authored points → smoothstep ground, slope tiers, snow depth
src/world/IntroTerrain.js  intro overrides (bridge surface, tutorial log)
src/world/IntroSequence.js scripted intro beats (flight/collapse/farewell/tutorial)
src/world/Checkpoint.js    cairn/shrine/campfire markers → checkpointReached
src/world/DayNightCycle.js 10-min days, light/dusk curves, night grade overlay
src/world/WindSystem.js    signed wind value, gusts, speedModFor (§3.6)
src/world/WeatherSystem.js clear/gust/rain/fog/snowfall/blizzard, particles, force()
src/world/EncounterManager.js adventure/interest/challenge/creature/branch/lock/rite
src/world/Town.js          town zone, entry autosave, Inn/Trainer/Sage/Merchant/Healer
src/world/WorldProps.js    deterministic decor (rock/stump/mushroom/crystal/deadtree/flowers)
src/world/AmbientWildlife.js birds + rabbits that flush when approached
src/render/ParallaxRenderer.js 6-layer stack, cycle-aware sky, wind-scaled sway
src/render/HudRenderer.js  bars, portrait limb overlays, counters, save flash
src/render/LevelUpNotification.js burst + label on upgradeGranted/ageStageChanged
src/audio/AudioEngine.js   context + master/music/ambient buses, gesture unlock, M mute
src/audio/MusicManager.js  GENERATIVE per-biome layered stems + stings + crossfades
src/audio/AmbientManager.js wind/rain beds, locomotion footsteps
src/demo/DemoMode.js       11-stop scripted feature tour (hide via SHOW_DEMO in main.js)
```

## Architecture Essentials

**Loop.** `GameLoop` runs fixed 1/120s simulation steps with render interpolation. `main.js` owns one `scene` object at a time: `{ id, biome, terrain, encounters, town, checkpoints, parallax, props, wildlife, intro?, env }`. `loadScene(id, spawnX)` rebuilds it from the biome JSON (cached/prefetched); `transitionTo(id, x, {keepMomentum})` wraps it in a **crossfade** (the outgoing frame is captured to an offscreen canvas and dissolved over the new scene — there is deliberately no black fade).

**Input.** `InputManager` produces intents (`moveDir`, `holdDuration`, `jumpPressed/Held`, `interactPressed`, `crouch`). Touch: left-half drag = move, right-half tap = jump, **canvas-target-only** (UI taps never move the character), fully suppressed while `dialogue.blocking` (open OR closed <350ms — mobile fires pointerdown before touchstart). Near a service/vault, a right-side tap is converted to Interact in `main`. All UI buttons use `bindTap` (pointerdown + touchstart + touchend + click, deduped) and class-based visibility (`setVisible`/`.gone`) — **never toggle `hidden` per-tick; iOS drops taps on display-churned elements.**

**Combat is fully automatic.** `Player.autoAttack` runs every tick outside towns/intro: it fires only when a valid target is in range (nearest via `TargetAcquisition`, filtered by the creature's `targetableBy` tags — this is how the Fighter can't hit bats with zero special-casing). The player's skill is movement: close to commit, run to break off. All rolls go through `CombatResolver` (Accuracy hit rolls incl. sail-wide projectiles, Fight Speed cooldowns, passive Auto-Dodge), modified by injuries and the age damage curve.

**EventBus signals** (the wiring spine): `checkpointReached`, `forceSave`, `gameSaved`, `enteredTown`, `leftTown`, `challengeApproaching`, `challengePassed`, `combatStarted`, `combatEnded`, `creatureSlain`, `interestCollected`, `adventureResolved`, `riteCompleted`, `branchChosen`, `weatherChanged`, `biomeTransition`, `introComplete`, `xpGained`, `levelUp`, `upgradeGranted`, `ageStageChanged`, `injuryGained`, `injuryHealed`, `playerDefeated`, `artifactsIdentified`, `goldChanged`. Music, saves, XP, and notifications all subscribe rather than being called.

## Biome JSON Schema (everything is authored here)

```
id, name, palette{...16 colors}, layerScroll, layerStyle{treeStep}, groundY,
grassDensity, propDensity, props[kinds], wildlife[kinds],
terrain{points[[x,y]...]}, snow{zones[{from,to,depth 0-3}]},
environment{dayNight, weather}, caveLight, wind{base,gustiness,prevailing},
weather{stateName:weight...}, audio{root,mode,tempo,chord,brightness,
pluckDensity,windBase}, checkpoints[{id,x,type cairn|shrine|campfire}],
encounters[...], town{...}, exitEast{to,x} | endX
```

Encounter types: `adventure` (blocking NPC, lines/choices/responses), `interest` (walk-over relic, optional `reward{artifacts,gold}`), `challenge` (`kind: push|boulder` — boulder is class-flavored: Wizard TK 0.9s/mana 15, Fighter 2.0s, else 3.2s), `creature` (`kind: wolf|boar|bat`, `count`, `blocking:false` for harassers), `lock` (Thief instant, others 30%/attempt), `branch` (`routes[]` → scene transition, §C multi-path), `rite` (class selection).

**Authoring rules (hard-won):**
- Terrain interpolation is smoothstep between points: slopes flatten at segment ends and peak ~1.5× the linear angle mid-segment. Author accordingly; micro-noise applies only where near-flat so it can never distort a tier.
- Tiers: <15° walk, 15–45° scramble, 45–80° climb. Depth tiers 0–3 for snow; blizzard adds +1 effective.
- **No blocking `creature`/combat encounter may precede the Rite** (meadow x<7250) — a classless player has no weapon.
- A checkpoint before every hard cluster (Amendment 01 A.1).
- Match ground heights at `exitEast`/entry (spawn x=60) within ~30px — the crossfade hides small steps only.
- `manifest.json` biome/class arrays and each biome's `checkpoints`/`encounters` arrays are **append-only**: save codes encode indices into them. Growing `encounters` invalidates existing codes (they reject cleanly via count check); reordering corrupts silently — never reorder.

## Saves & Codes

- One rolling slot in `localStorage['eastward.save']`, written ONLY on `checkpointReached`/`forceSave`. `SaveManager.suspended` gates all writes (demo mode + every restore path set it). `buildSnapshot()` captures live state without writing (demo resume uses this).
- Snapshot: biome, checkpointId, player {x, facing, stamina, endurance, health, mana, maxHealth, artifacts, identified, gold, classId, skills{accuracy,fightSpeed,autoDodge,climbSkill}, xp, level, ageDays, injuries[kinds]}, world {timeOfDay, flags[]}.
- Codes: prefix **E3**, bit-packed + CRC-16 + Crockford Base32 (no I/L/O/U, confusables mapped on input), ~50–60 chars, dash-grouped. `peekBiomeIndex` → fetch that biome → `decodeSnapshot`. Any schema change ⇒ bump the version prefix so old codes reject cleanly.
- Reset: journey panel (✎, always visible) → "⟲ Start a new journey" (tap-twice confirm). URL `?new` also works.

## Controls

Desktop: ←→ walk (hold→run), ↑ jump (hold=higher; hold ↑+dir at a 45–80° face = climb), E interact, E/Enter advance dialogue, M mute. Touch: left-drag move, right-tap jump (— or Interact when at a service/vault), tap dialogue to advance, on-screen E button. Fighting is automatic everywhere.

## Demo Mode

▶ Demo (top-right) — hide by setting `const SHOW_DEMO = false` in `src/main.js`. 11 scripted stops (~2.5 min) driving real systems via input override: locomotion, climbing, forced weather, day/night timelapse, full Child→Elder aging sweep, auto-combat, Hearthstead, Deepwood, blizzard climb, cave TK+bats, Far Slopes finale. Captures live state at start and resumes it exactly; saves suspended throughout; Next ▸ / ✕ Exit; 8s load watchdog.

## Debug & Ops

- `?debug` — on-screen event log (button taps, interact ticks, demo telemetry per second).
- `?new` — fresh journey.
- Deploy: commit to `main`, Pages builds in ~30–60s. Check `GET /repos/bward916-byte/eastward/pages/builds/latest`. **The PAT used during development sits in chat history — revoke it and mint fresh ones as needed (repo scope).**
- Headless testing pattern (used throughout): `node --input-type=module` importing real modules with stubbed `performance/localStorage/location`, driving `Player`/`EncounterManager`/etc. with scripted inputs and asserting outcomes. Async dialogue flows need `await setImmediate` yields inside sim loops.

## Lessons / Gotchas (read before editing)

1. **Verify every automated text edit.** Python `str.replace` no-ops silently on needle mismatch; this shipped a build where attack/interact input was structurally dead for days (`InputManager` set edges nobody consumed). **Grep the file after patching, and prefer targeted `str_replace`-style edits with unique anchors.**
2. Mobile event order: pointerdown fires before touchstart — anything a pointerdown closes must keep blocking the paired touchstart (`dialogue.blocking` grace).
3. Never toggle `hidden`/`display` on tappable elements per frame (iOS tap drop). Use the `setVisible` class approach.
4. Restores must run with saves suspended and complete BEFORE un-suspending — mid-restore ticks once checkpoint-saved aged demo state (the "age persists after refresh" bug).
5. Landing must trigger on surface contact regardless of vertical velocity, or jumps into rising slopes sink-and-bounce.
6. Anchor full-screen gradients to stable values (biome baseY), not per-frame sampled ones (the ravine flicker).
7. The generative audio graph must be built once per biome with layers at gain 0 and toggled by ramp — never rebuild voices on state change.

## Roadmap (spec items not yet built)

Mounts (§9 — suits the longer roads and run-from-danger combat), Companions & Mercenary Post (§11 / Amendment 01 §B), building interiors (Amendment 06 §N), hordes (§P — auto-combat already frames run-vs-fight), more flying enemies (§Q), Wizard Burn spell (§M.4), snowshoes shop item (§M.3), remaining trainer skills & Blacksmith/equipment (§7/§10), recorded audio stems (swap voice construction inside `BiomeMusic` only — layer/crossfade API stays), a title screen (would also host Load Code per §S.3), further biomes (author JSON + one `exitEast` line), and the reunion ending (§2).
