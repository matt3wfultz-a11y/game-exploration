/* ============================================================================
   DUNGEON — behaviour for the things you place: monsters, spikes, dart traps.

   Monsters guard a POST rather than roaming the level. That single decision is
   what makes placement a real choice: a goblin is not "11 hit points", it is
   "11 hit points standing exactly here". Guards that all swarm the intruder
   would turn every layout into the same fight.
   ========================================================================== */
window.G = window.G || {};

G.Dungeon = {
  /* ---- Monsters ---------------------------------------------------------- */
  updateMonster(m, dt, game) {
    const def = G.CFG.place[m.kind];
    const hero = game.hero;
    m.cd = Math.max(0, m.cd - dt);
    m.hitFlash = Math.max(0, m.hitFlash - dt * 4);

    if (!hero || hero.state === 'done') {
      this._returnToPost(m, def, dt, game);
      return;
    }

    const d = G.U.dist(m.x, m.y, hero.x, hero.y);
    // A guard on the other side of a wall is not in the fight. Without this
    // they reached through solid rock to hit him — and he hit back.
    const canSee = d <= def.aggro && game.level.lineOfSight(m.x, m.y, hero.x, hero.y);

    if (canSee) {
      if (d <= def.attackRange + hero.radius) {
        if (m.cd <= 0) {
          m.cd = def.attackCooldown;
          // Choke: monsters hit harder once he's wounded.
          const choke = (game.mods && hero.hp / hero.maxHp < 0.5) ? game.mods.lowHpDamageMul : 1;
          hero.hurt(Math.round(def.damage * choke), m.kind, m.x, m.y);
          G.FX.burst(hero.x, hero.y, 6, {
            color: def.color, speed: 130, life: 0.3,
            dir: Math.atan2(hero.y - m.y, hero.x - m.x), spread: 1.2,
          });
        }
      } else {
        this._step(m, hero.x, hero.y, def.speed, dt, game);
      }
    } else {
      this._returnToPost(m, def, dt, game);
    }
  },

  _returnToPost(m, def, dt, game) {
    const d = G.U.dist(m.x, m.y, m.post.x, m.post.y);
    if (d > 4) this._step(m, m.post.x, m.post.y, def.speed * 0.7, dt, game);
  },

  _step(m, tx, ty, speed, dt, game) {
    const [dx, dy] = G.U.norm(tx - m.x, ty - m.y);
    const nx = m.x + dx * speed * dt;
    const ny = m.y + dy * speed * dt;
    // Axis-separated so they slide along corners instead of sticking.
    if (!this._solidAt(game.level, nx, m.y, m.radius)) m.x = nx;
    if (!this._solidAt(game.level, m.x, ny, m.radius)) m.y = ny;
  },

  _solidAt(level, x, y, r) { return level.solidForCircle(x, y, r); },

  /* ---- Traps ------------------------------------------------------------- */
  updateTrap(t, dt, game) {
    const def = G.CFG.place[t.kind];
    const hero = game.hero;

    if (t.kind === 'spikes') {
      t.rearm = Math.max(0, t.rearm - dt);
      if (t.rearm <= 0) t.armed = true;
      if (!hero || hero.state === 'done' || !t.armed) return;

      const ht = game.level.tileOf(hero.x, hero.y);
      if (ht.tx === t.tx && ht.ty === t.ty) this.springSpikes(t, game);
      return;
    }

    if (t.kind === 'snare' || t.kind === 'shrieker') {
      t.rearm = Math.max(0, t.rearm - dt);
      if (t.rearm <= 0) t.armed = true;
      if (!hero || hero.state === 'done' || !t.armed) return;
      const ht = game.level.tileOf(hero.x, hero.y);
      if (ht.tx !== t.tx || ht.ty !== t.ty) return;
      if (t.kind === 'snare') this.springSnare(t, game);
      else this.springShrieker(t, game);
      return;
    }

    if (t.kind === 'dart') {
      t.timer -= dt;
      if (!hero || hero.state === 'done') return;
      const ht = game.level.tileOf(hero.x, hero.y);
      const inLane = (t.dir.dx !== 0 && ht.ty === t.ty && Math.sign(ht.tx - t.tx) === t.dir.dx)
                  || (t.dir.dy !== 0 && ht.tx === t.tx && Math.sign(ht.ty - t.ty) === t.dir.dy);
      if (!inLane) return;
      if (G.U.dist(t.x, t.y, hero.x, hero.y) > def.range + (game.mods ? game.mods.dartRange : 0)) return;
      if (!game.level.laneClearTo(t.tx, t.ty, t.dir, ht.tx, ht.ty, 24)) return;
      if (t.timer <= 0) this.fireDart(t, game);
    }
  },

  springSpikes(t, game) {
    const def = G.CFG.place.spikes;
    const hero = game.hero;
    t.armed = false;
    t.rearm = def.rearm * (game.mods ? game.mods.spikeRearmMul : 1);

    G.FX.burst(t.x, t.y, 12, { color: def.color, speed: 150, life: 0.35, size: 4 });

    if (hero && hero.state !== 'done' &&
        G.U.dist(t.x, t.y, hero.x, hero.y) < G.CFG.trigger.radius + hero.radius) {
      hero.hurt(def.damage + (game.mods ? game.mods.spikeDamage : 0), 'spikes', t.x, t.y);
      // Discovered. He will route around this tile for the rest of the run.
      game.revealTrap(t);
      return true;
    }
    return false;
  },

  fireDart(t, game) {
    const def = G.CFG.place.dart;
    const mods = game.mods || {};
    t.timer = def.interval * (mods.dartIntervalMul || 1);

    // Extra darts fan out slightly rather than stacking on one line, so a
    // volley covers a moving target instead of just doing more damage to a
    // stationary one.
    const count = 1 + (mods.dartCount || 0);
    const base = Math.atan2(t.dir.dy, t.dir.dx);
    const spread = 0.13;
    for (let i = 0; i < count; i++) {
      const offset = count === 1 ? 0 : (i - (count - 1) / 2) * spread;
      const a = base + offset;
      game.projectiles.push({
        x: t.x, y: t.y,
        vx: Math.cos(a) * 300, vy: Math.sin(a) * 300,
        radius: 4, damage: def.damage + (mods.dartDamage || 0), life: 2.5,
      });
    }

    G.FX.burst(t.x, t.y, 4 + count * 2, {
      color: def.color, speed: 90, life: 0.2, dir: base, spread: 0.6,
    });
    // Seeing a dart fly is enough — he doesn't have to be hit to learn it.
    game.revealTrap(t);
  },

  /* Turn a placed dart trap 90°. Free, and build-phase only — re-aiming
     mid-run would undercut the whole build-then-commit split. */
  rotateDart(t) {
    const D = G.DART_DIRS;
    const i = D.findIndex((d) => d.dx === t.dir.dx && d.dy === t.dir.dy);
    t.dir = { ...D[(i + 1 + D.length) % D.length] };
    G.FX.ring(t.x, t.y, { color: G.CFG.place.dart.color, radius: 22, life: 0.25, width: 2 });
    return t.dir;
  },

  /* Snares deal no damage at all. Their whole value is holding him inside
     someone else's reach — the first piece in the game that is worthless
     alone and strong in combination. */
  springSnare(t, game) {
    const def = G.CFG.place.snare;
    const hero = game.hero;
    t.armed = false;
    t.rearm = def.rearm;
    hero.rootTimer = def.rootTime * (game.mods ? game.mods.snareMul : 1);
    hero.speak('My leg\u2014!', 1.6);
    G.FX.ring(t.x, t.y, { color: def.color, radius: 30, life: 0.4, width: 3 });
    G.FX.text(t.x, t.y - 18, 'SNARED', { color: def.color, size: 13, life: 1.2 });
    game.revealTrap(t);
  },

  /* Pulls every guard in range onto him at once, which is how you beat a hero
     who has learned to route around your monsters one at a time. */
  springShrieker(t, game) {
    const def = G.CFG.place.shrieker;
    t.armed = false;
    t.rearm = def.rearm;
    let called = 0;
    for (const p of game.level.allPlaced()) {
      const d = G.CFG.place[p.kind];
      if (!d.monster || p.hp <= 0) continue;
      if (G.U.dist(p.x, p.y, t.x, t.y) > def.callRadius) continue;
      // Re-post them onto him: they chase from wherever they now stand.
      p.post = { x: game.hero.x, y: game.hero.y };
      called++;
    }
    G.FX.ring(t.x, t.y, { color: def.color, radius: def.callRadius, life: 0.7, width: 3 });
    G.FX.addShake(7);
    G.FX.text(t.x, t.y - 18, called ? `CALLED ${called}` : 'NOBODY CAME',
      { color: def.color, size: 13, life: 1.4 });
    game.revealTrap(t);
  },

  /* ---- Drawing ----------------------------------------------------------- */
  draw(ctx, p, game, time) {
    const C = G.CFG;
    const def = C.place[p.kind];
    const T = C.TILE;
    const x = p.tx * T, y = p.ty * T;

    if (p.kind === 'wall') {
      ctx.fillStyle = def.color;
      ctx.fillRect(x, y, T, T);
      ctx.fillStyle = 'rgba(255,255,255,0.09)';
      ctx.fillRect(x, y, T, 5);
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, T - 1, T - 1);
      return;
    }

    if (p.kind === 'spikes') {
      const known = game.memory.knows(p.ty * C.GRID_W + p.tx);
      // You always see your own traps. Dimmed once he's mapped them, so
      // "which of my traps still work" is legible at a glance.
      ctx.globalAlpha = p.armed ? (known ? 0.5 : 0.95) : 0.28;
      ctx.fillStyle = def.color;
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          const cx = x + 8 + i * 12, cy = y + 8 + j * 12;
          ctx.beginPath();
          ctx.moveTo(cx, cy - 5);
          ctx.lineTo(cx + 4, cy + 4);
          ctx.lineTo(cx - 4, cy + 4);
          ctx.closePath();
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      if (known) this._knownMark(ctx, x, y, T);
      return;
    }

    if (p.kind === 'snare') {
      const known = game.memory.knows(p.ty * C.GRID_W + p.tx);
      ctx.globalAlpha = p.armed ? (known ? 0.5 : 0.95) : 0.25;
      ctx.strokeStyle = def.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x + T / 2, y + T / 2, T * 0.28, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x + T / 2 - 9, y + T / 2 - 9);
      ctx.lineTo(x + T / 2 + 9, y + T / 2 + 9);
      ctx.stroke();
      ctx.globalAlpha = 1;
      if (known) this._knownMark(ctx, x, y, T);
      return;
    }

    if (p.kind === 'shrieker') {
      const known = game.memory.knows(p.ty * C.GRID_W + p.tx);
      ctx.globalAlpha = p.armed ? (known ? 0.5 : 0.95) : 0.25;
      ctx.fillStyle = def.color;
      ctx.beginPath();
      ctx.moveTo(x + T / 2, y + 8);
      ctx.lineTo(x + T - 9, y + T - 9);
      ctx.lineTo(x + 9, y + T - 9);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha *= 0.5;
      ctx.strokeStyle = def.color;
      ctx.lineWidth = 1.5;
      for (let i = 1; i <= 2; i++) {
        ctx.beginPath();
        ctx.arc(x + T / 2, y + T / 2, 12 + i * 5, -0.9, -0.9 + 1.8);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      if (known) this._knownMark(ctx, x, y, T);
      return;
    }

    if (p.kind === 'dart') {
      const known = game.memory.knows(p.ty * C.GRID_W + p.tx);
      ctx.globalAlpha = known ? 0.55 : 1;
      ctx.fillStyle = def.color;
      G.U.roundRect(ctx, x + 9, y + 9, T - 18, T - 18, 4);
      ctx.fill();
      // Barrel showing the lane it covers.
      ctx.fillRect(x + T / 2 - 3 + p.dir.dx * 13, y + T / 2 - 3 + p.dir.dy * 13, 6, 6);
      ctx.globalAlpha = 0.25;
      ctx.strokeStyle = def.color;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + p.dir.dx * def.range, p.y + p.dir.dy * def.range);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      if (known) this._knownMark(ctx, x, y, T);
      return;
    }

    // Monsters
    if (p.hp <= 0) return;
    const r = p.radius;
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(p.x, p.y + r * 0.85, r * 0.9, r * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.fillStyle = p.hitFlash > 0.5 ? '#fff' : def.color;
    if (p.kind === 'goblin') {
      G.U.roundRect(ctx, p.x - r, p.y - r, r * 2, r * 2, 4);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - r);
      ctx.lineTo(p.x + r, p.y + r * 0.7);
      ctx.lineTo(p.x - r, p.y + r * 0.7);
      ctx.closePath();
      ctx.fill();
    }

    if (p.hp < p.maxHp) {
      const w = r * 2.2;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(p.x - w / 2, p.y - r - 8, w, 3);
      ctx.fillStyle = '#8ee06f';
      ctx.fillRect(p.x - w / 2, p.y - r - 8, w * (p.hp / p.maxHp), 3);
    }
  },

  _knownMark(ctx, x, y, T) {
    ctx.strokeStyle = 'rgba(224,69,95,0.65)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x + 6, y + 6); ctx.lineTo(x + T - 6, y + T - 6);
    ctx.moveTo(x + T - 6, y + 6); ctx.lineTo(x + 6, y + T - 6);
    ctx.stroke();
  },
};
