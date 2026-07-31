// Eastward — boot & scene orchestration.
// Fresh journey: playable intro (§2) → meadow. Existing save: resume at the
// most recent checkpoint in its biome (Amendment 01 §A).

import { GameLoop } from './core/GameLoop.js';
import { InputManager } from './core/InputManager.js';
import { Camera } from './core/Camera.js';
import { SaveManager } from './core/SaveManager.js';
import { OrientationGate } from './core/OrientationGate.js';
import { bus } from './core/EventBus.js';
import { Player } from './entities/Player.js';
import { Guardian } from './entities/Guardian.js';
import { TerrainSpline } from './world/TerrainSpline.js';
import { IntroTerrain } from './world/IntroTerrain.js';
import { IntroSequence } from './world/IntroSequence.js';
import { Checkpoint } from './world/Checkpoint.js';
import { DayNightCycle, DAY_SECONDS } from './world/DayNightCycle.js';
import { WindSystem } from './world/WindSystem.js';
import { WeatherSystem } from './world/WeatherSystem.js';
import { EncounterManager } from './world/EncounterManager.js';
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

async function boot() {
  const canvas = document.getElementById('game-canvas');
  const ctx = canvas.getContext('2d');

  const camera = new Camera(window.innerWidth, window.innerHeight);
  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    camera.resize(canvas.width, canvas.height);
  }
  window.addEventListener('resize', resize);
  resize();

  const classes = await fetch('data/classes.json').then(r => r.json());
  const manifest = await fetch('data/manifest.json').then(r => r.json());
  const player = new Player(60, 520);
  const projectiles = [];
  const attackBtn = document.getElementById('attack-btn');
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

  const dayNight = new DayNightCycle();
  const wind = new WindSystem();
  const weather = new WeatherSystem();
  const xpManager = new ExperienceManager();
  new UpgradeResolver(player);
  const levelFx = new LevelUpNotification(music);
  saveManager.getWorldState = () => ({
    timeOfDay: dayNight.phase,
    flags: scene?.encounters?.getFlags() ?? [],
  });

  let scene = null;
  let sceneFade = 0;          // 0 = clear, 1 = black (biome transitions)
  let transitioning = false;
  const biomeLabel = document.getElementById('biome-label');

  function showBiomeName(name) {
    if (!biomeLabel || !name) return;
    biomeLabel.textContent = name;
    biomeLabel.classList.add('visible');
    setTimeout(() => biomeLabel.classList.remove('visible'), 3200);
  }

  async function transitionTo(id, spawnX) {
    if (transitioning) return;
    transitioning = true;
    const fadeOut = setInterval(() => { sceneFade = Math.min(1, sceneFade + 0.07); }, 30);
    await new Promise(r => setTimeout(r, 480));
    clearInterval(fadeOut);
    sceneFade = 1;
    await loadScene(id, spawnX);
    bus.emit('biomeTransition', { to: id });
    showBiomeName(scene.biome.name);
    const fadeIn = setInterval(() => {
      sceneFade = Math.max(0, sceneFade - 0.06);
      if (sceneFade <= 0) { clearInterval(fadeIn); transitioning = false; }
    }, 30);
  }

  async function loadScene(id, spawnX) {
    const biome = await fetch(`data/biomes/${id}.json`).then(r => r.json());
    let terrain, intro = null;

    if (id === 'intro') {
      terrain = new IntroTerrain(biome);
      const guardian = new Guardian(spawnX + 90, terrain);
      intro = new IntroSequence(player, terrain, dialogue, camera, guardian);
      intro.onComplete = () => loadScene('meadow', 100);
    } else {
      terrain = new TerrainSpline(biome);
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
      attackBtn.hidden = false;
    };
    projectiles.length = 0;
    camera.nearestFlaggedDistance = () => encounters.nearestFlaggedDistance(player.x);
    scene = {
      id, biome, terrain, intro, checkpoints, env, encounters, town,
      parallax: new ParallaxRenderer(biome, terrain),
    };
  }

  // Resume at last checkpoint, or begin the intro (§2) on a fresh journey
  const snap = saveManager.load();
  if (snap) {
    await loadScene(snap.biome ?? 'meadow', snap.player.x);
    saveManager.applyTo(player, snap);
    if (snap.player.classId) {
      player.applyClass(snap.player.classId, classes[snap.player.classId]);
      attackBtn.hidden = false;
    }
    if (snap.world?.timeOfDay != null) dayNight.phase = snap.world.timeOfDay;
    scene.encounters.applyFlags(snap.world?.flags);
    player.y = scene.terrain.groundYAt(player.x);
    player.prevX = player.x; player.prevY = player.y;
    for (const cp of scene.checkpoints) {
      if (cp.x <= player.x + 1) cp.reached = true;
      cp.glow = 0;
    }
  } else {
    await loadScene('intro', 60);
  }

  bus.on('gameSaved', () => hud.flashSaved());
  bus.on('creatureSlain', () => { player.gold += 5; });   // pelts, abstracted (§10)
  const contextBtn = document.getElementById('context-btn');
  contextBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (!dialogue.blocking) input.pressInteract();
  });
  attackBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (!dialogue.blocking) input.pressAttack();
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
      if (!scene.intro) {
        scene.encounters.update(dt, inp);
        scene.town?.update(dt, inp.interactPressed && !dialogue.blocking);
        // towns are non-combat zones (§8): weapons suppressed inside
        if (inp.attackPressed && player.classDef && !dialogue.blocking && !scene.town?.inTown) {
          player.tryAttack(scene.encounters.creatures, projectiles);
        }
        for (let i = projectiles.length - 1; i >= 0; i--) {
          projectiles[i].update(dt, scene.encounters.creatures);
          if (!projectiles[i].alive) projectiles.splice(i, 1);
        }
      }
      for (const cp of scene.checkpoints) cp.update(dt, player);
      camera.update(dt, player);
      scene.parallax.update(dt);
      ambient.update(dt, player);
      levelFx.update(dt);
      player.xp = xpManager.xp;
      player.level = xpManager.level;
      hud.xpProgress = xpManager.progress;
      // biome chaining: crossing the authored east exit moves the journey on (§13)
      const exit = scene.biome.exitEast;
      if (exit && !transitioning && !demo.active && player.x >= exit.x) {
        transitionTo(exit.to, 60);
      }

      journeyBtn.hidden = !(
        scene.checkpoints.some(cp => cp.reached && Math.abs(player.x - cp.x) < 80)
        || scene.town?.inTown   // the town IS a checkpoint (§A.1)
      );
      const nearSvc = !!scene.town?.nearService;
      contextBtn.hidden = !nearSvc;
      attackBtn.hidden = !player.classDef || scene.town?.inTown || nearSvc;
    },
    (alpha) => {
      const [sx, sy] = scene.intro?.shakeOffset() ?? [0, 0];
      ctx.save();
      ctx.translate(sx, sy);
      scene.parallax.render(ctx, camera, scene.env.dayNight ? dayNight : null);
      camera.applyTransform(ctx);
      ctx.translate(sx / camera.zoom, sy / camera.zoom);
      for (const cp of scene.checkpoints) cp.render(ctx, worldTime);
      scene.town?.render(ctx, worldTime);
      scene.encounters.render(ctx, worldTime);
      for (const pr of projectiles) pr.render(ctx);
      levelFx.render(ctx, player.x, player.y);
      scene.intro?.renderWorld(ctx);
      player.render(ctx, alpha);
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
      if (sceneFade > 0) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = `rgba(6, 8, 12, ${sceneFade})`;
        ctx.fillRect(0, 0, camera.viewW, camera.viewH);
      }
      if (scene.env.dayNight) dayNight.renderOverlay(ctx, camera);
      scene.intro?.renderOverlay(ctx, camera);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      hud.update(player);
    }
  );

  // --- Demo tour (hideable via SHOW_DEMO) ---
  const demo = new DemoMode({
    player, classes, weather, dayNight, dialogue, saveManager,
    transitionTo,
    restoreLastCheckpoint: async () => {
      const s = saveManager.load();
      if (s) await restoreFromSnapshot(s);
      else await loadScene('intro', 60);
    },
  });
  const demoBtn = document.getElementById('demo-btn');
  demoBtn.hidden = !SHOW_DEMO;
  demoBtn.addEventListener('pointerdown', () => {
    if (!demo.active && !dialogue.active) demo.start();
  });

  // --- Portable save codes (Amendment 07 §S) ---
  const journeyBtn = document.getElementById('journey-btn');
  const journeyPanel = document.getElementById('journey-panel');
  const journeyCode = document.getElementById('journey-code');
  const journeyInput = document.getElementById('journey-input');
  const journeyError = document.getElementById('journey-error');
  journeyBtn.addEventListener('pointerdown', () => {
    journeyError.hidden = true;
    journeyInput.value = '';
    journeyCode.value = saveManager.exportCode(scene.biome, manifest) ?? '(no saved journey yet)';
    journeyPanel.hidden = false;
  });
  document.getElementById('journey-close').addEventListener('pointerdown', () => {
    journeyPanel.hidden = true;
  });
  document.getElementById('journey-copy').addEventListener('pointerdown', async () => {
    try { await navigator.clipboard.writeText(journeyCode.value); } catch {
      journeyCode.select(); document.execCommand?.('copy');
    }
  });
  document.getElementById('journey-load').addEventListener('pointerdown', async () => {
    journeyError.hidden = true;
    const code = journeyInput.value.trim();
    if (!code) return;
    const biomeId = saveManager.peekCodeBiome(code, manifest);
    if (!biomeId) { journeyError.hidden = false; return; }
    const biomeData = await fetch(`data/biomes/${biomeId}.json`).then(r => r.json());
    const snapIn = saveManager.importFromCode(code, biomeData, manifest);
    if (!snapIn) { journeyError.hidden = false; return; }
    journeyPanel.hidden = true;
    await restoreFromSnapshot(snapIn);
  });

  new OrientationGate((isLandscape) => {
    if (isLandscape) { resize(); loop.start(); }
    else loop.stop();
  });
}

boot();
