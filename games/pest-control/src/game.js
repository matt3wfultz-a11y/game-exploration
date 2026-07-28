/* ============================================================================
   PEST CONTROL — state machine, build UI, run loop, rendering.

     TITLE → BUILD ⇄ RUN → RESULT → BUILD → … → survive 8 waves = WIN
                                        └── 3 treasures stolen = LOSE

   Note what persists across waves and what doesn't. Your buildings persist —
   monsters you lose stay lost, survivors heal. His MEMORY persists too. The
   asymmetry between those two is the game: you spend gold to rebuild, he
   spends nothing to remember.
   ========================================================================== */
window.G = window.G || {};

const ST = { TITLE: 'title', BUILD: 'build', RUN: 'run', RESULT: 'result', WIN: 'win', LOSE: 'lose' };

G.Game = {
  init(canvas) {
    const C = G.CFG;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    canvas.width = C.W;
    canvas.height = C.H;
    G.Input.attach(canvas);

    this.time = 0;
    this.stateTime = 0;
    this.state = ST.TITLE;
    this.best = Number(G.U.load('pest.best', 0));
    this.toast = '';
    this.toastTimer = 0;

    this.newRun();

    this._last = performance.now();
    this._acc = 0;
    requestAnimationFrame(this._frame.bind(this));
  },

  newRun() {
    const C = G.CFG;
    this.level = new G.Level();
    this.memory = new G.HeroMemory();
    this.gold = C.START_GOLD;
    this.wave = 1;
    this.treasures = C.TREASURES;
    this.hero = null;
    this.projectiles = [];
    this.tool = 'spikes';
    this.speedIdx = 0;
    this.triggerCd = 0;
    this.runTime = 0;
    this.sealed = false;   // else the door renders barred during the build phase
    this.lastResult = null;
    this.spentThisWave = 0;
    G.FX.reset();
  },

  setState(s) { this.state = s; this.stateTime = 0; },

  say(msg, t = 2.2) { this.toast = msg; this.toastTimer = t; },

  /* ---- Wave lifecycle ---------------------------------------------------- */

  startWave() {
    this.memory.forgetRemovedTraps(this.level);
    const lo = this.memory.chooseLoadout(this.wave);
    this.hero = new G.Hero(this.level, this.memory, this.wave);
    this.hero.speak(this.memory.line(this.wave), 3.4);
    this.projectiles = [];
    this.triggerCd = 0;
    this.runTime = 0;
    this.sealed = false;
    this._sourceSnapshot = { ...this.memory.source };
    this.setState(ST.RUN);
  },

  endWave(status) {
    const C = G.CFG;
    const bounty = C.BOUNTY_BASE + this.wave * C.BOUNTY_PER_WAVE;
    let gold = 0;
    if (status === 'killed') gold = bounty;
    else if (status === 'retreated') gold = Math.round(bounty * 0.65);
    else {
      this.treasures--;
      // Losing a treasure already costs you a life. Paying nothing on top of
      // that turns one bad wave into an unrecoverable spiral, which reads as
      // the game being broken rather than as you being behind.
      gold = Math.round(bounty * C.LOOT_CONSOLATION);
    }

    this.gold += gold;

    // What actually hurt him this wave — the honest scoreboard for your build.
    const delta = {};
    for (const k in this.memory.source) {
      delta[k] = this.memory.source[k] - (this._sourceSnapshot[k] || 0);
    }

    this.memory.endWave(this.wave, status !== 'killed');
    const survived = this.wave;
    if (survived > this.best) { this.best = survived; G.U.save('pest.best', this.best); }

    // Everything you built comes back between waves — dead monsters included.
    //
    // This is the single most important balance decision in the game. When
    // dead monsters stayed dead, losing a wave stripped your dungeon AND paid
    // you almost nothing, so one bad wave compounded into an unrecoverable
    // run. Making your garrison permanent turns the game into a question of
    // PLACEMENT rather than attrition, and lets a bad wave be a setback
    // instead of a death sentence.
    for (const p of this.level.allPlaced()) {
      const def = C.place[p.kind];
      if (def.monster) p.hp = p.maxHp;
      if (p.kind === 'spikes') { p.armed = true; p.rearm = 0; }
    }

    const nextLoadout = this.memory.chooseLoadout(this.wave + 1);
    this.lastResult = { status, gold, delta, nextLoadout, wave: this.wave };

    if (this.treasures <= 0) { this.setState(ST.LOSE); return; }
    if (this.wave >= C.WAVES_TO_WIN) { this.setState(ST.WIN); return; }
    this.setState(ST.RESULT);
  },

  nextWave() {
    this.wave++;
    this.spentThisWave = 0;
    this.sealed = false;   // the door is open again while you rebuild
    this.runTime = 0;
    this.setState(ST.BUILD);
  },

  revealTrap(t) {
    const ti = t.ty * G.CFG.GRID_W + t.tx;
    if (this.memory.knows(ti)) return;
    this.memory.reveal(ti);
    G.FX.ring(t.x, t.y, { color: '#e0455f', radius: 30, life: 0.45, width: 2 });
    G.FX.text(t.x, t.y - 18, 'SPOTTED', { color: '#e0455f', size: 12, life: 1.1 });
  },

  damageMonster(m, amount, fromX, fromY) {
    m.hp -= amount;
    m.hitFlash = 1;
    G.FX.addShake(G.CFG.fx.shakeOnHit);
    G.FX.burst(m.x, m.y, 7, {
      color: '#ffe9a8', speed: 180, life: 0.3, size: 3,
      dir: Math.atan2(m.y - fromY, m.x - fromX), spread: 1.5,
    });
    if (m.hp <= 0) {
      G.FX.addShake(G.CFG.fx.shakeOnKill);
      G.FX.burst(m.x, m.y, 16, { color: G.CFG.place[m.kind].color, speed: 220, life: 0.5, size: 4 });
    }
  },

  /* ---- Building ---------------------------------------------------------- */

  tryPlace(tx, ty) {
    const def = G.CFG.place[this.tool];
    if (this.gold < def.cost) { this.say('Not enough gold.'); return; }
    const check = this.level.canPlace(this.tool, tx, ty);
    if (!check.ok) { if (check.reason) this.say(check.reason); return; }

    this.level.place(this.tool, tx, ty);
    this.gold -= def.cost;
    this.spentThisWave += def.cost;
    const c = this.level.center(tx, ty);
    G.FX.burst(c.x, c.y, 8, { color: def.color, speed: 90, life: 0.3, size: 3 });
  },

  tryRemove(tx, ty) {
    const p = this.level.placedAt(tx, ty);
    if (!p) return;
    const def = G.CFG.place[p.kind];
    this.level.remove(tx, ty);
    const refund = Math.round(def.cost * G.CFG.SALVAGE);
    this.gold += refund;
    this.say(`Salvaged ${def.name} · +${refund}g`);
  },

  /* ---- Loop -------------------------------------------------------------- */

  _frame(now) {
    requestAnimationFrame(this._frame.bind(this));
    let dt = (now - this._last) / 1000;
    this._last = now;
    dt = Math.min(dt, 0.05);

    const speed = this.state === ST.RUN ? G.CFG.runSpeeds[this.speedIdx] : 1;
    const STEP = 1 / 120;
    this._acc += dt * speed;
    let steps = 0;
    while (this._acc >= STEP && steps < 24) {
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
    this.toastTimer = Math.max(0, this.toastTimer - dt);

    if (G.FX.hitStop > 0) { G.FX.hitStop -= dt; G.FX.update(dt); return; }
    G.FX.update(dt);

    switch (this.state) {
      case ST.TITLE:
        if (G.Input.anyConfirm()) { this.newRun(); this.setState(ST.BUILD); }
        break;
      case ST.BUILD: this.updateBuild(); break;
      case ST.RUN: this.updateRun(dt); break;
      case ST.RESULT:
        if (this.stateTime > 0.4 && G.Input.anyConfirm()) this.nextWave();
        break;
      case ST.WIN:
      case ST.LOSE:
        if (this.stateTime > 0.8 && G.Input.anyConfirm()) this.setState(ST.TITLE);
        break;
    }
  },

  updateBuild() {
    const I = G.Input;

    for (const kind in G.CFG.place) {
      if (I.wasPressed('Digit' + G.CFG.place[kind].key)) this.tool = kind;
    }

    const ui = this.paletteLayout();
    if (I.mouse.pressed) {
      // Palette first, then the board.
      for (const b of ui.buttons) {
        if (this.hit(b, I.mouse.x, I.mouse.y)) { this.tool = b.kind; return; }
      }
      if (this.hit(ui.go, I.mouse.x, I.mouse.y)) { this.startWave(); return; }
      if (I.mouse.onBoard) this.tryPlace(I.mouse.tx, I.mouse.ty);
    }
    if (I.mouse.rightPressed && I.mouse.onBoard) this.tryRemove(I.mouse.tx, I.mouse.ty);
    if (I.wasPressed('Space', 'Enter')) this.startWave();
  },

  updateRun(dt) {
    const I = G.Input;
    this.triggerCd = Math.max(0, this.triggerCd - dt);
    this.runTime += dt;
    if (!this.sealed && this.runTime >= G.CFG.SEAL_TIME) {
      this.sealed = true;
      const e = this.level.center(this.level.entrance.tx, this.level.entrance.ty);
      G.FX.ring(e.x, e.y, { color: '#e0455f', radius: 60, life: 0.6, width: 4 });
      G.FX.text(e.x + 60, e.y, 'BARRED', { color: '#e0455f', size: 15, life: 1.8 });
      G.FX.addShake(9);
    }

    // Your one live power: spring a trap by hand as he crosses it.
    if (I.mouse.pressed) {
      if (this.hit(this.speedButton(), I.mouse.x, I.mouse.y)) {
        this.speedIdx = (this.speedIdx + 1) % G.CFG.runSpeeds.length;
      } else if (I.mouse.onBoard && this.triggerCd <= 0) {
        const p = this.level.placedAt(I.mouse.tx, I.mouse.ty);
        if (p && (p.kind === 'spikes' || p.kind === 'dart')) {
          this.triggerCd = G.CFG.trigger.cooldown;
          if (p.kind === 'spikes') G.Dungeon.springSpikes(p, this);
          else G.Dungeon.fireDart(p, this);
          G.FX.ring(p.x, p.y, { color: '#f0c05a', radius: 32, life: 0.35, width: 2 });
        }
      }
    }
    if (I.wasPressed('Tab', 'KeyF')) {
      this.speedIdx = (this.speedIdx + 1) % G.CFG.runSpeeds.length;
    }

    const hero = this.hero;
    hero.update(dt, this);

    for (const p of this.level.allPlaced()) {
      const def = G.CFG.place[p.kind];
      if (def.monster && p.hp > 0) G.Dungeon.updateMonster(p, dt, this);
      else if (p.kind === 'spikes' || p.kind === 'dart') G.Dungeon.updateTrap(p, dt, this);
    }

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
      const t = this.level.tileOf(p.x, p.y);
      const hitWall = this.level.blocked(t.tx, t.ty);
      const hitHero = hero.state !== 'done' &&
        G.U.dist(p.x, p.y, hero.x, hero.y) < p.radius + hero.radius;
      if (hitHero) hero.hurt(p.damage, 'dart', p.x, p.y);
      if (hitWall || hitHero || p.life <= 0) {
        G.FX.burst(p.x, p.y, 4, { color: '#7fdce0', speed: 90, life: 0.2, size: 2.5 });
        this.projectiles.splice(i, 1);
      }
    }

    if (hero.state === 'done') {
      // Small beat before the result card so the death lands.
      if (this.stateTime > 0.001) this.endWave(hero.status);
    }
  },

  /* ---- UI layout (shared by draw and hit-test) ---------------------------- */

  paletteLayout() {
    const C = G.CFG;
    const y = C.BOARD_Y + C.BOARD_H + 12;
    const buttons = [];
    let x = 14;
    for (const kind in C.place) {
      buttons.push({ kind, x, y, w: 138, h: 70 });
      x += 146;
    }
    return { buttons, go: { x: C.W - 190, y, w: 176, h: 70 } };
  },

  speedButton() {
    const C = G.CFG;
    return { x: C.W - 110, y: C.BOARD_Y + C.BOARD_H + 24, w: 96, h: 46 };
  },

  hit(r, x, y) { return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h; },

  /* ---- Draw -------------------------------------------------------------- */

  draw() {
    const ctx = this.ctx, C = G.CFG;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0c0f16';
    ctx.fillRect(0, 0, C.W, C.H);

    if (this.state === ST.TITLE) { this.drawTitle(ctx); return; }

    ctx.save();
    ctx.translate(0, C.BOARD_Y);
    G.FX.applyShake(ctx);
    this.drawBoard(ctx);
    this.drawPlaced(ctx);
    if (this.hero && this.state === ST.RUN) this.hero.draw(ctx, this.time);
    this.drawProjectiles(ctx);
    G.FX.draw(ctx);
    G.FX.drawTexts(ctx);
    if (this.state === ST.BUILD) this.drawGhost(ctx);
    ctx.restore();

    this.drawTopBar(ctx);
    if (this.state === ST.BUILD) this.drawPalette(ctx);
    if (this.state === ST.RUN) this.drawRunBar(ctx);
    if (this.state === ST.RESULT) this.drawResult(ctx);
    if (this.state === ST.WIN || this.state === ST.LOSE) this.drawEnd(ctx);
  },

  drawBoard(ctx) {
    const C = G.CFG, T = C.TILE;
    for (let ty = 0; ty < this.level.h; ty++) {
      for (let tx = 0; tx < this.level.w; tx++) {
        const x = tx * T, y = ty * T;
        if (this.level.at(tx, ty) === G.BEDROCK) {
          ctx.fillStyle = C.col.bedrock;
          ctx.fillRect(x, y, T, T);
          if (this.level.at(tx, ty - 1) !== G.BEDROCK) {
            ctx.fillStyle = C.col.bedrockTop;
            ctx.fillRect(x, y, T, 6);
          }
        } else {
          ctx.fillStyle = (tx + ty) % 2 ? C.col.floor : C.col.floorAlt;
          ctx.fillRect(x, y, T, T);
          ctx.strokeStyle = C.col.grid;
          ctx.lineWidth = 1;
          ctx.strokeRect(x + 0.5, y + 0.5, T - 1, T - 1);
        }
      }
    }

    // Entrance
    const e = this.level.center(this.level.entrance.tx, this.level.entrance.ty);
    ctx.fillStyle = this.sealed ? '#5c2733' : C.col.entrance;
    G.U.roundRect(ctx, e.x - T / 2 + 4, e.y - T / 2 + 4, T - 8, T - 8, 4);
    ctx.fill();
    if (this.sealed) {
      ctx.fillStyle = '#e0455f';
      for (let i = 0; i < 3; i++) ctx.fillRect(e.x - 13 + i * 10, e.y - T / 2 + 6, 4, T - 12);
    } else {
      this.text(ctx, 'IN', e.x, e.y, { size: 11, align: 'center', color: '#0c0f16', weight: 'bold' });
    }

    // Vault
    const v = this.level.center(this.level.vault.tx, this.level.vault.ty);
    const pulse = 0.75 + Math.sin(this.time * 2.5) * 0.25;
    ctx.globalAlpha = pulse;
    ctx.fillStyle = C.col.vault;
    G.U.roundRect(ctx, v.x - T / 2 + 4, v.y - T / 2 + 4, T - 8, T - 8, 4);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#7a5a12';
    ctx.fillRect(v.x - 5, v.y - 3, 10, 8);
  },

  drawPlaced(ctx) {
    for (const p of this.level.allPlaced()) G.Dungeon.draw(ctx, p, this, this.time);
  },

  drawProjectiles(ctx) {
    ctx.fillStyle = '#9fe8ec';
    for (const p of this.projectiles) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fill();
    }
  },

  drawGhost(ctx) {
    const I = G.Input, C = G.CFG, T = C.TILE;
    if (!I.mouse.onBoard) return;
    const def = C.place[this.tool];
    const check = this.level.canPlace(this.tool, I.mouse.tx, I.mouse.ty);
    const afford = this.gold >= def.cost;
    const ok = check.ok && afford;

    ctx.globalAlpha = 0.5;
    ctx.fillStyle = ok ? def.color : '#e0455f';
    ctx.fillRect(I.mouse.tx * T + 3, I.mouse.ty * T + 3, T - 6, T - 6);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = ok ? '#fff' : '#e0455f';
    ctx.lineWidth = 2;
    ctx.strokeRect(I.mouse.tx * T + 1, I.mouse.ty * T + 1, T - 2, T - 2);

    // Show a monster's reach while placing — guard range is the whole point
    // of where you put it, so it shouldn't be invisible at decision time.
    if (def.monster) {
      const c = this.level.center(I.mouse.tx, I.mouse.ty);
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = def.color;
      ctx.beginPath();
      ctx.arc(c.x, c.y, def.aggro, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  },

  drawTopBar(ctx) {
    const C = G.CFG;
    ctx.fillStyle = '#12151f';
    ctx.fillRect(0, 0, C.W, C.BOARD_Y);
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.fillRect(0, C.BOARD_Y - 1, C.W, 1);

    this.text(ctx, `WAVE ${this.wave}`, 16, 22, { size: 15, weight: '800', color: C.col.text });
    this.text(ctx, `/ ${C.WAVES_TO_WIN}`, 86, 22, { size: 12, color: C.col.dim });

    this.text(ctx, `${this.gold}g`, 150, 22, { size: 15, weight: 'bold', color: C.col.gold });

    // Treasure pips
    for (let i = 0; i < C.TREASURES; i++) {
      const alive = i < this.treasures;
      ctx.fillStyle = alive ? C.col.vault : 'rgba(255,255,255,0.12)';
      G.U.roundRect(ctx, 224 + i * 18, 15, 13, 13, 3);
      ctx.fill();
    }

    if (this.state === ST.RUN && this.hero) {
      const label = { travel: 'SEARCHING', fight: 'FIGHTING', flee: 'FLEEING', done: '' }[this.hero.state];
      this.text(ctx, label, C.W / 2, 22, {
        size: 13, align: 'center', weight: 'bold',
        color: this.hero.state === 'flee' ? C.col.good : C.col.text,
      });
      if (this.sealed) {
        this.text(ctx, 'DOOR BARRED', C.W / 2 + 120, 22,
          { size: 12, align: 'left', weight: 'bold', color: C.col.bad });
      }
      const lo = this.memory.loadout;
      if (lo && lo.id !== 'none') {
        this.text(ctx, lo.name, C.W - 130, 22, { size: 12, align: 'right', color: C.col.dim });
      }
    }

    if (this.toastTimer > 0) {
      ctx.globalAlpha = G.U.clamp(this.toastTimer * 2, 0, 1);
      this.text(ctx, this.toast, C.W / 2, 22, { size: 13, align: 'center', color: C.col.bad });
      ctx.globalAlpha = 1;
    }
  },

  drawPalette(ctx) {
    const C = G.CFG;
    const ui = this.paletteLayout();
    ctx.fillStyle = '#12151f';
    ctx.fillRect(0, C.BOARD_Y + C.BOARD_H, C.W, C.BAR_H);

    for (const b of ui.buttons) {
      const def = C.place[b.kind];
      const sel = this.tool === b.kind;
      const afford = this.gold >= def.cost;

      ctx.fillStyle = sel ? '#222a3c' : '#181c28';
      G.U.roundRect(ctx, b.x, b.y, b.w, b.h, 6);
      ctx.fill();
      ctx.strokeStyle = sel ? def.color : 'rgba(255,255,255,0.09)';
      ctx.lineWidth = sel ? 2 : 1;
      G.U.roundRect(ctx, b.x, b.y, b.w, b.h, 6);
      ctx.stroke();

      ctx.globalAlpha = afford ? 1 : 0.4;
      ctx.fillStyle = def.color;
      G.U.roundRect(ctx, b.x + 12, b.y + 14, 16, 16, 3);
      ctx.fill();

      this.text(ctx, def.name, b.x + 38, b.y + 22, { size: 13, weight: 'bold', color: C.col.text });
      this.text(ctx, `${def.cost}g`, b.x + 38, b.y + 40, {
        size: 12, color: afford ? C.col.gold : C.col.bad,
      });
      this.text(ctx, def.key, b.x + b.w - 16, b.y + 22, { size: 11, align: 'right', color: C.col.dim });
      ctx.globalAlpha = 1;
    }

    // Tooltip for the selected tool.
    const def = C.place[this.tool];
    this.text(ctx, def.desc, 14, C.BOARD_Y + C.BOARD_H + 88, { size: 12, color: C.col.dim, italic: true });

    const go = ui.go;
    const hot = this.hit(go, G.Input.mouse.x, G.Input.mouse.y);
    ctx.fillStyle = hot ? '#e0455f' : '#c23a51';
    G.U.roundRect(ctx, go.x, go.y, go.w, go.h, 6);
    ctx.fill();
    this.text(ctx, 'SEND HIM IN', go.x + go.w / 2, go.y + 28, {
      size: 16, align: 'center', weight: '800', color: '#fff',
    });
    this.text(ctx, 'space', go.x + go.w / 2, go.y + 50, {
      size: 11, align: 'center', color: 'rgba(255,255,255,0.65)',
    });
  },

  drawRunBar(ctx) {
    const C = G.CFG;
    ctx.fillStyle = '#12151f';
    ctx.fillRect(0, C.BOARD_Y + C.BOARD_H, C.W, C.BAR_H);
    const y = C.BOARD_Y + C.BOARD_H;

    this.text(ctx, 'Click a trap to spring it by hand.', 16, y + 30,
      { size: 13, color: C.col.text });
    this.text(ctx, 'It is the only thing you control once he is inside.', 16, y + 50,
      { size: 12, color: C.col.dim, italic: true });

    // Manual trigger cooldown
    const ready = this.triggerCd <= 0;
    const bw = 160;
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    G.U.roundRect(ctx, 16, y + 66, bw, 7, 3); ctx.fill();
    ctx.fillStyle = ready ? C.col.gold : 'rgba(240,192,90,0.5)';
    G.U.roundRect(ctx, 16, y + 66, bw * (ready ? 1 : 1 - this.triggerCd / C.trigger.cooldown), 7, 3);
    ctx.fill();
    this.text(ctx, ready ? 'TRIGGER READY' : 'RECHARGING', 186, y + 71,
      { size: 11, color: ready ? C.col.gold : C.col.dim, weight: 'bold' });

    const sb = this.speedButton();
    const hot = this.hit(sb, G.Input.mouse.x, G.Input.mouse.y);
    ctx.fillStyle = hot ? '#2a3346' : '#1c2231';
    G.U.roundRect(ctx, sb.x, sb.y, sb.w, sb.h, 6); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    G.U.roundRect(ctx, sb.x, sb.y, sb.w, sb.h, 6); ctx.stroke();
    this.text(ctx, `${C.runSpeeds[this.speedIdx]}× speed`, sb.x + sb.w / 2, sb.y + sb.h / 2, {
      size: 13, align: 'center', weight: 'bold', color: C.col.text,
    });
  },

  /* ---- Cards ------------------------------------------------------------- */

  drawResult(ctx) {
    const C = G.CFG;
    const r = this.lastResult;
    ctx.fillStyle = 'rgba(9,11,17,0.93)';
    ctx.fillRect(0, 0, C.W, C.H);
    const cx = C.W / 2;

    const HEAD = {
      killed: ['HE DIED IN YOUR DUNGEON', C.col.good],
      retreated: ['HE RAN', C.col.gold],
      looted: ['HE TOOK A TREASURE', C.col.bad],
    }[r.status];

    this.text(ctx, HEAD[0], cx, 150, { size: 42, align: 'center', weight: '900', color: HEAD[1] });
    this.text(ctx, `Wave ${r.wave}`, cx, 190, { size: 14, align: 'center', color: C.col.dim });

    if (r.gold > 0) {
      this.text(ctx, `+${r.gold} gold`, cx, 226, { size: 18, align: 'center', color: C.col.gold, weight: 'bold' });
    } else {
      this.text(ctx, `${this.treasures} treasure${this.treasures === 1 ? '' : 's'} left`,
        cx, 226, { size: 16, align: 'center', color: C.col.bad });
    }

    // What actually hurt him — tells you which parts of your build earned out.
    this.text(ctx, 'WHAT HURT HIM', cx, 292, {
      size: 12, align: 'center', color: C.col.dim, weight: 'bold', spacing: true,
    });

    const rows = Object.entries(r.delta).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    if (rows.length === 0) {
      this.text(ctx, 'Nothing. He walked straight through.', cx, 326,
        { size: 15, align: 'center', color: C.col.bad, italic: true });
    } else {
      const max = Math.max(...rows.map((x) => x[1]));
      rows.forEach(([kind, v], i) => {
        const y = 326 + i * 26;
        const def = C.place[kind];
        this.text(ctx, def.name, cx - 130, y, { size: 13, align: 'right', color: C.col.text });
        ctx.fillStyle = def.color;
        G.U.roundRect(ctx, cx - 118, y - 5, Math.max(4, (v / max) * 170), 10, 4);
        ctx.fill();
        this.text(ctx, `${v}`, cx + 66, y, { size: 12, align: 'left', color: C.col.dim });
      });
    }

    // The counter he is bringing next time.
    const lo = r.nextLoadout;
    const ly = 326 + Math.max(1, rows.length) * 26 + 34;
    this.text(ctx, 'HE COMES BACK WITH', cx, ly, {
      size: 12, align: 'center', color: '#c98be8', weight: 'bold', spacing: true,
    });
    this.text(ctx, lo.name, cx, ly + 30, { size: 22, align: 'center', color: C.col.text, weight: 'bold' });
    this.text(ctx, lo.note, cx, ly + 56, { size: 14, align: 'center', color: C.col.dim, italic: true });

    if (this.memory.known.size > 0) {
      this.text(ctx, `He has mapped ${this.memory.known.size} of your traps.`, cx, ly + 84,
        { size: 13, align: 'center', color: C.col.bad });
    }

    const pulse = 0.5 + Math.sin(this.time * 3.4) * 0.5;
    ctx.globalAlpha = this.stateTime > 0.4 ? pulse : 0;
    this.text(ctx, 'CLICK TO REBUILD', cx, C.H - 54, {
      size: 16, align: 'center', color: C.col.gold, weight: 'bold',
    });
    ctx.globalAlpha = 1;
  },

  drawEnd(ctx) {
    const C = G.CFG;
    const won = this.state === ST.WIN;
    ctx.fillStyle = won ? 'rgba(10,17,13,0.95)' : 'rgba(17,9,11,0.95)';
    ctx.fillRect(0, 0, C.W, C.H);
    const cx = C.W / 2;

    this.text(ctx, won ? 'THE DUNGEON HOLDS' : 'THE DUNGEON FALLS', cx, 180, {
      size: 48, align: 'center', weight: '900', color: won ? C.col.good : C.col.bad,
    });
    this.text(ctx,
      won ? `Eight waves. He never made it to the vault more than ${C.TREASURES - this.treasures} time${C.TREASURES - this.treasures === 1 ? '' : 's'}.`
          : `He emptied your vault on wave ${this.wave}.`,
      cx, 228, { size: 16, align: 'center', color: C.col.dim });

    this.text(ctx, 'HIS LOG', cx, 300, {
      size: 12, align: 'center', color: C.col.dim, weight: 'bold', spacing: true,
    });
    const hist = this.memory.history.slice(-8);
    hist.forEach((h, i) => {
      const y = 336 + i * 26;
      this.text(ctx, `wave ${h.wave}`, cx - 150, y, { size: 13, align: 'right', color: C.col.dim });
      this.text(ctx, h.survived ? 'got through' : 'stopped', cx - 130, y, {
        size: 13, align: 'left', color: h.survived ? C.col.bad : C.col.good,
      });
      this.text(ctx, `${h.damage} damage taken`, cx + 20, y, { size: 13, align: 'left', color: C.col.dim });
    });

    this.text(ctx, `best: wave ${this.best}`, cx, C.H - 96, { size: 13, align: 'center', color: C.col.dim });
    const pulse = 0.5 + Math.sin(this.time * 3.4) * 0.5;
    ctx.globalAlpha = this.stateTime > 0.8 ? pulse : 0;
    this.text(ctx, 'CLICK TO START OVER', cx, C.H - 54, {
      size: 16, align: 'center', color: C.col.gold, weight: 'bold',
    });
    ctx.globalAlpha = 1;
  },

  drawTitle(ctx) {
    const C = G.CFG;
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    for (let i = 0; i < 44; i++) {
      const x = (i * 137.5 + this.time * 9 * (1 + i % 3)) % C.W;
      const y = (i * 91.7) % C.H;
      ctx.fillRect(x, y, 2, 2);
    }

    this.text(ctx, 'PEST CONTROL', C.W / 2, 190, {
      size: 66, align: 'center', weight: '900', color: C.col.text,
    });
    this.text(ctx, 'you are the dungeon. he is the problem.', C.W / 2, 240, {
      size: 18, align: 'center', color: '#c98be8', italic: true,
    });

    const lines = [
      'Spend gold on walls, traps and monsters. Then send him in and watch.',
      'Kill him and you keep the treasure. Reach wave 8 and the dungeon holds.',
      '',
      'He remembers. Traps are hidden until they fire once — after that he',
      'routes around them forever, and he comes back equipped for whatever',
      'hurt him most. A dungeon that stops changing is a dungeon he solves.',
    ];
    lines.forEach((l, i) => {
      this.text(ctx, l, C.W / 2, 320 + i * 26, {
        size: 15, align: 'center', color: i >= 3 ? C.col.text : C.col.dim,
      });
    });

    if (this.best > 0) {
      this.text(ctx, `best: wave ${this.best}`, C.W / 2, 540, {
        size: 13, align: 'center', color: C.col.dim,
      });
    }
    const pulse = 0.55 + Math.sin(this.time * 3.2) * 0.45;
    ctx.globalAlpha = pulse;
    this.text(ctx, 'CLICK TO BUILD', C.W / 2, 600, {
      size: 20, align: 'center', color: C.col.gold, weight: 'bold',
    });
    ctx.globalAlpha = 1;
  },

  text(ctx, str, x, y, o = {}) {
    const {
      size = 14, color = '#fff', align = 'left',
      weight = 'normal', italic = false, spacing = false,
    } = o;
    ctx.font = `${italic ? 'italic ' : ''}${weight} ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    if (spacing) {
      const chars = [...str], gap = 2.5;
      const total = chars.reduce((s, c) => s + ctx.measureText(c).width + gap, 0) - gap;
      let cx = align === 'center' ? x - total / 2 : x;
      ctx.textAlign = 'left';
      for (const c of chars) { ctx.fillText(c, cx, y); cx += ctx.measureText(c).width + gap; }
      return;
    }
    ctx.fillText(str, x, y);
  },
};

function bootPest() {
  const canvas = document.getElementById('game');
  if (canvas) G.Game.init(canvas);
}
if (document.readyState === 'loading') addEventListener('DOMContentLoaded', bootPest);
else bootPest();
