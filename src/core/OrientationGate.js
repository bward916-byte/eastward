// Landscape-orientation gate (Amendment 02 §E). Owns the orientation check,
// the rotate-prompt overlay, and the orientation-lock attempt — isolated from
// main.js per §14.0. Desktop is unaffected (always "landscape" by aspect).
//
// Behavior (§E.2): portrait → full-screen "rotate" prompt, game loop halted,
// nothing renders behind it; rotating to landscape resumes instantly, no tap.

export class OrientationGate {
  /** @param {(isLandscape:boolean)=>void} onChange */
  constructor(onChange) {
    this.onChange = onChange;
    this._mq = window.matchMedia('(orientation: landscape)');
    this._overlay = this._buildOverlay();
    document.body.appendChild(this._overlay);

    const handler = () => this._apply(this._mq.matches);
    // older Safari lacks addEventListener on MediaQueryList
    if (this._mq.addEventListener) this._mq.addEventListener('change', handler);
    else this._mq.addListener(handler);

    this._tryLock();
    this._apply(this._mq.matches);
  }

  get isLandscape() { return this._mq.matches; }

  _apply(isLandscape) {
    this._overlay.style.display = isLandscape ? 'none' : 'flex';
    this.onChange(isLandscape);
  }

  // Best-effort orientation lock (§E.2). Most mobile browsers require
  // fullscreen first, and iOS Safari doesn't allow it at all — failures are
  // fine, the prompt overlay is the guaranteed fallback.
  async _tryLock() {
    try {
      if (screen.orientation?.lock) await screen.orientation.lock('landscape');
    } catch { /* fallback: prompt overlay */ }
  }

  _buildOverlay() {
    const el = document.createElement('div');
    el.id = 'orientation-gate';
    el.innerHTML = `
      <div class="og-icon" aria-hidden="true">
        <svg viewBox="0 0 64 64" width="72" height="72">
          <rect x="20" y="8" width="24" height="44" rx="4"
                fill="none" stroke="currentColor" stroke-width="3"/>
          <path d="M50 40 a20 20 0 0 1 -14 16" fill="none"
                stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
          <path d="M33 60 l4 -5 l-6 -2 z" fill="currentColor"/>
        </svg>
      </div>
      <p>Rotate your device to play</p>
      <p class="og-sub">Eastward is a landscape journey</p>`;
    return el;
  }
}
