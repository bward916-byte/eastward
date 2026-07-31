// Passive ambient wildlife (§13.7, Amendment 06 §L): birds that startle into
// flight and rabbits/hares that dart away when the traveler nears. Pure life
// and motion — never blocking, never hostile. Deterministic placement per
// biome from its authored wildlife list; flushed critters fade and return
// only on scene reload.

function hash(n) {
  let x = Math.sin(n * 73.1 + 19.7) * 43758.5453;
  return x - Math.floor(x);
}

const DEFS = {
  bird: { step: 420, flushR: 130 },
  rabbit: { step: 560, flushR: 150 },
};

export class AmbientWildlife {
  constructor(biome, terrain) {
    this.terrain = terrain;
    this.critters = [];
    for (const kind of biome.wildlife ?? []) {
      const def = DEFS[kind];
      if (!def) continue;
      const span = (biome.terrain?.points?.at(-1)?.[0] ?? 8000);
      for (let x = 250; x < span - 200; x += def.step) {
        const r = hash(x * (kind === 'bird' ? 1.3 : 2.1));
        if (r > 0.55) continue;
        const px = x + (hash(x + 5) - 0.5) * def.step * 0.6;
        this.critters.push({
          kind, x: px, y: terrain.groundYAt(px),
          state: 'idle', t: hash(px) * 7, vx: 0, vy: 0, alpha: 1, dir: hash(px + 2) > 0.5 ? 1 : -1,
        });
      }
    }
  }

  update(dt, player) {
    for (const c of this.critters) {
      c.t += dt;
      if (c.state === 'idle') {
        if (Math.abs(player.x - c.x) < DEFS[c.kind].flushR && Math.abs(player.y - c.y) < 120) {
          c.state = 'flee';
          const away = Math.sign(c.x - player.x) || 1;
          if (c.kind === 'bird') { c.vx = away * 130 + away * 60; c.vy = -170; }
          else { c.vx = away * 260; c.vy = 0; }
        } else if (c.kind === 'rabbit' && Math.sin(c.t * 0.7) > 0.93) {
          c.x += c.dir * 14 * dt;   // occasional grazing hop drift
        }
      } else {
        c.x += c.vx * dt;
        if (c.kind === 'bird') {
          c.vy += -60 * dt;          // climbs away
          c.y += c.vy * dt;
          c.alpha -= dt * 0.55;
        } else {
          c.y = this.terrain.groundYAt(c.x);
          c.alpha -= dt * 0.8;
        }
        if (c.alpha <= 0) c.state = 'gone';
      }
    }
    this.critters = this.critters.filter(c => c.state !== 'gone');
  }

  render(ctx) {
    for (const c of this.critters) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, c.alpha);
      if (c.kind === 'bird') this._bird(ctx, c);
      else this._rabbit(ctx, c);
      ctx.restore();
    }
  }

  _bird(ctx, c) {
    const flap = c.state === 'flee' ? Math.sin(c.t * 22) * 4 : Math.sin(c.t * 2) * 0.5;
    ctx.fillStyle = '#4a4640';
    ctx.beginPath();
    ctx.ellipse(c.x, c.y - 5, 4.5, 3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(c.x + 4, c.y - 7, 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#3a3630';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(c.x - 1, c.y - 6);
    ctx.lineTo(c.x - 6, c.y - 9 - flap);
    ctx.stroke();
    if (c.state === 'idle' && Math.sin(c.t * 1.1) > 0.8) {
      // little head-peck bob
      ctx.beginPath(); ctx.arc(c.x + 5.5, c.y - 5.5, 1, 0, Math.PI * 2); ctx.fill();
    }
  }

  _rabbit(ctx, c) {
    const hop = c.state === 'flee' ? Math.abs(Math.sin(c.t * 14)) * 7 : 0;
    const y = c.y - hop;
    ctx.fillStyle = '#9a8e7c';
    ctx.beginPath();
    ctx.ellipse(c.x, y - 5, 6, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(c.x + 5, y - 8, 3, 0, Math.PI * 2);
    ctx.fill();
    // ears
    ctx.strokeStyle = '#9a8e7c';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(c.x + 5, y - 10); ctx.lineTo(c.x + 4, y - 16); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(c.x + 7, y - 10); ctx.lineTo(c.x + 7.5, y - 15); ctx.stroke();
    // tail
    ctx.fillStyle = '#e8e2d4';
    ctx.beginPath(); ctx.arc(c.x - 6, y - 5, 1.8, 0, Math.PI * 2); ctx.fill();
  }
}
