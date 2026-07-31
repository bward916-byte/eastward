// Encounter framework (§4): Adventures, Interest Items, and Challenges seeded
// per-biome in biomes/*.json. Adventures and Challenges block forward motion
// (geometry-style, via player.maxX) until resolved; Interest Items are
// non-blocking walk-over discoveries. Approaching a blocking encounter emits
// "challengeApproaching" (music tension, camera zoom-in via
// nearestFlaggedDistance); resolution emits "challengePassed". Resolved IDs
// persist in checkpoint worldFlags (Amendment 01 §A.4).

import { bus } from '../core/EventBus.js';
import { clamp } from '../core/utils.js';
import { Creature } from '../entities/Creature.js';

const APPROACH_R = 380;
const PUSH_TIME = 2.4;      // seconds of pushing to clear the fallen tree
const PUSH_DRAIN = 13;      // stamina/s while pushing

export class EncounterManager {
  constructor(defs, terrain, player, dialogue, endX = null) {
    this.endX = endX;
    this.terrain = terrain;
    this.player = player;
    this.dialogue = dialogue;
    this.encounters = (defs ?? []).map(d => ({
      ...d,
      y: terrain.groundYAt(d.x),
      resolved: false,
      progress: 0,        // challenge push progress
      _dialogueOpen: false,
      sparkle: 0,
    }));
    this._tension = false;
    this._combat = false;
    this.creatures = [];
    this.onClassChosen = null;   // main provides (classId) => void
    this.onBranchChosen = null;  // main provides (biomeId) => void (§C multi-path)
  }

  getFlags() { return this.encounters.filter(e => e.resolved).map(e => e.id); }
  applyFlags(ids = []) {
    for (const e of this.encounters) if (ids.includes(e.id)) e.resolved = true;
  }

  nearestFlaggedDistance(x) {
    let min = Infinity;
    for (const e of this.encounters) {
      if (!e.resolved) min = Math.min(min, Math.abs(e.x - x));
    }
    return min;
  }

  update(dt, input) {
    const p = this.player;
    let maxX = this.endX ?? Infinity;   // the journey's current edge
    let anyNear = false;

    for (const e of this.encounters) {
      if (e.sparkle > 0) e.sparkle -= dt;
      if (e.resolved) continue;
      const dist = e.x - p.x;

      if (Math.abs(dist) < APPROACH_R && (e.type === 'adventure' || e.type === 'challenge')) {
        anyNear = true;
      }

      if (e.type === 'creature') {
        if (!e.spawned && Math.abs(dist) < 620) {
          e.spawned = true;
          e.pack = [];
          for (let i = 0; i < (e.count ?? 1); i++) {
            const c = new Creature(e.kind ?? 'wolf', e.x + i * 48, this.terrain);
            e.pack.push(c);
            this.creatures.push(c);
          }
        }
        if (e.spawned && e.pack.every(c => c.dead)) {
          e.resolved = true;
          e.sparkle = 1;
          bus.emit('challengePassed', { id: e.id });
        }
        if (!e.resolved && dist > 0 && e.blocking !== false) maxX = Math.min(maxX, e.x - 42);
        e._showAttackHint = e.spawned && !e.resolved && Math.abs(dist) < 320;
        continue;
      }

      if (e.type === 'branch') {
        if (!e.resolved && dist > 0) maxX = Math.min(maxX, e.x - 46);
        if (!e._dialogueOpen && dist > 0 && dist < 80) {
          e._dialogueOpen = true;
          this._runBranch(e);
        }
        continue;
      }

      if (e.type === 'lock') {
        if (!e.resolved && Math.abs(dist) < 44 && input.interactPressed && !e._dialogueOpen) {
          e._dialogueOpen = true;
          this._runLock(e).finally(() => { e._dialogueOpen = false; });
        }
        continue;
      }

      if (e.type === 'rite' && !e._dialogueOpen && dist > 0 && dist < 80) {
        e._dialogueOpen = true;
        this._runRite(e);
      }
      if (e.type === 'rite') {
        if (!e.resolved && dist > 0) maxX = Math.min(maxX, e.x - 46);
        continue;
      }

      if (e.type === 'interest') {
        if (Math.abs(dist) < 26) {
          e.resolved = true;
          e.sparkle = 1.2;
          p.artifacts += e.reward?.artifacts ?? 1;   // route-reward caches (§C.2)
          if (e.reward?.gold) p.gold += e.reward.gold;
          bus.emit('interestCollected', { id: e.id });
        }
        continue;
      }

      // blocking encounters: stand in the path (§4)
      if (dist > 0) maxX = Math.min(maxX, e.x - 42);

      if (e.type === 'adventure' && !e._dialogueOpen && dist > 0 && dist < 70) {
        e._dialogueOpen = true;
        this._runAdventure(e);
      }

      if (e.type === 'challenge' && (e.kind === 'push' || e.kind === 'boulder')) {
        if (e.kind === 'boulder' && e._need == null) {
          // §C.2: Wizard telekinesis (mana), Fighter strength, others patience
          if (p.classId === 'wizard' && p.mana >= 15) { e._need = 0.9; e._tk = true; p.mana -= 15; }
          else if (p.classId === 'fighter') e._need = 2.0;
          else e._need = 3.2;
        }
        const need = e.kind === 'boulder' ? e._need ?? 3.2 : PUSH_TIME;
        const pushing = dist > 0 && dist < 60 && input.moveDir === 1 && p.grounded && p.stamina > 2;
        if (pushing) {
          e.progress += dt;
          if (!e._tk) p.stamina -= PUSH_DRAIN * dt;
          if (e.progress >= need) {
            e.resolved = true;
            e.sparkle = 1;
            bus.emit('challengePassed', { id: e.id });
          }
        } else if (e.progress > 0) {
          e.progress = Math.max(0, e.progress - dt * 0.6); // it settles back
        }
        e._needCache = need;
      }
    }

    if (!this._introScene) p.maxX = maxX;

    // creatures live update + combat state (drives music layer, §H.2)
    for (const c of this.creatures) c.update(dt, p);
    const fighting = this.creatures.some(c => c.engaged);
    if (fighting && !this._combat) { this._combat = true; bus.emit('combatStarted'); }
    else if (!fighting && this._combat) { this._combat = false; bus.emit('combatEnded'); }

    // tension layer on approach, off when clear (§H.2 wiring)
    if (anyNear && !this._tension) { this._tension = true; bus.emit('challengeApproaching'); }
    else if (!anyNear && this._tension) { this._tension = false; bus.emit('challengePassed', { id: null }); }
  }

  async _runBranch(e) {
    const idx = await this.dialogue.ask(e.lines, e.choices, { speaker: e.speaker ?? '' });
    e.resolved = true;
    bus.emit('branchChosen', { route: e.routes[idx] });
    this.onBranchChosen?.(e.routes[idx]);
  }

  async _runLock(e) {
    const p = this.player;
    if (p.classId === 'thief') {
      e.resolved = true;
      e.sparkle = 1.2;
      p.artifacts += e.reward?.artifacts ?? 1;
      if (e.reward?.gold) p.gold += e.reward.gold;
      bus.emit('interestCollected', { id: e.id });
      await this.dialogue.say(["The lock gives with a soft click. Quick hands earn quiet rewards."], { autoMs: 3000 });
    } else if (Math.random() < 0.3) {
      e.resolved = true;
      e.sparkle = 1.2;
      p.artifacts += e.reward?.artifacts ?? 1;
      if (e.reward?.gold) p.gold += e.reward.gold;
      bus.emit('interestCollected', { id: e.id });
      await this.dialogue.say(["Clumsy work — but the old lock finally gives."], { autoMs: 3000 });
    } else {
      await this.dialogue.say(["The lock resists. A defter hand would make short work of it."], { autoMs: 2800 });
    }
  }

  async _runRite(e) {
    const idx = await this.dialogue.ask(
      e.lines ?? ['Choose your path.'],
      e.choices ?? ['Thief', 'Wizard', 'Fighter'],
      { speaker: e.speaker ?? 'Elder' }
    );
    const classId = (e.classIds ?? ['thief', 'wizard', 'fighter'])[idx];
    e.resolved = true;
    this.onClassChosen?.(classId);
    if (e.responses?.[idx]) {
      await this.dialogue.say([e.responses[idx]], { speaker: e.speaker ?? 'Elder', autoMs: 3600 });
    }
    bus.emit('riteCompleted', { classId });
    bus.emit('challengePassed', { id: e.id });
  }

  async _runAdventure(e) {
    const choice = await this.dialogue.ask(
      e.lines ?? ['...'],
      e.choices ?? ['Continue'],
      { speaker: e.speaker ?? '' }
    );
    e.resolved = true;
    e.choice = choice;
    if (e.responses?.[choice]) {
      await this.dialogue.say([e.responses[choice]], { speaker: e.speaker ?? '', autoMs: 3400 });
    }
    bus.emit('adventureResolved', { id: e.id, choice });
    bus.emit('challengePassed', { id: e.id });
  }

  render(ctx, time) {
    for (const e of this.encounters) {
      if (e.type === 'adventure') this._renderNPC(ctx, e, time);
      else if (e.type === 'branch') this._renderBranch(ctx, e, time);
      else if (e.type === 'lock') this._renderVault(ctx, e, time);
      else if (e.type === 'rite') this._renderRite(ctx, e, time);
      else if (e.type === 'creature' && e._showAttackHint) {
        const hx = e.x, hy = this.terrain.groundYAt(e.x) - 92;
        ctx.font = '13px "Trebuchet MS", sans-serif';
        const label = 'X / ⚔ to attack';
        const w = ctx.measureText(label).width + 18;
        ctx.fillStyle = 'rgba(12, 16, 10, 0.62)';
        ctx.beginPath(); ctx.roundRect(hx - w / 2, hy - 13, w, 22, 10); ctx.fill();
        ctx.fillStyle = 'rgba(240, 236, 214, 0.92)';
        ctx.textAlign = 'center';
        ctx.fillText(label, hx, hy + 3);
        ctx.textAlign = 'left';
      }
      else if (e.type === 'interest') this._renderInterest(ctx, e, time);
      else if (e.type === 'challenge') this._renderTree(ctx, e, time);
      if (e.sparkle > 0) this._renderSparkle(ctx, e, time);
    }
    for (const c of this.creatures) c.render(ctx);
    if (this.endX != null) this._renderEdge(ctx, time);
  }

  _renderEdge(ctx, time) {
    const x = this.endX + 30;
    const y = this.terrain.groundYAt(x);
    // wayside signpost pointing east
    ctx.fillStyle = '#5a4632';
    ctx.fillRect(x - 3, y - 46, 6, 46);
    ctx.fillStyle = '#6d5b42';
    ctx.beginPath();
    ctx.moveTo(x - 6, y - 46); ctx.lineTo(x + 30, y - 46);
    ctx.lineTo(x + 38, y - 39); ctx.lineTo(x + 30, y - 32); ctx.lineTo(x - 6, y - 32);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = `rgba(240, 236, 214, ${0.7 + Math.sin(time * 2) * 0.15})`;
    ctx.font = '12px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('The pass lies ahead — the road continues soon…', x, y - 60);
    ctx.textAlign = 'left';
  }

  _renderRite(ctx, e, time) {
    const x = e.x, y = e.y;
    // village edge: two huts behind the elder
    for (const [ox, w, hh] of [[70, 74, 52], [170, 60, 44]]) {
      const hx = x + ox, hy = this.terrain.groundYAt(x + ox);
      ctx.fillStyle = '#6d5b42';
      ctx.fillRect(hx - w / 2, hy - hh, w, hh);
      ctx.fillStyle = '#4a3a28';
      ctx.beginPath();
      ctx.moveTo(hx - w / 2 - 8, hy - hh);
      ctx.lineTo(hx, hy - hh - 30);
      ctx.lineTo(hx + w / 2 + 8, hy - hh);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#33271a';
      ctx.fillRect(hx - 9, hy - 26, 18, 26);
    }
    // the elder
    const bob = Math.sin(time * 1.6) * 0.7;
    ctx.save();
    ctx.translate(x, y - 27 + bob * 0.3);
    ctx.strokeStyle = '#7a6a4e';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(12, 27); ctx.lineTo(14, -18); ctx.stroke();
    ctx.fillStyle = '#8a8272';
    ctx.beginPath();
    ctx.moveTo(0, -19);
    ctx.quadraticCurveTo(-12, 6, -9, 27);
    ctx.lineTo(9, 27);
    ctx.quadraticCurveTo(12, 6, 0, -19);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#d8c4a4';
    ctx.beginPath(); ctx.arc(-1, -23, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e8e4d8';   // white hair
    ctx.beginPath(); ctx.arc(-2, -26, 6, Math.PI * 0.8, Math.PI * 2.05); ctx.fill();
    ctx.restore();
  }

  _renderNPC(ctx, e, time) {
    if (e.resolved && e.walkedOff) return;
    const bob = Math.sin(time * 2 + 1) * 0.8;
    const x = e.x, y = e.y;
    ctx.save();
    ctx.translate(x, y - 26 + bob * 0.3);
    // walking staff
    ctx.strokeStyle = '#6a5236';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-11, 26); ctx.lineTo(-13, -14); ctx.stroke();
    // tunic
    ctx.fillStyle = '#7a5f43';
    ctx.beginPath();
    ctx.moveTo(0, -18);
    ctx.quadraticCurveTo(-11, 4, -8, 24);
    ctx.lineTo(8, 24);
    ctx.quadraticCurveTo(11, 4, 0, -18);
    ctx.closePath(); ctx.fill();
    // head + hood
    ctx.fillStyle = '#d8b48e';
    ctx.beginPath(); ctx.arc(-1, -22, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#8a6f4d';
    ctx.beginPath(); ctx.arc(0, -24, 7, Math.PI * 0.85, Math.PI * 2.15); ctx.fill();
    ctx.restore();
    if (!e.resolved) {
      // quiet presence marker
      ctx.fillStyle = `rgba(216, 201, 138, ${0.5 + Math.sin(time * 3) * 0.25})`;
      ctx.font = '13px "Trebuchet MS", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('…', x, y - 62 + bob);
      ctx.textAlign = 'left';
    }
  }

  _renderInterest(ctx, e, time) {
    if (e.resolved) return;
    const x = e.x, y = e.y;
    // half-buried relic
    ctx.fillStyle = '#8a8272';
    ctx.beginPath();
    ctx.moveTo(x - 7, y);
    ctx.lineTo(x - 3, y - 11);
    ctx.lineTo(x + 5, y - 8);
    ctx.lineTo(x + 8, y);
    ctx.closePath(); ctx.fill();
    // glint (§4: visually flagged)
    const g = 0.5 + Math.sin(time * 4 + e.x) * 0.5;
    ctx.strokeStyle = `rgba(255, 240, 190, ${0.35 + g * 0.5})`;
    ctx.lineWidth = 1.5;
    const gy = y - 16 - g * 4;
    ctx.beginPath();
    ctx.moveTo(x, gy - 5); ctx.lineTo(x, gy + 5);
    ctx.moveTo(x - 5, gy); ctx.lineTo(x + 5, gy);
    ctx.stroke();
  }

  _renderBranch(ctx, e, time) {
    const x = e.x, y = e.y;
    // weathered double-marker: one arm up-slope, one to the dark
    ctx.fillStyle = '#6a6458';
    ctx.fillRect(x - 4, y - 62, 8, 62);
    ctx.save();
    ctx.translate(x, y - 54); ctx.rotate(-0.5);
    ctx.fillStyle = '#7a746a'; ctx.fillRect(0, -5, 34, 10);
    ctx.restore();
    ctx.save();
    ctx.translate(x, y - 36); ctx.rotate(0.35);
    ctx.fillStyle = '#5a5464'; ctx.fillRect(0, -5, 34, 10);
    ctx.restore();
  }

  _renderVault(ctx, e, time) {
    const x = e.x, y = e.y;
    ctx.fillStyle = '#3a4050';
    ctx.beginPath();
    ctx.moveTo(x - 22, y); ctx.lineTo(x - 16, y - 34); ctx.lineTo(x + 16, y - 34); ctx.lineTo(x + 22, y);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = e.resolved ? '#1a2030' : '#565e70';
    ctx.fillRect(x - 10, y - 26, 20, 26);
    if (!e.resolved) {
      ctx.fillStyle = '#c9a94a';
      ctx.beginPath(); ctx.arc(x, y - 13, 3.2, 0, Math.PI * 2); ctx.fill();
      const g = 0.5 + Math.sin(time * 3 + e.x) * 0.4;
      ctx.fillStyle = `rgba(240, 236, 214, ${0.5 + g * 0.3})`;
      ctx.font = '11px "Trebuchet MS", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('E · sealed vault', x, y - 46);
      ctx.textAlign = 'left';
    }
  }

  _renderTree(ctx, e, time) {
    const x = e.x, y = e.y;
    const need = e._needCache ?? PUSH_TIME;
    const t = e.resolved ? 1 : clamp(e.progress / need, 0, 1);
    if (e.kind === 'boulder') {
      ctx.save();
      ctx.translate(x + t * 46, y);
      ctx.rotate(t * 2.4);
      ctx.fillStyle = e._tk && !e.resolved ? '#6a7a9c' : '#5a6068';
      ctx.strokeStyle = '#3e444c';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-20, 0); ctx.lineTo(-14, -30); ctx.lineTo(4, -36); ctx.lineTo(19, -22); ctx.lineTo(21, 0);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      if (e._tk && !e.resolved) {
        ctx.strokeStyle = `rgba(150, 180, 255, ${0.5 + Math.sin(time * 8) * 0.3})`;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, -18, 28, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
      if (!e.resolved && e.progress > 0.05) {
        ctx.fillStyle = 'rgba(12, 16, 10, 0.55)';
        ctx.fillRect(x - 24, y - 56, 48, 6);
        ctx.fillStyle = e._tk ? '#7a9ae0' : '#e0b23c';
        ctx.fillRect(x - 23, y - 55, 46 * t, 4);
      }
      return;
    }
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-0.12 - t * 1.15);      // pushes up and over as progress builds
    ctx.fillStyle = '#4d3b26';
    ctx.strokeStyle = '#33271a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(-9, -74, 18, 76, 7);
    ctx.fill(); ctx.stroke();
    // broken branch stubs
    ctx.strokeStyle = '#4d3b26';
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(4, -50); ctx.lineTo(16, -58); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-4, -30); ctx.lineTo(-15, -34); ctx.stroke();
    ctx.restore();
    if (!e.resolved && e.progress > 0.05) {
      // effort meter above (ground-anchored, minimal)
      ctx.fillStyle = 'rgba(12, 16, 10, 0.55)';
      ctx.fillRect(x - 24, y - 96, 48, 6);
      ctx.fillStyle = '#e0b23c';
      ctx.fillRect(x - 23, y - 95, 46 * t, 4);
    }
  }

  _renderSparkle(ctx, e, time) {
    const a = clamp(e.sparkle, 0, 1);
    ctx.strokeStyle = `rgba(255, 240, 190, ${a * 0.8})`;
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 5; i++) {
      const ang = (i / 5) * Math.PI * 2 + time;
      const r = 14 + (1 - a) * 26;
      const px = e.x + Math.cos(ang) * r;
      const py = e.y - 14 + Math.sin(ang) * r * 0.7;
      ctx.beginPath();
      ctx.moveTo(px - 2, py); ctx.lineTo(px + 2, py);
      ctx.stroke();
    }
  }
}
