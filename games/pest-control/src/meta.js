/* ============================================================================
   META — the "lite" in roguelite. What survives losing.

   Every run pays out Dread whether you win or lose, and Dread buys permanent
   upgrades that apply to all future runs. This is the difference between a
   roguelike (lose and you have nothing) and a roguelite (lose and you're
   still a little further along than you were).

   Two rules kept in mind while picking these:

     1. Unlocks should add OPTIONS before they add numbers. Snare and Shrieker
        are new verbs; +30 gold is just a bigger opening. A shop that's all
        stat bumps makes the game easier without making it different.
     2. Nothing here may be required to win. Meta upgrades that gate victory
        turn a losing streak into homework.
   ========================================================================== */
window.G = window.G || {};

G.UPGRADES = [
  {
    id: 'snare', name: 'Snare', cost: 4, kind: 'piece',
    desc: 'Unlocks a cheap trap that roots him in place. Pairs with everything.',
  },
  {
    id: 'shrieker', name: 'Shrieker', cost: 6, kind: 'piece',
    desc: 'Unlocks an alarm that drags every nearby monster onto him at once.',
  },
  {
    id: 'purse', name: 'Deeper Purse', cost: 3, kind: 'perk',
    desc: 'Start every run with 40 extra gold.',
  },
  {
    id: 'vault', name: 'Third Vault', cost: 7, kind: 'perk',
    desc: 'Start every run with one more treasure to lose.',
  },
  {
    id: 'quickhand', name: 'Quick Hand', cost: 3, kind: 'perk',
    desc: 'Hand-triggered traps recharge 1.2s faster.',
  },
  {
    id: 'scrap', name: 'Clean Salvage', cost: 3, kind: 'perk',
    desc: 'Picking your own traps back up refunds the full price.',
  },
];

G.Meta = {
  dread: 0,
  owned: new Set(),
  runs: 0,
  bestWave: 0,

  load() {
    try {
      const raw = G.U.load('pest.meta', null);
      if (raw) {
        const d = JSON.parse(raw);
        this.dread = d.dread || 0;
        this.owned = new Set(d.owned || []);
        this.runs = d.runs || 0;
        this.bestWave = d.bestWave || 0;
      }
    } catch { /* corrupt save is not worth crashing over */ }
    return this;
  },

  save() {
    G.U.save('pest.meta', JSON.stringify({
      dread: this.dread,
      owned: [...this.owned],
      runs: this.runs,
      bestWave: this.bestWave,
    }));
  },

  has(id) { return this.owned.has(id); },

  canAfford(u) { return !this.has(u.id) && this.dread >= u.cost; },

  buy(u) {
    if (!this.canAfford(u)) return false;
    this.dread -= u.cost;
    this.owned.add(u.id);
    this.save();
    return true;
  },

  /* Paid out at the end of every run, win or lose. Losing still earns —
     that's the entire point of the mode. */
  award(wavesHeld, won) {
    const earned = wavesHeld + (won ? 6 : 0);
    this.dread += earned;
    this.runs++;
    if (wavesHeld > this.bestWave) this.bestWave = wavesHeld;
    this.save();
    return earned;
  },

  /* Perks folded into starting conditions. */
  startGold() { return this.has('purse') ? 40 : 0; },
  extraTreasures() { return this.has('vault') ? 1 : 0; },
  triggerBonus() { return this.has('quickhand') ? -1.2 : 0; },
  salvageRate() { return this.has('scrap') ? 1 : G.CFG.SALVAGE; },

  /* Which build pieces are available this run. */
  unlockedPieces() {
    const out = [];
    for (const kind in G.CFG.place) {
      const def = G.CFG.place[kind];
      if (def.locked && !this.has(kind)) continue;
      out.push(kind);
    }
    return out;
  },

  /* Dev/testing escape hatch, also handy if a player wants a clean slate. */
  wipe() {
    this.dread = 0; this.owned = new Set(); this.runs = 0; this.bestWave = 0;
    this.save();
  },
};
