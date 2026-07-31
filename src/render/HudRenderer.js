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
    this.rowHealth = document.getElementById('row-health');
    this.barHealth = document.getElementById('bar-health');
    this.rowMana = document.getElementById('row-mana');
    this.barMana = document.getElementById('bar-mana');
    this.barXp = document.getElementById('bar-xp');
    this.xpProgress = 0;
    this.artifactCount = document.getElementById('artifact-count');
    this._saveTimer = null;
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
      const n = player.artifacts ?? 0;
      this.artifactWrap.hidden = n === 0;
      this.artifactCount.textContent = n;
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

    // condition color: healthy-green → tired-amber → exhausted-red
    const worst = Math.min(stamPct / 100, endPct / 100);
    let color;
    if (worst > 0.55)      color = '#7ec96a';
    else if (worst > 0.25) color = '#e0b23c';
    else                   color = '#e06a4a';
    this.portrait.style.setProperty('--condition-color', color);
  }
}
