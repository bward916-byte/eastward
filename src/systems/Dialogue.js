// Ground-anchored dialogue text box (§4): a bottom strip, never a floating
// mid-screen panel. Built in Phase 3 for the intro; Phase 5's Adventure
// encounters reuse it. Lines advance by tap/click on the box, E/Enter, or an
// auto-timer (used for intro pacing). Typewriter reveal, skippable.

const CHARS_PER_SEC = 34;

export class Dialogue {
  constructor() {
    this.box = document.getElementById('dialogue-box');
    this.speakerEl = document.getElementById('dialogue-speaker');
    this.textEl = document.getElementById('dialogue-text');
    this._advance = null;
    this.active = false;
    this._closedAt = 0;

    let lastAdv = 0;
    const tryAdvance = () => {
      const now = performance.now();
      if (now - lastAdv < 250) return;   // dedupe multi-event taps
      lastAdv = now;
      if (this._advance) this._advance();
    };
    for (const ev of ['pointerdown', 'click']) {
      this.box?.addEventListener(ev, (e) => { e.stopPropagation(); tryAdvance(); });
      // While open, a tap ANYWHERE advances (InputManager suppresses movement)
      window.addEventListener(ev, () => { if (this.active) tryAdvance(); });
    }
    this.box?.addEventListener('touchstart', (e) => { e.stopPropagation(); tryAdvance(); }, { passive: true });
    window.addEventListener('touchstart', () => { if (this.active) tryAdvance(); }, { passive: true });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'e' || e.key === 'E' || e.key === 'Enter') tryAdvance();
    });
  }

  /**
   * Show lines sequentially. Resolves when the last line is dismissed.
   * @param {string[]} lines
   * @param {{speaker?:string, autoMs?:number}} opts autoMs auto-advances each line
   */
  async say(lines, { speaker = '', autoMs = 0 } = {}) {
    if (!this.box) return; // headless/testing
    this.active = true;
    this.box.hidden = false;
    this.speakerEl.textContent = speaker;
    this.speakerEl.style.display = speaker ? '' : 'none';

    for (const line of lines) {
      await this._showLine(line, autoMs);
    }
    this.hide();
  }

  _showLine(line, autoMs) {
    return new Promise((resolve) => {
      let shown = 0;
      let done = false;
      this.textEl.textContent = '';
      const iv = setInterval(() => {
        shown += CHARS_PER_SEC / 20;
        this.textEl.textContent = line.slice(0, Math.floor(shown));
        if (shown >= line.length) { clearInterval(iv); done = true; }
      }, 50);

      let autoTimer = null;
      const finish = () => {
        clearInterval(iv); clearTimeout(autoTimer);
        this._advance = null;
        resolve();
      };
      this._advance = () => {
        if (!done) { // first tap: reveal the whole line
          clearInterval(iv); done = true;
          this.textEl.textContent = line;
        } else finish();
      };
      if (autoMs > 0) {
        autoTimer = setTimeout(finish, autoMs + (line.length / CHARS_PER_SEC) * 1000);
      }
    });
  }

  /**
   * Show lines, then present tappable choices on the last screen.
   * Resolves with the chosen index. Used by Adventure encounters (§4).
   */
  async ask(lines, options, { speaker = '' } = {}) {
    if (!this.box) return 0; // headless
    if (lines.length > 1) await this.say(lines.slice(0, -1), { speaker });
    this.active = true;
    this.box.hidden = false;
    this.speakerEl.textContent = speaker;
    this.speakerEl.style.display = speaker ? '' : 'none';
    this.textEl.textContent = lines[lines.length - 1];

    const wrap = document.getElementById('dialogue-choices');
    wrap.innerHTML = '';
    return new Promise((resolve) => {
      options.forEach((label, idx) => {
        const b = document.createElement('button');
        b.className = 'dialogue-choice';
        b.textContent = label;
        let picked = false;
        const choose = (e) => {
          e.stopPropagation();
          if (picked) return;
          picked = true;
          wrap.innerHTML = '';
          this.hide();
          resolve(idx);
        };
        b.addEventListener('pointerdown', choose);
        b.addEventListener('touchstart', choose, { passive: true });
        b.addEventListener('click', choose);
        wrap.appendChild(b);
      });
    });
  }

  hide() {
    if (this.box) this.box.hidden = true;
    this._advance = null;
    this.active = false;
    this._closedAt = 0;
  }
}
