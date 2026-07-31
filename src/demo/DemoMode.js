// Demo mode: a scripted autopilot tour of every major system, launched from
// an in-game button (hideable via the SHOW_DEMO flag in main). While active:
// checkpoint saves are suspended, input is script-driven, and each stop
// teleports to a curated scene with a caption. Exiting restores the player's
// last checkpoint. Content-only module — no gameplay system knows about it.

const RUN = { moveDir: 1, jumpPressed: false, jumpHeld: false, interactPressed: false, attackPressed: false, crouch: false };
const IDLE = { ...RUN, moveDir: 0 };

const STOPS = [
  {
    caption: 'EASTWARD — the feature tour. (You resume right where you left off.) Walk · Run · Jump.',
    biome: 'meadow', x: 300, duration: 11,
    script: (t) => (Math.floor(t * 1.1) % 4 === 3 && (t % 1) < 0.05)
      ? { ...RUN, jumpPressed: true, jumpHeld: true } : RUN,
  },
  {
    caption: 'Terrain has tiers — walkable, scramble, and true climbing. Hold on, and up.',
    biome: 'meadow', x: 4180, duration: 15,
    tick: (d, t) => { if (t < 1.5) { d.player.stamina = 100; d.player.endurance = 100; } },
    script: () => ({ ...RUN, jumpHeld: true }),
  },
  {
    caption: 'Living weather — wind pushes and pulls your pace; rain soaks, fog blinds.',
    biome: 'meadow', x: 1800, duration: 12,
    setup: (d) => d.weather.force('rain'),
    tick: (d, t) => { if (t > 7 && d.weather.state !== 'gust') d.weather.force('gust'); },
    script: () => RUN,
  },
  {
    caption: 'Ten-minute days — dusk, stars, and dawn roll over the road.',
    biome: 'meadow', x: 1000, duration: 12,
    setup: (d) => d.weather.force('clear'),
    tick: (d, t, dt) => { d.dayNight.phase = (d.dayNight.phase + dt * 0.085) % 1; },
    script: (t) => (t % 4 < 2.2 ? { ...RUN } : IDLE),
  },
  {
    caption: 'A whole life on one road — child to elder, growth lived and earned.',
    biome: 'meadow', x: 600, duration: 15,
    tick: (d, t) => { d.player.ageDays = Math.min(22, (t / 14) * 23); },
    script: (t) => (t % 3 < 1.8 ? { ...RUN } : IDLE),
  },
  {
    caption: 'Combat is fully automatic — your position is the weapon. Close in, or run when outmatched.',
    biome: 'meadow', x: 8480, duration: 16,
    setup: (d) => {
      d.player.applyClass('fighter', d.classes.fighter);
      d.player.skills.accuracy = 2; d.player.skills.fightSpeed = 1.6; d.player.skills.autoDodge = 1.2;
      d.player.ageDays = 6;
    },
    tick: (d) => { d.player.health = d.player.maxHealth; },
    script: (t, player) => ({
      ...RUN,
      moveDir: player.x > 8560 ? (t % 2 < 1.4 ? 1 : 0) : 1,
    }),
  },
  {
    caption: 'Villages — rest, train, identify relics, trade. Every town saves the journey.',
    biome: 'meadow', x: 7100, duration: 13,
    setup: (d) => { d.player.ageDays = 6; d.weather.force('clear'); },
    script: () => ({ ...RUN, moveDir: 1 }),
  },
  {
    caption: 'Biomes chain eastward — each stretch its own complete world, sound and all.',
    biome: 'forest', x: 400, duration: 11,
    script: () => RUN,
  },
  {
    caption: 'The Mountain Pass — snow depth, blizzards, and cold that bites.',
    biome: 'mountain-high', x: 700, duration: 14,
    setup: (d) => { d.weather.force('blizzard'); d.player.ageDays = 6; },
    tick: (d, t) => { if (t < 1.5) { d.player.stamina = 100; d.player.endurance = 100; } d.player.injuries = []; },
    script: () => ({ ...RUN, jumpHeld: true }),
  },
  {
    caption: '…or under it — darkness, telekinesis, and things a sword can never reach.',
    biome: 'mountain-cave', x: 700, duration: 15,
    setup: (d) => {
      d.player.applyClass('wizard', d.classes.wizard);
      d.player.mana = 50; d.player.skills.accuracy = 2;
    },
    tick: (d) => { d.player.health = d.player.maxHealth; if (d.player.mana < 20) d.player.mana = 50; },
    script: () => RUN,
  },
  {
    caption: 'Somewhere east, a family waits.   — EASTWARD',
    biome: 'mountain-east', x: 900, duration: 11,
    setup: (d) => { d.weather.force('clear'); d.dayNight.phase = 0.68; },
    script: (t) => (t < 7 ? { ...RUN } : IDLE),
  },
];

export class DemoMode {
  /**
   * deps: { player, classes, weather, dayNight, dialogue, saveManager,
   *         transitionTo(id, x), restoreLastCheckpoint() }
   */
  constructor(deps) {
    this.d = deps;
    this.active = false;
    this.scriptInput = { ...IDLE, holdDuration: 0 };
    this.stopIdx = -1;
    this.t = 0;
    this._loading = false;
    this.captionEl = document.getElementById('demo-caption');
    this.uiEl = document.getElementById('demo-ui');
    this.dotsEl = document.getElementById('demo-dots');
    const tap = (id, fn) => {
      const el = document.getElementById(id);
      if (!el) return;
      let last = 0;
      const h = (e) => {
        if (e.cancelable) e.preventDefault();
        const now = performance.now();
        if (now - last < 350) return;
        last = now;
        fn();
      };
      el.addEventListener('pointerdown', h);
      el.addEventListener('touchstart', h, { passive: false });
    };
    tap('demo-skip', () => this.active && this._next());
    tap('demo-exit', () => this.active && this.exit());
  }

  async start() {
    if (this.active) return;
    this.d.log?.('demo start');
    // capture LIVE state — exit resumes exactly here, nothing lost
    this._resume = this.d.buildResumeSnapshot();
    this.d.saveManager.suspended = true;
    this.active = true;
    this.uiEl.hidden = false;
    this.dotsEl.innerHTML = STOPS.map(() => '<span></span>').join('');
    this.stopIdx = -1;
    await this._next();
  }

  async _next() {
    this.stopIdx += 1;
    if (this.stopIdx >= STOPS.length) { await this.exit(); return; }
    const s = STOPS[this.stopIdx];
    this._loading = true;
    this._loadStarted = performance.now();
    this.captionEl.classList.remove('visible');
    this.d.log?.(`demo stop ${this.stopIdx} → ${s.biome}@${s.x}`);
    try {
      await this.d.transitionTo(s.biome, s.x);
      s.setup?.(this.d);
    } catch (err) {
      this.d.log?.(`demo load ERR ${err?.message}`);
    }
    this.captionEl.textContent = s.caption;
    this.captionEl.classList.add('visible');
    [...this.dotsEl.children].forEach((el, i) => el.classList.toggle('on', i <= this.stopIdx));
    this.t = 0;
    this._loading = false;
  }

  update(dt) {
    if (!this.active) return;
    if (this._loading) {
      // watchdog: a wedged transition can't stall the tour forever
      if (performance.now() - this._loadStarted > 8000) {
        this.d.log?.('demo load watchdog fired');
        this._loading = false;
        this.t = 0;
      }
      return;
    }
    this.t += dt;
    if ((this._dbgAcc = (this._dbgAcc ?? 0) + dt) > 1) {
      this._dbgAcc = 0;
      this.d.log?.(`demo tick stop=${this.stopIdx} t=${this.t.toFixed(1)} move=${this.scriptInput.moveDir} px=${this.d.player.x.toFixed(0)}`);
    }
    const s = STOPS[this.stopIdx];
    s.tick?.(this.d, this.t, dt);
    const inp = s.script(this.t, this.d.player);
    const prevDir = this.scriptInput.moveDir;
    Object.assign(this.scriptInput, inp);
    this.scriptInput.holdDuration = (inp.moveDir !== 0 && inp.moveDir === prevDir)
      ? this.scriptInput.holdDuration + dt : 0;
    if (this.t >= s.duration) this._next();
  }

  async exit() {
    this.active = false;
    this.uiEl.hidden = true;
    this.captionEl.classList.remove('visible');
    // restore FIRST — un-suspending before the async restore let mid-restore
    // ticks save aged demo state at nearby checkpoints (the age-persist bug)
    try {
      await this.d.restoreResume(this._resume);
    } finally {
      this.d.saveManager.suspended = false;
    }
    this._resume = null;
  }
}
