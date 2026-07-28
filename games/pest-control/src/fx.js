/* ============================================================================
   FX — particles, screen shake, hit-stop, floating text.

   None of this changes the rules of the game. All of it changes how the game
   FEELS. If the combat ever feels limp, come here before you touch balance.
   ========================================================================== */
window.G = window.G || {};

G.FX = {
  particles: [],
  texts: [],
  shake: 0,
  shakeDecay: 6.5,
  flashAlpha: 0,
  flashColor: '#fff',
  hitStop: 0,

  reset() {
    this.particles.length = 0;
    this.texts.length = 0;
    this.shake = 0;
    this.flashAlpha = 0;
    this.hitStop = 0;
  },

  addShake(amount) { this.shake = Math.min(26, this.shake + amount); },
  addHitStop(t) { this.hitStop = Math.max(this.hitStop, t); },
  flash(color, alpha = 0.5) { this.flashColor = color; this.flashAlpha = alpha; },

  /* A burst of particles. `spread` of Math.PI*2 is omnidirectional. */
  burst(x, y, count, opts = {}) {
    const {
      color = '#fff', speed = 150, speedVar = 90, life = 0.45,
      dir = 0, spread = Math.PI * 2, size = 3, gravity = 0, drag = 3.2,
    } = opts;
    for (let i = 0; i < count; i++) {
      const a = dir + (Math.random() - 0.5) * spread;
      const s = speed + (Math.random() - 0.5) * speedVar;
      this.particles.push({
        x, y,
        vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: life * (0.6 + Math.random() * 0.7),
        maxLife: life,
        size: size * (0.6 + Math.random() * 0.8),
        color, gravity, drag,
      });
    }
  },

  /* An expanding ring — good for explosions and dashes. */
  ring(x, y, opts = {}) {
    const { color = '#fff', radius = 60, life = 0.35, width = 3 } = opts;
    this.particles.push({
      ring: true, x, y, r: 4, targetR: radius,
      life, maxLife: life, color, width,
    });
  },

  text(x, y, str, opts = {}) {
    const { color = '#fff', life = 0.85, size = 16, vy = -46 } = opts;
    this.texts.push({ x, y, str, color, life, maxLife: life, size, vy });
  },

  update(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) { this.particles.splice(i, 1); continue; }
      if (p.ring) {
        const t = 1 - p.life / p.maxLife;
        p.r = p.targetR * (1 - Math.pow(1 - t, 2.4));   // ease-out
      } else {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += p.gravity * dt;
        const d = Math.max(0, 1 - p.drag * dt);
        p.vx *= d; p.vy *= d;
      }
    }

    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.life -= dt;
      if (t.life <= 0) { this.texts.splice(i, 1); continue; }
      t.y += t.vy * dt;
      t.vy *= Math.max(0, 1 - 2.4 * dt);
    }

    this.shake = Math.max(0, this.shake - this.shakeDecay * this.shake * dt - 6 * dt);
    this.flashAlpha = Math.max(0, this.flashAlpha - 3.2 * dt);
  },

  /* Call before drawing the world. Returns the offset it applied. */
  applyShake(ctx) {
    if (this.shake <= 0.05) return;
    const a = Math.random() * Math.PI * 2;
    ctx.translate(Math.cos(a) * this.shake, Math.sin(a) * this.shake);
  },

  draw(ctx) {
    for (const p of this.particles) {
      const a = Math.max(0, p.life / p.maxLife);
      ctx.globalAlpha = a;
      if (p.ring) {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.width * a;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.fillStyle = p.color;
        const s = p.size * a;
        ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
      }
    }
    ctx.globalAlpha = 1;
  },

  drawTexts(ctx) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const t of this.texts) {
      const a = Math.max(0, Math.min(1, t.life / t.maxLife * 1.8));
      ctx.globalAlpha = a;
      ctx.font = `bold ${t.size}px system-ui, sans-serif`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.65)';
      ctx.strokeText(t.str, t.x, t.y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.str, t.x, t.y);
    }
    ctx.globalAlpha = 1;
  },

  drawFlash(ctx, w, h) {
    if (this.flashAlpha <= 0.01) return;
    ctx.globalAlpha = this.flashAlpha;
    ctx.fillStyle = this.flashColor;
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;
  },
};
