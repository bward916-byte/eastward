// Companion (§11) — a follower recruited by a decision and remembered by the
// Journal across biome borders. Not a combat pet on a leash: she trails at a
// loose distance, closes when threatened, and occasionally speaks to the road.
//
// Deliberately NOT a Creature subclass — she has no aggro/patrol AI and is
// never a valid auto-attack target (TargetAcquisition only sees `creatures`).
// She contributes damage through her own slow strike timer so she never steals
// the player's kill cadence or trivialises encounters.

import { clamp, damp } from '../core/utils.js';
import { bus } from '../core/EventBus.js';
import { CombatResolver } from '../systems/CombatResolver.js';

const DEFS = {
  mira: {
    name: 'Mira',
    follow: 74,          // px behind the player she settles at
    speed: 395,          // headroom over the player's 300 px/s run (§Player RUN_MULT)
    strikeR: 58,
    strikeDamage: 7,
    strikeCooldown: 2.1, // slow — support, not a second player
    cloak: '#6b4a5a', dark: '#4a3340', skin: '#d9b08a',
  },
};

export class Companion {
  constructor(id, x, terrain) {
    const def = DEFS[id] ?? DEFS.mira;
    this.id = id;
    this.def = def;
    this.name = def.name;
    this.x = x;
    this.terrain = terrain;
    this.y = terrain.groundYAt(x);
    this.prevX = x; this.prevY = this.y;
    this.facing = 1;
    this.vx = 0;
    this.bob = Math.random() * 6.28;
    this.strikeTimer = 0;
    this.flash = 0;
    this.said = new Set();      // barks fire once each per journey
    this._sayCooldown = 6;
  }

  /** Snap to the player on scene load so she doesn't walk in from offscreen. */
  placeNear(player) {
    this.x = player.x - this.def.follow * player.facing;
    this.y = this.terrain.groundYAt(this.x);
    this.prevX = this.x; this.prevY = this.y;
  }

  update(dt, player, creatures = []) {
    this.prevX = this.x; this.prevY = this.y;
    const def = this.def;
    this.bob += dt * 6;
    if (this.flash > 0) this.flash -= dt;
    if (this.strikeTimer > 0) this.strikeTimer -= dt;
    if (this._sayCooldown > 0) this._sayCooldown -= dt;

    // Threat nearby? Close the gap and hold beside the player instead of behind.
    let threat = null, threatD = Infinity;
    for (const c of creatures) {
      if (c.dead) continue;
      const d = Math.abs(c.x - player.x);
      if (d < 320 && d < threatD) { threat = c; threatD = d; }
    }

    const gap = threat ? def.follow * 0.45 : def.follow;
    const targetX = player.x - gap * player.facing;
    const dx = targetX - this.x;

    // Velocity feed-forward: matching the player's own speed is what holds the
    // follow distance. A pure proportional term alone leaves a permanent lag
    // (at a 300 px/s run and gain 3.2 that is ~94px of drift), which read as
    // her steadily falling behind on long stretches.
    const lead = player.vx ?? 0;
    // Dead zone stops the jitter of chasing a moving anchor exactly.
    if (Math.abs(dx) > 12) {
      const want = clamp(lead + dx * 3.2, -def.speed, def.speed);
      this.vx = damp(this.vx, want, 9, dt);
    } else {
      this.vx = damp(this.vx, lead, 12, dt);
    }

    // If she falls badly behind (cliffs, cave mouths, a long sprint) she
    // catches up rather than being stranded in the previous screen.
    if (Math.abs(player.x - this.x) > 640) {
      this.x = player.x - def.follow * player.facing;
      this.vx = 0;
    } else {
      this.x += this.vx * dt;
    }

    if (Math.abs(this.vx) > 20) this.facing = Math.sign(this.vx);
    else if (threat) this.facing = Math.sign(threat.x - this.x) || this.facing;

    this.y = this.terrain.groundYAt(this.x);

    // Support strike — only at a target already engaged with the player.
    if (threat && this.strikeTimer <= 0 && Math.abs(threat.x - this.x) < def.strikeR) {
      this.strikeTimer = def.strikeCooldown;
      this.flash = 0.16;
      if (CombatResolver.hitRoll(1.05)) {
        threat.takeDamage(def.strikeDamage, this.x);
      }
    }
  }

  /** One-shot line, routed through the caller's dialogue system. */
  bark(key, text, dialogue) {
    if (this.said.has(key) || this._sayCooldown > 0) return false;
    if (dialogue?.blocking) return false;
    this.said.add(key);
    this._sayCooldown = 10;
    dialogue?.say?.([text], { speaker: this.name, autoMs: 3200 });
    return true;
  }

  render(ctx, alpha = 1) {
    const d = this.def;
    const x = this.prevX + (this.x - this.prevX) * alpha;
    const y = this.prevY + (this.y - this.prevY) * alpha;
    const moving = Math.abs(this.vx) > 20;
    const sway = moving ? Math.sin(this.bob) * 2.2 : Math.sin(this.bob * 0.25) * 0.7;

    ctx.save();
    ctx.translate(x, y);

    // contact shadow
    ctx.globalAlpha = 0.24;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(0, -1, 13, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.scale(this.facing, 1);

    // legs
    ctx.strokeStyle = d.dark;
    ctx.lineWidth = 3.4;
    ctx.lineCap = 'round';
    const stride = moving ? Math.sin(this.bob) * 6 : 1.5;
    ctx.beginPath();
    ctx.moveTo(-1, -17); ctx.lineTo(-1 + stride, -1);
    ctx.moveTo(1, -17); ctx.lineTo(1 - stride, -1);
    ctx.stroke();

    // cloak / body
    ctx.fillStyle = this.flash > 0 ? '#e8dcc8' : d.cloak;
    ctx.beginPath();
    ctx.moveTo(-7, -16);
    ctx.quadraticCurveTo(-9 + sway, -32, -4, -40);
    ctx.lineTo(4, -40);
    ctx.quadraticCurveTo(9 + sway, -32, 7, -16);
    ctx.closePath();
    ctx.fill();

    // head
    ctx.fillStyle = d.skin;
    ctx.beginPath();
    ctx.arc(0.5, -45, 5.2, 0, Math.PI * 2);
    ctx.fill();
    // hood
    ctx.fillStyle = d.dark;
    ctx.beginPath();
    ctx.arc(0.5, -46, 5.8, Math.PI * 1.05, Math.PI * 2.05);
    ctx.fill();

    ctx.restore();
  }
}

export const COMPANION_IDS = Object.keys(DEFS);
