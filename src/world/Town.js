// Village/town zone (§8): a non-combat safe hub inside a biome. Entering
// triggers the automatic town checkpoint save (Amendment 01 §A.1) and the
// town music layer (§H.2). Services — Inn, Trainer, Sage, Merchant — are
// walk-up buildings with an interact prompt; flows run through the Dialogue
// choice UI. Weapons are suppressed inside bounds (main enforces).

import { bus } from '../core/EventBus.js';

const NEAR_R = 52;
const TRAIN_COST = { accuracy: 20, fightSpeed: 20, climbSkill: 20, autoDodge: 25 };
const SELL_PRICE = 15;
const SIGNS = { inn: '🛏', trainer: '⚔', sage: '👁', merchant: '⚖', healer: '✚' };
const NAMES = { inn: 'Inn', trainer: 'Trainer', sage: 'Sage', merchant: 'Merchant', healer: 'Healer' };
const CURE_COST = 10;

export class Town {
  constructor(def, terrain, player, dialogue, dayNight) {
    this.def = def;
    this.terrain = terrain;
    this.player = player;
    this.dialogue = dialogue;
    this.dayNight = dayNight;
    this.inTown = false;
    this.nearService = null;
    this._busy = false;
    this._cooldown = 0;
  }

  update(dt, interactPressed) {
    const p = this.player;
    if (this._cooldown > 0) this._cooldown -= dt;

    const inside = p.x >= this.def.west && p.x <= this.def.east;
    if (inside && !this.inTown) {
      this.inTown = true;
      bus.emit('enteredTown', { id: this.def.id });
      bus.emit('checkpointReached', { id: this.def.id });   // §A.1 city autosave
    } else if (!inside && this.inTown) {
      this.inTown = false;
      bus.emit('leftTown', { id: this.def.id });
    }

    this.nearService = null;
    if (inside && !this._busy) {
      for (const s of this.def.services) {
        if (Math.abs(p.x - s.x) < NEAR_R) { this.nearService = s; break; }
      }
    }
    if (this.nearService && interactPressed && !this._busy && this._cooldown <= 0) {
      this._busy = true;
      this._run(this.nearService).finally(() => {
        this._busy = false;
        this._cooldown = 0.45;
      });
    }
  }

  async _run(s) {
    const p = this.player;
    const d = this.dialogue;
    if (s.type === 'inn') {
      const c = await d.ask(
        ["Warm hearth, soft bed. Rest until morning?"],
        ["Rest (free)", "Not now"], { speaker: 'Innkeeper' });
      if (c === 0) {
        p.endurance = 100; p.stamina = 100;
        p.health = p.maxHealth; p.mana = p.maxMana;
        p.injuries = [];                                // proper rest heals (§12)
        const skipped = (0.32 - this.dayNight.phase + 1) % 1;   // sleep advances the age clock too (§5)
        p.ageDays += skipped;
        this.dayNight.phase = 0.32;                     // morning (§8 inn rest)
        bus.emit('forceSave', { id: this.def.id });
        await d.say(["You wake rested. The road east waits."], { autoMs: 2600 });
      }
      return;
    }
    if (s.type === 'trainer') {
      const opts = [
        `Accuracy (+) — ${TRAIN_COST.accuracy}g`,
        `Fight Speed (+) — ${TRAIN_COST.fightSpeed}g`,
        `Climbing (+) — ${TRAIN_COST.climbSkill}g`,
        `Reflexes (+) — ${TRAIN_COST.autoDodge}g`,
      ];
      const c = await d.ask(
        [`You've ${p.gold} gold. What shall we sharpen?`], opts, { speaker: 'Trainer' });
      const key = ['accuracy', 'fightSpeed', 'climbSkill', 'autoDodge'][c];
      const cost = TRAIN_COST[key];
      if (p.gold < cost) {
        await d.say(["Come back when your purse is heavier."], { speaker: 'Trainer', autoMs: 2400 });
        return;
      }
      p.gold -= cost;
      if (key === 'climbSkill') p.climbSkill += 0.2;
      else if (key === 'autoDodge') p.skills.autoDodge += 0.12;
      else p.skills[key] += 0.2;
      bus.emit('upgradeGranted', { tier: 'minor', label: `${NAMES.trainer}: ${key === 'climbSkill' ? 'Climbing' : key === 'autoDodge' ? 'Reflexes' : key === 'fightSpeed' ? 'Fight Speed' : 'Accuracy'} improved` });
      await d.say(["Again tomorrow, and the day after. That's how it sticks."], { speaker: 'Trainer', autoMs: 2600 });
      return;
    }
    if (s.type === 'sage') {
      if (p.artifacts <= 0) {
        await d.say(["Bring me what the road buries, and I'll tell you what it was."], { speaker: 'Sage', autoMs: 2800 });
        return;
      }
      const n = p.artifacts;
      const firstEver = !p._sageStoryTold;
      p.identified += n;
      p.artifacts = 0;
      bus.emit('artifactsIdentified', { count: n });
      if (firstEver) {
        p._sageStoryTold = true;
        await d.say([
          `Old things, road-worn... ${n > 1 ? 'these are' : 'this is'} worth coin to the merchant.`,
          "This one, though — a child's carved horse. Someone's keepsake, dropped in a hurry, heading east.",
        ], { speaker: 'Sage', autoMs: 3400 });
      } else {
        await d.say([`Identified. Worth a fair price at the merchant's scales.`], { speaker: 'Sage', autoMs: 2800 });
      }
      return;
    }
    if (s.type === 'healer') {
      if (p.injuries.length === 0) {
        await d.say(["Sound of limb and clear of eye. The road hasn't marked you yet."], { speaker: 'Healer', autoMs: 2800 });
        return;
      }
      const names = { limp: 'a limp', arm: 'a bad arm', bruise: 'deep bruising', chill: 'a chill' };
      const list = p.injuries.map(i => names[i.kind] ?? i.kind).join(', ');
      const c = await d.ask(
        [`You carry ${list}. It will mend on its own — or I can see to it now.`],
        [`Treat me (${CURE_COST}g)`, 'It can wait'], { speaker: 'Healer' });
      if (c === 0) {
        if (p.gold < CURE_COST) {
          await d.say(["No coin? Then rest well and go gently — time heals for free."], { speaker: 'Healer', autoMs: 3000 });
          return;
        }
        p.gold -= CURE_COST;
        p.injuries = [];
        await d.say(["There. Mind the cliffs, and stay dry in the rain."], { speaker: 'Healer', autoMs: 2800 });
      }
      return;
    }
    if (s.type === 'merchant') {
      if (p.identified <= 0) {
        await d.say(["Nothing to weigh? The sage can name what you've found."], { speaker: 'Merchant', autoMs: 2800 });
        return;
      }
      const total = p.identified * SELL_PRICE;
      const c = await d.ask(
        [`${p.identified} identified relic${p.identified > 1 ? 's' : ''} — I'll give ${total} gold for the lot.`],
        [`Sell all (${total}g)`, 'Not now'], { speaker: 'Merchant' });
      if (c === 0) {
        p.gold += total;
        p.identified = 0;
        bus.emit('goldChanged', {});
      }
    }
  }

  render(ctx, time) {
    const t = this.terrain;
    // gate posts + name at the west entrance
    const gy = t.groundYAt(this.def.west);
    ctx.fillStyle = '#5a4632';
    ctx.fillRect(this.def.west - 4, gy - 58, 8, 58);
    ctx.fillStyle = '#4a3a28';
    ctx.fillRect(this.def.west - 30, gy - 62, 60, 10);
    ctx.fillStyle = '#e8dfc0';
    ctx.font = '10px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(this.def.name, this.def.west, gy - 54);
    ctx.textAlign = 'left';

    for (const s of this.def.services) {
      const y = t.groundYAt(s.x);
      // building
      const w = 88, h = 62;
      ctx.fillStyle = '#6d5b42';
      ctx.fillRect(s.x - w / 2, y - h, w, h);
      ctx.fillStyle = '#4a3a28';
      ctx.beginPath();
      ctx.moveTo(s.x - w / 2 - 9, y - h);
      ctx.lineTo(s.x, y - h - 34);
      ctx.lineTo(s.x + w / 2 + 9, y - h);
      ctx.closePath(); ctx.fill();
      // door + window
      ctx.fillStyle = '#33271a';
      ctx.fillRect(s.x - 11, y - 30, 22, 30);
      ctx.fillStyle = 'rgba(255, 226, 150, 0.55)';
      ctx.fillRect(s.x + 20, y - 46, 14, 12);
      // hanging sign
      const sway = Math.sin(time * 1.5 + s.x) * 0.06;
      ctx.save();
      ctx.translate(s.x - 32, y - h + 6);
      ctx.rotate(sway);
      ctx.strokeStyle = '#8a6f4d';
      ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(0, 4); ctx.stroke();
      ctx.fillStyle = '#8a7a5c';
      ctx.fillRect(-13, 4, 26, 18);
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(SIGNS[s.type] ?? '?', 0, 17);
      ctx.restore();
      ctx.textAlign = 'left';
      // interact prompt when near
      if (this.nearService === s) {
        ctx.font = '12px "Trebuchet MS", sans-serif';
        const label = `E · ${NAMES[s.type]}`;
        const lw = ctx.measureText(label).width + 16;
        ctx.fillStyle = 'rgba(12, 16, 10, 0.62)';
        ctx.beginPath();
        ctx.roundRect(s.x - lw / 2, y - h - 52, lw, 20, 9);
        ctx.fill();
        ctx.fillStyle = 'rgba(240, 236, 214, 0.92)';
        ctx.textAlign = 'center';
        ctx.fillText(label, s.x, y - h - 38);
        ctx.textAlign = 'left';
      }
    }
  }
}
