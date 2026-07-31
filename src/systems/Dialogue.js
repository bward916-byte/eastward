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

    const tryAdvance = () => { if (this._advance) this._advance(); };
    this.box?.addEventListener('pointerdown', (e) => { e.stopPropagation(); tryAdvance(); });
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

  hide() { if (this.box) this.box.hidden = true; this._advance = null; }
}
