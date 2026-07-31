// Translates raw keyboard (and basic touch) input into movement *intents*.
// The Player state machine decides what those intents become (§3.1–3.2).
//
// Intents exposed each frame:
//   moveDir      : -1 | 0 | 1
//   holdDuration : seconds the current moveDir has been continuously held
//   jumpPressed  : true on the frame Up was first pressed (edge)
//   jumpHeld     : true while Up remains held (variable jump height)
//   crouch       : Down held while NOT moving (reserved for later phases)

const LEFT  = new Set(['ArrowLeft', 'a', 'A']);
const RIGHT = new Set(['ArrowRight', 'd', 'D']);
const UP    = new Set(['ArrowUp', 'w', 'W', ' ']);
const DOWN  = new Set(['ArrowDown', 's', 'S']);

export class InputManager {
  constructor(target = window) {
    this._keys = new Set();
    this._jumpEdge = false;
    // When this returns true (e.g. a dialogue box is open), touch input is
    // ignored so a right-side tap dismisses the box instead of jumping.
    this.touchBlocked = () => false;

    this.moveDir = 0;
    this.holdDuration = 0;
    this.jumpPressed = false;
    this.jumpHeld = false;
    this.crouch = false;

    target.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (UP.has(e.key) && !this._keys.has('up')) this._jumpEdge = true;
      this._setKey(e.key, true);
      if ([...LEFT, ...RIGHT, ...UP, ...DOWN].includes(e.key)) e.preventDefault();
    });
    target.addEventListener('keyup', (e) => this._setKey(e.key, false));
    window.addEventListener('blur', () => { this._keys.clear(); });

    this._bindTouch();
  }

  _setKey(key, down) {
    let name = null;
    if (LEFT.has(key)) name = 'left';
    else if (RIGHT.has(key)) name = 'right';
    else if (UP.has(key)) name = 'up';
    else if (DOWN.has(key)) name = 'down';
    if (!name) return;
    if (down) this._keys.add(name); else this._keys.delete(name);
  }

  // Minimal touch mapping per §3.2: right-half tap = jump, left-half drag = move.
  _bindTouch() {
    let moveTouchId = null;
    let startX = 0;
    window.addEventListener('touchstart', (e) => {
      if (this.touchBlocked()) return;
      for (const t of e.changedTouches) {
        if (t.clientX > window.innerWidth / 2) {
          this._jumpEdge = true;
          this._keys.add('up');
        } else if (moveTouchId === null) {
          moveTouchId = t.identifier;
          startX = t.clientX;
        }
      }
    }, { passive: true });
    window.addEventListener('touchmove', (e) => {
      if (this.touchBlocked()) return;
      for (const t of e.changedTouches) {
        if (t.identifier !== moveTouchId) continue;
        const dx = t.clientX - startX;
        this._keys.delete('left'); this._keys.delete('right'); this._keys.delete('down');
        if (dx > 12) this._keys.add('right');
        else if (dx < -12) this._keys.add('left');
      }
    }, { passive: true });
    window.addEventListener('touchend', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === moveTouchId) {
          moveTouchId = null;
          this._keys.delete('left'); this._keys.delete('right'); this._keys.delete('down');
        } else {
          this._keys.delete('up');
        }
      }
    }, { passive: true });
  }

  /** Call once per fixed update, before the player reads intents. */
  update(dt) {
    const left = this._keys.has('left');
    const right = this._keys.has('right');
    const dir = (right ? 1 : 0) - (left ? 1 : 0);

    if (dir !== 0 && dir === this.moveDir) this.holdDuration += dt;
    else this.holdDuration = 0;
    this.moveDir = dir;

    this.crouch = this._keys.has('down');
    this.jumpHeld = this._keys.has('up');
    this.jumpPressed = this._jumpEdge;
    this._jumpEdge = false;
  }
}
