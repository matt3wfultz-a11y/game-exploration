/* ============================================================================
   THE HERO — plays the level by itself. You never control this.

   Deliberately simple state machine (TRAVEL / FIGHT / FLEE) sitting on top of
   A*. Almost all of the apparent intelligence comes from one place: the cost
   map it hands to the pathfinder. Remembered pain, known traps and visible
   monsters all become movement cost, and "cleverness" falls out of the search.

   There is no "avoid the spikes" rule anywhere in this file. That's the trick
   worth stealing — encode preferences as costs and let the planner be smart,
   instead of writing behaviour branches you'll be debugging forever.
   ========================================================================== */
window.G = window.G || {};

G.Hero = class Hero {
  /* `archetype` is drawn from the run seed by the game — a different man each
     wave, so no single dungeon layout answers everything. */
  constructor(level, memory, wave, archetype) {
    const C = G.CFG.hero;
    this.level = level;
    this.memory = memory;
    this.wave = wave;
    this.arch = archetype || G.CFG.heroes[0];

    const start = level.center(level.entrance.tx, level.entrance.ty);
    this.x = start.x; this.y = start.y;
    this.radius = C.radius;

    this.maxHp = Math.round(C.baseHp * Math.pow(C.hpGrowth, wave - 1) * this.arch.hp);
    this.hp = this.maxHp;
    this.damage = C.damage * Math.pow(C.damageGrowth, wave - 1) * this.arch.damage;
    this.speed = C.speed * this.arch.speed;

    const lo = memory.loadout;
    this.potions = C.potions + (lo ? lo.potions : 0);
    this.damage *= lo ? lo.damageMul : 1;

    this.rootTimer = 0;      // snares
    this.vaultTimer = 0;     // Fool's Gold pause

    this.state = 'travel';           // travel | fight | flee | done
    this.status = null;              // looted | killed | retreated
    this.path = null;
    this.pathAge = 99;
    this.waypoint = 0;
    this.attackCd = 0;
    this.target = null;
    this.hitFlash = 0;
    this.iframe = 0;
    this.drinkTimer = 0;
    this.noCombat = 0;               // seconds since last exchange
    this.say = '';
    this.sayTimer = 0;
    this.facing = 0;
    this.walkPhase = 0;
    this.distanceTravelled = 0;
  }

  get caution() { return (this.memory.loadout ? this.memory.loadout.caution : 1) * this.arch.caution; }

  speak(line, time = 2.6) { this.say = line; this.sayTimer = time; }

  /* ---- The cost map: this is the whole AI --------------------------------- */
  buildDangerMap(game) {
    const C = G.CFG;
    const n = C.GRID_W * C.GRID_H;
    const d = new Float32Array(n);
    const caution = this.caution;

    for (let i = 0; i < n; i++) {
      // Remembered pain, scaled down so it biases rather than dictates.
      d[i] = Math.min(6, this.memory.danger[i] * 0.18) * C.hero.dangerWeight * 0.35 * caution;
    }

    // A trap it has actually discovered is treated as near-impassable —
    // but only *near*, so a fully trapped corridor is still crossable if
    // that's the only way through.
    for (const ti of this.memory.known) {
      d[ti] += 7 * caution;
    }

    // Monsters are visible from the start. Route around the expensive ones.
    for (const p of this.level.allPlaced()) {
      const def = C.place[p.kind];
      if (!def.monster || p.hp <= 0) continue;
      const threat = 1 + this.memory.threatRank(p.kind) * 0.02;
      const ti = p.ty * C.GRID_W + p.tx;
      d[ti] += 2.2 * threat;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = p.tx + dx, ny = p.ty + dy;
        if (nx < 0 || ny < 0 || nx >= C.GRID_W || ny >= C.GRID_H) continue;
        d[ny * C.GRID_W + nx] += 0.9 * threat;
      }
    }
    return d;
  }

  repath(game, goal) {
    const here = this.level.tileOf(this.x, this.y);
    const danger = this.buildDangerMap(game);
    const path = this.level.findPath(here, goal, danger);
    if (path && path.length) {
      this.path = path;
      this.waypoint = Math.min(1, path.length - 1);
    } else {
      // Cost map made it look hopeless — fall back to raw geometry so he
      // always has *some* plan rather than standing still.
      this.path = this.level.findPath(here, goal) || null;
      this.waypoint = this.path ? Math.min(1, this.path.length - 1) : 0;
    }
    this.pathAge = 0;
  }

  /* ---- Update ------------------------------------------------------------ */
  update(dt, game) {
    if (this.state === 'done') return;

    this.attackCd = Math.max(0, this.attackCd - dt);
    this.iframe = Math.max(0, this.iframe - dt);
    this.hitFlash = Math.max(0, this.hitFlash - dt * 4);
    this.sayTimer = Math.max(0, this.sayTimer - dt);
    this.pathAge += dt;
    this.noCombat += dt;

    if (this.drinkTimer > 0) { this.drinkTimer -= dt; return; }

    // Snared: he can still swing at whatever reaches him, but he cannot move.
    if (this.rootTimer > 0) {
      this.rootTimer -= dt;
      const pinned = this.pickTarget(game);
      if (pinned && this.attackCd <= 0 &&
          G.U.dist(this.x, this.y, pinned.x, pinned.y) <= G.CFG.hero.attackRange + pinned.radius) {
        this.attackCd = G.CFG.hero.attackCooldown;
        this.swing = 0.16;
        game.damageMonster(pinned, this.damage, this.x, this.y);
      }
      return;
    }

    // --- Survival decisions ------------------------------------------------
    const frac = this.hp / this.maxHp;
    if (frac <= G.CFG.hero.potionAtHp && this.potions > 0) {
      this.potions--;
      this.hp = Math.min(this.maxHp, this.hp + this.maxHp * G.CFG.hero.potionHeal);
      this.drinkTimer = 0.9;
      this.speak('Potion. Hold on.');
      G.FX.ring(this.x, this.y, { color: '#8ee06f', radius: 34, life: 0.5, width: 3 });
      G.FX.text(this.x, this.y - 26, '+heal', { color: '#8ee06f', size: 14 });
      return;
    }
    if (frac <= G.CFG.hero.fleeAtHp && this.state !== 'flee' && !game.sealed && !this.arch.neverFlees) {
      // Once he commits to leaving he does not turn around. Without that
      // commitment he oscillates on the HP threshold forever.
      this.state = 'flee';
      this.speak('Not worth dying for. Out!', 3.2);
      this.repath(game, this.level.entrance);
    }
    if (this.state === 'flee' && game.sealed) {
      // Door came down while he was running for it. No way out but forward.
      this.state = 'travel';
      this.speak('Barred. Through, then.', 3.0);
      this.repath(game, this.level.vault);
    }

    if (this.state === 'flee') {
      this.noCombat > 1.2 && (this.hp = Math.min(this.maxHp, this.hp + G.CFG.hero.healRate * dt));
      this.follow(dt, game, this.level.entrance);
      const e = this.level.center(this.level.entrance.tx, this.level.entrance.ty);
      if (G.U.dist(this.x, this.y, e.x, e.y) < 22) {
        this.state = 'done';
        this.status = 'retreated';
      }
      return;
    }

    // --- Fight anything in the way ----------------------------------------
    const target = this.pickTarget(game);
    if (target) {
      this.target = target;
      const d = G.U.dist(this.x, this.y, target.x, target.y);
      this.facing = Math.atan2(target.y - this.y, target.x - this.x);
      if (d <= G.CFG.hero.attackRange + target.radius) {
        this.state = 'fight';
        if (this.attackCd <= 0) {
          this.attackCd = G.CFG.hero.attackCooldown;
          this.swing = 0.16;
          game.damageMonster(target, this.damage, this.x, this.y);
          this.noCombat = 0;
        }
        return;   // planted while swinging
      }
      // Close the distance to the chosen target.
      this.moveToward(target.x, target.y, dt);
      return;
    }

    this.state = 'travel';
    this.target = null;
    this.follow(dt, game, this.level.vault);

    const v = this.level.center(this.level.vault.tx, this.level.vault.ty);
    if (G.U.dist(this.x, this.y, v.x, v.y) < 24) {
      // Fool's Gold buys a few seconds of him standing on the vault. Whether
      // that's worth a relic slot depends entirely on what you built nearby,
      // which is exactly the kind of decision a draft should be making you take.
      const delay = game.mods ? game.mods.vaultDelay : 0;
      if (delay > 0 && this.vaultTimer < delay) {
        this.vaultTimer += dt;
        if (this.vaultTimer < 0.1) this.speak('What is this? Fool\u2019s gold\u2026');
        return;
      }
      this.state = 'done';
      this.status = 'looted';
    }
  }

  /* Nearest engageable monster, weighted by how much that TYPE has hurt him
     historically — this is where the memory changes his target priority. */
  pickTarget(game) {
    let best = null, bestScore = -Infinity;
    for (const p of this.level.allPlaced()) {
      const def = G.CFG.place[p.kind];
      if (!def.monster || p.hp <= 0) continue;
      const d = G.U.dist(this.x, this.y, p.x, p.y);
      if (d > G.CFG.hero.engageRange) continue;
      const score = -d + this.memory.threatRank(p.kind) * 1.6;
      if (score > bestScore) { bestScore = score; best = p; }
    }
    return best;
  }

  follow(dt, game, goal) {
    if (!this.path || this.pathAge > 0.6) this.repath(game, goal);
    if (!this.path || this.path.length === 0) return;

    let wp = this.path[this.waypoint];
    if (!wp) { this.repath(game, goal); wp = this.path[this.waypoint]; if (!wp) return; }

    const c = this.level.center(wp.tx, wp.ty);
    if (G.U.dist(this.x, this.y, c.x, c.y) < 9) {
      if (this.waypoint < this.path.length - 1) this.waypoint++;
      else { this.repath(game, goal); return; }
    }
    this.moveToward(c.x, c.y, dt);
  }

  moveToward(tx, ty, dt) {
    const [dx, dy] = G.U.norm(tx - this.x, ty - this.y);
    const sp = this.speed * (this.state === 'flee' ? G.CFG.hero.fleeSpeedMul : 1);
    this.x += dx * sp * dt;
    this.y += dy * sp * dt;
    this.facing = Math.atan2(dy, dx);
    this.walkPhase += dt * 9;
    this.distanceTravelled += sp * dt;
  }

  /* ---- Damage ------------------------------------------------------------ */
  hurt(amount, kind, fromX, fromY) {
    const lo = this.memory.loadout;
    const isTrap = kind === 'spikes' || kind === 'dart';
    const pierced = isTrap && G.Game.mods && G.Game.mods.pierceBoots > 0;
    const mul = !lo ? 1 : (isTrap ? (pierced ? 1 : lo.trapMul) : lo.monsterMul);
    const dealt = Math.max(1, Math.round(amount * mul));

    this.hp -= dealt;
    this.hitFlash = 1;
    this.noCombat = 0;

    const t = this.level.tileOf(this.x, this.y);
    const ti = t.ty * G.CFG.GRID_W + t.tx;
    this.memory.recordDamage(kind, ti, dealt);

    G.FX.addShake(G.CFG.fx.shakeOnHit);
    G.FX.burst(this.x, this.y, 9, {
      color: '#ff6b7f', speed: 180, life: 0.4, size: 3.5,
      dir: Math.atan2(this.y - fromY, this.x - fromX), spread: 1.7,
    });
    G.FX.text(this.x, this.y - 22, `-${dealt}`, { color: '#ff6b7f', size: 15 });

    if (this.hp <= 0) {
      this.hp = 0;
      this.state = 'done';
      this.status = 'killed';
      G.FX.addShake(12);
      G.FX.burst(this.x, this.y, 34, { color: '#f2e9d8', speed: 260, life: 0.8, size: 4 });
      G.FX.ring(this.x, this.y, { color: '#f2e9d8', radius: 70, life: 0.6, width: 3 });
    }
    return dealt;
  }

  /* ---- Draw -------------------------------------------------------------- */
  draw(ctx, time) {
    const C = G.CFG.col;
    if (this.state === 'done' && this.status !== 'looted') return;

    // Planned route — showing his intent is what makes the run phase readable.
    if (this.path && this.path.length > 1) {
      ctx.strokeStyle = 'rgba(242,233,216,0.13)';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      for (let i = this.waypoint; i < this.path.length; i++) {
        const c = this.level.center(this.path[i].tx, this.path[i].ty);
        i === this.waypoint ? ctx.moveTo(c.x, c.y) : ctx.lineTo(c.x, c.y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.globalAlpha = 0.3;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(this.x, this.y + this.radius * 0.85, this.radius * 0.95, this.radius * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    if (this.swing > 0) {
      this.swing -= 1 / 60;
      ctx.globalAlpha = 0.7;
      ctx.strokeStyle = '#fff8e2';
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(this.x, this.y, 30, this.facing - 0.6, this.facing + 0.6);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    const bob = Math.sin(this.walkPhase) * 1.5;
    const r = this.radius;
    ctx.fillStyle = this.hitFlash > 0.5 ? '#fff' : C.hero;
    G.U.roundRect(ctx, this.x - r, this.y - r + bob, r * 2, r * 2, 5);
    ctx.fill();

    ctx.fillStyle = C.heroDark;
    ctx.beginPath();
    ctx.arc(this.x + Math.cos(this.facing) * r * 0.5, this.y + Math.sin(this.facing) * r * 0.5 + bob, 3, 0, Math.PI * 2);
    ctx.fill();

    // Health bar
    const w = 34;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(this.x - w / 2, this.y - r - 12, w, 4);
    ctx.fillStyle = this.hp / this.maxHp > 0.35 ? '#8ee06f' : '#e0455f';
    ctx.fillRect(this.x - w / 2, this.y - r - 12, w * (this.hp / this.maxHp), 4);

    // Speech — the hero telling you what he learned is the whole feedback loop.
    if (this.sayTimer > 0 && this.say) {
      const a = G.U.clamp(this.sayTimer * 2, 0, 1);
      ctx.globalAlpha = a;
      ctx.font = 'italic 13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const tw = ctx.measureText(this.say).width;
      ctx.fillStyle = 'rgba(10,12,18,0.88)';
      G.U.roundRect(ctx, this.x - tw / 2 - 8, this.y - r - 42, tw + 16, 22, 5);
      ctx.fill();
      ctx.fillStyle = '#e8e4d9';
      ctx.fillText(this.say, this.x, this.y - r - 31);
      ctx.globalAlpha = 1;
    }
  }
};
