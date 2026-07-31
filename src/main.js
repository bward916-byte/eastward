// Eastward — Phase 1 boot.
// Wires: InputManager → Player state machine → Camera → ParallaxRenderer → HUD,
// driven by the fixed-timestep GameLoop. One meadow test biome, flat terrain.

import { GameLoop } from './core/GameLoop.js';
import { InputManager } from './core/InputManager.js';
import { Camera } from './core/Camera.js';
import { Player } from './entities/Player.js';
import { TerrainSpline } from './world/TerrainSpline.js';
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

  // snap camera to start position
  camera.x = player.x + camera.viewW * camera.eastBias;
  camera.y = player.y - camera.viewH * 0.12;

  const loop = new GameLoop(
    (dt) => {
      input.update(dt);
      player.update(dt, input, terrain);
      camera.update(dt, player);
      parallax.update(dt);
    },
    (alpha) => {
      parallax.render(ctx, camera);       // L1–L4 + L6 ground
      camera.applyTransform(ctx);
      player.render(ctx, alpha);
      parallax.renderForeground(ctx, camera); // sparse L5 fringe in front
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      hud.update(player);
    }
  );
  loop.start();
}

boot();
