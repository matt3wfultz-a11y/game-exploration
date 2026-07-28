/* ============================================================================
   GAME — state machine, fixed-timestep loop, collision resolution, rendering.

   The full loop this project exists to demonstrate:

     TITLE → CARD → ROOM → (clear it) → CARD → ROOM → … → ESCAPE
                       └────────── die ──────────→ DEAD → TITLE

   Every arrow above is implemented. That completeness is the exercise — a
   pile of mechanics with no beginning or end isn't a game yet.
   ========================================================================== */
window.G = window.G || {};

const STATE = { TITLE: 'title', CARD: 'card', PLAY: 'play', DEAD: 'dead', WIN: 'win' };

G.Game = {
  init(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    canvas.width = G.CFG.W;
    canvas.height = G.CFG.H;
    G.Input.attach(canvas);

    this.state = STATE.TITLE;
    this.time = 0;
    this.best = Number(localStorage.getItem('warden.best') || 0);

    this.warden = new G.Warden();
    this.room = new G.Room(1);
    this.hero = new G.Hero(this.room.spawn.x, this.room.spawn.y);
    this.enemies = [];
    this.projectiles = [];
    this.plan = null;
    this.roomIndex = 1;
    this.runTime = 0;
    this.stateTime = 0;

    this._last = performance.now();
    this._acc = 0;
    requestAnimationFrame(this._frame.bind(this));
  },

  /* ---- Run / room lifecycle -------------------------------------------- */

  startRun() {
    this.warden = new G.Warden();
    this.roomIndex = 1;
    this.runTime = 0;
    this.hero = new G.Hero(0, 0);
    G.FX.reset();
    this.prepareRoom();
  },

  /* Build the next room and let the Warden stock it. */
  prepareRoom() {
    this.room = new G.Room(this.roomIndex);
    this.enemies = [];
    this.projectiles = [];

    this.hero.x = this.room.spawn.x;
    this.hero.y = this.room.spawn.y;
    this.hero.vx = this.hero.vy = 0;
    this.hero.dashTimer = 0;
    this.hero.iframe = 0.6;   // brief grace on entry

    this.plan = this.warden.planRoom(this.room, this.roomIndex, this.hero.hp);
    for (const s of this.plan.spawns) {
      this.enemies.push(G.makeEnemy(s.type, s.x, s.y));
    }

    this.setState(STATE.CARD);
  },

  enterRoom() {
    this.setState(STATE.PLAY);
  },

  clearRoom() {
    this.warden.endRoom(this.roomIndex);
    if (this.roomIndex >= G.CFG.ROOMS_TO_ESCAPE) {
      if (this.roomIndex > this.best) {
        this.best = this.roomIndex;
        localStorage.setItem('warden.best', String(this.best));
      }
      this.setState(STATE.WIN);
      return;
    }
    this.roomIndex++;
    if (this.roomIndex - 1 > this.best) {
      this.best = this.roomIndex - 1;
      localStorage.setItem('warden.best', String(this.best));
    }
    this.prepareRoom();
  },

  die() {
    this.warden.endRoom(this.roomIndex);
    G.FX.addShake(20);
    G.FX.flash('#ff3b5c', 0.55);
    G.FX.burst(this.hero.x, this.hero.y, 40, { color: '#ff5c72', speed: 300, life: 0.9, size: 5 });
    this.setState(STATE.DEAD);
  },

  setState(s) { this.state = s; this.stateTime = 0; },

  /* ---- Reporting hooks (hero/enemies call these) ------------------------ */
  reportAttack() { this.warden.reportAttack(); },
  reportDash() { this.warden.reportDash(); },
  reportKill(e) { this.warden.reportKill(e); },

  /* ---- Main loop -------------------------------------------------------- */

  _frame(now) {
    requestAnimationFrame(this._frame.bind(this));
    let dt = (now - this._last) / 1000;
    this._last = now;
    dt = Math.min(dt, 0.05);            // clamp so tab-outs don't teleport things

    // Fixed timestep: physics runs at a constant 120Hz regardless of monitor
    // refresh rate. Without this, feel changes between machines.
    const STEP = 1 / 120;
    this._acc += dt;
    let steps = 0;
    while (this._acc >= STEP && steps < 8) {
      this.update(STEP);
      this._acc -= STEP;
      steps++;
    }
    this.draw();
    G.Input.endFrame();
  },

  update(dt) {
    this.time += dt;
    this.stateTime += dt;

    // Hit-stop: freeze the world for a few ms on impact. Costs nothing,
    // and it's the difference between a hit that lands and one that doesn't.
    if (G.FX.hitStop > 0) {
      G.FX.hitStop -= dt;
      G.FX.update(dt);
      return;
    }

    G.FX.update(dt);

    switch (this.state) {
      case STATE.TITLE:
        if (G.Input.anyConfirm()) this.startRun();
        break;

      case STATE.CARD:
        if (this.stateTime > 0.35 && G.Input.anyConfirm()) this.enterRoom();
        break;

      case STATE.PLAY:
        this.updatePlay(dt);
        break;

      case STATE.DEAD:
      case STATE.WIN:
        if (this.stateTime > 0.9 && G.Input.anyConfirm()) this.setState(STATE.TITLE);
        break;
    }
  },

  updatePlay(dt) {
    this.runTime += dt;
    const hero = this.hero;

    hero.update(dt, this);
    this.warden.tick(dt, this);

    for (const e of this.enemies) {
      if (!e.dead) G.updateEnemy(e, dt, this);
    }

    // Sword → enemies
    if (hero.attackTimer > 0) {
      for (const e of this.enemies) {
        if (e.dead) continue;
        if (hero.swordHits(e)) {
          hero.hitThisSwing.add(e.id);
          G.hurtEnemy(e, G.CFG.hero.attackDamage, hero.x, hero.y, this);
        }
      }
    }

    // Enemies → hero (contact)
    for (const e of this.enemies) {
      if (e.dead) continue;
      if (G.U.dist(hero.x, hero.y, e.x, e.y) < hero.radius + e.radius) {
        if (hero.hurt(e.def.damage, e.x, e.y)) this.warden.reportDamage(e.def.damage);
      }
    }

    // Projectiles
    const T = G.CFG.TILE;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;

      const hitWall = this.room.at(Math.floor(p.x / T), Math.floor(p.y / T)) === G.WALL;
      const hitHero = G.U.dist(p.x, p.y, hero.x, hero.y) < p.radius + hero.radius;

      if (hitHero && !hero.invulnerable) {
        if (hero.hurt(p.damage, p.x, p.y)) this.warden.reportDamage(p.damage);
      }
      if (hitWall || p.life <= 0 || hitHero) {
        G.FX.burst(p.x, p.y, 6, { color: '#7fdce0', speed: 120, life: 0.25, size: 3 });
        this.projectiles.splice(i, 1);
      }
    }

    // Traps
    const htx = Math.floor(hero.x / T), hty = Math.floor(hero.y / T);
    for (const trap of this.room.traps) {
      if (trap.tx !== htx || trap.ty !== hty) continue;
      if (this.room.trapState(trap, this.time) !== 'up') continue;
      if (hero.hurt(G.CFG.trap.damage, trap.tx * T + T / 2, trap.ty * T + T / 2)) {
        this.warden.reportDamage(G.CFG.trap.damage);
        this.warden.reportTrapHit();
        G.FX.text(hero.x, hero.y - 34, 'SPIKES', { color: '#d9455f', size: 13 });
      }
    }

    // Sweep the dead
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      if (this.enemies[i].dead) this.enemies.splice(i, 1);
    }

    if (this.enemies.length === 0 && !this.room.doorOpen) {
      this.room.doorOpen = true;
      G.FX.ring(this.room.door.tx * T + T / 2, this.room.door.ty * T + T / 2,
        { color: G.CFG.col.door, radius: 90, life: 0.6, width: 3 });
      G.FX.text(this.room.door.tx * T - 40, this.room.door.ty * T, 'THE WAY OPENS',
        { color: G.CFG.col.door, size: 14, life: 1.6 });
    }

    // Exit
    if (this.room.doorOpen) {
      const dx = this.room.door.tx * T + T / 2;
      const dy = this.room.door.ty * T + T / 2;
      if (G.U.dist(hero.x, hero.y, dx, dy) < T * 0.85) this.clearRoom();
    }

    if (hero.dead) this.die();
  },

  /* ---- Rendering -------------------------------------------------------- */

  draw() {
    const ctx = this.ctx;
    const C = G.CFG;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0d1017';
    ctx.fillRect(0, 0, C.W, C.H);

    if (this.state === STATE.TITLE) { this.drawTitle(ctx); return; }

    ctx.save();
    G.FX.applyShake(ctx);
    this.drawRoom(ctx);
    this.drawEntities(ctx);
    G.FX.draw(ctx);
    G.FX.drawTexts(ctx);
    ctx.restore();

    G.FX.drawFlash(ctx, C.W, C.H);
    if (this.state !== STATE.DEAD && this.state !== STATE.WIN) this.drawHud(ctx);

    if (this.state === STATE.CARD) this.drawCard(ctx);
    if (this.state === STATE.DEAD) this.drawEnd(ctx, false);
    if (this.state === STATE.WIN) this.drawEnd(ctx, true);
  },

  drawRoom(ctx) {
    const C = G.CFG, T = C.TILE, room = this.room;

    for (let ty = 0; ty < room.h; ty++) {
      for (let tx = 0; tx < room.w; tx++) {
        const x = tx * T, y = ty * T;
        if (room.at(tx, ty) === G.WALL) {
          ctx.fillStyle = C.col.wall;
          ctx.fillRect(x, y, T, T);
          // Lit top face — cheap fake lighting that reads as 3D.
          if (room.at(tx, ty - 1) !== G.WALL) {
            ctx.fillStyle = C.col.wallTop;
            ctx.fillRect(x, y, T, 6);
          }
        } else {
          ctx.fillStyle = (tx + ty) % 2 ? C.col.floor : C.col.floorAlt;
          ctx.fillRect(x, y, T, T);
        }
      }
    }

    // Traps
    for (const trap of room.traps) {
      const st = room.trapState(trap, this.time);
      const x = trap.tx * T, y = trap.ty * T;

      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.fillRect(x + 3, y + 3, T - 6, T - 6);

      if (st === 'warn') {
        const pulse = 0.4 + Math.abs(Math.sin(this.time * 14)) * 0.5;
        ctx.globalAlpha = pulse;
        ctx.strokeStyle = C.col.trapHot;
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 4, y + 4, T - 8, T - 8);
        ctx.globalAlpha = 1;
      }

      const up = st === 'up';
      ctx.fillStyle = up ? C.col.trapHot : C.col.trap;
      const n = 3, s = (T - 8) / n;
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          const cx = x + 4 + s * (i + 0.5);
          const cy = y + 4 + s * (j + 0.5);
          const h = up ? s * 0.46 : s * 0.16;
          ctx.beginPath();
          ctx.moveTo(cx, cy - h);
          ctx.lineTo(cx + h * 0.7, cy + h * 0.6);
          ctx.lineTo(cx - h * 0.7, cy + h * 0.6);
          ctx.closePath();
          ctx.fill();
        }
      }
    }

    // Door
    const dx = room.door.tx * T, dy = room.door.ty * T;
    if (room.doorOpen) {
      const glow = 0.55 + Math.sin(this.time * 4) * 0.2;
      ctx.globalAlpha = glow;
      ctx.fillStyle = C.col.door;
      ctx.fillRect(dx, dy, T, T);
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#fff6d8';
      ctx.fillRect(dx + T * 0.3, dy + T * 0.15, T * 0.4, T * 0.7);
    } else {
      ctx.fillStyle = '#232838';
      ctx.fillRect(dx, dy, T, T);
      ctx.fillStyle = '#3a4359';
      for (let i = 0; i < 3; i++) ctx.fillRect(dx + 4 + i * 9, dy + 5, 5, T - 10);
    }
  },

  drawEntities(ctx) {
    // Painter's algorithm by Y so things overlap correctly.
    const drawables = [...this.enemies.map((e) => ({ y: e.y, e })), { y: this.hero.y, hero: true }];
    drawables.sort((a, b) => a.y - b.y);
    for (const d of drawables) {
      if (d.hero) this.hero.draw(ctx, this.time);
      else G.drawEnemy(ctx, d.e, this.time);
    }

    ctx.fillStyle = '#9fe8ec';
    for (const p of this.projectiles) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.3;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius * 2.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  },

  drawHud(ctx) {
    const C = G.CFG;
    ctx.save();
    // Exactly one tile tall, so it sits flush on the room's top wall row.
    const barH = C.TILE;
    ctx.fillStyle = 'rgba(8,10,16,0.82)';
    ctx.fillRect(0, 0, C.W, barH);
    const midY = barH / 2;

    // Health pips
    for (let i = 0; i < this.hero.maxHp; i++) {
      const filled = i < this.hero.hp;
      ctx.fillStyle = filled ? '#e0455f' : 'rgba(255,255,255,0.14)';
      G.U.roundRect(ctx, 14 + i * 17, midY - 6, 12, 12, 3);
      ctx.fill();
    }

    // Dash cooldown meter
    const dashX = 14 + this.hero.maxHp * 17 + 14;
    const dashReady = this.hero.dashCd <= 0;
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    G.U.roundRect(ctx, dashX, midY - 4, 34, 8, 3);
    ctx.fill();
    ctx.fillStyle = C.col.heroDash;
    const fill = dashReady ? 1 : 1 - this.hero.dashCd / C.hero.dashCooldown;
    G.U.roundRect(ctx, dashX, midY - 4, 34 * fill, 8, 3);
    ctx.fill();

    this.text(ctx, `ROOM ${this.roomIndex} / ${C.ROOMS_TO_ESCAPE}`, C.W / 2, midY,
      { size: 13, color: C.col.text, align: 'center', weight: 'bold' });

    const left = this.enemies.length;
    this.text(ctx, left > 0 ? `${left} REMAIN` : 'ROOM CLEAR', C.W - 16, midY,
      { size: 12, color: left > 0 ? C.col.dim : C.col.door, align: 'right', weight: 'bold' });

    // The Warden whispers on entry — keeps its presence felt mid-room.
    if (this.state === STATE.PLAY && this.stateTime < 3.4 && this.plan) {
      const a = G.U.clamp(Math.min(this.stateTime * 3, (3.4 - this.stateTime) * 2), 0, 1);
      ctx.globalAlpha = a * 0.9;
      this.text(ctx, `“${this.plan.taunt}”`, C.W / 2, C.H - 26,
        { size: 15, color: C.col.warden, align: 'center', italic: true });
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  },

  drawTitle(ctx) {
    const C = G.CFG;
    // Drifting background motes so the title isn't dead air.
    ctx.fillStyle = 'rgba(255,255,255,0.045)';
    for (let i = 0; i < 40; i++) {
      const x = (i * 137.5 + this.time * 12 * (1 + i % 3)) % C.W;
      const y = (i * 71.3) % C.H;
      ctx.fillRect(x, y, 2, 2);
    }

    this.text(ctx, 'THE WARDEN', C.W / 2, 176, { size: 62, align: 'center', weight: '900', color: C.col.text });
    this.text(ctx, 'a dungeon that is paying attention', C.W / 2, 222,
      { size: 17, align: 'center', color: C.col.warden, italic: true });

    this.text(ctx, `Escape ${G.CFG.ROOMS_TO_ESCAPE} rooms. It rebuilds each one around how you played the last.`,
      C.W / 2, 300, { size: 15, align: 'center', color: C.col.dim });

    const rows = [
      ['WASD / Arrows', 'move'],
      ['Mouse', 'aim'],
      ['Left click', 'swing'],
      ['Shift / Space', 'dash (brief invulnerability)'],
    ];
    rows.forEach((r, i) => {
      const y = 358 + i * 26;
      this.text(ctx, r[0], C.W / 2 - 16, y, { size: 14, align: 'right', color: C.col.text, weight: 'bold' });
      this.text(ctx, r[1], C.W / 2 + 16, y, { size: 14, align: 'left', color: C.col.dim });
    });

    if (this.best > 0) {
      this.text(ctx, `deepest room reached: ${this.best}`, C.W / 2, 500,
        { size: 13, align: 'center', color: C.col.dim });
    }

    const pulse = 0.55 + Math.sin(this.time * 3.4) * 0.45;
    ctx.globalAlpha = pulse;
    this.text(ctx, 'CLICK TO DESCEND', C.W / 2, 560,
      { size: 18, align: 'center', color: C.col.door, weight: 'bold' });
    ctx.globalAlpha = 1;
  },

  drawCard(ctx) {
    const C = G.CFG;
    ctx.fillStyle = 'rgba(8,10,16,0.9)';
    ctx.fillRect(0, 0, C.W, C.H);

    const p = this.plan;
    const cx = C.W / 2;

    this.text(ctx, `ROOM ${this.roomIndex}`, cx, 150,
      { size: 46, align: 'center', weight: '900', color: C.col.text });

    ctx.strokeStyle = 'rgba(176,107,224,0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cx - 220, 186); ctx.lineTo(cx + 220, 186); ctx.stroke();

    this.text(ctx, 'THE WARDEN', cx, 214,
      { size: 12, align: 'center', color: C.col.warden, weight: 'bold', spacing: true });

    this.text(ctx, p.read, cx, 262, { size: 22, align: 'center', color: C.col.text, italic: true });
    this.text(ctx, p.counter, cx, 296, { size: 22, align: 'center', color: C.col.warden, italic: true });

    this.text(ctx, `garrison: ${p.composition}`, cx, 372,
      { size: 14, align: 'center', color: C.col.dim });
    if (this.room.traps.length) {
      // Only claim it's reading your footsteps once it actually has some.
      const note = p.trapsFromHeat
        ? `${this.room.traps.length} spike plates, laid where you walk`
        : `${this.room.traps.length} spike plates, scattered blind`;
      this.text(ctx, note, cx, 396, { size: 14, align: 'center', color: C.col.dim });
    }

    const pulse = 0.5 + Math.sin(this.time * 3.4) * 0.5;
    ctx.globalAlpha = this.stateTime > 0.35 ? pulse : 0;
    this.text(ctx, 'CLICK TO ENTER', cx, 500,
      { size: 17, align: 'center', color: C.col.door, weight: 'bold' });
    ctx.globalAlpha = 1;
  },

  drawEnd(ctx, won) {
    const C = G.CFG;
    ctx.fillStyle = won ? 'rgba(10,16,14,0.92)' : 'rgba(14,8,10,0.92)';
    ctx.fillRect(0, 0, C.W, C.H);
    const cx = C.W / 2;

    this.text(ctx, won ? 'YOU ESCAPED' : 'THE DUNGEON KEEPS YOU', cx, 108,
      { size: won ? 52 : 42, align: 'center', weight: '900', color: won ? '#8ee06f' : '#e0455f' });

    this.text(ctx,
      won ? `Eight rooms. ${this.runTime.toFixed(1)}s. It never found the answer.`
          : `Room ${this.roomIndex} of ${G.CFG.ROOMS_TO_ESCAPE} · ${this.runTime.toFixed(1)}s survived`,
      cx, 150, { size: 16, align: 'center', color: C.col.dim });

    this.text(ctx, 'WHAT IT LEARNED ABOUT YOU', cx, 214,
      { size: 12, align: 'center', color: C.col.warden, weight: 'bold', spacing: true });

    // Dossier bars — the payoff. Shows the profile that was driving generation.
    const rows = this.warden.dossier();
    const barW = 240, x0 = cx - barW / 2;
    rows.forEach((r, i) => {
      const y = 254 + i * 40;
      this.text(ctx, r.label, x0 - 18, y, { size: 13, align: 'right', color: C.col.text });

      ctx.fillStyle = 'rgba(255,255,255,0.09)';
      G.U.roundRect(ctx, x0, y - 5, barW, 10, 5); ctx.fill();
      ctx.fillStyle = C.col.warden;
      const knob = x0 + G.U.clamp(r.v, 0, 1) * barW;
      G.U.roundRect(ctx, knob - 5, y - 8, 10, 16, 4); ctx.fill();

      this.text(ctx, r.v < 0.5 ? r.lo : r.hi, x0 + barW + 18, y,
        { size: 13, align: 'left', color: C.col.dim });
    });

    const pulse = 0.5 + Math.sin(this.time * 3.4) * 0.5;
    ctx.globalAlpha = this.stateTime > 0.9 ? pulse : 0;
    this.text(ctx, 'CLICK TO TRY AGAIN', cx, 588,
      { size: 16, align: 'center', color: C.col.door, weight: 'bold' });
    ctx.globalAlpha = 1;
  },

  /* Small text helper so call sites stay readable. */
  text(ctx, str, x, y, o = {}) {
    const {
      size = 16, color = '#fff', align = 'left',
      weight = 'normal', italic = false, spacing = false,
    } = o;
    ctx.font = `${italic ? 'italic ' : ''}${weight} ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    if (spacing) {
      // Poor man's letter-spacing for the small caps labels.
      const chars = [...str];
      const gap = 2.5;
      const total = chars.reduce((s, c) => s + ctx.measureText(c).width + gap, 0) - gap;
      let cx = align === 'center' ? x - total / 2 : x;
      ctx.textAlign = 'left';
      for (const c of chars) {
        ctx.fillText(c, cx, y);
        cx += ctx.measureText(c).width + gap;
      }
      return;
    }
    ctx.fillText(str, x, y);
  },
};

addEventListener('DOMContentLoaded', () => {
  G.Game.init(document.getElementById('game'));
});
