/* ============================================================================
   LEVEL — the dungeon grid, what you've built into it, and pathfinding.

   The one rule that makes this genre work: you may never fully seal the
   dungeon. Every wall placement is validated against a fresh path search and
   rejected if it would leave the hero no route. Mazing is the whole strategy,
   so this check runs constantly and has to be cheap — the grid is 24×16, so a
   full A* per attempted placement costs nothing.
   ========================================================================== */
window.G = window.G || {};

G.FLOOR = 0;
G.BEDROCK = 1;

G.Level = class Level {
  constructor() {
    const C = G.CFG;
    this.w = C.GRID_W;
    this.h = C.GRID_H;
    this.tiles = new Uint8Array(this.w * this.h);
    this.placed = new Array(this.w * this.h).fill(null);

    this.entrance = { tx: 1, ty: 8 };
    this.vault = { tx: this.w - 2, ty: 8 };

    this._carve();
  }

  i(tx, ty) { return ty * this.w + tx; }
  inBounds(tx, ty) { return tx >= 0 && ty >= 0 && tx < this.w && ty < this.h; }

  at(tx, ty) {
    if (!this.inBounds(tx, ty)) return G.BEDROCK;
    return this.tiles[this.i(tx, ty)];
  }

  placedAt(tx, ty) {
    if (!this.inBounds(tx, ty)) return null;
    return this.placed[this.i(tx, ty)];
  }

  /* Blocked for pathing: natural rock, or a wall you built. */
  blocked(tx, ty) {
    if (this.at(tx, ty) === G.BEDROCK) return true;
    const p = this.placedAt(tx, ty);
    return !!(p && G.CFG.place[p.kind].blocks);
  }

  isEntrance(tx, ty) { return tx === this.entrance.tx && ty === this.entrance.ty; }
  isVault(tx, ty) { return tx === this.vault.tx && ty === this.vault.ty; }

  center(tx, ty) {
    const T = G.CFG.TILE;
    return { x: tx * T + T / 2, y: ty * T + T / 2 };
  }
  tileOf(x, y) {
    const T = G.CFG.TILE;
    return { tx: Math.floor(x / T), ty: Math.floor(y / T) };
  }

  /* ---- Layout ----------------------------------------------------------- */

  _carve() {
    for (let ty = 0; ty < this.h; ty++) {
      for (let tx = 0; tx < this.w; tx++) {
        const border = tx === 0 || ty === 0 || tx === this.w - 1 || ty === this.h - 1;
        this.tiles[this.i(tx, ty)] = border ? G.BEDROCK : G.FLOOR;
      }
    }

    // A few fixed rock masses. Hand-placed rather than random: the level is
    // the same every run, so skill comes from how YOU build into it, and you
    // can actually learn the space.
    const rocks = [
      [6, 2, 2, 3], [6, 11, 2, 3],
      [11, 5, 3, 2], [11, 9, 3, 2],
      [17, 3, 2, 3], [17, 10, 2, 3],
      [9, 0, 1, 2], [14, 14, 1, 2],
    ];
    for (const [x, y, w, h] of rocks) {
      for (let ty = y; ty < y + h; ty++) {
        for (let tx = x; tx < x + w; tx++) {
          if (this.inBounds(tx, ty)) this.tiles[this.i(tx, ty)] = G.BEDROCK;
        }
      }
    }

    // Guarantee the two anchor tiles are open.
    this.tiles[this.i(this.entrance.tx, this.entrance.ty)] = G.FLOOR;
    this.tiles[this.i(this.vault.tx, this.vault.ty)] = G.FLOOR;
  }

  /* ---- Building --------------------------------------------------------- */

  canPlace(kind, tx, ty) {
    if (!this.inBounds(tx, ty)) return { ok: false, reason: '' };
    if (this.at(tx, ty) === G.BEDROCK) return { ok: false, reason: 'Solid rock.' };
    if (this.placedAt(tx, ty)) return { ok: false, reason: 'Something is already here.' };
    if (this.isEntrance(tx, ty)) return { ok: false, reason: 'He comes in here.' };
    if (this.isVault(tx, ty)) return { ok: false, reason: 'The vault must stay clear.' };

    if (G.CFG.place[kind].blocks) {
      // Temporarily commit the wall and check the dungeon is still solvable.
      this.placed[this.i(tx, ty)] = { kind };
      const ok = !!this.findPath(this.entrance, this.vault);
      this.placed[this.i(tx, ty)] = null;
      if (!ok) return { ok: false, reason: 'That would seal the dungeon.' };
    }
    return { ok: true, reason: '' };
  }

  place(kind, tx, ty) {
    const def = G.CFG.place[kind];
    const obj = { kind, tx, ty, ...this.center(tx, ty) };

    if (kind === 'spikes') { obj.armed = true; obj.rearm = 0; obj.known = false; }
    if (kind === 'dart') {
      obj.timer = Math.random() * def.interval;
      obj.dir = this._bestLane(tx, ty);
      obj.known = false;
    }
    if (def.monster) {
      obj.hp = def.hp; obj.maxHp = def.hp;
      obj.post = this.center(tx, ty);
      obj.cd = 0; obj.hitFlash = 0; obj.radius = def.radius;
      obj.vx = 0; obj.vy = 0;
    }

    this.placed[this.i(tx, ty)] = obj;
    return obj;
  }

  remove(tx, ty) {
    const p = this.placedAt(tx, ty);
    if (!p) return null;
    this.placed[this.i(tx, ty)] = null;
    return p;
  }

  /* Point a dart trap down whichever axis has the longest clear run. */
  _bestLane(tx, ty) {
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    let best = dirs[0], bestLen = -1;
    for (const [dx, dy] of dirs) {
      let len = 0;
      let x = tx + dx, y = ty + dy;
      while (this.inBounds(x, y) && !this.blocked(x, y)) { len++; x += dx; y += dy; }
      if (len > bestLen) { bestLen = len; best = [dx, dy]; }
    }
    return { dx: best[0], dy: best[1], len: bestLen };
  }

  allPlaced() {
    const out = [];
    for (const p of this.placed) if (p) out.push(p);
    return out;
  }

  /* ---- Pathfinding ------------------------------------------------------ */

  /* A* over the grid. `danger` is an optional per-tile extra cost — this is
     how the hero's memory of pain bends its route without any special-casing
     in the AI itself. Eight-directional, but corner-cutting is forbidden so
     it can never squeeze diagonally between two walls. */
  findPath(start, goal, danger = null) {
    const W = this.w, H = this.h;
    const n = W * H;
    const startI = this.i(start.tx, start.ty);
    const goalI = this.i(goal.tx, goal.ty);
    if (this.blocked(goal.tx, goal.ty)) return null;

    const g = new Float64Array(n).fill(Infinity);
    const f = new Float64Array(n).fill(Infinity);
    const from = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const open = [];

    const hx = (i) => {
      const ax = i % W, ay = (i / W) | 0;
      return Math.hypot(goal.tx - ax, goal.ty - ay);
    };

    g[startI] = 0; f[startI] = hx(startI);
    open.push(startI);

    const NB = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

    while (open.length) {
      // Linear extract-min: the grid is tiny, a heap would be premature.
      let bi = 0;
      for (let k = 1; k < open.length; k++) if (f[open[k]] < f[open[bi]]) bi = k;
      const cur = open.splice(bi, 1)[0];
      if (cur === goalI) break;
      closed[cur] = 1;

      const cx = cur % W, cy = (cur / W) | 0;
      for (const [dx, dy] of NB) {
        const nx = cx + dx, ny = cy + dy;
        if (!this.inBounds(nx, ny) || this.blocked(nx, ny)) continue;
        if (dx !== 0 && dy !== 0) {
          // No slipping through a diagonal gap between two blocked tiles.
          if (this.blocked(cx + dx, cy) || this.blocked(cx, cy + dy)) continue;
        }
        const ni = this.i(nx, ny);
        if (closed[ni]) continue;

        const step = (dx !== 0 && dy !== 0) ? 1.4142 : 1;
        const extra = danger ? danger[ni] : 0;
        const tentative = g[cur] + step + extra;
        if (tentative < g[ni]) {
          g[ni] = tentative;
          f[ni] = tentative + hx(ni);
          from[ni] = cur;
          if (!open.includes(ni)) open.push(ni);
        }
      }
    }

    if (from[goalI] === -1 && goalI !== startI) return null;

    const path = [];
    let cur = goalI;
    while (cur !== -1) {
      path.push({ tx: cur % W, ty: (cur / W) | 0 });
      if (cur === startI) break;
      cur = from[cur];
    }
    return path.reverse();
  }

  /* Straight-line tile walk, used for dart line of fire. */
  laneClearTo(tx, ty, dir, targetTx, targetTy, maxLen) {
    let x = tx + dir.dx, y = ty + dir.dy;
    for (let i = 0; i < maxLen; i++) {
      if (!this.inBounds(x, y) || this.at(x, y) === G.BEDROCK) return false;
      const p = this.placedAt(x, y);
      if (p && G.CFG.place[p.kind].blocks) return false;
      if (x === targetTx && y === targetTy) return true;
      x += dir.dx; y += dir.dy;
    }
    return false;
  }
};
