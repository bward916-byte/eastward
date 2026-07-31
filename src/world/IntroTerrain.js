// Intro-scene terrain wrapper: the ravine is authored in intro.json, and this
// subclass overlays (a) the rope-bridge walking surface while it's intact and
// (b) the tutorial log obstacle — a sharp little bump whose edges classify as
// climb-tier, so walking is blocked and the jump prompt is genuinely needed.

import { TerrainSpline } from './TerrainSpline.js';

export const BRIDGE_W = 835, BRIDGE_E = 1025, BRIDGE_Y = 516;
export const LOG_W = 1596, LOG_E = 1620, LOG_TOP = 492;

export class IntroTerrain extends TerrainSpline {
  constructor(biome) {
    super(biome);
    this.bridgeIntact = true;
  }

  groundYAt(x) {
    if (this.bridgeIntact && x >= BRIDGE_W && x <= BRIDGE_E) return BRIDGE_Y;
    if (x >= LOG_W && x <= LOG_E) return LOG_TOP;
    return super.groundYAt(x);
  }
}
