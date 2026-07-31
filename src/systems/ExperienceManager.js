// XP accumulation (Amendment 07 §U): earns from the EventBus signals the
// encounter/combat systems already emit, fills a visible bar, and fires
// "levelUp" with a minor/major tier when full. Threshold grows each cycle.

import { bus } from '../core/EventBus.js';

const AWARDS = {
  creatureSlain: 14,
  challengePassed: 20,   // only with a real encounter id
  adventureResolved: 15,
  interestCollected: 8,
  riteCompleted: 10,
};

export class ExperienceManager {
  constructor() {
    this.xp = 0;
    this.level = 0;
    bus.on('creatureSlain', () => this.grant(AWARDS.creatureSlain));
    bus.on('challengePassed', (d) => { if (d?.id) this.grant(AWARDS.challengePassed); });
    bus.on('adventureResolved', () => this.grant(AWARDS.adventureResolved));
    bus.on('interestCollected', () => this.grant(AWARDS.interestCollected));
    bus.on('riteCompleted', () => this.grant(AWARDS.riteCompleted));
  }

  get threshold() { return Math.round(60 * Math.pow(1.25, this.level)); }
  get progress() { return Math.min(1, this.xp / this.threshold); }

  grant(amount) {
    this.xp += amount;
    bus.emit('xpGained', { amount });
    while (this.xp >= this.threshold) {
      this.xp -= this.threshold;
      this.level += 1;
      const tier = this.level % 4 === 0 ? 'major' : 'minor';  // majors rarer (§U.3)
      bus.emit('levelUp', { tier, level: this.level });
    }
  }

  getState() { return { xp: this.xp, level: this.level }; }
  setState(s) { this.xp = s?.xp ?? 0; this.level = s?.level ?? 0; }
}
