/* ============================================================================
   HERO MEMORY — what the adventurer carries between waves.

   This is the mirror of the director in the other prototype, pointed the other
   way. There, the dungeon studied the player. Here, the AI studies YOU.

   Three things persist across waves:

     danger[]   per-tile record of where it got hurt. Fed straight into A* as
                extra movement cost, so avoidance is emergent — there is no
                "avoid traps" branch anywhere in the AI.
     known      which trap tiles it has discovered. Traps are invisible until
                they fire once; after that they are on the map forever.
     source{}   how much damage each thing has dealt it, which decides what
                equipment it shows up wearing next time.

   The consequence you want as a designer: a trap is worth full value once.
   After that you are paying rent on it. Your dungeon has to keep moving.
   ========================================================================== */
window.G = window.G || {};

G.HeroMemory = class HeroMemory {
  constructor() {
    const C = G.CFG;
    this.danger = new Float32Array(C.GRID_W * C.GRID_H);
    this.known = new Set();                 // tile indices of discovered traps
    this.source = { spikes: 0, dart: 0, goblin: 0, brute: 0 };
    this.waveDamage = 0;
    this.loadout = null;
    this.history = [];
  }

  /* Called whenever the hero takes a hit. `ti` is the tile it happened on. */
  recordDamage(kind, ti, amount) {
    this.source[kind] = (this.source[kind] || 0) + amount;
    this.waveDamage += amount;
    if (ti >= 0 && ti < this.danger.length) {
      // Pain spreads slightly to neighbours — it remembers "that corridor",
      // not one exact square, which is both more human and more useful.
      this.danger[ti] += amount * 0.9;
      const C = G.CFG;
      const tx = ti % C.GRID_W, ty = (ti / C.GRID_W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = tx + dx, ny = ty + dy;
        if (nx < 0 || ny < 0 || nx >= C.GRID_W || ny >= C.GRID_H) continue;
        this.danger[ny * C.GRID_W + nx] += amount * 0.25;
      }
    }
  }

  reveal(ti) { this.known.add(ti); }
  knows(ti) { return this.known.has(ti); }

  /* He remembers trap LOCATIONS, not haunted ground. If you pick a trap back
     up, he stops avoiding the bare stone where it used to be.

     Without this, every trap you ever placed became a permanent no-go tile,
     the map silently filled with scar tissue, and relocating traps — the main
     verb of the game — was strictly worse than never placing them at all. */
  forgetRemovedTraps(level) {
    for (const ti of [...this.known]) {
      const tx = ti % G.CFG.GRID_W, ty = (ti / G.CFG.GRID_W) | 0;
      const p = level.placedAt(tx, ty);
      if (!p || (p.kind !== 'spikes' && p.kind !== 'dart')) this.known.delete(ti);
    }
  }

  endWave(waveIndex, survived) {
    this.history.push({
      wave: waveIndex, survived, damage: this.waveDamage,
      loadout: this.loadout ? this.loadout.name : '—',
    });
    // Old pain fades a little, so a corridor you've stopped trapping
    // eventually becomes attractive again. Keeps play from ossifying.
    for (let i = 0; i < this.danger.length; i++) this.danger[i] *= 0.9;
    this.waveDamage = 0;
  }

  /* What hurt it most, overall. */
  dominantSource() {
    let best = null, bestV = 0;
    for (const k in this.source) {
      if (this.source[k] > bestV) { bestV = this.source[k]; best = k; }
    }
    return bestV > 0 ? best : null;
  }

  trapDamage() { return this.source.spikes + this.source.dart; }
  monsterDamage() { return this.source.goblin + this.source.brute; }

  /* Equipment is chosen by what killed it, so your own dungeon dictates the
     counter you have to fight next wave. */
  chooseLoadout(waveIndex) {
    const t = this.trapDamage(), m = this.monsterDamage();

    if (waveIndex <= 1 || (t === 0 && m === 0)) {
      this.loadout = {
        id: 'none', name: 'Nothing in particular',
        note: 'He has no idea what is down here yet.',
        trapMul: 1, monsterMul: 1, potions: 0, damageMul: 1, caution: 1,
      };
    } else if (t > m * 1.35) {
      this.loadout = {
        id: 'boots', name: 'Ironshod Boots',
        note: 'Your traps hurt him. He bought boots, and he is watching the floor.',
        trapMul: 0.55, monsterMul: 1, potions: 0, damageMul: 1, caution: 1.6,
      };
    } else if (m > t * 1.35) {
      this.loadout = {
        id: 'shield', name: 'Kite Shield',
        note: 'Your monsters hurt him. He came back armoured.',
        trapMul: 1, monsterMul: 0.65, potions: 0, damageMul: 1, caution: 0.85,
      };
    } else {
      this.loadout = {
        id: 'whetstone', name: 'Whetstone & Draught',
        note: 'Nothing stood out last time. He sharpened up and brought a spare potion.',
        trapMul: 1, monsterMul: 1, potions: 1, damageMul: 1.25, caution: 1,
      };
    }
    return this.loadout;
  }

  /* Which monster to swing at first — whatever has cost him most. */
  threatRank(kind) { return this.source[kind] || 0; }

  /* Narration. Same principle as the other prototype: an adaptive system the
     player cannot perceive may as well be a random number generator. */
  line(waveIndex) {
    if (waveIndex <= 1) return 'Right. In and out.';
    const d = this.dominantSource();
    const known = this.known.size;
    const LINES = {
      spikes: ['I know where the spikes are now.', 'Watch the floor. Always the floor.', 'Not stepping there again.'],
      dart: ['Those long halls are a shooting gallery.', 'Something fires down the corridors. Keep to the corners.', 'I hate this hallway.'],
      goblin: ['The little ones swarm. Kill them first.', 'Greenskins again. Fine.', 'Cut through the small ones.'],
      brute: ['The big one hits like a cart.', 'Do not let the big one corner me.', 'Shield up for the brute.'],
    };
    if (d && LINES[d]) {
      const base = G.U.pick(LINES[d]);
      return known > 3 ? `${base} (${known} traps mapped)` : base;
    }
    return 'Back again.';
  }
};
