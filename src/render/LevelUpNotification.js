// Explosive level-up notification (Amendment 07 §U.4): a radial particle
// burst from the player (additive light approach per §13.5), a one-off
// musical sting, and a brief ground-anchored label — never a blocking modal.
// Majors get a bigger burst and longer sting than minors.

import { bus } from '../core/EventBus.js';

export class LevelUpNotification {
  constructor(music) {
    this.bursts = [];
    this.labelEl = document.getElementById('levelup-label');
    this._labelTimer = null;
    bus.on('upgradeGranted', ({ tier, label }) => {
      this.bursts.push({ t: 0, tier });
      music?.sting(tier === 'major' ? 'levelup-major' : 'levelup');
      if (this.labelEl) {
        this.labelEl.textContent = label;
        this.labelEl.classList.remove('major');
        if (tier === 'major') this.labelEl.classList.add('major');
        this.labelEl.classList.add('visible');
        clearTimeout(this._labelTimer);
        this._labelTimer = setTimeout(() => this.labelEl.classList.remove('visible'), 2600);
      }
    });
  }

  update(dt) {
    for (const b of this.bursts) b.t += dt;
    this.bursts = this.bursts.filter(b => b.t < 1.3);
  }

  /** World-space render, called with the player position. */
  render(ctx, px, py) {
    for (const b of this.bursts) {
      const big = b.tier === 'major';
      const life = b.t / 1.3;
      const n = big ? 26 : 14;
      const maxR = big ? 130 : 75;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * Math.PI * 2 + (big ? b.t * 0.6 : 0);
        const r = maxR * (1 - Math.pow(1 - life, 2));
        const x = px + Math.cos(ang) * r;
        const y = py - 24 + Math.sin(ang) * r * 0.75;
        const a = (1 - life) * (big ? 0.85 : 0.6);
        ctx.fillStyle = `rgba(255, 232, 160, ${a})`;
        ctx.beginPath();
        ctx.arc(x, y, big ? 3.2 : 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
      // central flash
      const g = ctx.createRadialGradient(px, py - 24, 2, px, py - 24, maxR * 0.5 * (1 - life * 0.4));
      g.addColorStop(0, `rgba(255, 244, 200, ${(1 - life) * (big ? 0.5 : 0.3)})`);
      g.addColorStop(1, 'rgba(255, 244, 200, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(px, py - 24, maxR, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}
