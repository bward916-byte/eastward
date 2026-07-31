// Decides and applies what a level-up grants (Amendment 07 §U.3). Minor:
// a small bump to a combat/traversal skill or max health. Major: a larger
// jump in one skill ("free" trainer-grade advancement). The aging-nudge major
// variant activates in Phase 8 when the age accumulator exists — until then
// majors weight entirely to skill enhancements, per §U.3's tunable weighting.

import { bus } from '../core/EventBus.js';

const MINORS = [
  { key: 'accuracy', amt: 0.15, label: 'Accuracy improved' },
  { key: 'fightSpeed', amt: 0.12, label: 'Fight Speed improved' },
  { key: 'climbSkill', amt: 0.12, label: 'Climbing improved' },
  { key: 'autoDodge', amt: 0.08, label: 'Reflexes sharpened' },
  { key: 'maxHealth', amt: 6, label: 'Hardier constitution' },
];

export class UpgradeResolver {
  constructor(player) {
    this.player = player;
    bus.on('levelUp', ({ tier }) => this.apply(tier));
  }

  apply(tier) {
    // §U.3 major variant: an earned aging nudge (active now that §5 exists)
    if (tier === 'major' && Math.random() < 0.45) {
      this.player.ageDays += 0.6;
      bus.emit('upgradeGranted', { tier, label: 'You feel the years — grown by the road' });
      return;
    }
    const pick = MINORS[Math.floor(Math.random() * MINORS.length)];
    const mult = tier === 'major' ? 2.6 : 1;
    if (pick.key === 'maxHealth') {
      this.player.maxHealth += Math.round(pick.amt * mult);
      this.player.health = Math.min(this.player.maxHealth, this.player.health + pick.amt * mult);
    } else if (pick.key === 'climbSkill') {
      this.player.climbSkill += pick.amt * mult;
    } else {
      this.player.skills[pick.key] += pick.amt * mult;
    }
    const label = tier === 'major' ? pick.label.replace('improved', 'greatly improved') + '!' : pick.label;
    bus.emit('upgradeGranted', { tier, label });
  }
}
