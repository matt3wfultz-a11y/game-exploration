/* ============================================================================
   HERO — the thing you control. Movement, sword, dash, damage.

   Everything the hero does also gets *reported to the Warden* (see the
   `game.profileTick` / `game.reportX` calls). That reporting is the whole
   premise of this game: your habits are the input to level generation.
   ========================================================================== */
window.G = window.G || {};

G.Hero = class Hero {
  constructor(x, y) {
    const H = G.CFG.hero;
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.radius = H.radius;
    this.maxHp = H.maxHp;
    this.hp = H.maxHp;
    this.aim = 0;                 // radians, toward mouse

    this.attackTimer = 0;         // >0 while the hitbox is live
    this.attackCd = 0;
    this.attackAngle = 0;
    this.hitThisSwing = new Set();

    this.dashTimer = 0;
    this.dashCd = 0;
    this.dashDx = 1; this.dashDy = 0;

    this.iframe = 0;
    this.dead = false;
    this.walkPhase = 0;
  }

  get invulnerable() {
    return this.iframe > 0 || (this.dashTimer > 0 && G.CFG.hero.dashIframes);
  }

  update(dt, game) {
    const H = G.CFG.hero;
    const input = G.Input;

    this.attackCd = Math.max(0, this.attackCd - dt);
    this.dashCd = Math.max(0, this.dashCd - dt);
    this.iframe = Math.max(0, this.iframe - dt);
    this.attackTimer = Math.max(0, this.attackTimer - dt);

    // Aim always follows the mouse — attacks and dashes both use it.
    this.aim = Math.atan2(input.mouse.y - this.y, input.mouse.x - this.x);

    const [ix, iy] = input.moveAxis();
    const moving = ix !== 0 || iy !== 0;

    // --- Dash ------------------------------------------------------------
    if (this.dashTimer > 0) {
      this.dashTimer -= dt;
      this.vx = this.dashDx * H.dashSpeed;
      this.vy = this.dashDy * H.dashSpeed;
      if (Math.random() < 0.6) {
        G.FX.burst(this.x, this.y, 1, {
          color: G.CFG.col.heroDash, speed: 40, life: 0.3, size: 4,
        });
      }
    } else {
      if (input.isDown('ShiftLeft', 'ShiftRight', 'Space') && this.dashCd <= 0) {
        // Dash toward movement input if there is any, otherwise toward aim.
        const [dx, dy] = moving ? [ix, iy] : [Math.cos(this.aim), Math.sin(this.aim)];
        this.dashDx = dx; this.dashDy = dy;
        this.dashTimer = H.dashTime;
        this.dashCd = H.dashCooldown;
        G.FX.ring(this.x, this.y, { color: G.CFG.col.heroDash, radius: 34, life: 0.28, width: 2 });
        game.reportDash();
      }

      // --- Move --------------------------------------------------------
      const targetVx = ix * H.speed;
      const targetVy = iy * H.speed;
      const rate = moving ? H.accel : H.friction;
      const dvx = targetVx - this.vx, dvy = targetVy - this.vy;
      const dv = Math.hypot(dvx, dvy);
      if (dv > 1e-4) {
        const step = Math.min(dv, rate * dt);
        this.vx += dvx / dv * step;
        this.vy += dvy / dv * step;
      }
    }

    if (moving) this.walkPhase += dt * 11;

    // --- Attack ------------------------------------------------------------
    const wantsAttack = input.mouse.down || input.isDown('KeyJ');
    if (wantsAttack && this.attackCd <= 0) {
      this.attackCd = H.attackCooldown;
      this.attackTimer = H.attackWindow;
      this.attackAngle = this.aim;
      this.hitThisSwing.clear();
      // Small forward lunge — makes the swing feel committed instead of limp.
      this.vx += Math.cos(this.aim) * H.attackLunge;
      this.vy += Math.sin(this.aim) * H.attackLunge;
      game.reportAttack();
    }

    this.x += this.vx * dt;
    this.y += this.vy * dt;
    game.room.collide(this);
  }

  /* Is `e` inside the live sword arc, and not already hit by this swing? */
  swordHits(e) {
    if (this.attackTimer <= 0) return false;
    if (this.hitThisSwing.has(e.id)) return false;
    const H = G.CFG.hero;
    const d = G.U.dist(this.x, this.y, e.x, e.y);
    if (d > H.attackRange + e.radius) return false;
    const a = Math.atan2(e.y - this.y, e.x - this.x);
    return Math.abs(G.U.angleDiff(this.attackAngle, a)) <= H.attackArc / 2;
  }

  hurt(amount, fromX, fromY) {
    if (this.invulnerable || this.dead) return false;
    const H = G.CFG.hero;
    this.hp -= amount;
    this.iframe = H.iframes;
    const [kx, ky] = G.U.norm(this.x - fromX, this.y - fromY);
    this.vx += kx * H.knockback;
    this.vy += ky * H.knockback;

    G.FX.addShake(G.CFG.fx.shakeOnHurt);
    G.FX.flash('#ff3b5c', 0.35);
    G.FX.addHitStop(0.07);
    G.FX.burst(this.x, this.y, 14, { color: '#ff5c72', speed: 190, life: 0.5, size: 4 });
    G.FX.text(this.x, this.y - 20, `-${amount}`, { color: '#ff5c72', size: 18 });

    if (this.hp <= 0) { this.hp = 0; this.dead = true; }
    return true;
  }

  draw(ctx, time) {
    const C = G.CFG.col;
    const flicker = this.iframe > 0 && Math.floor(time * 22) % 2 === 0;

    // Shadow
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(this.x, this.y + this.radius * 0.9, this.radius * 0.9, this.radius * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    if (flicker) return;

    // Sword arc (drawn behind the body so the body reads clearly)
    if (this.attackTimer > 0) {
      const H = G.CFG.hero;
      const t = 1 - this.attackTimer / H.attackWindow;
      const sweep = H.attackArc;
      const a0 = this.attackAngle - sweep / 2 + sweep * t * 0.55;
      ctx.globalAlpha = 0.75 * (1 - t * 0.55);
      ctx.strokeStyle = '#fff8e2';
      ctx.lineWidth = 7;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(this.x, this.y, H.attackRange * 0.82, a0, a0 + sweep * 0.6);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Body — squashes slightly as you walk, which sells motion for free.
    const bob = Math.sin(this.walkPhase) * 1.6;
    const r = this.radius;
    ctx.fillStyle = this.dashTimer > 0 ? C.heroDash : C.hero;
    G.U.roundRect(ctx, this.x - r, this.y - r + bob, r * 2, r * 2, 5);
    ctx.fill();

    // Facing pip
    ctx.fillStyle = '#2a2f3d';
    const px = this.x + Math.cos(this.aim) * r * 0.52;
    const py = this.y + Math.sin(this.aim) * r * 0.52 + bob;
    ctx.beginPath();
    ctx.arc(px, py, 3.1, 0, Math.PI * 2);
    ctx.fill();
  }
};
