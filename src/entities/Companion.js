// Companions (§11) — friends gathered along the road. Each is recruited by an
// encounter, remembered by the Journal, and fights beside the player for the
// rest of the journey. The party IS the answer to the escalating hordes (§P):
// walking alone into the late-game waves is not survivable.
//
// Deliberately NOT Creature subclasses — they have no aggro/patrol AI and are
// never valid auto-attack targets (TargetAcquisition only sees `creatures`).
// Each carries a role so party composition reads differently in a fight:
//
//   scout    fast, closes early, modest damage
//   shield   slow heavy strikes, stands FORWARD of the player when threatened
//   spear    long reach, hits before the line closes
//   archer   ranged, fires into the pack from behind the line
//   healer   no attack, periodically mends the player between waves
//
// Balance intent: one companion contributes clearly less than the player. Five
// together are roughly two players — enough to turn a losing horde, not enough
// to make the player a spectator.

import { clamp, damp } from '../core/utils.js';
import { bus } from '../core/EventBus.js';
import { CombatResolver } from '../systems/CombatResolver.js';
import { Projectile } from './Projectile.js';

export const COMPANIONS = {
  mira: {
    name: 'Mira', role: 'scout',
    follow: 74, speed: 395, strikeR: 58, damage: 9, cooldown: 1.9, hp: 130,
    cloak: '#6b4a5a', dark: '#4a3340', skin: '#d9b08a',
  },
  corran: {
    name: 'Corran', role: 'shield',
    follow: 52, speed: 330, strikeR: 52, damage: 13, cooldown: 2.6, hp: 240,
    guard: true,
    cloak: '#5a5a4a', dark: '#3e3e32', skin: '#c9a078',
  },
  bram: {
    name: 'Bram', role: 'spear',
    follow: 96, speed: 360, strikeR: 96, damage: 10, cooldown: 2.1, hp: 150,
    cloak: '#4a5a62', dark: '#333f45', skin: '#d0a884',
  },
  sela: {
    name: 'Sela', role: 'archer',
    follow: 128, speed: 350, strikeR: 300, damage: 8, cooldown: 2.2, hp: 95,
    ranged: true, projSpeed: 520,
    cloak: '#6a5a3a', dark: '#4a3f28', skin: '#e0b48c',
  },
  tolm: {
    name: 'Tolm', role: 'healer',
    follow: 146, speed: 340, strikeR: 0, damage: 0, cooldown: 7.0, hp: 110,
    heal: 9,
    cloak: '#4a4a6a', dark: '#33334a', skin: '#cfa982',
  },
  fen: {
    name: 'Fen', role: 'scout',
    follow: 40, speed: 430, strikeR: 46, damage: 7, cooldown: 1.3, hp: 90,
    hound: true,
    cloak: '#6a5a48', dark: '#4a3f32', skin: '#6a5a48',
  },
};

export const COMPANION_IDS = Object.keys(COMPANIONS);

export class Companion {
  constructor(id, x, terrain, slot = 0) {
    const def = COMPANIONS[id] ?? COMPANIONS.mira;
    this.id = id;
    this.def = def;
    this.name = def.name;
    this.role = def.role;
    this.slot = slot;            // formation index — keeps the line from stacking
    this.x = x;
    this.terrain = terrain;
    this.y = terrain.groundYAt(x);
    this.prevX = x; this.prevY = this.y;
    this.facing = 1;
    this.vx = 0;
    this.bob = Math.random() * 6.28;
    this.strikeTimer = def.cooldown * Math.random();
    this.flash = 0;
    this.isCompanion = true;          // creatures use this to decide aggro draw
    this.maxHealth = def.hp ?? 55;
    this.health = this.maxHealth;
    this.downed = false;
    this.downTimer = 0;
  }

  /**
   * Companions are never killed outright — a permanent loss mid-journey would
   * be punishing and would desync the Journal roster from the live party.
   * They go DOWN, stop fighting and drawing aggro, and get back up.
   */
  takeDamage(n) {
    if (this.downed) return;
    this.health -= n;
    this.flash = 0.2;
    if (this.health <= 0) {
      this.health = 0;
      this.downed = true;
      this.downTimer = 8;
      bus.emit('companionDowned', { id: this.id, name: this.name });
    }
  }

  placeNear(player) {
    this.x = player.x - this._gap(false) * (player.facing || 1);
    this.y = this.terrain.groundYAt(this.x);
    this.prevX = this.x; this.prevY = this.y;
  }

  _gap(threatened) {
    // Each slot sits a little further back so a five-strong party reads as a
    // line on the road rather than one figure with overlapping copies.
    return this.def.follow + this.slot * 26;
  }

  /**
   * Where this companion wants to stand right now.
   * Marching: a slot behind the player. Engaged: within reach of the threat.
   *
   * Formation-only tightening is NOT enough — creatures attack the player from
   * ~42px ahead, so a companion holding even a tight rear slot sits ~79px from
   * the target and, with a 58px strike range, never lands a blow. Melee roles
   * must close ON the creature or the whole party is decorative.
   */
  _targetX(player, threat) {
    const def = this.def;
    const face = player.facing || 1;
    if (!threat) return player.x - this._gap(false) * face;

    const side = Math.sign(this.x - threat.x) || -face;
    if (def.heal) {
      return player.x - this._gap(false) * face;      // healers hang back
    }
    if (def.ranged) {
      // hold a firing line: inside strike range, well outside the creature's
      const stand = Math.min(def.strikeR * 0.6, 190);
      return threat.x + side * stand;
    }
    if (def.guard) {
      // shield steps between the player and the threat, and takes the contact
      return threat.x + side * (def.strikeR * 0.55);
    }
    // melee: close to just inside strike range, staggered by slot so the line
    // doesn't collapse onto a single point
    return threat.x + side * (def.strikeR * 0.55 + this.slot * 9);
  }

  update(dt, player, creatures = [], projectiles = null) {
    this.prevX = this.x; this.prevY = this.y;
    const def = this.def;
    this.bob += dt * 6;
    if (this.flash > 0) this.flash -= dt;
    if (this.strikeTimer > 0) this.strikeTimer -= dt;

    if (this.downed) {
      this.downTimer -= dt;
      this.vx = 0;
      this.y = this.terrain.groundYAt(this.x);
      if (this.downTimer <= 0) {
        this.downed = false;
        this.health = Math.round(this.maxHealth * 0.6);
        bus.emit('companionRecovered', { id: this.id, name: this.name });
      }
      return;
    }
    // out-of-combat mend
    if (creatures.every(c => c.dead) && this.health < this.maxHealth) {
      this.health = Math.min(this.maxHealth, this.health + 9 * dt);
    }

    // Nearest live threat to the PLAYER (not to us) — the party defends the
    // player's position, it does not go hunting.
    let threat = null, threatD = Infinity;
    for (const c of creatures) {
      if (c.dead) continue;
      const d = Math.abs(c.x - player.x);
      if (d < 420 && d < threatD) { threat = c; threatD = d; }
    }

    const targetX = this._targetX(player, threat);
    const dx = targetX - this.x;
    const lead = threat ? 0 : (player.vx ?? 0);

    // Velocity feed-forward — a proportional term alone leaves a permanent lag
    // against a moving anchor (~94px at a 300px/s run).
    if (Math.abs(dx) > 12) {
      this.vx = damp(this.vx, clamp(lead + dx * 3.2, -def.speed, def.speed), 9, dt);
    } else {
      this.vx = damp(this.vx, lead, 12, dt);
    }

    if (Math.abs(player.x - this.x) > 700) {
      this.x = targetX;          // stranded by a cliff or a cave mouth
      this.vx = 0;
    } else {
      this.x += this.vx * dt;
    }

    if (Math.abs(this.vx) > 20) this.facing = Math.sign(this.vx);
    else if (threat) this.facing = Math.sign(threat.x - this.x) || this.facing;

    this.y = this.terrain.groundYAt(this.x);

    if (this.strikeTimer > 0) return;

    if (def.heal) {
      const max = player.maxHealth ?? 100;
      if ((player.health ?? max) < max) {
        this.strikeTimer = def.cooldown;
        this.flash = 0.2;
        player.health = Math.min(max, player.health + def.heal);
        bus.emit('companionHealed', { id: this.id, amount: def.heal });
      }
      return;
    }

    if (!threat) return;

    if (def.ranged && projectiles) {
      const d = Math.abs(threat.x - this.x);
      if (d < def.strikeR && d > 40) {
        this.strikeTimer = def.cooldown;
        this.flash = 0.16;
        projectiles.push(new Projectile(
          'knife', this.x, this.y - 30, threat,
          { damage: def.damage, projSpeed: def.projSpeed },
          this.facing, !CombatResolver.hitRoll(1.0), this
        ));
      }
      return;
    }

    if (Math.abs(threat.x - this.x) < def.strikeR) {
      this.strikeTimer = def.cooldown;
      this.flash = 0.16;
      if (CombatResolver.hitRoll(1.05)) threat.takeDamage(def.damage, this.x, this);
    }
  }

  render(ctx, alpha = 1) {
    const d = this.def;
    const x = this.prevX + (this.x - this.prevX) * alpha;
    const y = this.prevY + (this.y - this.prevY) * alpha;
    const moving = Math.abs(this.vx) > 20;
    const sway = moving ? Math.sin(this.bob) * 2.2 : Math.sin(this.bob * 0.25) * 0.7;

    ctx.save();
    ctx.translate(x, y);

    ctx.globalAlpha = 0.24;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(0, -1, 13, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    if (this.downed) {
      // fallen: rotated flat, dimmed — legible as "out of the fight"
      ctx.globalAlpha = 0.6;
      ctx.rotate(-Math.PI / 2 * this.facing);
      ctx.scale(this.facing, 1);
      ctx.fillStyle = d.dark;
      ctx.beginPath();
      ctx.moveTo(-7, -14);
      ctx.quadraticCurveTo(-9, -30, -4, -38);
      ctx.lineTo(4, -38);
      ctx.quadraticCurveTo(9, -30, 7, -14);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = d.skin;
      ctx.beginPath(); ctx.arc(0.5, -43, 5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      return;
    }

    ctx.scale(this.facing, 1);

    if (d.hound) {
      // Four-legged silhouette — must not read as another cloaked walker.
      const gait = moving ? Math.sin(this.bob) * 5 : 0.8;
      ctx.strokeStyle = d.dark;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-7, -13); ctx.lineTo(-7 + gait, -1);
      ctx.moveTo(-4, -13); ctx.lineTo(-4 - gait, -1);
      ctx.moveTo(6, -13); ctx.lineTo(6 - gait, -1);
      ctx.moveTo(9, -13); ctx.lineTo(9 + gait, -1);
      ctx.stroke();
      ctx.fillStyle = this.flash > 0 ? '#e8dcc8' : d.cloak;
      ctx.beginPath();
      ctx.ellipse(1, -18, 11, 6.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();                       // head
      ctx.ellipse(12, -24, 5.5, 4.4, 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();                       // muzzle
      ctx.moveTo(15, -23); ctx.lineTo(20, -21); ctx.lineTo(15, -20);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = d.dark;
      ctx.beginPath();                       // ear
      ctx.moveTo(9, -28); ctx.lineTo(12, -21); ctx.lineTo(7, -23);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = d.cloak;             // tail
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(-10, -19);
      ctx.quadraticCurveTo(-17, -24 + Math.sin(this.bob * 1.5) * 3, -15, -30);
      ctx.stroke();
      ctx.restore();
      return;
    }

    ctx.strokeStyle = d.dark;
    ctx.lineWidth = 3.4;
    ctx.lineCap = 'round';
    const stride = moving ? Math.sin(this.bob) * 6 : 1.5;
    ctx.beginPath();
    ctx.moveTo(-1, -17); ctx.lineTo(-1 + stride, -1);
    ctx.moveTo(1, -17); ctx.lineTo(1 - stride, -1);
    ctx.stroke();

    ctx.fillStyle = this.flash > 0 ? '#e8dcc8' : d.cloak;
    ctx.beginPath();
    ctx.moveTo(-7, -16);
    ctx.quadraticCurveTo(-9 + sway, -32, -4, -40);
    ctx.lineTo(4, -40);
    ctx.quadraticCurveTo(9 + sway, -32, 7, -16);
    ctx.closePath();
    ctx.fill();

    // role tell — silhouette must read at a glance in a crowded fight
    ctx.strokeStyle = d.dark;
    ctx.lineWidth = 2.4;
    if (this.role === 'spear') {
      ctx.beginPath(); ctx.moveTo(4, -8); ctx.lineTo(11, -52); ctx.stroke();
    } else if (this.role === 'archer') {
      ctx.beginPath(); ctx.arc(8, -30, 9, -1.1, 1.1); ctx.stroke();
    } else if (this.role === 'shield') {
      ctx.fillStyle = d.dark;
      ctx.beginPath(); ctx.ellipse(8, -27, 5, 11, 0, 0, Math.PI * 2); ctx.fill();
    } else if (this.role === 'healer') {
      ctx.beginPath(); ctx.moveTo(7, -12); ctx.lineTo(7, -46); ctx.stroke();
      ctx.beginPath(); ctx.arc(7, -49, 3.4, 0, Math.PI * 2); ctx.stroke();
    }

    ctx.fillStyle = d.skin;
    ctx.beginPath();
    ctx.arc(0.5, -45, 5.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = d.dark;
    ctx.beginPath();
    ctx.arc(0.5, -46, 5.8, Math.PI * 1.05, Math.PI * 2.05);
    ctx.fill();

    ctx.restore();
  }
}
