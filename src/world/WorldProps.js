// Deterministic world-space decor (§13.7 flora, Amendment 06 §L spirit):
// rocks, stumps, mushrooms, crystals, dead trees, flower clusters — placed by
// hash along the terrain per biome's authored prop list. Pure visual density;
// no collision. Rendered between the ground and entities.

function hash(n) {
  let x = Math.sin(n * 91.7 + 47.3) * 43758.5453;
  return x - Math.floor(x);
}

const STEP = 120;

export class WorldProps {
  constructor(biome, terrain) {
    this.kinds = biome.props ?? [];
    this.density = biome.propDensity ?? 0.42;
    this.terrain = terrain;
    this.palette = biome.palette;
  }

  render(ctx, camera, time) {
    if (!this.kinds.length) return;
    const left = camera.worldLeft() - 80, right = camera.worldRight() + 80;
    for (let x = Math.floor(left / STEP) * STEP; x < right; x += STEP) {
      const r = hash(x);
      if (r > this.density) continue;
      const kind = this.kinds[Math.floor(hash(x + 7) * this.kinds.length)];
      const px = x + (hash(x + 3) - 0.5) * STEP * 0.7;
      const py = this.terrain.groundYAt(px);
      const s = 0.7 + hash(x + 11) * 0.7;
      this['_' + kind]?.(ctx, px, py, s, time, hash(x + 19));
    }
  }

  _rock(ctx, x, y, s) {
    ctx.fillStyle = '#7a7e86';
    ctx.strokeStyle = '#5a5e66';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x - 11 * s, y);
    ctx.lineTo(x - 7 * s, y - 9 * s);
    ctx.lineTo(x + 3 * s, y - 12 * s);
    ctx.lineTo(x + 10 * s, y - 4 * s);
    ctx.lineTo(x + 12 * s, y);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
  }

  _stump(ctx, x, y, s) {
    ctx.fillStyle = '#5c4832';
    ctx.fillRect(x - 8 * s, y - 13 * s, 16 * s, 13 * s);
    ctx.fillStyle = '#8a7050';
    ctx.beginPath();
    ctx.ellipse(x, y - 13 * s, 8 * s, 3 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#6d5a40';
    ctx.beginPath();
    ctx.ellipse(x, y - 13 * s, 4.5 * s, 1.7 * s, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  _mushroom(ctx, x, y, s, time, r2) {
    for (let i = 0; i < 2 + Math.floor(r2 * 2); i++) {
      const mx = x + (i - 1) * 8 * s, sc = s * (0.6 + i * 0.2);
      ctx.fillStyle = '#d8cfc0';
      ctx.fillRect(mx - 1.6 * sc, y - 8 * sc, 3.2 * sc, 8 * sc);
      ctx.fillStyle = r2 > 0.5 ? '#a85c48' : '#8a6f9c';
      ctx.beginPath();
      ctx.ellipse(mx, y - 8 * sc, 6 * sc, 3.6 * sc, 0, Math.PI, 0);
      ctx.fill();
    }
  }

  _crystal(ctx, x, y, s, time) {
    const glow = 0.5 + Math.sin(time * 1.4 + x) * 0.3;
    for (const [ox, h] of [[-6, 14], [2, 22], [9, 11]]) {
      ctx.fillStyle = `rgba(120, 160, 220, ${0.55 + glow * 0.3})`;
      ctx.beginPath();
      ctx.moveTo(x + ox - 4 * s, y);
      ctx.lineTo(x + ox, y - h * s);
      ctx.lineTo(x + ox + 4 * s, y);
      ctx.closePath(); ctx.fill();
    }
    const g = ctx.createRadialGradient(x, y - 8, 2, x, y - 8, 30 * s);
    g.addColorStop(0, `rgba(140, 180, 240, ${glow * 0.22})`);
    g.addColorStop(1, 'rgba(140, 180, 240, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - 30 * s, y - 38, 60 * s, 40);
  }

  _deadtree(ctx, x, y, s) {
    ctx.strokeStyle = '#5a5248';
    ctx.lineWidth = 5 * s;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 3 * s, y - 42 * s); ctx.stroke();
    ctx.lineWidth = 3 * s;
    ctx.beginPath(); ctx.moveTo(x + 1, y - 26 * s); ctx.lineTo(x - 13 * s, y - 38 * s); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + 2, y - 34 * s); ctx.lineTo(x + 14 * s, y - 46 * s); ctx.stroke();
  }

  _flowers(ctx, x, y, s, time, r2) {
    for (let i = 0; i < 5; i++) {
      const fx = x + (hash(x + i * 13) - 0.5) * 34 * s;
      const fh = 6 + hash(x + i * 7) * 8;
      const sway = Math.sin(time * 2 + fx * 0.08) * 1.5;
      ctx.strokeStyle = '#4e7a3e';
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(fx, y); ctx.lineTo(fx + sway, y - fh); ctx.stroke();
      ctx.fillStyle = ['#e8b4c8', '#f0d868', '#c8a4e0'][Math.floor(hash(fx) * 3)];
      ctx.beginPath(); ctx.arc(fx + sway, y - fh - 1.5, 2.4, 0, Math.PI * 2); ctx.fill();
    }
  }
}
