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
import { ParallaxRenderer } from './render/ParallaxRenderer.js';
import { HudRenderer } from './render/HudRenderer.js';
import { Dialogue } from './systems/Dialogue.js';
import { AudioEngine } from './audio/AudioEngine.js';
import { MusicManager } from './audio/MusicManager.js';
import { AmbientManager } from './audio/AmbientManager.js';

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

  const player = new Player(60, 520);
  const input = new InputManager();
  const hud = new HudRenderer();
  const dialogue = new Dialogue();
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

  let scene = null;

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
    scene = {
      id, biome, terrain, intro, checkpoints,
      parallax: new ParallaxRenderer(biome, terrain),
    };
  }

  // Resume at last checkpoint, or begin the intro (§2) on a fresh journey
  const snap = saveManager.load();
  if (snap) {
    await loadScene(snap.biome ?? 'meadow', snap.player.x);
    saveManager.applyTo(player, snap);
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

  let worldTime = 0;
  const loop = new GameLoop(
    (dt) => {
      worldTime += dt;
      input.update(dt);
      player.update(dt, input, scene.terrain);
      scene.intro?.update(dt);
      for (const cp of scene.checkpoints) cp.update(dt, player);
      camera.update(dt, player);
      scene.parallax.update(dt);
      ambient.update(dt, player);
    },
    (alpha) => {
      const [sx, sy] = scene.intro?.shakeOffset() ?? [0, 0];
      ctx.save();
      ctx.translate(sx, sy);
      scene.parallax.render(ctx, camera);
      camera.applyTransform(ctx);
      ctx.translate(sx / camera.zoom, sy / camera.zoom);
      for (const cp of scene.checkpoints) cp.render(ctx, worldTime);
      scene.intro?.renderWorld(ctx);
      player.render(ctx, alpha);
      scene.parallax.renderForeground(ctx, camera);
      ctx.restore();
      scene.intro?.renderOverlay(ctx, camera);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      hud.update(player);
    }
  );

  new OrientationGate((isLandscape) => {
    if (isLandscape) { resize(); loop.start(); }
    else loop.stop();
  });
}

boot();
