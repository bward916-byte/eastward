// Eastward — Phase 1 + Amendment 01 §A boot.
// Wires: InputManager → Player → Checkpoints/SaveManager → Camera → renderers.

import { GameLoop } from './core/GameLoop.js';
import { InputManager } from './core/InputManager.js';
import { Camera } from './core/Camera.js';
import { SaveManager } from './core/SaveManager.js';
import { bus } from './core/EventBus.js';
import { OrientationGate } from './core/OrientationGate.js';
import { Player } from './entities/Player.js';
import { TerrainSpline } from './world/TerrainSpline.js';
import { Checkpoint } from './world/Checkpoint.js';
import { ParallaxRenderer } from './render/ParallaxRenderer.js';
import { HudRenderer } from './render/HudRenderer.js';

async function boot() {
  const canvas = document.getElementById('game-canvas');
  const ctx = canvas.getContext('2d');

  // Biome data is never hardcoded into logic files (§14.0).
  const biome = await fetch('data/biomes/meadow.json').then(r => r.json());

  const camera = new Camera(window.innerWidth, window.innerHeight);
  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    camera.resize(canvas.width, canvas.height);
  }
  window.addEventListener('resize', resize);
  resize();

  const terrain = new TerrainSpline(biome.groundY);
  const player = new Player(120, terrain.groundYAt(120));
  const input = new InputManager();
  const parallax = new ParallaxRenderer(biome, terrain);
  const hud = new HudRenderer();

  // Checkpoint markers authored in biome data (Amendment 01 §A.4)
  const checkpoints = (biome.checkpoints ?? []).map(d => new Checkpoint(d, terrain));

  // Checkpoint-only saves; resume at most recent checkpoint if one exists (§A.2)
  const saveManager = new SaveManager(player);
  const snap = saveManager.load();
  if (snap) {
    saveManager.applyTo(player, snap);
    player.y = terrain.groundYAt(player.x);
    // markers at/before the resumed checkpoint start already-reached (no re-fire)
    for (const cp of checkpoints) {
      if (cp.x <= player.x + 1) cp.reached = true;
      cp.glow = 0;
    }
  }

  bus.on('gameSaved', () => hud.flashSaved());

  camera.x = player.x + camera.viewW * camera.eastBias;
  camera.y = player.y - camera.viewH * 0.12;

  let worldTime = 0;
  const loop = new GameLoop(
    (dt) => {
      worldTime += dt;
      input.update(dt);
      player.update(dt, input, terrain);
      for (const cp of checkpoints) cp.update(dt, player);
      camera.update(dt, player);
      parallax.update(dt);
    },
    (alpha) => {
      parallax.render(ctx, camera);            // L1–L4 + L6 ground
      camera.applyTransform(ctx);
      for (const cp of checkpoints) cp.render(ctx, worldTime);
      player.render(ctx, alpha);
      parallax.renderForeground(ctx, camera);  // sparse L5 fringe in front
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      hud.update(player);
    }
  );
  // Landscape required (Amendment 02 §E): loop only runs while landscape;
  // portrait shows the rotate prompt and halts simulation, resume is instant.
  new OrientationGate((isLandscape) => {
    if (isLandscape) {
      resize(); // dimensions change on rotate
      loop.start();
    } else {
      loop.stop();
    }
  });
}

boot();
