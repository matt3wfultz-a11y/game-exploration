/* ============================================================================
   ROOM — tile grid, layout generation, tile collision, traps, the exit door.

   The *shape* of a room is random-but-safe. The *contents* (enemies, traps)
   are chosen by the Warden in director.js — that's where the adversarial
   behaviour lives. Keeping those separate matters: layout is a fairness
   guarantee, contents are the attack.
   ========================================================================== */
window.G = window.G || {};

G.FLOOR = 0;
G.WALL = 1;

G.Room = class Room {
  constructor(index) {
    const C = G.CFG;
    this.index = index;
    this.w = C.GRID_W;
    this.h = C.GRID_H;
    this.tiles = new Uint8Array(this.w * this.h);
    this.traps = [];
    this.doorOpen = false;

    // Hero always enters on the left, exit is always on the right. Predictable
    // traversal is what makes the Warden's trap placement *readable* — you can
    // see it learning your preferred lane.
    this.spawn = { x: 2.5 * C.TILE, y: (this.h / 2) * C.TILE };
    this.door = { tx: this.w - 1, ty: Math.floor(this.h / 2) };

    this._generate();
  }

  idx(tx, ty) { return ty * this.w + tx; }
  at(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return G.WALL;
    return this.tiles[this.idx(tx, ty)];
  }
  setTile(tx, ty, v) {
    if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return;
    this.tiles[this.idx(tx, ty)] = v;
  }

  _generate() {
    const { w, h } = this;

    // Solid border.
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        this.setTile(x, y, (x === 0 || y === 0 || x === w - 1 || y === h - 1) ? G.WALL : G.FLOOR);
      }
    }

    // Scatter small pillar clusters. Kept sparse and short so the room can
    // never be sealed off — cheap guaranteed connectivity beats a pathfinding
    // check at this scale.
    const clusters = G.U.randInt(3, 5 + Math.min(3, this.index));
    for (let c = 0; c < clusters; c++) {
      const cx = G.U.randInt(5, w - 6);
      const cy = G.U.randInt(3, h - 4);
      const len = G.U.randInt(1, 3);
      const horizontal = Math.random() < 0.5;
      for (let i = 0; i < len; i++) {
        const tx = cx + (horizontal ? i : 0);
        const ty = cy + (horizontal ? 0 : i);
        if (this._blocksCriticalPath(tx, ty)) continue;
        this.setTile(tx, ty, G.WALL);
      }
    }

    this.setTile(this.door.tx, this.door.ty, G.FLOOR);
  }

  /* Keep the spawn pocket and the doorway mouth clear. */
  _blocksCriticalPath(tx, ty) {
    const spawnTx = Math.floor(this.spawn.x / G.CFG.TILE);
    const spawnTy = Math.floor(this.spawn.y / G.CFG.TILE);
    if (Math.abs(tx - spawnTx) <= 2 && Math.abs(ty - spawnTy) <= 2) return true;
    if (Math.abs(tx - this.door.tx) <= 2 && Math.abs(ty - this.door.ty) <= 2) return true;
    return false;
  }

  /* ---- Traps ------------------------------------------------------------ */

  addTrap(tx, ty, phase) {
    if (this.at(tx, ty) !== G.FLOOR) return false;
    if (this.traps.some((t) => t.tx === tx && t.ty === ty)) return false;
    this.traps.push({ tx, ty, phase: phase ?? Math.random() * G.CFG.trap.cycle });
    return true;
  }

  /* Where a trap is in its cycle: 'idle' | 'warn' | 'up' */
  trapState(trap, time) {
    const T = G.CFG.trap;
    const t = (time + trap.phase) % T.cycle;
    if (t < T.upTime) return 'up';
    if (t > T.cycle - T.warnTime) return 'warn';
    return 'idle';
  }

  isFloor(tx, ty) { return this.at(tx, ty) === G.FLOOR; }

  /* ---- Collision -------------------------------------------------------- */

  /* Resolve a circle against solid tiles, one axis at a time so the entity
     slides along walls instead of sticking to them. */
  collide(ent) {
    const T = G.CFG.TILE;
    const r = ent.radius;

    // X axis
    let minTx = Math.floor((ent.x - r) / T), maxTx = Math.floor((ent.x + r) / T);
    let minTy = Math.floor((ent.y - r) / T), maxTy = Math.floor((ent.y + r) / T);
    for (let ty = minTy; ty <= maxTy; ty++) {
      for (let tx = minTx; tx <= maxTx; tx++) {
        if (this.at(tx, ty) !== G.WALL) continue;
        const left = tx * T, right = left + T, top = ty * T, bottom = top + T;
        if (ent.y + r <= top || ent.y - r >= bottom) continue;
        if (ent.x > left && ent.x < right) continue;  // deep overlap, let Y handle it
        if (ent.x + r > left && ent.x < left) { ent.x = left - r; ent.vx = Math.min(0, ent.vx); }
        else if (ent.x - r < right && ent.x > right) { ent.x = right + r; ent.vx = Math.max(0, ent.vx); }
      }
    }

    // Y axis
    minTx = Math.floor((ent.x - r) / T); maxTx = Math.floor((ent.x + r) / T);
    minTy = Math.floor((ent.y - r) / T); maxTy = Math.floor((ent.y + r) / T);
    for (let ty = minTy; ty <= maxTy; ty++) {
      for (let tx = minTx; tx <= maxTx; tx++) {
        if (this.at(tx, ty) !== G.WALL) continue;
        const left = tx * T, right = left + T, top = ty * T, bottom = top + T;
        if (ent.x + r <= left || ent.x - r >= right) continue;
        if (ent.y + r > top && ent.y < top) { ent.y = top - r; ent.vy = Math.min(0, ent.vy); }
        else if (ent.y - r < bottom && ent.y > bottom) { ent.y = bottom + r; ent.vy = Math.max(0, ent.vy); }
      }
    }

    // Final safety clamp so nothing can ever escape the room bounds.
    ent.x = G.U.clamp(ent.x, T + r, (this.w - 1) * T - r);
    ent.y = G.U.clamp(ent.y, T + r, (this.h - 1) * T - r);
  }

  /* True if the straight line a→b is unobstructed. Used for enemy line of
     sight — cheap DDA-ish sampling, plenty accurate at this tile size. */
  lineOfSight(ax, ay, bx, by) {
    const T = G.CFG.TILE;
    const steps = Math.ceil(G.U.dist(ax, ay, bx, by) / (T * 0.4));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
      if (this.at(Math.floor(x / T), Math.floor(y / T)) === G.WALL) return false;
    }
    return true;
  }

  /* Random floor position at least `minDist` from (fx, fy). */
  randomFloorAway(fx, fy, minDist, tries = 220) {
    const T = G.CFG.TILE;
    let best = null, bestD = -1;
    for (let i = 0; i < tries; i++) {
      const tx = G.U.randInt(1, this.w - 2);
      const ty = G.U.randInt(1, this.h - 2);
      if (this.at(tx, ty) !== G.FLOOR) continue;
      const x = tx * T + T / 2, y = ty * T + T / 2;
      const d = G.U.dist(x, y, fx, fy);
      if (d >= minDist) return { x, y };
      if (d > bestD) { bestD = d; best = { x, y }; }
    }
    return best || { x: this.w / 2 * T, y: this.h / 2 * T };
  }
};
