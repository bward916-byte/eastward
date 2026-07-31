// The guardian figure from the intro (§2): an older protective silhouette,
// deliberately ambiguous. Simple keep-ahead follow during the flight east,
// then a fixed farewell position across the ravine. Fades out after the
// separation beat — camera holds on the silhouette, then the path forward
// is all that's left.

const WALK_SPEED = 132;

export class Guardian {
  constructor(x, terrain) {
    this.x = x;
    this.terrain = terrain;
    this.y = terrain.groundYAt(x);
    this.alpha = 1;
    this.animTime = 0;
    this.moving = false;
    this.targetX = x;
  }

  setTarget(x) { this.targetX = x; }

  update(dt) {
    const dx = this.targetX - this.x;
    this.moving = Math.abs(dx) > 4;
    if (this.moving) {
      this.x += Math.sign(dx) * Math.min(Math.abs(dx), WALK_SPEED * dt);
    }
    this.y = this.terrain.groundYAt(this.x);
    this.animTime += dt * (this.moving ? 1.6 : 0.6);
  }

  render(ctx) {
    if (this.alpha <= 0) return;
    const t = this.animTime;
    const bob = this.moving ? Math.sin(t * 9) * 1.6 : Math.sin(t * 2) * 0.7;
    ctx.save();
    ctx.globalAlpha = this.alpha;
    ctx.translate(this.x, this.y - 30 + bob * 0.3);

    // legs under the cloak hem
    ctx.strokeStyle = '#1c2230';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    const swing = this.moving ? Math.sin(t * 9) * 0.45 : 0;
    for (const s of [1, -1]) {
      ctx.beginPath();
      ctx.moveTo(0, 8);
      ctx.lineTo(Math.sin(swing * s) * 9, 8 + Math.cos(swing * s) * 22);
      ctx.stroke();
    }
    // long travel cloak
    ctx.fillStyle = '#242c40';
    ctx.beginPath();
    ctx.moveTo(0, -26);
    ctx.quadraticCurveTo(-14 - Math.sin(t * 3) * 1.5, 2, -11, 14);
    ctx.lineTo(11, 14);
    ctx.quadraticCurveTo(14, 2, 0, -26);
    ctx.closePath();
    ctx.fill();
    // hood + shadowed face
    ctx.fillStyle = '#2c3650';
    ctx.beginPath();
    ctx.arc(1, -30, 8.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#141a26';
    ctx.beginPath();
    ctx.arc(3, -29, 5.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
}
