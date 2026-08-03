// Viewport sizing (Amendment 02 §E).
//
// Mobile browsers do NOT have correct viewport dimensions at the moment they
// tell you the orientation changed. The `(orientation: landscape)` media query
// and the `orientationchange` event both fire BEFORE layout settles, and
// `window.innerHeight` / `100dvh` keep reporting the old portrait height for
// a frame or several hundred milliseconds afterwards.
//
// That produced this bug: rotating portrait -> landscape left #game-root at the
// portrait height (~844px) while the visible landscape viewport was ~390px.
// #hud is anchored `bottom: 0` inside that box, so the whole bottom bar sat
// far below the fold and was clipped by `overflow: hidden` — invisible, with
// no way to get it back short of reloading.
//
// The fix is to stop trusting any single reading: measure from visualViewport
// where available (it is the only API that reports the actually-visible area,
// excluding dynamic browser chrome), publish it as a CSS variable the layout
// uses instead of dvh, and re-measure on a short schedule after any event that
// could have changed it. Re-measuring is cheap; being wrong is not recoverable.

const SETTLE_DELAYS = [0, 60, 160, 320, 600];   // ms — iOS needs the long tail

export class Viewport {
  /** @param {(w:number,h:number)=>void} onChange called whenever the size actually changes */
  constructor(onChange = () => {}) {
    this.onChange = onChange;
    this.width = 0;
    this.height = 0;
    this._timers = [];

    this._sync = this._sync.bind(this);
    this.refresh = this.refresh.bind(this);

    window.addEventListener('resize', this.refresh);
    window.addEventListener('orientationchange', this.refresh);
    window.addEventListener('pageshow', this.refresh);
    if (window.visualViewport) {
      // fires on chrome show/hide and pinch-zoom, which plain resize misses
      window.visualViewport.addEventListener('resize', this.refresh);
      window.visualViewport.addEventListener('scroll', this.refresh);
    }
    this._sync();
  }

  /** Best available reading of the actually-visible viewport. */
  measure() {
    const vv = window.visualViewport;
    // Math.round: visualViewport reports fractional px on zoomed/scaled devices,
    // and a fractional canvas size blurs a pixel-art render.
    return {
      w: Math.round(vv?.width ?? window.innerWidth ?? 0),
      h: Math.round(vv?.height ?? window.innerHeight ?? 0),
    };
  }

  _sync() {
    const { w, h } = this.measure();
    if (w <= 0 || h <= 0) return;            // mid-rotation garbage; a later tick will catch it
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    // The layout reads this instead of 100dvh, which lies during rotation.
    document.documentElement.style.setProperty('--app-w', `${w}px`);
    document.documentElement.style.setProperty('--app-h', `${h}px`);
    this.onChange(w, h);
  }

  /**
   * Re-measure now and again as layout settles. A single reading after
   * orientationchange is reliably WRONG on iOS, so this deliberately samples
   * several times rather than trusting the first.
   */
  refresh() {
    for (const t of this._timers) clearTimeout(t);
    this._timers = SETTLE_DELAYS.map((ms) => setTimeout(this._sync, ms));
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(this._sync);
  }

  destroy() {
    for (const t of this._timers) clearTimeout(t);
    window.removeEventListener('resize', this.refresh);
    window.removeEventListener('orientationchange', this.refresh);
    window.removeEventListener('pageshow', this.refresh);
    if (window.visualViewport) {
      window.visualViewport.removeEventListener('resize', this.refresh);
      window.visualViewport.removeEventListener('scroll', this.refresh);
    }
  }
}
