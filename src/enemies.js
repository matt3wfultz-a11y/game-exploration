/* ============================================================================
   ENEMIES — four types, each one built to punish a different habit.

     grunt    baseline pressure, no strong opinion
     charger  punishes KITING     (closes 300px before you can react)
     bomber   punishes BRAWLING   (kill it in your face and it takes you with it)
     caster   punishes STANDING STILL / open sightlines

   That mapping is the heart of the design. The Warden reads your habits and
   spends its budget on whichever type counters what you actually do.
   ========================================================================== */
window.G = window.G || {};

let _nextId = 1;

G.makeEnemy = function (type, x, y) {
  const def = G.CFG.enemies[type];
  return {
    id: _nextId++,
    type, def,
    x, y,
    vx: 0, vy: 0,
    kx: 0, ky: 0,             // knockback velocity, decays separately
    hp: def.hp, maxHp: def.hp,
    radius: def.radius,
    dead: false,
    state: 'idle',
    timer: type === 'caster' ? def.firstShotDelay : 0,
    dashDx: 0, dashDy: 0,
    strafeDir: Math.random() < 0.5 ? 1 : -1,
    hitFlash: 0,
    wobble: Math.random() * Math.PI * 2,
    spawnT: 0.35,             // brief fade-in so spawns never feel like cheating
  };
};

/* Steering helper: returns a desired velocity toward/away from a point. */
function seek(e, tx, ty, speed, away = false) {
  let [dx, dy] = G.U.norm(tx - e.x, ty - e.y);
  if (away) { dx = -dx; dy = -dy; }
  return [dx * speed, dy * speed];
}

G.updateEnemy = function (e, dt, game) {
  const def = e.def;
  const hero = game.hero;
  e.hitFlash = Math.max(0, e.hitFlash - dt * 4);
  e.wobble += dt * 4;
  e.spawnT = Math.max(0, e.spawnT - dt);

  const d = G.U.dist(e.x, e.y, hero.x, hero.y);
  let mvx = 0, mvy = 0;

  switch (e.type) {
    /* ---------------------------------------------------------------- */
    case 'grunt': {
      [mvx, mvy] = seek(e, hero.x, hero.y, def.speed);
      break;
    }

    /* ---------------------------------------------------------------- */
    case 'charger': {
      if (e.state === 'idle') {
        [mvx, mvy] = seek(e, hero.x, hero.y, def.speed);
        if (d < def.sightRange && game.room.lineOfSight(e.x, e.y, hero.x, hero.y)) {
          e.state = 'telegraph';
          e.timer = def.telegraph;
        }
      } else if (e.state === 'telegraph') {
        // Stand still and wind up. The pause is the *fairness* — it's your
        // window to move. Shorten `telegraph` and this enemy becomes unfair.
        e.timer -= dt;
        [e.dashDx, e.dashDy] = G.U.norm(hero.x - e.x, hero.y - e.y);
        if (e.timer <= 0) {
          e.state = 'dash';
          e.timer = def.dashTime;
          G.FX.burst(e.x, e.y, 8, {
            color: def.color, speed: 130, life: 0.3,
            dir: Math.atan2(-e.dashDy, -e.dashDx), spread: 1.2,
          });
        }
      } else if (e.state === 'dash') {
        e.timer -= dt;
        mvx = e.dashDx * def.dashSpeed;
        mvy = e.dashDy * def.dashSpeed;
        if (e.timer <= 0) { e.state = 'recover'; e.timer = def.recover; }
      } else {
        e.timer -= dt;
        if (e.timer <= 0) e.state = 'idle';
      }
      break;
    }

    /* ---------------------------------------------------------------- */
    case 'bomber': {
      if (e.state === 'fuse') {
        e.timer -= dt;
        // Keeps drifting at you while lit — you have to actually leave.
        [mvx, mvy] = seek(e, hero.x, hero.y, def.speed * 0.55);
        if (e.timer <= 0) { G.explodeBomber(e, game); return; }
      } else {
        [mvx, mvy] = seek(e, hero.x, hero.y, def.speed);
        if (d < def.fuseRange) {
          e.state = 'fuse';
          e.timer = def.fuse;
          G.FX.ring(e.x, e.y, { color: '#ffd166', radius: def.blastRadius, life: def.fuse, width: 2 });
        }
      }
      break;
    }

    /* ---------------------------------------------------------------- */
    case 'caster': {
      const pref = def.preferredRange;
      if (d < pref * 0.8) [mvx, mvy] = seek(e, hero.x, hero.y, def.speed, true);
      else if (d > pref * 1.25) [mvx, mvy] = seek(e, hero.x, hero.y, def.speed);
      else {
        // Strafe perpendicular so it isn't a sitting duck.
        const [nx, ny] = G.U.norm(hero.x - e.x, hero.y - e.y);
        mvx = -ny * def.speed * e.strafeDir * 0.8;
        mvy = nx * def.speed * e.strafeDir * 0.8;
        if (Math.random() < 0.4 * dt) e.strafeDir *= -1;
      }

      e.timer -= dt;
      if (e.timer <= 0 && game.room.lineOfSight(e.x, e.y, hero.x, hero.y)) {
        e.timer = def.fireInterval;
        const [dx, dy] = G.U.norm(hero.x - e.x, hero.y - e.y);
        game.projectiles.push({
          x: e.x, y: e.y,
          vx: dx * def.shotSpeed, vy: dy * def.shotSpeed,
          radius: def.shotRadius, damage: def.shotDamage, life: 4,
        });
        G.FX.burst(e.x, e.y, 5, {
          color: def.color, speed: 90, life: 0.25,
          dir: Math.atan2(dy, dx), spread: 0.9,
        });
      }
      break;
    }
  }

  // Separation — stops packs from collapsing into one super-enemy.
  for (const o of game.enemies) {
    if (o === e || o.dead) continue;
    const dd = G.U.dist(e.x, e.y, o.x, o.y);
    const min = e.radius + o.radius;
    if (dd > 0 && dd < min) {
      const push = (min - dd) / min;
      const [sx, sy] = G.U.norm(e.x - o.x, e.y - o.y);
      mvx += sx * push * 130;
      mvy += sy * push * 130;
    }
  }

  e.kx *= Math.max(0, 1 - 7 * dt);
  e.ky *= Math.max(0, 1 - 7 * dt);

  e.vx = mvx + e.kx;
  e.vy = mvy + e.ky;
  e.x += e.vx * dt;
  e.y += e.vy * dt;
  game.room.collide(e);
};

G.hurtEnemy = function (e, amount, fromX, fromY, game) {
  if (e.dead) return;
  e.hp -= amount;
  e.hitFlash = 1;
  const [kx, ky] = G.U.norm(e.x - fromX, e.y - fromY);
  e.kx += kx * e.def.knockback;
  e.ky += ky * e.def.knockback;

  G.FX.addShake(G.CFG.fx.shakeOnHit);
  G.FX.addHitStop(G.CFG.fx.hitStop);
  G.FX.burst(e.x, e.y, 8, {
    color: '#ffe9a8', speed: 210, life: 0.3, size: 3.5,
    dir: Math.atan2(e.y - fromY, e.x - fromX), spread: 1.6,
  });

  if (e.hp <= 0) {
    e.dead = true;
    G.FX.addShake(G.CFG.fx.shakeOnKill);
    G.FX.burst(e.x, e.y, 18, { color: e.def.color, speed: 240, life: 0.55, size: 4 });
    G.FX.ring(e.x, e.y, { color: e.def.color, radius: 40, life: 0.3, width: 2 });
    // A bomber killed at melee range still gets you — that's its whole job.
    if (e.type === 'bomber') G.explodeBomber(e, game);
    game.reportKill(e);
  }
};

G.explodeBomber = function (e, game) {
  const def = e.def;
  e.dead = true;
  e.exploded = true;

  G.FX.addShake(G.CFG.fx.shakeOnBlast);
  G.FX.flash('#ffd166', 0.22);
  G.FX.ring(e.x, e.y, { color: '#ffd166', radius: def.blastRadius, life: 0.32, width: 4 });
  G.FX.burst(e.x, e.y, 26, { color: '#ffb347', speed: 320, life: 0.5, size: 5 });

  if (G.U.dist(e.x, e.y, game.hero.x, game.hero.y) < def.blastRadius + game.hero.radius) {
    game.hero.hurt(def.blastDamage, e.x, e.y);
  }
  // Friendly fire is on. It makes bombers a tool as well as a threat.
  for (const o of game.enemies) {
    if (o === e || o.dead) continue;
    if (G.U.dist(e.x, e.y, o.x, o.y) < def.blastRadius + o.radius) {
      G.hurtEnemy(o, def.blastDamage, e.x, e.y, game);
    }
  }
};

/* ---- Drawing -------------------------------------------------------------- */

G.drawEnemy = function (ctx, e, time) {
  const def = e.def;
  const r = e.radius;

  ctx.globalAlpha = 1 - e.spawnT / 0.35 * 0.8;

  // Shadow
  ctx.save();
  ctx.globalAlpha *= 0.28;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(e.x, e.y + r * 0.9, r * 0.9, r * 0.4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  let color = def.color;
  let scale = 1;

  if (e.type === 'charger' && e.state === 'telegraph') {
    // Flash faster as the dash approaches — a readable countdown.
    const urgency = 1 - e.timer / def.telegraph;
    color = Math.floor(time * (8 + urgency * 26)) % 2 ? '#fff' : def.color;
    scale = 1 + urgency * 0.22;
  }
  if (e.type === 'bomber' && e.state === 'fuse') {
    const urgency = 1 - e.timer / def.fuse;
    color = Math.floor(time * (10 + urgency * 30)) % 2 ? '#fff3c4' : def.color;
    scale = 1 + urgency * 0.3;
  }
  if (e.hitFlash > 0.5) color = '#fff';

  ctx.fillStyle = color;
  const rr = r * scale;

  ctx.save();
  ctx.translate(e.x, e.y);

  switch (e.type) {
    case 'grunt': {
      const squash = 1 + Math.sin(e.wobble) * 0.07;
      G.U.roundRect(ctx, -rr, -rr / squash, rr * 2, rr * 2 * squash, 4);
      ctx.fill();
      break;
    }
    case 'charger': {
      // Triangle pointing where it will dash.
      const a = e.state === 'idle'
        ? Math.atan2(e.vy, e.vx)
        : Math.atan2(e.dashDy, e.dashDx);
      ctx.rotate(a);
      ctx.beginPath();
      ctx.moveTo(rr * 1.35, 0);
      ctx.lineTo(-rr * 0.85, -rr * 0.95);
      ctx.lineTo(-rr * 0.85, rr * 0.95);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'bomber': {
      ctx.beginPath();
      ctx.arc(0, 0, rr, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#2a2f3d';
      ctx.fillRect(-2, -rr - 4, 4, 5);
      break;
    }
    case 'caster': {
      ctx.rotate(Math.PI / 4 + Math.sin(e.wobble * 0.6) * 0.12);
      ctx.fillRect(-rr * 0.8, -rr * 0.8, rr * 1.6, rr * 1.6);
      ctx.fillStyle = '#0d1017';
      const charge = 1 - G.U.clamp(e.timer / def.fireInterval, 0, 1);
      ctx.globalAlpha *= 0.35 + charge * 0.65;
      ctx.fillRect(-rr * 0.28, -rr * 0.28, rr * 0.56, rr * 0.56);
      break;
    }
  }
  ctx.restore();

  // Health pips for anything that has taken a hit.
  if (e.hp < e.maxHp) {
    const w = r * 2.2;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(e.x - w / 2, e.y - r - 9, w, 3);
    ctx.fillStyle = '#8ee06f';
    ctx.fillRect(e.x - w / 2, e.y - r - 9, w * (e.hp / e.maxHp), 3);
  }

  ctx.globalAlpha = 1;
};
