// Small shared helpers — no system should reimplement these (§14.0).

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export const lerp = (a, b, t) => a + (b - a) * t;

// Frame-rate-independent exponential smoothing toward a target.
// `rate` ≈ how quickly it converges (higher = faster). dt in seconds.
export const damp = (current, target, rate, dt) =>
  lerp(current, target, 1 - Math.exp(-rate * dt));

export const easeInOut = (t) => t * t * (3 - 2 * t);

/** Lerp two '#rrggbb' colors. */
export function lerpColor(a, b, t) {
  const pa = [1, 3, 5].map(i => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map(i => parseInt(b.slice(i, i + 2), 16));
  const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
  return '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
}
