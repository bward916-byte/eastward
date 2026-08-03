// Player: locomotion state machine and Stamina/Endurance model (§3.1), now with
// Phase 2 slope handling (§3.3): uphill penalties, scramble drain, the CLIMB
// state (hold Up against a 45–80° face), SLIDE on slips/release, and
// fall-recovery STAGGER (minor cost, never instant death). Rendering is
// procedural; sprite rigs and age stages arrive in Phase 8.

import { clamp } from '../core/utils.js';
import { bus } from '../core/EventBus.js';
import { SCRAMBLE_MIN, CLIMB_MIN } from '../world/TerrainSpline.js';
import { nearestTarget } from './TargetAcquisition.js';
import { CombatResolver } from '../systems/CombatResolver.js';
import { rigParams } from './PlayerRig.js';
import { Projectile } from './Projectile.js';

// --- locomotion tunables --------------------------------------------------
const BASE_SPEED = 150;        // px/s at Walk (1x)
const RUN_MULT = 2.0;
const RUN_THRESHOLD = 0.3;     // hold seconds before Walk promotes to Run
const ACCEL = 900;
const DECEL = 1100;

const GRAVITY = 1500;
const JUMP_VEL = -420;
const JUMP_HOLD_BOOST = -900;
const JUMP_HOLD_MAX = 0.22;
const AIR_CONTROL = 0.45;

// --- climbing / slopes (§3.3) --------------------------------------------
const CLIMB_SPEED = 70;        // along-surface px/s at skill 1, easiest angle
const CLIMB_DRAIN = 5.5;       // stamina/s, scaled up with angle
// Entering a climb you have no hope of finishing is a trap: you drain to zero
// partway up, slip, slide back to the foot, and repeat forever. A flat entry
// threshold does not fix it — the meadow face costs 40 stamina, so any fixed
// number below that still admits a doomed attempt. The gate is computed from
// the actual face ahead instead (see _climbCostAhead).
const CLIMB_ENTRY_MARGIN = 1.12;   // need a little more than the bare cost
const CLIMB_ENTRY_FLOOR = 12;      // ...and never trivially little
const SCRAMBLE_DRAIN = 8;      // stamina/s while pushing uphill on scramble
const SLIDE_ACCEL = 620;
const SLIDE_MAX = 280;
const SAFE_FALL = 150;         // px of drop before landing staggers
const STAGGER_TIME = 0.9;
const FALL_STAM_COST = 15;

// --- stamina / endurance (§3.1) -------------------------------------------
const STAMINA_MAX = 100;
const ENDURANCE_MAX = 100;
const RUN_DRAIN = 6;
const JUMP_COST = 5;
const STAMINA_REGEN = 18;
const ENDURANCE_DRAIN = 0.25;  // slow conditioning wear during sustained Run
const ENDURANCE_REGEN = 0.35;
const FATIGUE_TIME = 2.5;
const FATIGUE_SPEED = 0.6;

export class Player {
  constructor(x, groundY) {
    this.x = x;
    this.y = groundY;
    this.prevX = x; this.prevY = this.y;
    this.vx = 0;
    this.vy = 0;
    this.facing = 1;
    this.grounded = true;
    this.minX = 40;
    this.maxX = Infinity;

    this.state = 'IDLE';
    this.stamina = STAMINA_MAX;
    this.endurance = ENDURANCE_MAX;
    this.fatigueTimer = 0;
    this.pinnedByFace = false;
    this._climbDir = 0;
    this.climbHint = 0;
    this.staggerTimer = 0;
    this._jumpHoldTime = 0;
    this._leaveGroundY = groundY;

    // §7 Climbing skill (1 = untrained). Trainer raises this in Phase 6/7:
    // higher = faster climb, less drain, (later) higher max angle & grip.
    this.climbSkill = 1.0;
    this.artifacts = 0;        // unidentified '???' artifacts held (§8)
    this.identified = 0;       // sage-identified relics, sellable (§8/§10)
    this.gold = 0;

    // class & combat (Phase 6, Amendment 06 §O)
    this.classId = null;
    this.classDef = null;
    this.health = 100;
    this.maxHealth = 100;
    this.mana = 0;
    this.maxMana = 0;
    this.skills = { accuracy: 1, fightSpeed: 1, autoDodge: 0 };  // §T
    this.xp = 0;
    this.level = 0;
    this.dodgeT = 0;
    this.attackCooldown = 0;
    this.ageDays = 0;                 // in-game days lived (§5)
    this._lastStage = 'Child';
    this._rig = rigParams(0);
    this.injuries = [];               // {kind, t} — §12, recoverable always
    this.snowDepth = 0;               // effective tier 0–3, set by main (§M.2)
    this.swingT = 0;           // fighter swipe anim
    this.iframes = 0;
    this.hurtFlash = 0;
    // §3.6 permanent progression + §13.3 wind hooks (later phases fill these)
    this.speedBonus = 1.0;
    this.windSpeedMod = 1.0;
    this.windValue = 0;        // signed live wind, drifts jump arcs (§13.3)

    this.animTime = 0;
    this.slopeAngle = 0;       // signed, cached for render lean
  }

  applyClass(id, def) {
    this.classId = id;
    this.classDef = def;
    if (def.speedBonus) this.speedBonus = def.speedBonus;
    if (def.climbSkill) this.climbSkill = def.climbSkill;
    if (def.mana) { this.maxMana = def.mana; this.mana = def.mana; }
  }

  hasInjury(kind) { return this.injuries.some(i => i.kind === kind); }

  addInjury(kind) {
    if (this.hasInjury(kind)) return;
    const DUR = { limp: 150, arm: 150, bruise: 120, chill: 180 };
    this.injuries.push({ kind, t: DUR[kind] ?? 120 });
    bus.emit('injuryGained', { kind });
  }

  takeDamage(n, fromX) {
    if (this.iframes > 0 || this.health <= 0) return;
    // passive Auto-Dodge (§T.4): trained chance to evade a landing attack
    if (CombatResolver.dodgeRoll(this.skills.autoDodge)) {
      this.dodgeT = 0.3;
      this.iframes = 0.55;
      this.vx += Math.sign(this.x - fromX) * 210;   // quick sidestep
      return;
    }
    this.health -= n;
    this.iframes = 0.9;
    this.hurtFlash = 0.25;
    this.vx += Math.sign(this.x - fromX) * 150;
    // heavy hits at low health can leave a lingering injury (§12)
    if (this.health < 35 && this.health > 0 && Math.random() < 0.35) {
      this.addInjury(Math.random() < 0.5 ? 'arm' : 'bruise');
    }
    if (this.health <= 0) {
      this.health = 0;
      bus.emit('playerDefeated');
    }
  }

  /** Fully automatic combat (§O taken to its end): weapons engage on their
   *  own when a valid target is in range — the player's skill is movement.
   *  Closing distance commits; running breaks off. */
  autoAttack(creatures, projectiles) {
    const def = this.classDef;
    if (!def || this.attackCooldown > 0 || this.state === 'CLIMB'
      || this.state === 'SLIDE' || this.state === 'STAGGER') return;
    const armPen = this.hasInjury('arm');                    // §12: bad swing arm
    const acc = this.skills.accuracy - (armPen ? 0.25 : 0);
    const cdMult = armPen ? 1.3 : 1;
    const dmg = Math.round(def.damage * this._rig.damageMult);
    if (def.attack === 'swipe') {
      // any living melee-valid target close enough, either side
      let best = null, bd = def.range;
      for (const c of creatures) {
        if (c.dead || !c.targetableBy.includes('melee')) continue;
        const ad = Math.abs(c.x - this.x);
        if (ad < bd && Math.abs(c.y - this.y) < 55) { best = c; bd = ad; }
      }
      if (!best) return;
      // standing still: square up to a threat behind you
      if (Math.abs(this.vx) < 25) this.facing = Math.sign(best.x - this.x) || this.facing;
      this.attackCooldown = CombatResolver.cooldownFor(def.cooldown, this.skills.fightSpeed) * cdMult;
      this.swingT = 0.25;
      for (const c of creatures) {
        if (c.dead || !c.targetableBy.includes('melee')) continue;
        const dx = c.x - this.x;
        if (Math.sign(dx) === this.facing && Math.abs(dx) < def.range && Math.abs(c.y - this.y) < 55) {
          // §T.2: auto-aim directs, Accuracy decides — per-target roll on a cleave
          if (CombatResolver.hitRoll(acc)) c.takeDamage(dmg, this.x);
        }
      }
      return;
    }
    const target = nearestTarget(this.x, this.y - 20, creatures, def.range, 'ground')
      ?? nearestTarget(this.x, this.y - 20, creatures, def.range, 'air');
    if (!target) return;                       // nothing in range — hold fire
    if (def.attack === 'bolt' && this.mana < def.manaCost) return;
    this.attackCooldown = CombatResolver.cooldownFor(def.cooldown, this.skills.fightSpeed) * cdMult;
    if (def.attack === 'bolt') this.mana -= def.manaCost;
    const willMiss = !CombatResolver.hitRoll(acc);
    projectiles.push(new Projectile(
      def.attack === 'bolt' ? 'bolt' : 'knife',
      this.x + this.facing * 10, this.y - 26, target, { ...def, damage: dmg }, this.facing, willMiss
    ));
  }

  get staminaCeiling() {
    const chill = this.hasInjury('chill') ? 0.8 : 1;        // §12 sickness
    return (this.endurance / ENDURANCE_MAX) * STAMINA_MAX * chill;
  }
  get exhausted() { return this.state === 'EXHAUSTED'; }

  /**
   * Stamina this climb will actually cost, by walking the contiguous climb-tier
   * run ahead and integrating the same drain the CLIMB branch applies. Sampled
   * every 4px — fine enough for a cost estimate, cheap enough to run per frame
   * while standing at a face.
   */
  _climbCostAhead(terrain, x, dir) {
    let cost = 0, cx = x, steps = 0;
    while (steps++ < 220) {
      const tier = terrain.tierAt(cx);
      if (steps > 2 && tier !== 'climb') break;
      const a = Math.abs(terrain.slopeAt(cx));
      const grade = clamp((a - CLIMB_MIN) / (Math.PI / 2 - CLIMB_MIN), 0, 1);
      const hspeed = CLIMB_SPEED * this.climbSkill * (1 - grade * 0.45) * Math.cos(a);
      if (hspeed <= 1) break;
      cost += CLIMB_DRAIN * (0.6 + grade) / this.climbSkill * (4 / hspeed);
      cx += dir * 4;
    }
    return cost;
  }

  /** Stamina required to be allowed to start the climb ahead. */
  climbEntryCost(terrain, dir) {
    const raw = this._climbCostAhead(terrain, this.x, dir) * CLIMB_ENTRY_MARGIN;
    return Math.max(CLIMB_ENTRY_FLOOR, Math.min(raw, this.staminaCeiling * 0.98));
  }

  update(dt, input, terrain) {
    this.prevX = this.x; this.prevY = this.y;

    const sAng = terrain.slopeAt(this.x);        // + = rises east
    const absAng = Math.abs(sAng);
    this.slopeAngle = sAng;
    const ascendDir = sAng > 0 ? 1 : (sAng < 0 ? -1 : this.facing);
    const tierHere = terrain.tierAt(this.x);
    const tierAhead = terrain.tierAt(this.x + this.facing * 14);

    const wantDir = input.moveDir;
    if (wantDir !== 0 && this.state !== 'CLIMB' && this.state !== 'SLIDE') {
      this.facing = wantDir;
    }
    const fatigued = this.fatigueTimer > 0;

    // Pushing into a climb-tier face with no Up held: forward motion is zeroed
    // further down, so this is running on the spot. Without this flag the
    // player burns RUN stamina AND endurance for zero distance, drains to
    // nothing at the foot of the hill, and then cannot start the climb at all
    // (entry needs stamina > 1). That is the "stuck at the base of a hill with
    // zero stamina, still in RUN" report.
    this.pinnedByFace = this.grounded
      && tierAhead === 'climb'
      && wantDir === this.facing
      && terrain.slopeAt(this.x + this.facing * 14) * this.facing > 0;
    // surfaced for the HUD prompt — the climb input is otherwise undiscoverable
    // 0 = none, 1 = needs the climb input, 2 = knows how but is too spent
    this.climbHint = !this.pinnedByFace ? 0
      : (this.stamina < this.climbEntryCost(terrain, this.facing)
          ? 2 : (input.jumpHeld ? 0 : 1));

    // ---- state resolution ----
    if (this.staggerTimer > 0) {
      this.state = 'STAGGER';
    } else if (!this.grounded) {
      this.state = 'JUMP';
    } else if (this.state === 'CLIMB') {
      // Climb direction is LATCHED on entry. Recomputing it from the slope
      // underfoot strands the player at the foot of a steep face that sits in a
      // small basin: the face ahead rises east, the ground underfoot tilts
      // west, so the hold test failed on the very next frame and the state
      // oscillated CLIMB->WALK->RUN at ~15Hz without moving. (Meadow x~4300.)
      const climbDir = this._climbDir || ascendDir;
      const holding = input.jumpHeld && wantDir === climbDir;
      const faceAhead = terrain.tierAt(this.x + climbDir * 16) === 'climb';
      if (absAng < CLIMB_MIN && !faceAhead) this.state = 'WALK'; // truly topped out
      else if (!holding || this.stamina <= 0.01) this.state = 'SLIDE'; // slip (§3.3)
    } else if (tierHere === 'climb') {
      const wantClimb = input.jumpHeld && wantDir === ascendDir;
      if (wantClimb && this.stamina >= this.climbEntryCost(terrain, ascendDir)) {
        this.state = 'CLIMB'; this._climbDir = ascendDir;
      }
      else this.state = 'SLIDE';
    } else if (this.state === 'SLIDE') {
      this.state = 'WALK';                                   // slid onto safe ground
      this._climbDir = 0;
    } else if (this.stamina <= 0.01 && this.endurance <= 0.01) {
      this.state = 'EXHAUSTED';
    } else if (wantDir === 0) {
      this.state = 'IDLE';
    } else if (fatigued) {
      this.state = 'WALK';
    } else if (input.holdDuration > RUN_THRESHOLD && this.stamina > 0.01
               && !this.pinnedByFace) {
      this.state = 'RUN';
    } else {
      this.state = 'WALK';
    }

    // ---- entering a climb face from below: hold Up + direction to start ----
    if ((this.state === 'WALK' || this.state === 'RUN' || this.state === 'IDLE')
        && tierAhead === 'climb' && this.grounded) {
      const faceAscends = terrain.slopeAt(this.x + this.facing * 14) * this.facing > 0;
      if (faceAscends && input.jumpHeld && wantDir === this.facing
          && this.stamina >= this.climbEntryCost(terrain, this.facing)) {
        this.state = 'CLIMB';
        this._climbDir = this.facing;   // latch: the FACE decides, not the dip
      }
    }

    // ---- movement per state ----
    if (this.state === 'CLIMB') {
      const climbDir = this._climbDir || ascendDir;
      // grade from the face being climbed, not a basin lip underfoot
      const faceAng = Math.abs(terrain.slopeAt(this.x + climbDir * 14));
      const useAng = Math.max(absAng, faceAng);
      const grade = clamp((useAng - CLIMB_MIN) / (Math.PI / 2 - CLIMB_MIN), 0, 1);
      const speed = CLIMB_SPEED * this.climbSkill * (1 - grade * 0.45);
      this.vx = climbDir * speed * Math.cos(useAng);
      this.x += this.vx * dt;
      this.stamina -= CLIMB_DRAIN * (0.6 + grade) / this.climbSkill * dt;
    } else if (this.state === 'SLIDE') {
      const downDir = -ascendDir;
      this.vx += downDir * SLIDE_ACCEL * Math.sin(absAng) * dt;
      this.vx = clamp(this.vx, -SLIDE_MAX, SLIDE_MAX);
      this.x += this.vx * dt;
    } else if (this.state === 'STAGGER') {
      this.vx *= Math.max(0, 1 - 8 * dt);
      this.x += this.vx * dt;
      this.staggerTimer -= dt;
    } else {
      let mult = 0;
      switch (this.state) {
        case 'WALK': mult = fatigued ? FATIGUE_SPEED : 1; break;
        case 'RUN': mult = RUN_MULT * (this.hasInjury('limp') ? 0.75 : 1); break;
        case 'EXHAUSTED': mult = 0.45; break;
        case 'JUMP': mult = Math.abs(this.vx) / BASE_SPEED; break;
      }
      let targetVx = wantDir * BASE_SPEED * mult * this.speedBonus * this.windSpeedMod;

      // snow depth wading (§M.2): deeper = slower + draining
      if (this.grounded && this.snowDepth > 0 && Math.abs(targetVx) > 5) {
        targetVx *= [1, 0.93, 0.75, 0.55][this.snowDepth] ?? 1;
        this.stamina -= [0, 0.5, 3, 6][this.snowDepth] * dt;
      }
      // slope projection + scramble penalty (§3.3)
      if (this.grounded && targetVx !== 0) {
        const movingUp = Math.sign(targetVx) === ascendDir && absAng > 0.02;
        targetVx *= Math.cos(absAng);
        if (movingUp && tierHere === 'scramble') {
          const grade = (absAng - SCRAMBLE_MIN) / (CLIMB_MIN - SCRAMBLE_MIN);
          targetVx *= 1 - grade * (0.65 / this.climbSkill);
          this.stamina -= SCRAMBLE_DRAIN * grade / this.climbSkill * dt;
        }
        // can't walk up a climb-tier face — push against it instead
        if (movingUp && tierAhead === 'climb') targetVx = 0;
      }

      const control = this.grounded ? 1 : AIR_CONTROL;
      const rate = Math.abs(targetVx) > Math.abs(this.vx) ? ACCEL : DECEL;
      this.vx += clamp(targetVx - this.vx, -rate * control * dt, rate * control * dt);
      this.x += this.vx * dt;
    }
    if (this.x < this.minX) { this.x = this.minX; this.vx = Math.max(0, this.vx); }
    if (this.x > this.maxX) { this.x = this.maxX; this.vx = Math.min(0, this.vx); }

    // ---- jump / gravity / landing ----
    const canJump = this.grounded && this.state !== 'CLIMB' && this.state !== 'SLIDE'
      && this.state !== 'STAGGER' && !this.exhausted
      && !(tierAhead === 'climb' && wantDir === this.facing); // Up starts climb here
    if (input.jumpPressed && canJump && this.stamina > JUMP_COST) {
      this.vy = JUMP_VEL;
      this.grounded = false;
      this._leaveGroundY = this.y;
      this.stamina -= JUMP_COST;
      this._jumpHoldTime = 0;
    }
    if (!this.grounded) {
      if (input.jumpHeld && this._jumpHoldTime < JUMP_HOLD_MAX && this.vy < 0) {
        this.vy += JUMP_HOLD_BOOST * dt;
        this._jumpHoldTime += dt;
      }
      this.vx += this.windValue * 22 * dt;   // wind drifts airborne arcs
      this.vy += GRAVITY * dt;
      this.y += this.vy * dt;
      const g = terrain.groundYAt(this.x);
      // contact with the surface lands regardless of vertical direction —
      // jumping INTO a rising slope means hitting it, not sinking through
      if (this.y >= g) {
        this.y = g;
        this.grounded = true;
        const drop = this.y - this._leaveGroundY;
        if (drop > SAFE_FALL) {                    // fall recovery, not death (§3.3)
          this.staggerTimer = STAGGER_TIME * Math.min(2, drop / SAFE_FALL);
          this.stamina -= FALL_STAM_COST * Math.min(2, drop / SAFE_FALL);
          this.state = 'STAGGER';
          if (drop > SAFE_FALL * 1.6 && Math.random() < 0.6) this.addInjury('limp'); // §12
        }
        this.vy = 0;
      }
    } else {
      const g = terrain.groundYAt(this.x);
      // walked off an edge (ground fell away underfoot)
      if (g - this.y > 26) {
        this.grounded = false;
        this._leaveGroundY = this.y;
        this.vy = 0;
      } else {
        this.y = g;
      }
    }

    // ---- stamina / endurance (§3.1) ----
    const hadStamina = this.stamina > 0.01;
    if (this.state === 'RUN') {
      this.stamina -= RUN_DRAIN * dt;
      this.endurance = clamp(this.endurance - ENDURANCE_DRAIN * dt, 0, ENDURANCE_MAX);
    } else if (this.state === 'WALK' || this.state === 'IDLE'
               || this.state === 'EXHAUSTED' || this.state === 'SLIDE') {
      let regen = STAMINA_REGEN * this._rig.regenMult;      // age curve (§5)
      if (this.hasInjury('bruise')) regen *= 0.6;           // §12
      // EXHAUSTED recovers, slowly. It previously regenerated NOTHING, which
      // made it an absorbing state: once stamina and endurance both hit zero
      // the journey could not continue even by standing still indefinitely.
      if (this.state === 'EXHAUSTED') regen *= 0.35;
      // sliding down is not exertion — recovering here is what lets a player
      // who mistimed a climb try again instead of looping at the foot of it
      if (this.state === 'SLIDE') regen *= 0.5;
      this.stamina += regen * dt;
      if (this.state === 'IDLE' || this.state === 'EXHAUSTED') {
        // endurance is the ceiling on stamina, so it must climb back too or
        // the ceiling stays at zero and the stamina regen above does nothing
        const rate = this.state === 'EXHAUSTED' ? ENDURANCE_REGEN * 1.5 : ENDURANCE_REGEN;
        this.endurance = clamp(this.endurance + rate * dt, 0, ENDURANCE_MAX);
      }
    }
    this.stamina = clamp(this.stamina, 0, this.staminaCeiling);
    if (hadStamina && this.stamina <= 0.01) this.fatigueTimer = FATIGUE_TIME;
    if (this.fatigueTimer > 0) this.fatigueTimer -= dt;

    // combat timers & slow recovery
    if (this.attackCooldown > 0) this.attackCooldown -= dt;
    if (this.swingT > 0) this.swingT -= dt;
    if (this.dodgeT > 0) this.dodgeT -= dt;
    if (this.iframes > 0) this.iframes -= dt;
    if (this.hurtFlash > 0) this.hurtFlash -= dt;
    if (this.health > 0 && this.health < this.maxHealth) {
      this.health = Math.min(this.maxHealth, this.health + 0.6 * dt);
    }
    if (this.maxMana > 0 && this.mana < this.maxMana) {
      this.mana = Math.min(this.maxMana,
        this.mana + (this.classDef?.manaRegen ?? 0) * this._rig.manaRegenMult * dt);
    }
    // age rig refresh + stage transitions (§5)
    this._rig = rigParams(this.ageDays);
    if (this._rig.stage !== this._lastStage) {
      this._lastStage = this._rig.stage;
      bus.emit('ageStageChanged', { stage: this._rig.stage });
    }
    // injuries heal with time — recoverable, never permanent (§12)
    for (let i = this.injuries.length - 1; i >= 0; i--) {
      this.injuries[i].t -= dt;
      if (this.injuries[i].t <= 0) {
        bus.emit('injuryHealed', { kind: this.injuries[i].kind });
        this.injuries.splice(i, 1);
      }
    }

    const animSpeed = this.state === 'CLIMB' ? 0.8 : 1 + Math.abs(this.vx) / BASE_SPEED * 0.5;
    this.animTime += dt * animSpeed;
  }

  // ---- procedural render (interpolated) ----
  render(ctx, alpha) {
    const x = this.prevX + (this.x - this.prevX) * alpha;
    const y = this.prevY + (this.y - this.prevY) * alpha;
    const t = this.animTime;
    const climbing = this.state === 'CLIMB' || this.state === 'SLIDE';
    const moving = Math.abs(this.vx) > 6;
    const speedFrac = clamp(Math.abs(this.vx) / (BASE_SPEED * RUN_MULT), 0, 1);

    const bob = climbing ? 0 : moving ? Math.sin(t * 10) * (1.5 + speedFrac * 2.5) : Math.sin(t * 2) * 0.8;
    let lean;
    if (climbing) {
      // press into the face, aligned toward the slope (§3.3 reach cycle)
      lean = -this.slopeAngle * 0.65;
    } else if (this.state === 'STAGGER') {
      lean = Math.sin(t * 18) * 0.12;
    } else {
      lean = this.grounded
        ? this.facing * speedFrac * 0.22 - this.slopeAngle * 0.25
        : this.facing * 0.1;
    }
    const rig = this._rig;
    const hipY = y - 22 * rig.heightScale + bob * 0.4;

    // ground shadow — world space, before any rig transforms
    if (this.grounded) this._shadowY = y;
    ctx.save();
    ctx.translate(x, this._shadowY ?? y);
    ctx.fillStyle = 'rgba(20, 24, 14, 0.28)';
    ctx.beginPath();
    ctx.ellipse(0, 1, (13 - (this.grounded ? 0 : 5)) * rig.heightScale, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    // §F.1: height scales upward from the ground-contact point only
    ctx.translate(x, y);
    ctx.scale(rig.heightScale, rig.heightScale);
    ctx.translate(-x, -y);
    ctx.translate(x, y - 22 + bob * 0.4 / rig.heightScale);
    ctx.rotate(lean + rig.stoop * this.facing);

    const swing = climbing ? Math.sin(t * 6) : moving ? Math.sin(t * 10) : 0;
    const legA = climbing ? swing * 0.55 : swing * (0.4 + speedFrac * 0.5);
    const airPose = this.grounded ? 0 : (this.vy < 0 ? -0.5 : 0.35);
    const reach = climbing ? 0.9 : 0; // arms stretched toward grips while climbing

    // legs
    ctx.strokeStyle = '#3d4a63';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    for (const s of [1, -1]) {
      const a = legA * s + airPose;
      ctx.beginPath();
      ctx.moveTo(0, 2);
      ctx.lineTo(Math.sin(a) * 11 * this.facing, 2 + Math.cos(a) * 20);
      ctx.stroke();
    }
    // torso (class-tinted once chosen)
    ctx.strokeStyle = this.hurtFlash > 0 ? '#f0f0f0' : (this.classDef?.color ?? '#5a6b8c');
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(0, 3);
    ctx.lineTo(0, -16 - bob * 0.3);
    ctx.stroke();
    // arms — reach alternately up-slope while climbing
    ctx.strokeStyle = '#4d5c7a';
    ctx.lineWidth = 4;
    for (const s of [1, -1]) {
      const a = climbing
        ? -reach - 0.35 * Math.sin(t * 6 + (s > 0 ? 0 : Math.PI)) * 1.1
        : -legA * s * 0.8 + (this.grounded ? 0 : -1.2);
      ctx.beginPath();
      ctx.moveTo(0, -13);
      ctx.lineTo(Math.sin(a) * (9 + reach * 4) * this.facing, -13 + Math.cos(a) * 14);
      ctx.stroke();
    }
    // head — ratio evens out with age (§F.1)
    const hr = 7 * rig.headRel;
    const headX = this.facing * 1.5 + rig.stoop * this.facing * 8;
    const headY = -24 - bob * 0.3;
    ctx.fillStyle = this.hurtFlash > 0 ? '#f5f5f5' : '#e8c49a';
    ctx.beginPath();
    ctx.arc(headX, headY, hr, 0, Math.PI * 2);
    ctx.fill();
    // facial hair — its own layer, greys with age (§F.2)
    if (rig.beardAlpha > 0.02) {
      ctx.globalAlpha = rig.beardAlpha;
      ctx.fillStyle = rig.beardColor;
      ctx.beginPath();
      ctx.arc(headX + this.facing * 0.5, headY + hr * 0.28,
        hr * (0.68 + rig.beardLen * 0.42), Math.PI * 0.12, Math.PI * 0.88);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    // hair — greys alongside the beard (§5/§F.2)
    ctx.fillStyle = rig.hairColor;
    ctx.beginPath();
    ctx.arc(headX - this.facing, headY - 2, hr * 0.93, Math.PI * 0.9, Math.PI * 2.1);
    ctx.fill();

    // snow wading — feet sink to a matching depth (§M.2)
    if (this.snowDepth > 0 && this.grounded) {
      ctx.save();
      ctx.rotate(-(lean + rig.stoop * this.facing));
      ctx.fillStyle = 'rgba(238, 244, 250, 0.85)';
      ctx.beginPath();
      ctx.ellipse(0, 21, 15 + this.snowDepth * 2, 3 + this.snowDepth * 2.4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // fighter swipe arc — brief, readable, not flashy
    if (this.swingT > 0 && this.classDef?.attack === 'swipe') {
      const a = this.swingT / 0.25;
      ctx.strokeStyle = `rgba(230, 226, 214, ${a * 0.7})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, -10, 40, this.facing > 0 ? -1.1 : Math.PI - 0.7, this.facing > 0 ? 0.7 : Math.PI + 1.1);
      ctx.stroke();
    }

    ctx.restore();
  }
}
