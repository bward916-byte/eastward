// Renders the 6-layer parallax stack (§13.1) for the current biome.
// Phase 1 draws everything procedurally (no sprite assets yet) but honors the
// full layer contract: L1 sky → L2 far → L3 mid → L4 near → L5 foreground →
// L6 ground. Placement is deterministic per world segment so scenery is stable
// as the camera scrolls. Foliage sway is a shared-timer sine (§13.2 preview).

// Deterministic pseudo-random from an integer seed.
function hash(n) {
  let x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

export class ParallaxRenderer {
  constructor(biome, terrain) {
    this.biome = biome;
    this.terrain = terrain;
    this.windTime = 0;
  }

  update(dt) { this.windTime += dt; }

  render(ctx, camera) {
    const p = this.biome.palette;
    const w = camera.viewW, h = camera.viewH;

    // ---------- L1 sky (screen space) ----------
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, p.skyTop);
    sky.addColorStop(1, p.skyBottom);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    // sun
    const sunX = w * 0.78, sunY = h * 0.2;
    const sunG = ctx.createRadialGradient(sunX, sunY, 6, sunX, sunY, 90);
    sunG.addColorStop(0, p.sun);
    sunG.addColorStop(1, 'rgba(255,243,196,0)');
    ctx.fillStyle = sunG;
    ctx.fillRect(sunX - 90, sunY - 90, 180, 180);

    // ---------- parallax layers ----------
    const s = this.biome.layerScroll;
    this._hills(ctx, camera, s.l2, h * 0.62, 140, 700, p.l2Base, p.l2Accent, 0);
    this._hills(ctx, camera, s.l3, h * 0.7, 110, 480, p.l3Base, p.l3Accent, 10);
    this._treeline(ctx, camera, s.l4, p);
    // fog tint between mid layers and foreground for depth
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = p.fogTint;
    ctx.fillRect(0, 0, w, h);
    this._bushes(ctx, camera, s.l5, p);
    this._ground(ctx, camera, p);          // L6 (player-locked, world space)
  }

  /** Rendered after entities: L5's occasional in-front grass fringe. */
  renderForeground(ctx, camera) {
    const p = this.biome.palette;
    camera.applyTransform(ctx);
    const left = camera.worldLeft() - 60, right = camera.worldRight() + 60;
    const step = 26;
    for (let x = Math.floor(left / step) * step; x < right; x += step) {
      const r = hash(x * 0.77 + 5);
      if (r > 0.3) continue; // sparse — only occasional fringe passes in front
      const gy = this.terrain.groundYAt(x) + 4;
      this._grassTuft(ctx, x, gy, 14 + r * 20, p.l5Base, 1.4);
    }
  }

  // --- layer helpers -------------------------------------------------------

  _hills(ctx, camera, scroll, baseScreenY, amp, wavelength, base, accent, seed) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const off = camera.x * scroll * camera.zoom;
    const w = camera.viewW, h = camera.viewH;
    // subtle zoom parallax: layers rise slightly at wide zoom
    const y0 = baseScreenY + (1 - camera.zoom) * 40;

    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let sx = 0; sx <= w; sx += 8) {
      const wx = sx + off;
      const y = y0
        - Math.abs(Math.sin(wx / wavelength + seed)) * amp
        - Math.sin(wx / (wavelength * 0.37) + seed * 3) * amp * 0.2;
      ctx.lineTo(sx, y);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, y0 - amp, 0, h);
    g.addColorStop(0, accent);
    g.addColorStop(1, base);
    ctx.fillStyle = g;
    ctx.fill();
  }

  _treeline(ctx, camera, scroll, p) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const off = camera.x * scroll * camera.zoom;
    const w = camera.viewW, h = camera.viewH;
    const baseY = h * 0.74 + (1 - camera.zoom) * 60;
    const step = 90;
    const start = Math.floor(off / step) * step;
    for (let wx = start - step * 2; wx < off + w + step * 2; wx += step) {
      const r = hash(wx);
      if (r > 0.75) continue;
      const sx = wx - off;
      const th = 60 + r * 70;
      const sway = Math.sin(this.windTime * 1.2 + wx * 0.01) * 2;
      // trunk
      ctx.fillStyle = '#4a3a2a';
      ctx.fillRect(sx - 3, baseY - th * 0.35, 6, th * 0.35);
      // canopy — three stacked blobs
      ctx.fillStyle = r > 0.4 ? p.l4Base : p.l4Accent;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(sx + sway * (i + 1) * 0.4 + (hash(wx + i) - 0.5) * 18,
                baseY - th * 0.35 - i * th * 0.2,
                th * (0.3 - i * 0.05), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  _bushes(ctx, camera, scroll, p) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const off = camera.x * scroll * camera.zoom;
    const w = camera.viewW, h = camera.viewH;
    const baseY = h * 0.86 + (1 - camera.zoom) * 90;
    const step = 130;
    const start = Math.floor(off / step) * step;
    for (let wx = start - step; wx < off + w + step; wx += step) {
      const r = hash(wx * 1.3 + 40);
      if (r > 0.7) continue;
      const sx = wx - off;
      const size = 18 + r * 26;
      ctx.fillStyle = r > 0.35 ? p.l5Base : p.l5Accent;
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.arc(sx + i * size * 0.55, baseY - size * 0.4 + Math.abs(i) * 4,
                size * 0.55, 0, Math.PI * 2);
        ctx.fill();
      }
      // flowers on some bushes
      if (r < 0.25) {
        ctx.fillStyle = '#e8b4c8';
        for (let i = 0; i < 4; i++) {
          ctx.beginPath();
          ctx.arc(sx + (hash(wx + i * 7) - 0.5) * size * 1.6,
                  baseY - size * 0.5 - hash(wx + i * 13) * size * 0.5,
                  2.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  _ground(ctx, camera, p) {
    camera.applyTransform(ctx);
    const left = camera.worldLeft() - 40, right = camera.worldRight() + 40;
    const bottom = camera.y + camera.viewH / camera.zoom;

    // ground body
    ctx.beginPath();
    ctx.moveTo(left, bottom);
    for (let x = left; x <= right; x += 10) ctx.lineTo(x, this.terrain.groundYAt(x));
    ctx.lineTo(right, bottom);
    ctx.closePath();
    const gy = this.terrain.groundYAt(camera.x);
    const g = ctx.createLinearGradient(0, gy, 0, gy + 220);
    g.addColorStop(0, p.groundTop);
    g.addColorStop(0.18, p.groundDeep);
    g.addColorStop(0.4, p.dirt);
    g.addColorStop(1, '#5a4632');
    ctx.fillStyle = g;
    ctx.fill();

    // dirt path strip hugging the surface
    ctx.strokeStyle = 'rgba(138, 111, 77, 0.55)';
    ctx.lineWidth = 7;
    ctx.beginPath();
    for (let x = left; x <= right; x += 10) {
      const y = this.terrain.groundYAt(x) + 6;
      x === left ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();

    // underfoot grass tufts with wind sway (§13.2)
    const step = 18;
    for (let x = Math.floor(left / step) * step; x < right; x += step) {
      const r = hash(x * 0.31);
      if (r > this.biome.grassDensity * 4) continue;
      const y = this.terrain.groundYAt(x) + 2;
      this._grassTuft(ctx, x, y, 8 + r * 12, r > 0.06 ? p.groundTop : p.l5Accent, 1);
      if (r < 0.015) { // scattered wildflowers
        ctx.fillStyle = r < 0.007 ? '#f0d868' : '#e8b4c8';
        ctx.beginPath();
        ctx.arc(x, y - 12 - r * 200, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  _grassTuft(ctx, x, y, height, color, widthScale) {
    const sway = Math.sin(this.windTime * 2 + x * 0.05) * height * 0.18;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6 * widthScale;
    ctx.lineCap = 'round';
    for (let b = -1; b <= 1; b++) {
      ctx.beginPath();
      ctx.moveTo(x + b * 2.5, y);
      ctx.quadraticCurveTo(
        x + b * 3 + sway * 0.5, y - height * 0.6,
        x + b * 4 + sway, y - height
      );
      ctx.stroke();
    }
  }
}
