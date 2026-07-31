// Player projectiles (§6): Thief knives and Wizard bolts. Auto-aimed at fire
// time via TargetAcquisition (Amendment 06 §O) with light homing so a moving
// target doesn't trivially sidestep. Deliberately SMALL visuals — base attacks
// stay understated so super-weapon effects (§7) read as special by contrast.

export class Projectile {
  constructor(kind, x, y, target, def, fallbackDir) {
    this.kind = kind;              // 'knife' | 'bolt'
    this.x = x; this.y = y;
    this.target = target;          // may be null → flies straight
    this.damage = def.damage;
    this.speed = def.projSpeed;
    this.alive = true;
    this.ttl = 1.4;
    this.spin = 0;
    if (target) {
      const a = Math.atan2(target.y - 14 - y, target.x - x);
      this.vx = Math.cos(a) * this.speed;
      this.vy = Math.sin(a) * this.speed;
    } else {
      this.vx = fallbackDir * this.speed;
      this.vy = 0;
    }
  }

  update(dt, creatures) {
    if (!this.alive) return;
    this.ttl -= dt;
    if (this.ttl <= 0) { this.alive = false; return; }

    // light homing toward a living target
    if (this.target && !this.target.dead) {
      const a = Math.atan2(this.target.y - 14 - this.y, this.target.x - this.x);
      const cur = Math.atan2(this.vy, this.vx);
      let d = a - cur;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      const turn = Math.max(-3.2 * dt, Math.min(3.2 * dt, d));
      const na = cur + turn;
      this.vx = Math.cos(na) * this.speed;
      this.vy = Math.sin(na) * this.speed;
    }
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.spin += dt * 18;

    for (const c of creatures) {
      if (c.dead) continue;
      if (Math.hypot(c.x - this.x, c.y - 14 - this.y) < 18) {
        c.takeDamage(this.damage, this.x);
        this.alive = false;
        return;
      }
    }
  }

  render(ctx) {
    if (!this.alive) return;
    if (this.kind === 'knife') {
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.rotate(this.spin);
      ctx.strokeStyle = '#c9ccd4';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-5, 0); ctx.lineTo(5, 0); ctx.stroke();
      ctx.restore();
    } else {
      const g = ctx.createRadialGradient(this.x, this.y, 1, this.x, this.y, 8);
      g.addColorStop(0, 'rgba(150, 180, 255, 0.95)');
      g.addColorStop(1, 'rgba(110, 140, 240, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(this.x, this.y, 8, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
