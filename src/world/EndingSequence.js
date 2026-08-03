// The reunion (§2) — the ending the whole journey points at.
//
// Structure mirrors IntroSequence: position- and timer-driven beats, control
// taken away only briefly. The intro separated the player from their family on
// a collapsing bridge; this closes that loop at the low fires.
//
// Nothing here is fixed text. What is said depends on the state the player
// arrives in — how old they have become, who is standing behind them, and what
// they did on the road. A Child who ran the whole way and an Elder who stopped
// for everyone should not get the same scene.

import { bus } from '../core/EventBus.js';
import { stageName } from '../entities/PlayerRig.js';
import { COMPANIONS } from '../entities/Companion.js';

export const FIRE_X = 6840;          // the last fire, nearest the water
const HALT_X = FIRE_X - 120;         // where the party stops and the player goes on alone

const BEATS = ['APPROACH', 'SEEN', 'MEETING', 'SETTLE', 'EPILOGUE', 'DONE'];

export class EndingSequence {
  constructor(player, terrain, dialogue, camera, journal) {
    this.player = player;
    this.terrain = terrain;
    this.dialogue = dialogue;
    this.camera = camera;
    this.journal = journal;
    this.beat = 'APPROACH';
    this.beatTime = 0;
    this.fade = 0;
    this.glow = 0;
    this.epilogueT = 0;
    this.onComplete = null;
    this._spoke = new Set();
    this._figures = this._buildFigures();
    this.partyHalt = null;           // x where companions stop, set on SEEN
  }

  get active() { return this.beat !== 'DONE'; }
  get holdingParty() { return this.partyHalt !== null; }

  _buildFigures() {
    // Two adults and, if the player is still young, a smaller shape between
    // them — the family as they were is not who is standing here.
    return [
      { dx: -26, h: 1.0, tone: '#5a4a3e' },
      { dx: 6, h: 0.96, tone: '#4a4038' },
    ];
  }

  _speak(key, lines, opts) {
    if (this._spoke.has(key)) return null;
    this._spoke.add(key);
    return this.dialogue.say(lines, opts);
  }

  // --- what the reunion actually says ---------------------------------------

  /**
   * Years on the road, from the aging clock (§5).
   * PlayerRig keyframes run Child at day 0 to Elder at day 20 — a whole life
   * across ~20 in-game days. Reading that as a child of about eight reaching
   * old age puts roughly 2.85 lived years in each in-game day.
   */
  get yearsWalked() {
    return Math.max(1, Math.round((this.player.ageDays ?? 0) * 2.85));
  }

  get stage() { return stageName(this.player.ageDays ?? 0); }

  _openingLines() {
    const st = this.stage;
    if (st === 'Child' || st === 'Youth') {
      return [
        'The figure at the nearest fire straightens, and then goes very still.',
        'She says a name. It is yours, and it is the one used for a child, and you have not heard it spoken aloud since the bridge.',
      ];
    }
    if (st === 'Adult') {
      return [
        'The figure at the nearest fire straightens and looks a long moment at your face.',
        'You watch her work backwards through the years to find the child in it. You can see the moment she does.',
      ];
    }
    if (st === 'Middle-aged') {
      return [
        'The figure at the nearest fire straightens, and stands there holding a bowl she has forgotten about.',
        'She looks at the grey coming in at your temples. She had a child, and what has walked down to her fire is a grown stranger with that child somewhere inside it.',
        'She says your name like a question. You answer it.',
      ];
    }
    return [
      'The figure at the nearest fire straightens slowly, the way people do when they have stood up hopefully many times.',
      'She looks at your grey and your limp and the long road written into you, and she does not recognise you at all.',
      'Then you say her name, the way you said it on the bridge, and she puts her hand over her mouth.',
    ];
  }

  _partyLine() {
    const friends = this.journal.friends();
    if (!friends.length) {
      return 'She looks past you at the empty road, and asks who came with you. You tell her. She does not say anything to that for a while.';
    }
    const names = friends.map((f) => COMPANIONS[f]?.name ?? f);
    const list = names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
    return `She looks past you at ${list}, waiting up the rise where the light stops. Bring them down, she says. There is room at the fire and there has been for eleven days.`;
  }

  _deedLine() {
    const j = this.journal;
    const kindness = Number(j.get('kindness', 0));
    if (j.get('corran') === 'saved' && j.hasFriend('corran')) {
      return 'Corran tells her about the ford, and the night you stayed, and makes it sound like less than it was.';
    }
    if (kindness >= 2) {
      return 'You find you cannot tell her all of it — the boy in the meadow, the man at the ford, the ones you stopped for. It comes out later, in pieces, over months.';
    }
    if (j.get('oath') === 'sworn') {
      return 'You think of the oathstone, and the promise cut into it with a blunt knife, and that you have kept it after all.';
    }
    return 'Neither of you says very much. There is a great deal of time now in which to say it.';
  }

  _closingLine() {
    const cleared = Number(this.journal.get('hordes_cleared', 0));
    const st = this.stage;
    if (st === 'Elder') {
      return 'You sit down at the fire, which is the first thing you have done in years that was not walking east.';
    }
    if (cleared >= 5) {
      return 'Somewhere behind you the road goes on east, and for the first time it is not yours to walk.';
    }
    return 'You sit down at the fire. The water moves past, and nobody asks you to get up.';
  }

  // --- beats ----------------------------------------------------------------

  update(dt) {
    this.beatTime += dt;
    const p = this.player;
    this.glow = Math.min(1, this.glow + dt * 0.4);

    switch (this.beat) {
      case 'APPROACH':
        if (p.x > HALT_X - 220) {
          this._speak('lowfires', [
            'People sit at the low fires in twos and threes, facing the road rather than the water.',
            'They look up when anyone comes down the rise. They have done this many times.',
          ], { autoMs: 3600 });
        }
        if (p.x > HALT_X) {
          this.partyHalt = HALT_X - 40;       // the party stops here; you go on alone
          this._setBeat('SEEN');
        }
        break;

      case 'SEEN':
        this.camera.focusX = (p.x + FIRE_X) / 2;
        this._speak('seen', this._openingLines(), { autoMs: 4200 });
        if (this.beatTime > 1.2 && p.x > FIRE_X - 74) this._setBeat('MEETING');
        break;

      case 'MEETING':
        p.minX = p.x;                          // no walking away from this
        this.camera.focusX = FIRE_X - 10;
        this._speak('meeting', [this._partyLine(), this._deedLine()], { autoMs: 4400 });
        if (this.beatTime > 6) this._setBeat('SETTLE');
        break;

      case 'SETTLE':
        this._speak('settle', [this._closingLine()], { autoMs: 4000 });
        if (this.beatTime > 4.5) {
          bus.emit('journeyComplete', {
            years: this.yearsWalked,
            stage: this.stage,
            party: this.journal.friends(),
          });
          this._setBeat('EPILOGUE');
        }
        break;

      case 'EPILOGUE':
        this.epilogueT = Math.min(1, this.epilogueT + dt * 0.55);
        if (this.epilogueT >= 1 && this.beatTime > 3) {
          this._setBeat('DONE');
          this.onComplete?.();
        }
        break;
    }
  }

  _setBeat(b) { this.beat = b; this.beatTime = 0; }

  // --- render ---------------------------------------------------------------

  renderWorld(ctx) {
    const groundY = this.terrain.groundYAt(FIRE_X);
    const t = performance.now() / 1000;

    // the fire itself
    const flick = 0.85 + Math.sin(t * 7) * 0.1 + Math.sin(t * 11.3) * 0.05;
    const g = ctx.createRadialGradient(FIRE_X, groundY - 16, 4, FIRE_X, groundY - 16, 150 * flick);
    g.addColorStop(0, `rgba(255, 190, 110, ${0.55 * this.glow})`);
    g.addColorStop(0.5, `rgba(220, 130, 60, ${0.18 * this.glow})`);
    g.addColorStop(1, 'rgba(180, 90, 40, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(FIRE_X - 160, groundY - 170, 320, 200);

    ctx.fillStyle = '#3a2a20';
    ctx.beginPath(); ctx.ellipse(FIRE_X, groundY - 2, 22, 6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = `rgba(255, 170, 80, ${0.9 * flick})`;
    ctx.beginPath();
    ctx.moveTo(FIRE_X - 9, groundY - 4);
    ctx.quadraticCurveTo(FIRE_X - 3, groundY - 26 * flick, FIRE_X, groundY - 34 * flick);
    ctx.quadraticCurveTo(FIRE_X + 4, groundY - 24 * flick, FIRE_X + 9, groundY - 4);
    ctx.closePath(); ctx.fill();

    // the figures waiting at it
    for (const f of this._figures) {
      const fx = FIRE_X + f.dx;
      const fy = this.terrain.groundYAt(fx);
      const risen = this.beat !== 'APPROACH';
      const h = f.h * (risen ? 1 : 0.72);      // they were sitting until now
      ctx.save();
      ctx.translate(fx, fy);
      ctx.globalAlpha = 0.28;
      ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.ellipse(0, -1, 12, 4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = f.tone;
      ctx.beginPath();
      ctx.moveTo(-7, -14 * h);
      ctx.quadraticCurveTo(-9, -30 * h, -4, -38 * h);
      ctx.lineTo(4, -38 * h);
      ctx.quadraticCurveTo(9, -30 * h, 7, -14 * h);
      ctx.lineTo(7, 0); ctx.lineTo(-7, 0);
      ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.arc(0, -43 * h, 5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  /** Epilogue card — the record of the road, drawn in screen space. */
  renderOverlay(ctx, camera) {
    if (this.beat !== 'EPILOGUE' && this.beat !== 'DONE') return;
    const a = this.epilogueT;
    const W = ctx.canvas.width, H = ctx.canvas.height;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = `rgba(10, 12, 16, ${0.82 * a})`;
    ctx.fillRect(0, 0, W, H);

    const j = this.journal;
    const friends = j.friends().map((f) => COMPANIONS[f]?.name ?? f);
    const lines = [
      ['EASTWARD', 26, '#e8dcb8'],
      [`${this.yearsWalked} years on the road`, 15, '#c8b894'],
      ['', 8, ''],
      [friends.length
        ? `You did not arrive alone: ${friends.join(', ')}`
        : 'You walked every mile of it alone', 14, '#b8a884'],
    ];
    const cleared = Number(j.get('hordes_cleared', 0));
    if (cleared > 0) lines.push([`${cleared} ${cleared === 1 ? 'horde' : 'hordes'} broken on the way`, 14, '#b8a884']);
    if (Number(j.get('kindness', 0)) > 0) lines.push(['You stopped for people who could not repay you', 14, '#b8a884']);
    if (j.get('oath') === 'sworn') lines.push(['You swore on the oathstone, and you kept it', 14, '#b8a884']);
    lines.push(['', 10, '']);
    lines.push([`You were a ${this.stage.toLowerCase()} when you reached the water`, 13, '#8c8068']);

    let y = H / 2 - (lines.length * 26) / 2;
    ctx.textAlign = 'center';
    for (const [text, size, color] of lines) {
      if (text) {
        ctx.font = `${size}px "Trebuchet MS", sans-serif`;
        ctx.fillStyle = color;
        ctx.globalAlpha = a;          // the card fades in as a whole
        ctx.fillText(text, W / 2, y);
        ctx.globalAlpha = 1;
      }
      y += size + 12;
    }
    ctx.textAlign = 'left';
    ctx.restore();
  }
}
