// Hostile creatures (§13.7 threat tier). Phase 6 ships the meadow wolf: a
// ground quadruped with patrol → aggro → chase → windup → lunge AI. Carries
// targetableBy tags (Amendment 06 §O.3/§Q.3) so targeting capability falls out
// of data, not special cases — a future flying enemy just omits 'melee'.

import { clamp } from '../core/utils.js';
import { bus } from '../core/EventBus.js';

const KINDS = {
  wolf: {
    hp: 30, speed: 128, aggroR: 280, attackR: 42,
    windup: 0.5, lungeSpeed: 330, lungeTime: 0.32, damage: 12, cooldown: 1.3,
    targetableBy: ['melee', 'ground', 'air'],
    body: '#5a5248', dark: '#443e36', bulk: 1,
  },
  boar: {
    hp: 42, speed: 100, aggroR: 240, attackR: 48,
    windup: 0.62, lungeSpeed: 410, lungeTime: 0.3, damage: 15, cooldown: 1.7,
    targetableBy: ['melee', 'ground', 'air'],
    body: '#6d5a48', dark: '#52443a', bulk: 1.25,
  },
  bat: {
    hp: 14, speed: 150, aggroR: 300, attackR: 60,
    windup: 0.35, lungeSpeed: 380, lungeTime: 0.4, damage: 8, cooldown: 1.4,
    targetableBy: ['air'],            // §Q.1: melee cannot touch the sky
    body: '#3a3444', dark: '#2a2632', bulk: 0.6, flying: true, flyH: 78,
  },
};

export class Creature {
  constructor(kind, x, terrain) {
    const def = KINDS[kind] ?? KINDS.wolf;
    this.def = def;
    this.kind = kind;
    this.x = x;
    this.homeX = x;
    this.terrain = terrain;
    this.y = terrain.groundYAt(x);
    this.hp = def.hp;
    this.dead = false;
    this.victim = null;      // set by takeDamage when a companion draws us
    this.state = 'patrol';
    this.facing = -1;
    this.timer = 0;
    this.flash = 0;
    this.fade = 1;
    this.animT = Math.random() * 5;
    this.targetableBy = def.targetableBy;
  }

  get engaged() { return !this.dead && this.state !== 'patrol'; }

  /**
   * @param attacker optional entity that dealt the blow. A creature struck by a
   * companion will usually turn on them — without this the whole field funnels
   * onto the player and a small party is WORSE than walking alone, because it
   * aggros enemies it cannot then absorb.
   */
  takeDamage(n, fromX, attacker = null) {
    if (this.dead) return;
    this.hp -= n;
    this.flash = 0.18;
    this.x += Math.sign(this.x - fromX) * 7;
    if (this.hp <= 0) {
      this.dead = true; this.state = 'dead';
      bus.emit('creatureSlain', { kind: this.kind });
      return;
    }
    if (this.state === 'patrol') this.state = 'chase';
    if (attacker && attacker.isCompanion && !attacker.downed) {
      // guards hold attention hard; everyone else draws it about half the time
      const draw = attacker.def?.guard ? 0.98 : 0.72;
      if (Math.random() < draw) this.victim = attacker;
    }
  }

  update(dt, player) {
    this.animT += dt;
    if (this.flash > 0) this.flash -= dt;
    if (this.dead) { this.fade = Math.max(0, this.fade - dt * 0.8); return; }

    // Fight whoever drew us, falling back to the player when that target is
    // gone or downed.
    const target = (this.victim && !this.victim.downed) ? this.victim : player;

    const d = this.def;
    const dx = target.x - this.x;
    const dist = Math.abs(dx);
    this.timer -= dt;

    const flyBase = this.def.flying
      ? this.terrain.groundYAt(this.x) - this.def.flyH + Math.sin(this.animT * 3) * 8
      : null;

    switch (this.state) {
      case 'patrol': {
        const wander = Math.sin(this.animT * 0.4 + this.homeX) * 55;
        const tx = this.homeX + wander;
        this.facing = Math.sign(tx - this.x) || this.facing;
        this.x += this.facing * d.speed * 0.25 * dt;
        if (dist < d.aggroR) this.state = 'chase';
        break;
      }
      case 'chase':
        this.facing = Math.sign(dx) || this.facing;
        this.x += this.facing * d.speed * dt;
        if (dist < d.attackR && this.timer <= 0) { this.state = 'windup'; this.timer = d.windup; }
        else if (dist > d.aggroR * 1.7) this.state = 'patrol';
        break;
      case 'windup':
        if (this.timer <= 0) { this.state = 'lunge'; this.timer = d.lungeTime; this.facing = Math.sign(dx) || this.facing; }
        break;
      case 'lunge':
        this.x += this.facing * d.lungeSpeed * dt;
        if (this.def.flying) this.y += (target.y - 34 - this.y) * 6 * dt;  // swoop
        if (dist < 26 && Math.abs(target.y - 30 - this.y) < (this.def.flying ? 34 : 40) + 30) {
          target.takeDamage(d.damage, this.x);
        }
        if (this.timer <= 0) { this.state = 'chase'; this.timer = d.cooldown; }
        break;
    }
    if (this.def.flying) {
      if (this.state !== 'lunge') this.y += (flyBase - this.y) * 4 * dt;
    } else {
      this.y = this.terrain.groundYAt(this.x);
    }
  }

  render(ctx) {
    if (this.fade <= 0) return;
    const t = this.animT;
    const moving = this.state === 'chase' || this.state === 'lunge' || this.state === 'patrol';
    const gait = moving ? Math.sin(t * (this.state === 'lunge' ? 20 : 11)) : 0;
    const crouch = this.state === 'windup' ? 4 : 0;

    ctx.save();
    ctx.globalAlpha = this.fade;
    ctx.translate(this.x, this.y - 12 + crouch);
    ctx.scale(this.facing, 1);
    const body = this.flash > 0 ? '#e8e8e8' : this.def.body;
    const dark = this.flash > 0 ? '#d0d0d0' : this.def.dark;
    const bulk = this.def.bulk ?? 1;

    // flying: wings instead of legs
    if (this.def.flying) {
      const flap = Math.sin(t * 16) * 0.9;
      ctx.fillStyle = dark;
      for (const s of [1, -1]) {
        ctx.beginPath();
        ctx.moveTo(0, -4);
        ctx.quadraticCurveTo(s * 14, -10 - flap * 7, s * 20, -2 - flap * 10);
        ctx.quadraticCurveTo(s * 12, 0, 0, 0);
        ctx.closePath(); ctx.fill();
      }
      ctx.fillStyle = body;
      ctx.beginPath(); ctx.ellipse(0, -3, 6, 5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#d8b04a';
      ctx.beginPath(); ctx.arc(this.facing * 3, -4, 1.1, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      if (!this.dead && this.hp < this.def.hp) {
        ctx.fillStyle = 'rgba(12,16,10,0.55)';
        ctx.fillRect(this.x - 11, this.y - 24, 22, 3);
        ctx.fillStyle = '#c85a4a';
        ctx.fillRect(this.x - 10, this.y - 23.5, 20 * clamp(this.hp / this.def.hp, 0, 1), 2);
      }
      return;
    }
    // legs
    ctx.strokeStyle = dark;
    ctx.lineWidth = 3.5;
    ctx.lineCap = 'round';
    for (const [ox, ph] of [[-9, 0], [-4, Math.PI], [6, Math.PI], [10, 0]]) {
      const a = gait * 0.5 * Math.sin(ph + 1);
      ctx.beginPath();
      ctx.moveTo(ox, 2);
      ctx.lineTo(ox + Math.sin(a) * 5, 12);
      ctx.stroke();
    }
    // body
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.ellipse(0, -2 - (bulk - 1) * 3, 15 * bulk, 7.5 * bulk, 0, 0, Math.PI * 2);
    ctx.fill();
    // head + snout + ear
    ctx.beginPath();
    ctx.ellipse(15, -7 + (this.state === 'windup' ? 2 : 0), 7, 5.5, -0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(20, -7); ctx.lineTo(26, -5.5); ctx.lineTo(20, -4);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(12, -11); ctx.lineTo(14, -16); ctx.lineTo(16.5, -11);
    ctx.closePath(); ctx.fill();
    // boar tusks
    if (this.kind === 'boar') {
      ctx.fillStyle = '#e8e2d4';
      ctx.beginPath();
      ctx.moveTo(22, -4); ctx.lineTo(27, -9); ctx.lineTo(23.5, -3);
      ctx.closePath(); ctx.fill();
    }
    // tail
    ctx.strokeStyle = body;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-14, -3);
    ctx.quadraticCurveTo(-20, -6 + gait, -22, -10 + gait * 1.5);
    ctx.stroke();
    // eye
    if (this.flash <= 0) {
      ctx.fillStyle = this.engaged ? '#d8a03c' : '#2a2622';
      ctx.beginPath(); ctx.arc(16, -8, 1.4, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();

    // small hp pips when hurt & alive
    if (!this.dead && this.hp < this.def.hp) {
      const w = 26, frac = clamp(this.hp / this.def.hp, 0, 1);
      ctx.fillStyle = 'rgba(12,16,10,0.55)';
      ctx.fillRect(this.x - w / 2, this.y - 40, w, 4);
      ctx.fillStyle = '#c85a4a';
      ctx.fillRect(this.x - w / 2 + 1, this.y - 39, (w - 2) * frac, 2);
    }
  }
}
