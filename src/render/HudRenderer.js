// Updates the DOM HUD strip: stamina/endurance bars, endurance-ceiling shading
// on the stamina bar, state readout, and the status-portrait condition color.
// Per-limb injury overlays activate in Phase 8+ when Health.js lands.

export class HudRenderer {
  constructor() {
    this.stamina = document.getElementById('bar-stamina');
    this.staminaCap = document.getElementById('bar-stamina-cap');
    this.endurance = document.getElementById('bar-endurance');
    this.stateEl = document.getElementById('hud-state');
    this.portrait = document.getElementById('hud-portrait');
    this.saveIcon = document.getElementById('save-indicator');
    this.artifactWrap = document.getElementById('artifact-counter');
    this.goldWrap = document.getElementById('gold-counter');
    this.goldCount = document.getElementById('gold-count');
    this.rowHealth = document.getElementById('row-health');
    this.barHealth = document.getElementById('bar-health');
    this.rowMana = document.getElementById('row-mana');
    this.barMana = document.getElementById('bar-mana');
    this.barXp = document.getElementById('bar-xp');
    this.xpProgress = 0;
    this.artifactCount = document.getElementById('artifact-count');
    this._saveTimer = null;
    this.partyStrip = document.getElementById('party-strip');
    this._partyKey = '';        // roster signature — rebuild DOM only on change
    this._pips = new Map();
  }

  /**
   * Party strip (§11). Companions have health and a downed state, and mid-horde
   * you cannot tell who is on the ground from the world render alone — the
   * fallen sprite is behind you, under a pile of wolves.
   *
   * The DOM is rebuilt only when the roster itself changes. Per-frame rebuilds
   * churn elements, which iOS punishes (see the tap-drop gotcha); everything
   * that changes every frame is a width or a class.
   */
  updateParty(party = []) {
    if (!this.partyStrip) return;
    const key = party.map((c) => c.id).join(',');
    if (key !== this._partyKey) {
      this._partyKey = key;
      this._pips.clear();
      this.partyStrip.innerHTML = '';
      for (const c of party) {
        const el = document.createElement('div');
        el.className = 'pty';
        el.innerHTML = `<span class="pty-name">${c.name}</span>`
          + '<span class="pty-bar"><span class="pty-fill"></span></span>';
        this.partyStrip.appendChild(el);
        this._pips.set(c.id, { el, fill: el.querySelector('.pty-fill'), wasDown: false });
      }
    }
    for (const c of party) {
      const pip = this._pips.get(c.id);
      if (!pip) continue;
      const frac = Math.max(0, Math.min(1, (c.health ?? 0) / (c.maxHealth || 1)));
      pip.fill.style.width = `${frac * 100}%`;
      pip.el.classList.toggle('down', !!c.downed);
      pip.el.classList.toggle('bad', !c.downed && frac <= 0.3);
      pip.el.classList.toggle('hurt', !c.downed && frac > 0.3 && frac <= 0.65);
      if (!!c.downed !== pip.wasDown) {
        pip.wasDown = !!c.downed;
        pip.el.classList.remove('pulse');
        void pip.el.offsetWidth;          // restart the animation
        pip.el.classList.add('pulse');
      }
    }
  }

  /** Small unobtrusive confirmation on checkpoint save (Amendment 01 §A.2). */
  flashSaved() {
    if (!this.saveIcon) return;
    this.saveIcon.classList.add('visible');
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(
      () => this.saveIcon.classList.remove('visible'), 2200);
  }

  update(player) {
    if (this.artifactWrap) {
      const n = (player.artifacts ?? 0) + (player.identified ?? 0);
      this.artifactWrap.hidden = n === 0;
      this.artifactCount.textContent = player.identified > 0
        ? `${player.artifacts} · ✓${player.identified}` : `${player.artifacts}`;
    }
    if (this.goldWrap) {
      this.goldWrap.hidden = !(player.gold > 0);
      this.goldCount.textContent = player.gold;
    }
    // Health visible whenever below full (Amendment 02 §D.2); mana for casters
    const showHealth = player.health < player.maxHealth - 0.5;
    this.rowHealth.hidden = !showHealth;
    if (showHealth) this.barHealth.style.width = (player.health / player.maxHealth * 100) + '%';
    const showMana = player.maxMana > 0;
    this.rowMana.hidden = !showMana;
    if (showMana) this.barMana.style.width = (player.mana / player.maxMana * 100) + '%';

    if (this.barXp) this.barXp.style.width = (this.xpProgress * 100) + '%';

    const stamPct = player.stamina;                       // out of 100
    const endPct = player.endurance;
    this.stamina.style.width = stamPct + '%';
    this.endurance.style.width = endPct + '%';
    // darken the region of the stamina bar above the current endurance ceiling
    this.staminaCap.style.width = (100 - player.staminaCeiling) + '%';

    this.stateEl.textContent = player.state;
    this.stateEl.classList.toggle('exhausted',
      player.state === 'EXHAUSTED' || player.fatigueTimer > 0);

    // per-limb injury + sickness overlays on the portrait (§12/§14)
    const inj = (k) => player.injuries?.some(i => i.kind === k);
    const set = (id, on, color) => {
      const el = document.getElementById(id);
      if (el) el.style.fill = on ? color : '';
    };
    set('p-leg-l', inj('limp'), '#e06a4a');
    set('p-leg-r', inj('limp'), '#e06a4a');
    set('p-arm-r', inj('arm'), '#e06a4a');
    set('p-torso', inj('bruise'), '#c99a3c');
    set('p-head', inj('chill'), '#9ac48a');

    // condition color: healthy-green → tired-amber → exhausted-red
    const worst = Math.min(stamPct / 100, endPct / 100);
    let color;
    if (worst > 0.55)      color = '#7ec96a';
    else if (worst > 0.25) color = '#e0b23c';
    else                   color = '#e06a4a';
    this.portrait.style.setProperty('--condition-color', color);
  }
}
