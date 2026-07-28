/* ============================================================================
   THE WARDEN — an adversarial AI director.

   This is the whole point of the game, so it's worth stating plainly:

     1. OBSERVE   every frame, sample what the hero is doing (tick)
     2. PROFILE   at the end of a room, fold those samples into a running
                  profile of habits, using an EMA so it tracks recent play
                  rather than your first nervous minute (endRoom)
     3. COUNTER   when building the next room, spend an enemy budget on
                  whichever types punish the strongest habits, and put spikes
                  on the floor tiles you personally walk on most (planRoom)
     4. CONFESS   tell the player what it noticed (line / read / counter)

   Step 4 is not decoration. An adaptive system the player can't perceive is
   indistinguishable from random noise — they'll never credit it. Making the
   Warden announce its reads is what turns "the game got harder" into "it is
   doing this to ME."

   The FAIRNESS clamps below are load-bearing. An unbeatable adversary is a
   trivial thing to write and nobody wants to play it. The interesting design
   problem is being *maximally* mean inside constraints that keep it winnable.
   ========================================================================== */
window.G = window.G || {};

const norm01 = (v, lo, hi) => G.U.clamp((v - lo) / (hi - lo), 0, 1);

G.Warden = class Warden {
  constructor() {
    const C = G.CFG;

    // Running read on the player. Everything is 0..1. Starts neutral so the
    // first couple of rooms are honest, and it earns its opinions.
    this.profile = {
      ranged: 0.5,      // do you hold distance, or get in their face?
      mobility: 0.5,    // do you keep moving, or plant your feet?
      aggression: 0.5,  // how hard do you mash attack?
      dashLove: 0.5,    // how much do you rely on the dash?
      wallHug: 0.5,     // do you skirt the edges or take the middle?
      skill: 0.5,       // are you actually winning comfortably?
    };

    // Where you walk. Persists across rooms — this is what spikes key off.
    this.heat = new Float32Array(C.GRID_W * C.GRID_H);

    this.killOrder = { grunt: 0, charger: 0, bomber: 0, caster: 0 };
    this.lowHpRooms = 0;
    this.history = [];      // one entry per room, for the end-of-run dossier
    this._resetRoomStats();
  }

  _resetRoomStats() {
    this.rs = {
      time: 0, moving: 0, wallTime: 0,
      nearestSum: 0, nearestSamples: 0,
      attacks: 0, dashes: 0, damageTaken: 0,
      killed: 0, trapHits: 0,
    };
  }

  /* ======================================================================
     1. OBSERVE
     ==================================================================== */
  tick(dt, game) {
    const C = G.CFG;
    const hero = game.hero;
    const rs = this.rs;
    rs.time += dt;

    const speed = Math.hypot(hero.vx, hero.vy);
    if (speed > 26) rs.moving += dt;

    // Heat: where does this player actually stand?
    const tx = G.U.clamp(Math.floor(hero.x / C.TILE), 0, C.GRID_W - 1);
    const ty = G.U.clamp(Math.floor(hero.y / C.TILE), 0, C.GRID_H - 1);
    this.heat[ty * C.GRID_W + tx] += dt;

    // Wall-hugging: within ~1.5 tiles of the room edge.
    const edge = C.TILE * 2.5;
    if (hero.x < edge || hero.y < edge ||
        hero.x > C.W - edge || hero.y > C.H - edge) {
      rs.wallTime += dt;
    }

    // Preferred engagement distance.
    let nearest = Infinity;
    for (const e of game.enemies) {
      if (e.dead) continue;
      nearest = Math.min(nearest, G.U.dist(hero.x, hero.y, e.x, e.y));
    }
    if (nearest < Infinity) {
      rs.nearestSum += nearest;
      rs.nearestSamples++;
    }
  }

  reportAttack() { this.rs.attacks++; }
  reportDash() { this.rs.dashes++; }
  reportDamage(n) { this.rs.damageTaken += n; }
  reportTrapHit() { this.rs.trapHits++; }
  reportKill(e) {
    this.rs.killed++;
    this.killOrder[e.type] = (this.killOrder[e.type] || 0) + 1;
  }

  /* ======================================================================
     2. PROFILE
     ==================================================================== */
  endRoom(roomIndex) {
    const rs = this.rs;
    const t = Math.max(0.5, rs.time);
    const lr = G.CFG.warden.learnRate;

    const avgNearest = rs.nearestSamples
      ? rs.nearestSum / rs.nearestSamples
      : 160;

    const sample = {
      ranged: norm01(avgNearest, 46, 300),
      mobility: norm01(rs.moving / t, 0.25, 0.92),
      aggression: norm01(rs.attacks / t, 0.25, 2.1),
      dashLove: norm01(rs.dashes / t, 0.05, 0.75),
      wallHug: norm01(rs.wallTime / t, 0.12, 0.8),
      // Skill: took little damage AND cleared quickly.
      skill: G.U.clamp(
        (1 - norm01(rs.damageTaken, 0, 4)) * 0.65 +
        (1 - norm01(t, 12, 55)) * 0.35, 0, 1),
    };

    // Exponential moving average — recent rooms matter more, but one weird
    // room can't completely rewrite its opinion of you.
    for (const k in this.profile) {
      this.profile[k] = G.U.lerp(this.profile[k], sample[k], lr);
    }

    // Fade the heat map so old habits decay and it tracks your current lane.
    for (let i = 0; i < this.heat.length; i++) this.heat[i] *= 0.72;

    this.history.push({ room: roomIndex, ...sample, damageTaken: rs.damageTaken, time: rs.time });
    this._resetRoomStats();
  }

  /* ======================================================================
     3. COUNTER
     ==================================================================== */
  planRoom(room, roomIndex, heroHp) {
    const W = G.CFG.warden;
    const p = this.profile;

    // --- Budget ----------------------------------------------------------
    let budget = W.baseBudget + roomIndex * W.budgetGrowth + p.skill * W.skillBudgetBonus;

    // FAIRNESS: mercy. Two rooms in a row entered nearly dead and it backs off.
    if (heroHp <= W.mercyHpThreshold) this.lowHpRooms++;
    else this.lowHpRooms = 0;
    const mercy = this.lowHpRooms >= 2;
    if (mercy) budget *= W.mercyBudgetScale;

    budget = Math.max(2, Math.round(budget));

    // --- Which enemies? --------------------------------------------------
    // Each weight is "how well does this type punish what they actually do".
    const unlocked = {
      grunt: true,
      charger: roomIndex >= 2,
      bomber: roomIndex >= 2,
      caster: roomIndex >= 3,
    };

    const weights = {
      grunt: 0.85,
      charger: 0.30 + p.ranged * 2.0 + p.dashLove * 0.45,
      bomber: 0.30 + (1 - p.ranged) * 1.85 + p.aggression * 0.75,
      caster: 0.25 + (1 - p.mobility) * 1.65 + p.wallHug * 0.95,
    };

    const types = [], ws = [];
    for (const k in weights) {
      if (!unlocked[k]) continue;
      types.push(k); ws.push(weights[k]);
    }

    const plan = [];
    let spent = 0;
    let guard = 0;
    while (spent < budget && plan.length < W.maxConcurrent && guard++ < 60) {
      const type = G.U.weightedPick(types, ws);
      const cost = G.CFG.enemies[type].cost;
      if (spent + cost > budget + 0.5) {
        if (spent + G.CFG.enemies.grunt.cost <= budget) { plan.push('grunt'); spent += 1; continue; }
        break;
      }
      plan.push(type);
      spent += cost;
    }
    if (plan.length === 0) plan.push('grunt');

    // --- Where? ----------------------------------------------------------
    const spawns = plan.map((type) => ({
      type,
      ...this._placeEnemy(room, type, room.spawn.x, room.spawn.y),
    }));

    // --- Traps: directly on your favourite floor tiles --------------------
    const trapCount = Math.min(
      W.trapsMax,
      Math.round(W.trapsBase + roomIndex * W.trapsPerRoom) - (mercy ? 2 : 0)
    );
    const trapsFromHeat = this._placeTraps(room, Math.max(0, trapCount));

    // --- Confession -------------------------------------------------------
    const dominant = this._dominantTell();
    const speech = this._speak(dominant, roomIndex, mercy, plan);

    return { spawns, dominant, mercy, budget, trapsFromHeat, ...speech };
  }

  /* Score candidate floor tiles per enemy type instead of placing at random.
     This is what makes casters cover your lane and chargers wait down it. */
  _placeEnemy(room, type, heroX, heroY) {
    const C = G.CFG;
    const W = C.warden;
    let best = null, bestScore = -Infinity;

    for (let i = 0; i < 90; i++) {
      const tx = G.U.randInt(1, room.w - 2);
      const ty = G.U.randInt(1, room.h - 2);
      if (!room.isFloor(tx, ty)) continue;
      const x = tx * C.TILE + C.TILE / 2;
      const y = ty * C.TILE + C.TILE / 2;

      const d = G.U.dist(x, y, heroX, heroY);
      if (d < W.minSpawnDist) continue;          // FAIRNESS: no ambush spawns

      let score = 0;
      const heatHere = this.heat[ty * C.GRID_W + tx];

      if (type === 'caster') {
        // Wants line of sight onto your preferred lane, from far away.
        score += room.lineOfSight(x, y, heroX, heroY) ? 2.2 : 0;
        score += norm01(d, 200, 520) * 1.6;
        score += heatHere * 0.4;
      } else if (type === 'charger') {
        // Wants a long clear runway pointed at you.
        score += room.lineOfSight(x, y, heroX, heroY) ? 1.8 : 0;
        score += norm01(d, 240, 560) * 1.4;
      } else if (type === 'bomber') {
        // Wants to be in the middle of where you'll be fighting.
        score += heatHere * 1.2;
        score += 1 - norm01(d, 200, 600);
      } else {
        score += G.U.rand(1.0);                   // grunts fan out
        score += heatHere * 0.3;
      }

      score += G.U.rand(0.45);                    // keep it from being samey
      if (score > bestScore) { bestScore = score; best = { x, y }; }
    }

    return best || room.randomFloorAway(heroX, heroY, W.minSpawnDist);
  }

  /* Spikes go where YOU walk. Reading a heat map you generated yourself is
     the single most legible adaptive mechanic in here.
     Returns true if placement was actually driven by heat data. */
  _placeTraps(room, count) {
    const C = G.CFG;
    const W = C.warden;

    const cells = [];
    let totalHeat = 0;
    for (let ty = 1; ty < room.h - 1; ty++) {
      for (let tx = 1; tx < room.w - 1; tx++) {
        if (!room.isFloor(tx, ty)) continue;
        if (room._blocksCriticalPath(tx, ty)) continue;   // never trap the doors
        const heat = this.heat[ty * C.GRID_W + tx];
        totalHeat += heat;
        cells.push({ tx, ty, heat });
      }
    }
    if (cells.length === 0) return false;

    // In room 1 there is nothing to read yet. Sorting a flat array would just
    // hand back the top-left corner every time, which looks like a bug and
    // teaches the player the wrong thing about what this system does.
    const useHeat = totalHeat > 1.5;
    if (useHeat) cells.sort((a, b) => b.heat - a.heat);
    else G.U.shuffle(cells);

    let placed = 0;
    let i = 0;
    while (placed < count && i < cells.length * 2) {
      let cell;
      if (useHeat && Math.random() < W.trapHeatBias && i < cells.length) {
        cell = cells[i];                                   // a hotspot
      } else {
        cell = cells[G.U.randInt(0, cells.length - 1)];     // some spread
      }
      i++;
      if (!cell) break;
      // Random phases guarantee gaps in time — you can always wait one out.
      if (room.addTrap(cell.tx, cell.ty, Math.random() * C.trap.cycle)) placed++;
    }
    return useHeat;
  }

  /* ======================================================================
     4. CONFESS
     ==================================================================== */
  _dominantTell() {
    const p = this.profile;
    const tells = [
      { key: 'ranged', score: p.ranged },
      { key: 'melee', score: 1 - p.ranged },
      { key: 'static', score: 1 - p.mobility },
      { key: 'wallHug', score: p.wallHug },
      { key: 'masher', score: p.aggression },
      { key: 'dashy', score: p.dashLove },
    ];
    tells.sort((a, b) => b.score - a.score);
    // Only claim a read if it's actually pronounced.
    return tells[0].score > 0.58 ? tells[0].key : 'none';
  }

  _speak(tell, roomIndex, mercy, plan) {
    const counts = plan.reduce((m, t) => (m[t] = (m[t] || 0) + 1, m), {});
    const summary = Object.entries(counts)
      .map(([t, n]) => `${n}× ${t}`)
      .join(', ');

    const LINES = {
      ranged: {
        read: 'You fight from arm’s length.',
        counter: 'So distance is now a lie. Chargers.',
        taunt: ['Come closer.', 'Range will not save you here.', 'I have shortened the room.'],
      },
      melee: {
        read: 'You like to be close. Touching, almost.',
        counter: 'Then everything you touch will detonate.',
        taunt: ['Hold them tighter.', 'Yes. Get closer.', 'Embrace it.'],
      },
      static: {
        read: 'You plant your feet to swing.',
        counter: 'Standing still is now a wager. Casters.',
        taunt: ['Stay exactly there.', 'Do not move. Please.', 'A still target is a solved one.'],
      },
      wallHug: {
        read: 'You skirt the walls. Always the walls.',
        counter: 'I have paved your edges with iron.',
        taunt: ['The walls know your name.', 'Your lane is prepared.', 'Hug tighter.'],
      },
      masher: {
        read: 'You swing constantly. Rhythm, not judgement.',
        counter: 'I am giving you things you should not hit.',
        taunt: ['Swing away.', 'Every strike is a decision. Ask me how.', 'Keep mashing.'],
      },
      dashy: {
        read: 'You dash out of everything.',
        counter: 'Then I will aim where you land.',
        taunt: ['Dash again. I will wait.', 'You cannot outrun geometry.', 'Predictable.'],
      },
      none: {
        read: 'I am still reading you.',
        counter: 'A standard arrangement, for now.',
        taunt: ['Descend.', 'Deeper, then.', 'Let us see what you are.'],
      },
    };

    const L = LINES[tell] || LINES.none;
    const out = {
      read: L.read,
      counter: L.counter,
      taunt: G.U.pick(L.taunt),
      composition: summary,
    };
    if (mercy) {
      out.counter = 'You are barely standing. I will allow you a smaller room.';
      out.taunt = 'Not out of kindness.';
    }
    if (roomIndex === G.CFG.ROOMS_TO_ESCAPE) {
      out.counter = 'The last door is behind me. Everything I know about you is in this room.';
      out.taunt = 'Do not disappoint me.';
    }
    return out;
  }

  /* End-of-run summary: what it thinks it learned about you. */
  dossier() {
    const p = this.profile;
    return [
      { label: 'Preferred range', v: p.ranged, lo: 'In their face', hi: 'Arm’s length' },
      { label: 'Footwork', v: p.mobility, lo: 'Planted', hi: 'Never still' },
      { label: 'Sword discipline', v: 1 - p.aggression, lo: 'Mashes', hi: 'Patient' },
      { label: 'Dash reliance', v: p.dashLove, lo: 'Rarely', hi: 'Constantly' },
      { label: 'Positioning', v: 1 - p.wallHug, lo: 'Hugs walls', hi: 'Owns the middle' },
      { label: 'Overall read', v: p.skill, lo: 'Struggling', hi: 'Dangerous' },
    ];
  }
};
