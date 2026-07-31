// Player: locomotion state machine and Stamina/Endurance model (§3.1), now with
// Phase 2 slope handling (§3.3): uphill penalties, scramble drain, the CLIMB
// state (hold Up against a 45–80° face), SLIDE on slips/release, and
// fall-recovery STAGGER (minor cost, never instant death). Rendering is
// procedural; sprite rigs and age stages arrive in Phase 8.

import { clamp } from '../core/utils.js';
import { SCRAMBLE_MIN, CLIMB_MIN } from '../world/TerrainSpline.js';

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

    this.state = 'IDLE';
    this.stamina = STAMINA_MAX;
    this.endurance = ENDURANCE_MAX;
    this.fatigueTimer = 0;
    this.staggerTimer = 0;
    this._jumpHoldTime = 0;
    this._leaveGroundY = groundY;

    // §7 Climbing skill (1 = untrained). Trainer raises this in Phase 6/7:
    // higher = faster climb, less drain, (later) higher max angle & grip.
    this.climbSkill = 1.0;
    // §3.6 permanent progression + §13.3 wind hooks (later phases fill these)
    this.speedBonus = 1.0;
    this.windSpeedMod = 1.0;

    this.animTime = 0;
    this.slopeAngle = 0;       // signed, cached for render lean
  }

  get staminaCeiling() { return (this.endurance / ENDURANCE_MAX) * STAMINA_MAX; }
  get exhausted() { return this.state === 'EXHAUSTED'; }

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

    // ---- state resolution ----
    if (this.staggerTimer > 0) {
      this.state = 'STAGGER';
    } else if (!this.grounded) {
      this.state = 'JUMP';
    } else if (this.state === 'CLIMB') {
      const holding = input.jumpHeld && wantDir === ascendDir;
      const faceAhead = terrain.tierAt(this.x + ascendDir * 16) === 'climb';
      if (absAng < CLIMB_MIN && !faceAhead) this.state = 'WALK'; // truly topped out
      else if (!holding || this.stamina <= 0.01) this.state = 'SLIDE'; // slip (§3.3)
    } else if (tierHere === 'climb') {
      const wantClimb = input.jumpHeld && wantDir === ascendDir;
      this.state = (wantClimb && this.stamina > 1) ? 'CLIMB' : 'SLIDE';
    } else if (this.state === 'SLIDE') {
      this.state = 'WALK';                                   // slid onto safe ground
    } else if (this.stamina <= 0.01 && this.endurance <= 0.01) {
      this.state = 'EXHAUSTED';
    } else if (wantDir === 0) {
      this.state = 'IDLE';
    } else if (fatigued) {
      this.state = 'WALK';
    } else if (input.holdDuration > RUN_THRESHOLD && this.stamina > 0.01) {
      this.state = 'RUN';
    } else {
      this.state = 'WALK';
    }

    // ---- entering a climb face from below: hold Up + direction to start ----
    if ((this.state === 'WALK' || this.state === 'RUN' || this.state === 'IDLE')
        && tierAhead === 'climb' && this.grounded) {
      const faceAscends = terrain.slopeAt(this.x + this.facing * 14) * this.facing > 0;
      if (faceAscends && input.jumpHeld && wantDir === this.facing && this.stamina > 1) {
        this.state = 'CLIMB';
      }
    }

    // ---- movement per state ----
    if (this.state === 'CLIMB') {
      const grade = clamp((absAng - CLIMB_MIN) / (Math.PI / 2 - CLIMB_MIN), 0, 1);
      const speed = CLIMB_SPEED * this.climbSkill * (1 - grade * 0.45);
      this.vx = ascendDir * speed * Math.cos(absAng);
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
        case 'RUN': mult = RUN_MULT; break;
        case 'EXHAUSTED': mult = 0.45; break;
        case 'JUMP': mult = Math.abs(this.vx) / BASE_SPEED; break;
      }
      let targetVx = wantDir * BASE_SPEED * mult * this.speedBonus * this.windSpeedMod;

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
    if (this.x < 40) { this.x = 40; this.vx = Math.max(0, this.vx); }

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
      this.vy += GRAVITY * dt;
      this.y += this.vy * dt;
      const g = terrain.groundYAt(this.x);
      if (this.y >= g && this.vy >= 0) {
        this.y = g;
        this.grounded = true;
        const drop = this.y - this._leaveGroundY;
        if (drop > SAFE_FALL) {                    // fall recovery, not death (§3.3)
          this.staggerTimer = STAGGER_TIME * Math.min(2, drop / SAFE_FALL);
          this.stamina -= FALL_STAM_COST * Math.min(2, drop / SAFE_FALL);
          this.state = 'STAGGER';
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
    } else if (this.state === 'WALK' || this.state === 'IDLE') {
      this.stamina += STAMINA_REGEN * dt;
      if (this.state === 'IDLE') {
        this.endurance = clamp(this.endurance + ENDURANCE_REGEN * dt, 0, ENDURANCE_MAX);
      }
    }
    this.stamina = clamp(this.stamina, 0, this.staminaCeiling);
    if (hadStamina && this.stamina <= 0.01) this.fatigueTimer = FATIGUE_TIME;
    if (this.fatigueTimer > 0) this.fatigueTimer -= dt;

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
    const hipY = y - 22 + bob * 0.4;

    ctx.save();
    ctx.translate(x, hipY);
    ctx.rotate(lean);

    // shadow
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.translate(x, this.grounded ? y : (this._shadowY ?? y));
    ctx.fillStyle = 'rgba(20, 24, 14, 0.28)';
    ctx.beginPath();
    ctx.ellipse(0, 1, 13 - (this.grounded ? 0 : 5), 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    if (this.grounded) this._shadowY = y;

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
    // torso
    ctx.strokeStyle = '#5a6b8c';
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
    // head
    ctx.fillStyle = '#e8c49a';
    ctx.beginPath();
    ctx.arc(this.facing * 1.5, -24 - bob * 0.3, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#6b4a2f';
    ctx.beginPath();
    ctx.arc(this.facing * 0.5, -26 - bob * 0.3, 6.5, Math.PI * 0.9, Math.PI * 2.1);
    ctx.fill();

    ctx.restore();
  }
}
