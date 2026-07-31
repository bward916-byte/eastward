// Fixed-timestep accumulator loop (deterministic physics) + interpolated render.

const FIXED_DT = 1 / 120;      // physics step (seconds)
const MAX_FRAME = 0.25;        // clamp huge tab-switch gaps

export class GameLoop {
  /**
   * @param {(dt:number)=>void} update  fixed-step simulation
   * @param {(alpha:number)=>void} render  alpha = interpolation factor [0,1)
   */
  constructor(update, render) {
    this.update = update;
    this.render = render;
    this.accumulator = 0;
    this.lastTime = 0;
    this.running = false;
    this._frame = this._frame.bind(this);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.accumulator = 0;          // drop portrait-time backlog on resume
    this.lastTime = performance.now();
    requestAnimationFrame(this._frame);
  }

  stop() { this.running = false; }

  _frame(now) {
    if (!this.running) return;
    let frameTime = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (frameTime > MAX_FRAME) frameTime = MAX_FRAME;

    this.accumulator += frameTime;
    while (this.accumulator >= FIXED_DT) {
      this.update(FIXED_DT);
      this.accumulator -= FIXED_DT;
    }
    this.render(this.accumulator / FIXED_DT);
    requestAnimationFrame(this._frame);
  }
}

export { FIXED_DT };
