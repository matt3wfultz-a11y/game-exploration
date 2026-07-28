/* ============================================================================
   CONFIG — every number that defines how the game FEELS lives here.
   This is the file you should be editing constantly. Change one value,
   reload, play. That loop is most of what "game design" actually is.
   ========================================================================== */
window.G = window.G || {};

G.CFG = {
  // --- Canvas / grid ------------------------------------------------------
  TILE: 32,
  GRID_W: 30,          // tiles across (includes 1-tile wall border)
  GRID_H: 20,          // tiles down
  get W() { return this.TILE * this.GRID_W; },   // 960
  get H() { return this.TILE * this.GRID_H; },   // 640

  // --- Run structure ------------------------------------------------------
  ROOMS_TO_ESCAPE: 8,  // clear this many rooms and you win

  // --- Hero ---------------------------------------------------------------
  hero: {
    radius: 11,
    speed: 178,        // px/s top speed
    accel: 1400,       // px/s^2 — higher = snappier, lower = floatier
    friction: 1500,    // px/s^2 decel when no input
    maxHp: 6,
    iframes: 0.85,     // seconds of invulnerability after a hit
    knockback: 210,

    attackCooldown: 0.30,
    attackDamage: 2,
    attackRange: 48,
    attackArc: Math.PI * 0.62,   // ~112 degrees
    attackLunge: 130,            // small forward shove when you swing (juice)
    attackWindow: 0.14,          // how long the hitbox is live

    dashSpeed: 540,
    dashTime: 0.17,
    dashCooldown: 0.85,
    dashIframes: true,
  },

  // --- Enemies ------------------------------------------------------------
  // `cost` is what the Warden pays out of its room budget. Tune costs to
  // change how often each type shows up, not just how strong it is.
  enemies: {
    grunt: {
      cost: 1, hp: 4, radius: 11, speed: 78, damage: 1,
      color: '#c2566b', knockback: 170,
    },
    charger: {
      cost: 2, hp: 3, radius: 12, speed: 58, damage: 2,
      color: '#e0913f', knockback: 150,
      sightRange: 340, telegraph: 0.55, dashSpeed: 440,
      dashTime: 0.42, recover: 0.7,
    },
    bomber: {
      cost: 2, hp: 5, radius: 13, speed: 56, damage: 2,
      color: '#8f7ad6', knockback: 120,
      fuseRange: 46, fuse: 0.65, blastRadius: 68, blastDamage: 2,
    },
    caster: {
      cost: 2, hp: 3, radius: 11, speed: 52, damage: 1,
      color: '#4fa3a8', knockback: 190,
      preferredRange: 215, fireInterval: 1.75, firstShotDelay: 0.8,
      shotSpeed: 205, shotRadius: 5, shotDamage: 1,
    },
  },

  // --- Traps (the Warden's other weapon) ----------------------------------
  trap: {
    damage: 1,
    cycle: 2.3,        // full period, seconds
    upTime: 0.75,      // how long spikes are lethal
    warnTime: 0.45,    // telegraph before they pop
  },

  // --- The Warden (adversarial director) ----------------------------------
  // These knobs decide how nasty and how reactive the dungeon is.
  warden: {
    baseBudget: 3,           // enemy budget in room 1
    budgetGrowth: 1.35,      // added per room
    skillBudgetBonus: 2.6,   // extra budget when it reads you as strong

    maxConcurrent: 7,        // never more than this alive at once (FAIRNESS)
    minSpawnDist: 190,       // never spawn on top of you (FAIRNESS)

    trapsBase: 2,
    trapsPerRoom: 0.9,
    trapsMax: 14,
    trapHeatBias: 0.85,      // 1 = place traps purely on your walking hotspots

    // Mercy: if you enter two rooms in a row nearly dead, it eases off.
    // Delete this and the game becomes technically harder but much worse.
    mercyHpThreshold: 2,
    mercyBudgetScale: 0.62,

    learnRate: 0.34,         // how fast the profile chases your latest room
  },

  // --- Feel / juice -------------------------------------------------------
  fx: {
    shakeOnHit: 5,
    shakeOnKill: 3,
    shakeOnHurt: 11,
    shakeOnBlast: 14,
    hitStop: 0.045,          // freeze frames when you connect — huge for feel
  },

  // --- Palette ------------------------------------------------------------
  col: {
    floor: '#1b1f2b',
    floorAlt: '#191d28',
    wall: '#2e3547',
    wallTop: '#3a4359',
    hero: '#e8e4d9',
    heroDash: '#8fd6ff',
    door: '#f0c05a',
    trap: '#6b7590',
    trapHot: '#d9455f',
    text: '#e8e4d9',
    dim: '#8a90a3',
    warden: '#b06be0',
  },
};
