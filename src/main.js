// Eastward — boot & scene orchestration.
// Fresh journey: playable intro (§2) → meadow. Existing save: resume at the
// most recent checkpoint in its biome (Amendment 01 §A).

import { GameLoop } from './core/GameLoop.js';
import { InputManager } from './core/InputManager.js';
import { Camera } from './core/Camera.js';
import { SaveManager } from './core/SaveManager.js';
import { OrientationGate } from './core/OrientationGate.js';
import { Viewport } from './core/Viewport.js';
import { bus } from './core/EventBus.js';
import { journal } from './core/Journal.js';
import { Player } from './entities/Player.js';
import { Guardian } from './entities/Guardian.js';
import { Companion, COMPANIONS } from './entities/Companion.js';
import { TerrainSpline } from './world/TerrainSpline.js';
import { IntroTerrain } from './world/IntroTerrain.js';
import { IntroSequence } from './world/IntroSequence.js';
import { EndingSequence } from './world/EndingSequence.js';
import { Checkpoint } from './world/Checkpoint.js';
import { DayNightCycle, DAY_SECONDS } from './world/DayNightCycle.js';
import { WindSystem } from './world/WindSystem.js';
import { WeatherSystem } from './world/WeatherSystem.js';
import { EncounterManager } from './world/EncounterManager.js';
import { WorldProps } from './world/WorldProps.js';
import { AmbientWildlife } from './world/AmbientWildlife.js';
import { Town } from './world/Town.js';
import { ParallaxRenderer } from './render/ParallaxRenderer.js';
import { HudRenderer } from './render/HudRenderer.js';
import { Dialogue } from './systems/Dialogue.js';
import { AudioEngine } from './audio/AudioEngine.js';
import { MusicManager } from './audio/MusicManager.js';
import { AmbientManager } from './audio/AmbientManager.js';
import { ExperienceManager } from './systems/ExperienceManager.js';
import { UpgradeResolver } from './systems/UpgradeResolver.js';
import { LevelUpNotification } from './render/LevelUpNotification.js';
import { DemoMode } from './demo/DemoMode.js';

// Flip to false to hide the demo tour button entirely.
const SHOW_DEMO = true;

// On-screen diagnostics: open with ?debug to see input events live.
const DEBUG = new URLSearchParams(location.search).has('debug');
const dbgLines = [];
function dbg(msg) {
  if (!DEBUG) return;
  let el = document.getElementById('dbg-overlay');
  if (!el) {
    el = document.createElement('div');
    el.id = 'dbg-overlay';
    el.style.cssText = 'position:fixed;top:60px;left:8px;z-index:999;font:10px monospace;color:#8f8;background:rgba(0,0,0,0.7);padding:6px;border-radius:6px;pointer-events:none;max-width:70vw;white-space:pre;';
    document.body.appendChild(el);
  }
  dbgLines.push(`${(performance.now() / 1000).toFixed(1)} ${msg}`);
  while (dbgLines.length > 14) dbgLines.shift();
  el.textContent = dbgLines.join('\n');
}

async function boot() {
  const canvas = document.getElementById('game-canvas');
  const ctx = canvas.getContext('2d');

  // Viewport owns all sizing. It re-measures on a settle schedule after
  // rotation because window.innerHeight is stale at the moment the orientation
  // change is announced (§E) — reading it once left the HUD below the fold.
  const camera = new Camera(1, 1);
  const viewport = new Viewport((w, h) => {
    canvas.width = w;
    canvas.height = h;
    camera.resize(w, h);
  });
  const resize = viewport.refresh;

  const classes = await fetch('data/classes.json').then(r => r.json());
  const manifest = await fetch('data/manifest.json').then(r => r.json());
  const player = new Player(60, 520);
  const projectiles = [];
  const input = new InputManager();
  const hud = new HudRenderer();
  const dialogue = new Dialogue();
  input.touchBlocked = () => dialogue.blocking;
  const saveManager = new SaveManager(player);

  const audio = new AudioEngine();
  const music = new MusicManager(audio);
  const ambient = new AmbientManager(audio);
  const unlockAudio = () => {
    audio.init();
    if (scene) { music.playBiome(scene.biome.audio, scene.id); ambient.start(scene.biome.audio); }
    window.removeEventListener('pointerdown', unlockAudio);
    window.removeEventListener('keydown', unlockAudio);
  };
  window.addEventListener('pointerdown', unlockAudio);
  window.addEventListener('keydown', unlockAudio);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'm' || e.key === 'M') audio.toggleMute();
  });

  // which control scheme to name in prompts
  let usingTouch = false;
  window.addEventListener('touchstart', () => { usingTouch = true; }, { passive: true });
  window.addEventListener('keydown', () => { usingTouch = false; });

  const dayNight = new DayNightCycle();
  const wind = new WindSystem();
  const weather = new WeatherSystem();
  const xpManager = new ExperienceManager();
  new UpgradeResolver(player);
  const levelFx = new LevelUpNotification(music);
  journal.wire();   // decisions outlive the biome border (§Journal)
  saveManager.getWorldState = () => ({
    timeOfDay: dayNight.phase,
    flags: scene?.encounters?.getFlags() ?? [],
    journal: journal.serialize(),
  });

  let scene = null;
  let transitioning = false;
  const biomeCache = {};
  async function fetchBiome(id) {
    if (!biomeCache[id]) biomeCache[id] = fetch(`data/biomes/${id}.json`).then(r => r.json());
    return biomeCache[id];
  }
  // seamless crossfade: the outgoing frame dissolves over the incoming scene
  const oldFrame = document.createElement('canvas');
  let oldFrameAlpha = 0;
  const biomeLabel = document.getElementById('biome-label');

  function showBiomeName(name) {
    if (!biomeLabel || !name) return;
    biomeLabel.textContent = name;
    biomeLabel.classList.add('visible');
    setTimeout(() => biomeLabel.classList.remove('visible'), 3200);
  }

  async function transitionTo(id, spawnX, opts = {}) {
    while (transitioning) await new Promise(r => setTimeout(r, 60));
    transitioning = true;
    // capture the outgoing frame — no blackout, the world dissolves across
    oldFrame.width = canvas.width;
    oldFrame.height = canvas.height;
    oldFrame.getContext('2d').drawImage(canvas, 0, 0);
    oldFrameAlpha = 1;
    const keepVx = opts.keepMomentum ? player.vx : 0;
    await loadScene(id, spawnX);
    if (keepVx) { player.vx = keepVx; }
    bus.emit('biomeTransition', { to: id });
    showBiomeName(scene.biome.name);
    const iv = setInterval(() => {
      oldFrameAlpha = Math.max(0, oldFrameAlpha - 0.045);
      if (oldFrameAlpha <= 0) { clearInterval(iv); transitioning = false; }
    }, 30);
  }

  async function loadScene(id, spawnX) {
    const biome = await fetchBiome(id);
    let terrain, intro = null;

    let ending = null;
    if (id === 'intro') {
      terrain = new IntroTerrain(biome);
      const guardian = new Guardian(spawnX + 90, terrain);
      intro = new IntroSequence(player, terrain, dialogue, camera, guardian);
      intro.onComplete = () => loadScene('meadow', 100);
    } else {
      terrain = new TerrainSpline(biome);
      if (biome.journeyEnd) {
        ending = new EndingSequence(player, terrain, dialogue, camera, journal);
      }
    }

    const checkpoints = (biome.checkpoints ?? []).map(d => new Checkpoint(d, terrain));

    player.minX = 40;
    player.x = spawnX; player.prevX = spawnX;
    player.vx = 0; player.vy = 0; player.grounded = true;
    player.y = terrain.groundYAt(spawnX); player.prevY = player.y;

    camera.focusX = null;
    camera.x = player.x + camera.viewW * camera.eastBias;
    camera.y = player.y - camera.viewH * 0.12;

    saveManager.setBiome(id);
    music.playBiome(biome.audio, id);
    ambient.setBiome(biome.audio);
    wind.setBiome(biome.wind);
    weather.setBiome(biome.weather);
    const env = biome.environment ?? { dayNight: true, weather: true };
    const town = biome.town ? new Town(biome.town, terrain, player, dialogue, dayNight) : null;
    const encounters = new EncounterManager(biome.encounters, terrain, player, dialogue, biome.endX ?? null);
    encounters.onBranchChosen = (to) => transitionTo(to, 60);
    encounters.onClassChosen = (classId) => {
      player.applyClass(classId, classes[classId]);
    };
    projectiles.length = 0;
    camera.nearestFlaggedDistance = () => encounters.nearestFlaggedDistance(player.x);
    scene = {
      id, biome, terrain, intro, checkpoints, env, encounters, town,
      parallax: new ParallaxRenderer(biome, terrain),
      props: new WorldProps(biome, terrain),
      wildlife: new AmbientWildlife(biome, terrain),
      party: [],
      ending,
    };
    // the journey's edge marker means "the road goes on" — wrong at the ending
    if (ending) scene.encounters.showEdgeMarker = false;
    if (id !== 'intro') {
      journal.friends().forEach((fid, i) => {
        const c = new Companion(fid, spawnX, terrain, i);
        c.placeNear(player);
        scene.party.push(c);
      });
    }
  }

  // Recruited mid-scene by an adventure outcome — they fall in at the player.
  bus.on('companionJoined', ({ id }) => {
    if (!COMPANIONS[id]) return;
    const isNew = journal.addFriend(id);
    if (!isNew || !scene || scene.id === 'intro') return;
    const c = new Companion(id, player.x, scene.terrain, scene.party.length);
    c.placeNear(player);
    scene.party.push(c);
  });

  bus.on('companionLeft', ({ id }) => {
    journal.removeFriend(id);
    if (!scene) return;
    scene.party = scene.party.filter(c => c.id !== id);
    scene.party.forEach((c, i) => { c.slot = i; });
  });

  /**
   * Rebuild the whole world from a snapshot — used by the boot resume, by
   * respawn after defeat, and by the demo tour handing control back.
   *
   * Ordering is load-bearing:
   *  1. saves suspended for the WHOLE operation. A tick landing mid-restore
   *     once checkpoint-saved half-applied state (the "age persists after
   *     refresh" bug), so un-suspending happens only at the very end.
   *  2. journal.restore BEFORE loadScene — encounter gating and the party
   *     roster both resolve inside the EncounterManager/scene constructors.
   */
  async function restoreFromSnapshot(snap) {
    if (!snap) return false;
    const wasSuspended = saveManager.suspended;
    saveManager.suspended = true;
    try {
      journal.restore(snap.world?.journal);
      await loadScene(snap.biome ?? 'meadow', snap.player?.x ?? 60);
      saveManager.applyTo(player, snap);
      if (snap.player?.classId) {
        player.applyClass(snap.player.classId, classes[snap.player.classId]);
      }
      if (snap.world?.timeOfDay != null) dayNight.phase = snap.world.timeOfDay;
      scene.encounters.applyFlags(snap.world?.flags);
      player.y = scene.terrain.groundYAt(player.x);
      player.prevX = player.x; player.prevY = player.y;
      player.vx = 0;
      for (const cp of scene.checkpoints) {
        if (cp.x <= player.x + 1) cp.reached = true;
        cp.glow = 0;
      }
      // party members are rebuilt by loadScene from the journal; put them on
      // the ground beside the player rather than wherever the last scene left
      for (const c of scene.party) c.placeNear(player);
      return true;
    } finally {
      saveManager.suspended = wasSuspended;
    }
  }

  // Resume at last checkpoint, or begin the intro (§2) on a fresh journey
  const snap = saveManager.load();
  if (snap) await restoreFromSnapshot(snap);
  else await loadScene('intro', 60);

  bus.on('gameSaved', () => hud.flashSaved());
  bus.on('creatureSlain', () => { player.gold += 5; });   // pelts, abstracted (§10)

  // Robust tap binding: iOS Safari's pointerdown on <button> is flaky, so
  // listen to both pointerdown AND touchstart, deduped per tap.
  function bindTap(el, fn) {
    if (!el) return;
    let last = 0;
    const h = (e) => {
      dbg(`tap ${el.id} via ${e.type}`);
      const now = performance.now();
      if (now - last < 400) return;
      last = now;
      fn();
    };
    // Whatever this browser actually delivers, one of these fires; dedupe
    // makes multiple deliveries harmless.
    el.addEventListener('pointerdown', h);
    el.addEventListener('touchstart', h, { passive: true });
    el.addEventListener('touchend', h, { passive: true });
    el.addEventListener('click', h);
  }

  // Show/hide buttons WITHOUT display:none churn — iOS drops taps on
  // elements whose display is toggled mid-gesture, and we were reassigning
  // hidden 120×/s. Class-based visibility, mutated only on state change.
  function setVisible(el, on) {
    if (!el) return;
    if (el.hidden) el.hidden = false;           // one-time handoff from markup
    const off = el.classList.contains('gone');
    if (on && off) el.classList.remove('gone');
    else if (!on && !off) el.classList.add('gone');
  }

  const contextBtn = document.getElementById('context-btn');
  bindTap(contextBtn, () => {
    dbg(`E pressed blocking=${dialogue.blocking}`);
    if (!dialogue.blocking) input.pressInteract();
  });


  // combat defeat → resume at most recent checkpoint (Amendment 01 §A.2)
  let respawning = false;
  bus.on('playerDefeated', async () => {
    if (respawning) return;
    respawning = true;
    setTimeout(async () => {
      const snap = saveManager.load();
      if (snap) {
        await restoreFromSnapshot(snap);
        player.health = Math.max(50, snap.player.health ?? 100);
      } else {
        player.health = player.maxHealth;
      }
      respawning = false;
    }, 900);
  });

  let worldTime = 0;
  let audioSync = 0;
  const loop = new GameLoop(
    (dt) => {
      worldTime += dt;
      input.update(dt);
      demo.update(dt);
      const inp = demo.active ? demo.scriptInput : input;

      // Mobile-first interact: standing at a service/vault, a right-side tap
      // means "use it", not "jump" — the E button becomes optional.
      if (!demo.active && input.jumpPressed && !dialogue.blocking
          && (scene?.town?.nearService || scene?.encounters?.nearInteractable)) {
        input.jumpPressed = false;
        input.jumpHeld = false;
        input.interactPressed = true;
      }

      // environment (§13.3/§13.4) + the aging clock (§5: time, not distance)
      if (scene.env.dayNight) {
        dayNight.update(dt);
        player.ageDays += dt / DAY_SECONDS;
      }
      if (scene.env.weather) {
        wind.update(dt, weather.windBoost);
        weather.update(dt, wind, camera);
        player.windSpeedMod = wind.speedModFor((demo.active ? demo.scriptInput : input).moveDir) * weather.speedMod;
        player.windValue = wind.value;
        scene.parallax.setWind(Math.min(1, wind.strength + weather.rainLevel * 0.2));
      } else {
        player.windSpeedMod = 1;
        player.windValue = 0;
        scene.parallax.setWind(0.35); // scripted night breeze
      }
      // snow depth (§M.2): terrain tier + blizzard boost
      player.snowDepth = scene.env.weather
        ? Math.min(3, scene.terrain.snowDepthAt(player.x) + weather.snowBoost)
        : scene.terrain.snowDepthAt(player.x);

      // prolonged soaking or blizzard exposure risks a chill (§12/§M.2)
      const exposed = scene.env.weather && !scene.town?.inTown
        && (weather.rainLevel > 0.55 || (weather.state === 'blizzard' && weather.snowLevel > 0.5));
      if (exposed) {
        const rate = weather.state === 'blizzard' ? 1.5 : 1;   // cold bites faster
        player._drenchT = (player._drenchT ?? 0) + dt * rate;
        if (player._drenchT > 55) { player.addInjury('chill'); player._drenchT = 0; }
      } else if (player._drenchT > 0) {
        player._drenchT = Math.max(0, player._drenchT - dt * 2);
      }

      audioSync += dt;
      if (audioSync > 0.5) {
        audioSync = 0;
        ambient.setWind(scene.env.weather ? wind.strength : 0.4);
        ambient.setRain(scene.env.weather ? weather.rainLevel : 0);
      }

      player.update(dt, inp, scene.terrain);
      scene.intro?.update(dt);
      scene.ending?.update(dt);
      if (!scene.intro) {
        scene.encounters.update(dt, inp);
        if (inp.interactPressed) dbg(`interact tick near=${!!(scene.town?.nearService || scene.encounters.nearInteractable)} blk=${dialogue.blocking}`);
        scene.town?.update(dt, inp.interactPressed && !dialogue.blocking);
        // fully automatic combat — towns stay weapons-suppressed (§8)
        if (player.classDef && !scene.town?.inTown) {
          player.autoAttack(scene.encounters.creatures, projectiles);
        }
        for (let i = projectiles.length - 1; i >= 0; i--) {
          projectiles[i].update(dt, scene.encounters.creatures);
          if (!projectiles[i].alive) projectiles.splice(i, 1);
        }
      }
      for (const cp of scene.checkpoints) cp.update(dt, player);
      scene.wildlife.update(dt, player);
      // the party stops at the rise and the last stretch is walked alone (§2)
      if (!scene.ending?.holdingParty) {
        for (const c of scene.party) c.update(dt, player, scene.encounters.creatures, projectiles);
      }
      camera.update(dt, player);
      scene.parallax.update(dt);
      ambient.update(dt, player);
      levelFx.update(dt);
      player.xp = xpManager.xp;
      player.level = xpManager.level;
      hud.xpProgress = xpManager.progress;
      // biome chaining: crossing the authored east exit moves the journey on (§13)
      const exit = scene.biome.exitEast;
      if (exit) {
        if (player.x > exit.x - 900) fetchBiome(exit.to);   // prefetch: instant swap
        if (!transitioning && !demo.active && player.x >= exit.x) {
          transitionTo(exit.to, 60, { keepMomentum: true });
        }
      }

      setVisible(journeyBtn, true);   // journey/records always reachable
      const nearAct = !!scene.town?.nearService || !!scene.encounters.nearInteractable;
      setVisible(contextBtn, nearAct);
    },
    (alpha) => {
      const [sx, sy] = scene.intro?.shakeOffset() ?? [0, 0];
      ctx.save();
      ctx.translate(sx, sy);
      scene.parallax.render(ctx, camera, scene.env.dayNight ? dayNight : null);
      camera.applyTransform(ctx);
      ctx.translate(sx / camera.zoom, sy / camera.zoom);
      scene.props.render(ctx, camera, worldTime);
      scene.wildlife.render(ctx);
      for (const cp of scene.checkpoints) cp.render(ctx, worldTime);
      scene.town?.render(ctx, worldTime);
      for (const c of scene.party) c.render(ctx, alpha);
      scene.encounters.render(ctx, worldTime);
      for (const pr of projectiles) pr.render(ctx);
      levelFx.render(ctx, player.x, player.y);
      scene.intro?.renderWorld(ctx);
      scene.ending?.renderWorld(ctx);
      player.render(ctx, alpha);

      // Climb affordance (§3.3). Standing at a face you cannot walk up gives no
      // feedback otherwise — the player just stops and, before the RUN fix,
      // drained to nothing on the spot wondering why.
      if (player.climbHint && !dialogue.blocking) {
        const hx = player.x, hy = player.y - 104;
        ctx.font = '13px "Trebuchet MS", sans-serif';
        const label = player.climbHint === 2
          ? 'Too spent to climb — rest a moment'
          : usingTouch
            ? 'Too steep to walk — hold the jump side to climb'
            : 'Too steep to walk — hold ↑ with the direction to climb';
        const w = ctx.measureText(label).width + 18;
        ctx.fillStyle = 'rgba(12, 16, 10, 0.62)';
        ctx.beginPath(); ctx.roundRect(hx - w / 2, hy - 13, w, 22, 10); ctx.fill();
        ctx.fillStyle = 'rgba(240, 236, 214, 0.92)';
        ctx.textAlign = 'center';
        ctx.fillText(label, hx, hy + 3);
        ctx.textAlign = 'left';
      }
      scene.parallax.renderForeground(ctx, camera);
      ctx.restore();
      if (scene.env.weather) weather.render(ctx, camera, wind.value);
      // cave darkness with a light radius around the traveler (§13.6-adjacent)
      if (scene.biome.caveLight) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        const sx = camera.viewW / 2 + (player.x - camera.x) * camera.zoom;
        const sy = camera.viewH / 2 + (player.y - 30 - camera.y) * camera.zoom;
        const r = 240 * camera.zoom;
        const g = ctx.createRadialGradient(sx, sy, r * 0.25, sx, sy, r);
        g.addColorStop(0, 'rgba(4, 6, 12, 0)');
        g.addColorStop(0.75, 'rgba(4, 6, 12, 0.55)');
        g.addColorStop(1, 'rgba(4, 6, 12, 0.9)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, camera.viewW, camera.viewH);
      }
      if (oldFrameAlpha > 0) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = oldFrameAlpha;
        ctx.drawImage(oldFrame, 0, 0, camera.viewW, camera.viewH);
        ctx.globalAlpha = 1;
      }
      if (scene.env.dayNight) dayNight.renderOverlay(ctx, camera);
      scene.intro?.renderOverlay(ctx, camera);
      scene.ending?.renderOverlay(ctx, camera);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      hud.update(player);
    }
  );

  // --- Demo tour (hideable via SHOW_DEMO) ---
  const demo = new DemoMode({
    player, classes, weather, dayNight, dialogue, saveManager,
    log: dbg,
    transitionTo,
    buildResumeSnapshot: () => {
      const snap = saveManager.buildSnapshot(saveManager.lastCheckpointId);
      snap.world = saveManager.getWorldState?.() ?? {};
      return snap;
    },
    restoreResume: async (resume) => {
      const s = resume ?? saveManager.load();
      if (s) await restoreFromSnapshot(s);
      else await loadScene('intro', 60);
    },
  });
  const demoBtn = document.getElementById('demo-btn');
  demoBtn.hidden = !SHOW_DEMO;
  bindTap(demoBtn, () => {
    if (!demo.active) demo.start();   // starts immediately — no consent step
  });

  // --- Journey panel: the party you have gathered and the road behind ---
  const journeyBtn = document.getElementById('journey-btn');
  const journeyPanel = document.getElementById('journey-panel');
  const partyRoster = document.getElementById('party-roster');
  const journeyRecord = document.getElementById('journey-record');

  const ROLE_TEXT = {
    scout: 'ranges ahead, quick to close',
    shield: 'stands in front of you',
    spear: 'strikes over the line',
    archer: 'looses into the pack',
    healer: 'mends what the road breaks',
  };

  function renderJourneyPanel() {
    const friends = journal.friends();
    partyRoster.innerHTML = friends.length
      ? friends.map(id => {
          const d = COMPANIONS[id];
          if (!d) return '';
          return `<div class="roster-row"><span class="roster-name">${d.name}</span>` +
                 `<span class="roster-role">${ROLE_TEXT[d.role] ?? d.role}</span></div>`;
        }).join('')
      : '<p class="jp-hint">You walk alone.</p>';

    const deeds = [];
    const kindness = Number(journal.get('kindness', 0));
    if (kindness >= 3) deeds.push('You have stopped for people who could not repay you.');
    else if (kindness > 0) deeds.push('You have stopped, at least once, for someone.');
    if (journal.get('oath') === 'sworn') deeds.push('You swore on the oathstone to come back.');
    if (journal.get('family_sign')) deeds.push('You have had word of them on the road.');
    const cleared = Number(journal.get('hordes_cleared', 0));
    if (cleared > 0) deeds.push(`You have broken ${cleared} ${cleared === 1 ? 'horde' : 'hordes'}.`);
    if (friends.length >= 4) deeds.push('You do not walk east alone any more.');
    journeyRecord.innerHTML = deeds.length
      ? deeds.map(d => `<p class="jp-deed">${d}</p>`).join('')
      : '<p class="jp-hint">Your journey has barely begun.</p>';
  }

  bindTap(journeyBtn, () => {
    renderJourneyPanel();
    journeyPanel.hidden = false;
  });
  bindTap(document.getElementById('journey-close'), () => {
    journeyPanel.hidden = true;
  });

  const resetBtn = document.getElementById('journey-reset');
  let resetArmed = 0;
  bindTap(resetBtn, () => {
    const now = performance.now();
    if (now - resetArmed < 4000) {
      localStorage.removeItem('eastward.save');
      journal.clear();
      location.href = location.pathname;   // clean reload → the intro
      return;
    }
    resetArmed = now;
    resetBtn.textContent = 'Tap again to erase everything';
    setTimeout(() => { resetBtn.textContent = '⟲ Start a new journey'; resetArmed = 0; }, 4000);
  });

  // --- Horde banner (§P) ---
  const hordeBanner = document.getElementById('horde-banner');
  let hordeHideAt = 0;
  function showHorde(text, ms = 2600) {
    hordeBanner.textContent = text;
    hordeBanner.classList.remove('gone');
    hordeHideAt = performance.now() + ms;
  }
  bus.on('hordeWave', ({ wave, of, count, kind }) => {
    const noun = count > 1 ? `${kind}s` : kind;
    showHorde(`Wave ${wave} of ${of} — ${count} ${noun}`);
  });
  bus.on('hordeCleared', () => {
    journal.mark('hordes_cleared', Number(journal.get('hordes_cleared', 0)) + 1);
    showHorde('The road is clear.', 2200);
  });
  setInterval(() => {
    if (hordeHideAt && performance.now() > hordeHideAt) {
      hordeBanner.classList.add('gone');
      hordeHideAt = 0;
    }
  }, 200);

  new OrientationGate((isLandscape) => {
    // refresh(), not a single measurement: the media query fires before the
    // browser has laid out the new orientation
    viewport.refresh();
    if (isLandscape) loop.start();
    else loop.stop();
  });
}

boot();
