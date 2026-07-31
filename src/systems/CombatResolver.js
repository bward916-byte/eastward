// Centralized attack-resolution math (Amendment 07 §T.5): hit/miss on
// auto-aimed attacks (Accuracy), attack cadence (Fight Speed), and passive
// Auto-Dodge rolls. One auditable place — Player, Creature, and Projectile
// all query this instead of rolling their own.

import { clamp } from '../core/utils.js';

export const CombatResolver = {
  /** Accuracy 1 (fresh) ≈ 80% hit; ~2 approaches sure-handed. */
  hitRoll(accuracy) {
    return Math.random() < clamp(0.62 + accuracy * 0.18, 0.3, 0.99);
  },

  /** Fight Speed shortens cooldowns: fs 1 → base, fs 2 → ~×0.77. */
  cooldownFor(base, fightSpeed) {
    return base / (0.7 + fightSpeed * 0.3);
  },

  /** Auto-Dodge 0 → never; each point ≈ +25% chance, capped at 60% (§T.4). */
  dodgeRoll(autoDodge) {
    return Math.random() < clamp(autoDodge * 0.25, 0, 0.6);
  },
};
