// Player: locomotion state machine (Idle/Walk/Run/Sprint/Jump/Exhausted) and
// the two-resource Stamina/Endurance model (§3.1). Rendering is procedural
// (simple articulated figure) — sprite rigs and age stages arrive in Phase 8.

import { clamp, damp } from '../core/utils.js';

// --- tunables -------------------------------------------------------------
const BASE_SPEED   = 150;      // px/s at Walk (1x)
const RUN_MULT     = 2.0;
const SPRINT_MULT  = 3.2;
const RUN_THRESHOLD = 0.3;     // hold seconds before Walk promotes to Run
const ACCEL        = 900;      // ground acceleration px/s^2
const DECEL        = 1100;

const GRAVITY      = 1500;
const JUMP_VEL     = -420;
const JUMP_HOLD_BOOST = -900;  // extra accel while Up held early in the jump
const JUMP_HOLD_MAX   = 0.22;  // seconds of variable-height boost
const AIR_CONTROL  = 0.45;

// stamina (short-term) / endurance (long-term ceiling) — §3.1
const STAMINA_MAX      = 100;
const ENDURANCE_MAX    = 100;
const RUN_DRAIN        = 6;    // stamina/s
const SPRINT_DRAIN     = 26;
const JUMP_COST        = 5;
const STAMINA_REGEN    = 18;   // while Walk/Idle
const ENDURANCE_DRAIN  = 0.9;  // slow conditioning wear while sprinting
const ENDURANCE_REGEN  = 0.35; // trickle while idle (proper rest comes in Phase 7)
const FATIGUE_TIME     = 2.5;  // forced-walk debuff after emptying stamina (§3.1)
const FATIGUE_SPEED    = 0.6;

export class Player {
  constructor(x, groundY) {
    this.x = x;
    this.y = groundY;          // feet position
    this.prevX = x; this.prevY = this.y;
    this.vx = 0;
    this.vy = 0;
    this.facing = 1;
    this.grounded = true;

    this.state = 'IDLE';
    this.stamina = STAMINA_MAX;
    this.endurance = ENDURANCE_MAX;
    this.fatigueTimer = 0;
    this._jumpHoldTime = 0;

    // §3.6 permanent progression hooks (training/equipment fill these later)
    this.speedBonus = 1.0;
    // §13.3 live wind modifier hook (WeatherSystem fills this in Phase 4)
    this.windSpeedMod = 1.0;

    this.animTime = 0;
    this.height = 52;
    this.width = 20;
  }

  get staminaCeiling() { return (this.endurance / ENDURANCE_MAX) * STAMINA_MAX; }
  get exhausted() { return this.state === 'EXHAUSTED'; }

  update(dt, input, terrain) {
    this.prevX = this.x; this.prevY = this.y;

    // ---- resolve locomotion state from intents ----
    const wantDir = input.moveDir;
    if (wantDir !== 0) this.facing = wantDir;

    let targetState = this.state;
    const fatigued = this.fatigueTimer > 0;

    if (!this.grounded) {
      targetState = 'JUMP';
    } else if (this.stamina <= 0.01 && this.endurance <= 0.01) {
      targetState = 'EXHAUSTED';                       // §3.5 stumbling walk
    } else if (wantDir === 0) {
      targetState = 'IDLE';
    } else if (fatigued) {
      targetState = 'WALK';                            // stamina emptied → forced walk
    } else if (input.sprintMod && this.stamina > 0.01) {
      targetState = 'SPRINT';
    } else if (input.holdDuration > RUN_THRESHOLD && this.stamina > 0.01) {
      targetState = 'RUN';
    } else {
      targetState = 'WALK';
    }
    this.state = targetState;

    // ---- speed for state ----
    let mult = 0;
    switch (this.state) {
      case 'WALK':      mult = fatigued ? FATIGUE_SPEED : 1; break;
      case 'RUN':       mult = RUN_MULT; break;
      case 'SPRINT':    mult = SPRINT_MULT; break;
      case 'EXHAUSTED': mult = 0.45; break;
      case 'JUMP':      mult = Math.abs(this.vx) / BASE_SPEED; break;
      default:          mult = 0;
    }
    const targetVx = wantDir * BASE_SPEED * mult * this.speedBonus * this.windSpeedMod;

    // ---- horizontal integration ----
    const control = this.grounded ? 1 : AIR_CONTROL;
    const rate = Math.abs(targetVx) > Math.abs(this.vx) ? ACCEL : DECEL;
    const dv = clamp(targetVx - this.vx, -rate * control * dt, rate * control * dt);
    this.vx += dv;
    this.x += this.vx * dt;
    if (this.x < 40) { this.x = 40; this.vx = Math.max(0, this.vx); }

    // ---- jump / gravity ----
    if (input.jumpPressed && this.grounded && this.stamina > JUMP_COST && !this.exhausted) {
      this.vy = JUMP_VEL;
      this.grounded = false;
      this.stamina -= JUMP_COST;
      this._jumpHoldTime = 0;
    }
    if (!this.grounded) {
      if (input.jumpHeld && this._jumpHoldTime < JUMP_HOLD_MAX && this.vy < 0) {
        this.vy += JUMP_HOLD_BOOST * dt;               // variable jump height (§3.1)
        this._jumpHoldTime += dt;
      }
      this.vy += GRAVITY * dt;
      this.y += this.vy * dt;
      const g = terrain.groundYAt(this.x);
      if (this.y >= g && this.vy >= 0) {
        this.y = g;
        this.vy = 0;
        this.grounded = true;
      }
    } else {
      this.y = terrain.groundYAt(this.x);
    }

    // ---- stamina / endurance model (§3.1) ----
    const hadStamina = this.stamina > 0.01;
    if (this.state === 'SPRINT') {
      this.stamina -= SPRINT_DRAIN * dt;
      this.endurance = clamp(this.endurance - ENDURANCE_DRAIN * dt, 0, ENDURANCE_MAX);
    } else if (this.state === 'RUN') {
      this.stamina -= RUN_DRAIN * dt;
    } else if (this.state === 'WALK' || this.state === 'IDLE') {
      this.stamina += STAMINA_REGEN * dt;
      if (this.state === 'IDLE') {
        this.endurance = clamp(this.endurance + ENDURANCE_REGEN * dt, 0, ENDURANCE_MAX);
      }
    }
    this.stamina = clamp(this.stamina, 0, this.staminaCeiling); // endurance caps stamina
    if (hadStamina && this.stamina <= 0.01) this.fatigueTimer = FATIGUE_TIME;
    if (this.fatigueTimer > 0) this.fatigueTimer -= dt;

    this.animTime += dt * (1 + mult * 0.6);
  }

  // ---- procedural render (interpolated) ----
  render(ctx, alpha) {
    const x = this.prevX + (this.x - this.prevX) * alpha;
    const y = this.prevY + (this.y - this.prevY) * alpha;
    const t = this.animTime;
    const moving = Math.abs(this.vx) > 6;
    const speedFrac = clamp(Math.abs(this.vx) / (BASE_SPEED * SPRINT_MULT), 0, 1);

    const bob = moving ? Math.sin(t * 10) * (1.5 + speedFrac * 2.5) : Math.sin(t * 2) * 0.8;
    const lean = this.grounded ? this.facing * speedFrac * 0.22 : this.facing * 0.1;
    const hipY = y - 22 + bob * 0.4;

    ctx.save();
    ctx.translate(x, hipY);
    ctx.rotate(lean);

    // shadow
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.translate(x, this._groundShadowY ?? y);
    ctx.fillStyle = 'rgba(20, 24, 14, 0.28)';
    ctx.beginPath();
    ctx.ellipse(0, 1, 13 - (this.grounded ? 0 : 5), 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    const swing = moving ? Math.sin(t * 10) : 0;
    const legA = swing * (0.4 + speedFrac * 0.5);
    const airPose = this.grounded ? 0 : (this.vy < 0 ? -0.5 : 0.35);

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
    // arms
    ctx.strokeStyle = '#4d5c7a';
    ctx.lineWidth = 4;
    for (const s of [1, -1]) {
      const a = -legA * s * 0.8 + (this.grounded ? 0 : -1.2);
      ctx.beginPath();
      ctx.moveTo(0, -13);
      ctx.lineTo(Math.sin(a) * 9 * this.facing, -13 + Math.cos(a) * 14);
      ctx.stroke();
    }
    // head
    ctx.fillStyle = '#e8c49a';
    ctx.beginPath();
    ctx.arc(this.facing * 1.5, -24 - bob * 0.3, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#6b4a2f'; // hair
    ctx.beginPath();
    ctx.arc(this.facing * 0.5, -26 - bob * 0.3, 6.5, Math.PI * 0.9, Math.PI * 2.1);
    ctx.fill();

    ctx.restore();
    this._groundShadowY = this.grounded ? y : this._groundShadowY;
  }
}
