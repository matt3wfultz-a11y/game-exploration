/* ============================================================================
   RELICS — the in-run draft. Pick one of three after every wave.

   Design rule followed here: a relic should change what you BUILD, not just
   how big your numbers are. "+3 spike damage" is a number. "He pauses at the
   vault" changes where you put your killbox. A pool that's all numbers makes
   the draft feel like a tax you pay between waves.

   Implementation is deliberately dumb: every relic contributes to one flat
   `mods` object that the rest of the game reads. No callbacks, no event bus.
   With a pool this size that's less code and far less to debug — and adding a
   relic means adding one entry plus one line at the use site.
   ========================================================================== */
window.G = window.G || {};

G.RELICS = [
  {
    id: 'nails', name: 'Rusted Nails', tag: 'traps',
    desc: 'Spikes deal +4 damage.',
    mods: { spikeDamage: 4 },
  },
  {
    id: 'jaws', name: 'Iron Jaws', tag: 'traps',
    desc: 'Spikes rearm twice as fast — they can bite him twice in one pass.',
    mods: { spikeRearmMul: 0.5 },
  },
  {
    id: 'longhall', name: 'The Long Hall', tag: 'traps',
    desc: 'Dart traps reach much further and hit harder.',
    mods: { dartRange: 110, dartDamage: 2 },
  },
  {
    id: 'warren', name: 'Warren', tag: 'monsters',
    desc: 'Goblins cost 10 less. Swarm him.',
    mods: { costGoblin: -10 },
  },
  {
    id: 'gristle', name: 'Gristle', tag: 'monsters',
    desc: 'Brutes get +14 health. They hold the line longer.',
    mods: { bruteHp: 14 },
  },
  {
    id: 'roots', name: 'Deep Roots', tag: 'building',
    desc: 'Walls cost 6 less. Maze him properly.',
    mods: { costWall: -6 },
  },
  {
    id: 'bell', name: 'Cracked Bell', tag: 'control',
    desc: 'Your hand-triggered trap recharges 2s faster.',
    mods: { triggerCd: -2 },
  },
  {
    id: 'tithe', name: 'Tithe', tag: 'economy',
    desc: '+22 gold at the start of every wave.',
    mods: { goldPerWave: 22 },
  },
  {
    id: 'butcher', name: "Butcher's Due", tag: 'economy',
    desc: 'Killing him pays 35% more.',
    mods: { bountyMul: 0.35 },
  },
  {
    id: 'foolsgold', name: "Fool's Gold", tag: 'control',
    desc: 'He stops to check the vault for 2.5s before taking anything. One last window.',
    mods: { vaultDelay: 2.5 },
  },
  {
    id: 'moss', name: 'Amnesia Moss', tag: 'control',
    desc: 'Each wave he forgets 2 of the traps he had mapped.',
    mods: { forgetPerWave: 2 },
  },
  {
    id: 'choke', name: 'Choke', tag: 'monsters',
    desc: 'Your monsters hit 30% harder once he drops below half health.',
    mods: { lowHpDamageMul: 0.3 },
  },
  {
    id: 'quicklime', name: 'Quicklime', tag: 'traps',
    desc: 'Armour does not help him underfoot — his boots no longer reduce trap damage.',
    mods: { pierceBoots: 1 },
  },
  {
    id: 'vault2', name: 'Second Vault', tag: 'economy',
    desc: '+1 treasure. A whole extra mistake to make.',
    mods: { treasures: 1 }, once: true,
  },
  {
    id: 'snarewire', name: 'Snare Wire', tag: 'traps',
    desc: 'Snares hold him 60% longer.',
    mods: { snareMul: 0.6 }, needs: 'snare',
  },
];

G.Relics = {
  /* Sum every held relic into one flat modifier bag. */
  aggregate(held) {
    const m = {
      spikeDamage: 0, spikeRearmMul: 1, dartRange: 0, dartDamage: 0,
      costGoblin: 0, costWall: 0, bruteHp: 0,
      triggerCd: 0, goldPerWave: 0, bountyMul: 1,
      vaultDelay: 0, forgetPerWave: 0, lowHpDamageMul: 1,
      pierceBoots: 0, treasures: 0, snareMul: 1,
    };
    for (const r of held) {
      for (const k in r.mods) {
        const v = r.mods[k];
        if (k === 'spikeRearmMul' || k === 'snareMul') m[k] *= (k === 'snareMul' ? 1 + v : v);
        else if (k === 'bountyMul' || k === 'lowHpDamageMul') m[k] += v;
        else m[k] += v;
      }
    }
    return m;
  },

  /* Three choices, never a duplicate, never one you can't use yet. */
  draft(held, meta, count = 3) {
    const heldIds = new Set(held.map((r) => r.id));
    const pool = G.RELICS.filter((r) => {
      if (r.once && heldIds.has(r.id)) return false;
      if (r.needs && !meta.has(r.needs)) return false;
      return true;
    });
    // Prefer relics you don't already own so the draft keeps introducing
    // things, but allow repeats of stackable ones if the pool runs thin.
    const fresh = pool.filter((r) => !heldIds.has(r.id));
    const source = fresh.length >= count ? fresh : pool;
    return G.RNG.sample(source, Math.min(count, source.length));
  },
};
