// Terrain surface. Phase 1: flat ground with gentle cosmetic undulation kept
// shallow enough to walk without slope logic. Phase 2 replaces the sampler
// with real spline segments + slope-angle tagging (§3.3) — same API.

export class TerrainSpline {
  constructor(baseY) {
    this.baseY = baseY;
  }

  /** World-space y of the walkable surface at x. */
  groundYAt(x) {
    // very gentle rolling so the ground line isn't a ruler-straight bore
    return this.baseY + Math.sin(x * 0.0012) * 6 + Math.sin(x * 0.0031 + 2) * 3;
  }

  /** Slope angle in radians at x (Phase 2 will use this for climb gating). */
  slopeAt(x) {
    const e = 4;
    return Math.atan2(this.groundYAt(x + e) - this.groundYAt(x - e), 2 * e);
  }
}
