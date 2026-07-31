// Mid-stretch checkpoint markers (Amendment 01 §A.1, §A.4): small unmistakable
// in-world landmarks — a wayside shrine, a trail cairn, or a campfire ring —
// never a menu popup. Positions/types are authored per-biome in biomes/*.json.
// On player proximity, emits "checkpointReached" once; SaveManager does the rest.

import { bus } from '../core/EventBus.js';

const TRIGGER_RADIUS = 46;

export class Checkpoint {
  /** @param {{id:string, x:number, type:'shrine'|'cairn'|'campfire'}} def */
  constructor(def, terrain) {
    this.id = def.id;
    this.x = def.x;
    this.type = def.type ?? 'cairn';
    this.y = terrain.groundYAt(def.x);
    this.reached = false;
    this.glow = 0; // brief activation glow
  }

  update(dt, player) {
    if (!this.reached && Math.abs(player.x - this.x) < TRIGGER_RADIUS) {
      this.reached = true;
      this.glow = 1;
      bus.emit('checkpointReached', { id: this.id });
    }
    if (this.glow > 0) this.glow = Math.max(0, this.glow - dt * 0.5);
  }

  render(ctx, time) {
    const { x, y } = this;
    ctx.save();

    if (this.type === 'cairn') {
      // stacked trail stones
      const stones = [[0, 0, 11], [-1, -9, 8.5], [1, -16, 6.5], [0, -21.5, 4.5]];
      for (const [ox, oy, r] of stones) {
        ctx.fillStyle = this.reached ? '#8f9aa8' : '#79828e';
        ctx.strokeStyle = '#5a626d';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.ellipse(x + ox, y + oy - 4, r, r * 0.72, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    } else if (this.type === 'campfire') {
      // ring of stones + (lit when reached) flame
      ctx.fillStyle = '#6d6258';
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        ctx.beginPath();
        ctx.ellipse(x + Math.cos(a) * 13, y - 2 + Math.sin(a) * 4, 4, 3, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = '#4a3a28';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x - 7, y - 3); ctx.lineTo(x + 6, y - 9); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + 7, y - 3); ctx.lineTo(x - 5, y - 9); ctx.stroke();
      if (this.reached) {
        const f = 1 + Math.sin(time * 9 + 1) * 0.15;
        const grad = ctx.createRadialGradient(x, y - 12, 1, x, y - 12, 14 * f);
        grad.addColorStop(0, 'rgba(255, 220, 130, 0.95)');
        grad.addColorStop(0.5, 'rgba(240, 140, 60, 0.7)');
        grad.addColorStop(1, 'rgba(200, 80, 30, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.ellipse(x, y - 13, 9 * f, 14 * f, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    } else { // shrine
      ctx.fillStyle = '#7a7466';
      ctx.fillRect(x - 3.5, y - 34, 7, 34);              // post
      ctx.fillStyle = '#8a8272';
      ctx.fillRect(x - 13, y - 40, 26, 7);               // roof beam
      ctx.beginPath();                                    // peak
      ctx.moveTo(x - 15, y - 40); ctx.lineTo(x, y - 50); ctx.lineTo(x + 15, y - 40);
      ctx.closePath(); ctx.fill();
      if (this.reached) {                                 // small votive light
        const g = ctx.createRadialGradient(x, y - 28, 1, x, y - 28, 9);
        g.addColorStop(0, 'rgba(255, 236, 170, 0.9)');
        g.addColorStop(1, 'rgba(255, 236, 170, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - 9, y - 37, 18, 18);
      }
    }

    // activation pulse
    if (this.glow > 0) {
      ctx.strokeStyle = `rgba(255, 240, 190, ${this.glow * 0.8})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y - 16, 24 + (1 - this.glow) * 40, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
}
