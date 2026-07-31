// Shared auto-aim targeting (Amendment 06 §O): nearest valid living enemy in
// range, filtered by the attacker's target capability vs. the creature's
// targetableBy tags (§O.3/§Q.3). Thief knives and Wizard bolts both use this —
// one implementation, no per-class duplication. The Fighter's melee swipe does
// its own arc check but respects the same tags (flying excludes 'melee').

export function nearestTarget(x, y, creatures, range, capability) {
  let best = null, bestD = range;
  for (const c of creatures) {
    if (c.dead) continue;
    if (!c.targetableBy.includes(capability)) continue;
    const d = Math.hypot(c.x - x, c.y - y);
    if (d < bestD) { best = c; bestD = d; }
  }
  return best;
}
