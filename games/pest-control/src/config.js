/* ============================================================================
   PEST CONTROL — config.

   You are the dungeon. The hero is the problem.

   Balance note before you touch anything: this game is a negotiation between
   two numbers — how much damage a dungeon can deal in one traversal, and how
   much HP the hero brings. Everything else is texture. If waves feel wrong,
   start with `hero.baseHp` / `hero.hpGrowth` and the trap damage values.
   ========================================================================== */
window.G = window.G || {};

G.CFG = {
  TILE: 40,
  GRID_W: 24,
  GRID_H: 16,
  BOARD_Y: 44,          // play area is offset below the top HUD
  BAR_H: 96,            // build palette along the bottom
  get BOARD_W() { return this.TILE * this.GRID_W; },   // 960
  get BOARD_H() { return this.TILE * this.GRID_H; },   // 640
  get W() { return this.BOARD_W; },
  get H() { return this.BOARD_Y + this.BOARD_H + this.BAR_H; },  // 780

  // --- Run structure ------------------------------------------------------
  WAVES_TO_WIN: 8,
  // The entrance bars itself this many seconds after he steps in. Before this
  // existed he could always turn round and stroll out — he is faster than
  // every monster in the game — so "kill the hero" was literally unreachable
  // and every wave ended in a retreat or a robbery. Sealing the door is what
  // converts a chase you cannot win into a fight he has to finish.
  SEAL_TIME: 2.0,
  TREASURES: 5,           // lose them all and the dungeon falls. Five rather
                          // than three purely for the difficulty CURVE: with
                          // three, one bad wave was most of your margin and
                          // the game read as a pass/fail exam.
  START_GOLD: 250,
  BOUNTY_BASE: 52,        // gold for killing the hero
  BOUNTY_PER_WAVE: 14,
  LOOT_CONSOLATION: 0.45,   // gold even when he loots — without this one bad
                           // wave spirals into an unrecoverable run
  SALVAGE: 0.85,          // refund when you pick your own stuff back up.
                          // Relocating traps is the main verb of the game —
                          // taxing it heavily punishes correct play.

  // --- The hero -----------------------------------------------------------
  hero: {
    radius: 12,
    speed: 74,
    baseHp: 26,
    hpGrowth: 1.24,       // per wave — compounding, so late heroes are tanky
    damage: 6,
    damageGrowth: 1.1,
    attackRange: 36,
    attackCooldown: 0.75,
    engageRange: 96,      // will break off travel to fight inside this
    sightRange: 150,      // spots *revealed* hazards this far ahead

    potions: 1,
    potionHeal: 0.45,     // fraction of max hp
    potionAtHp: 0.35,     // drinks below this fraction
    fleeAtHp: 0.14,       // retreats below this. Tuned low on purpose: if he
                          // bails too early, killing him stops being possible
                          // and the whole fantasy of the game evaporates.
    healRate: 1.6,        // hp/sec while retreating out of combat
    fleeSpeedMul: 0.88,   // wounded men run slower than they walked in

    // How strongly remembered pain warps its pathfinding. Higher = more
    // cautious detours. This is the knob that decides whether your traps
    // stay useful or get routed around forever.
    dangerWeight: 2.6,
  },

  // --- Everything you can place -------------------------------------------
  // `cost` is gold. `blocks` means it obstructs pathing (walls only).
  place: {
    wall: {
      name: 'Wall', cost: 12, key: '1', blocks: true,
      color: '#4a5268',
      desc: 'Reroute him. The long way round is the point.',
    },
    spikes: {
      name: 'Spikes', cost: 20, key: '2', hidden: true,
      color: '#c8506a', damage: 7, rearm: 2.4,
      desc: 'Hidden until it bites. Then he remembers it forever.',
    },
    dart: {
      name: 'Dart Trap', cost: 38, key: '3', hidden: true,
      color: '#57b0a8', damage: 4, interval: 1.5, range: 210,
      desc: 'Fires down its lane. Punishes long straight corridors.',
    },
    goblin: {
      name: 'Goblin', cost: 24, key: '4', monster: true,
      color: '#7fae4f', hp: 10, damage: 3, speed: 84,
      attackRange: 28, attackCooldown: 1.0, aggro: 190, radius: 11,
      // Faster than the hero ON PURPOSE. Before this, he outran every
      // monster in the game, so retreating was a guaranteed escape and
      // killing him was impossible. Goblins are the answer to running.
      desc: 'Faster than he is. The only thing that can catch him running.',
    },
    brute: {
      name: 'Brute', cost: 55, key: '5', monster: true,
      color: '#b8683c', hp: 34, damage: 8, speed: 40,
      attackRange: 32, attackCooldown: 1.6, aggro: 120, radius: 14,
      desc: 'A wall that hits back. Holds a corridor while the traps work.',
    },
  },

  // --- Your one live power during a run ------------------------------------
  // Without this you'd just be watching. Timing a manual trigger as he steps
  // across is the only skill expression in the run phase — protect it.
  trigger: {
    cooldown: 4.0,
    radius: 26,           // manual spike hits slightly wider than stepping on it
  },

  runSpeeds: [1, 2, 4],

  fx: { shakeOnHit: 3, shakeOnKill: 5, hitStop: 0.03 },

  col: {
    floor: '#1c2130', floorAlt: '#191e2b',
    bedrock: '#2b3243', bedrockTop: '#3a4356',
    grid: 'rgba(255,255,255,0.028)',
    hero: '#f2e9d8', heroDark: '#2a2f3d',
    vault: '#f0c05a',
    entrance: '#5f6b8a',
    text: '#e8e4d9', dim: '#8990a4',
    gold: '#f0c05a', bad: '#e0455f', good: '#8ee06f',
    ghost: 'rgba(255,255,255,0.22)',
  },
};
