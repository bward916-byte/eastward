// Terrain surface — Phase 2. Ground is authored per-biome as control points in
// biomes/*.json ("terrain.points"), smoothly interpolated, with slope-angle
// sampling and the §3.3 tier classification:
//   walk     < 15°   normal locomotion, mild uphill penalty
//   scramble 15–45°  slowed + extra stamina drain uphill (Climbing skill helps)
//   climb    45–80°  true climbing: hold Up against the face (Player CLIMB state)
// Micro-rolling noise is applied only where the authored ground is near-flat,
// so it can never distort an authored slope's tier.

const DEG = Math.PI / 180;
export const SCRAMBLE_MIN = 15 * DEG;
export const CLIMB_MIN = 45 * DEG;
export const CLIMB_MAX = 80 * DEG;

export class TerrainSpline {
  constructor(biome) {
    this.baseY = biome.groundY;
    const pts = biome.terrain?.points ?? [[0, this.baseY], [1e6, this.baseY]];
    this.points = pts.slice().sort((a, b) => a[0] - b[0]);
  }

  _seg(x) {
    const pts = this.points;
    if (x <= pts[0][0]) return [pts[0], pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      if (x < pts[i + 1][0]) return [pts[i], pts[i + 1]];
    }
    const last = pts[pts.length - 1];
    return [last, last];
  }

  groundYAt(x) {
    const [p0, p1] = this._seg(x);
    let y, segSlope;
    if (p0 === p1) { y = p0[1]; segSlope = 0; }
    else {
      const t = (x - p0[0]) / (p1[0] - p0[0]);
      const s = t * t * (3 - 2 * t); // smoothstep between authored points
      y = p0[1] + (p1[1] - p0[1]) * s;
      segSlope = (p1[1] - p0[1]) / (p1[0] - p0[0]);
    }
    // rolling detail only on near-flat authored ground
    const flatW = Math.max(0, 1 - Math.abs(segSlope) * 6);
    return y + (Math.sin(x * 0.0012) * 6 + Math.sin(x * 0.0031 + 2) * 3) * flatW;
  }

  /** Signed slope angle (radians). Positive = surface RISES toward the east. */
  slopeAt(x) {
    const e = 3;
    const dy = this.groundYAt(x + e) - this.groundYAt(x - e);
    return Math.atan2(-dy, 2 * e);
  }

  angleAt(x) { return Math.abs(this.slopeAt(x)); }

  /** @returns {'walk'|'scramble'|'climb'} */
  tierAt(x) {
    const a = this.angleAt(x);
    if (a < SCRAMBLE_MIN) return 'walk';
    if (a < CLIMB_MIN) return 'scramble';
    return 'climb';
  }
}
