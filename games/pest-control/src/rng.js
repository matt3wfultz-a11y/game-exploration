/* ============================================================================
   RNG — a seeded random number generator.

   Math.random() can't be seeded, so a roguelite needs its own. Everything that
   defines the SHAPE of a run — the dungeon layout, which relics you're offered,
   which adventurer shows up — draws from here, which means a seed reproduces
   a run exactly and can be handed to someone else.

   Cosmetic randomness (particles, wobble, trap phase offsets) deliberately
   still uses Math.random. Tying visuals to the seed buys nothing and makes the
   generator's stream depend on how many sparks you drew, which quietly breaks
   reproducibility the first time you touch the art.
   ========================================================================== */
window.G = window.G || {};

G.RNG = {
  seed: 1,
  _s: 1,

  /* Turn any string or number into a 32-bit seed. */
  hash(input) {
    const str = String(input);
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  },

  reseed(seed) {
    this.seed = seed >>> 0;
    this._s = this.seed || 1;
    return this;
  },

  /* mulberry32 — small, fast, and good enough for a game this size. */
  next() {
    this._s = (this._s + 0x6D2B79F5) >>> 0;
    let t = this._s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  },

  int(lo, hi) { return lo + Math.floor(this.next() * (hi - lo + 1)); },
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; },
  chance(p) { return this.next() < p; },

  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  },

  /* Pick `n` distinct items. Used for the relic draft. */
  sample(arr, n) {
    return this.shuffle([...arr]).slice(0, n);
  },

  /* Seeds are shown and typed by humans, so keep them short and unambiguous —
     no vowels (no accidental words), no 0/O/1/I.

     toCode and fromCode MUST be exact inverses, and every seed must fit in
     six base-28 digits (SEED_SPACE below). Get this wrong and the code shown
     on screen decodes to a different dungeon than the one you played — which
     silently breaks the entire point of showing a seed. */
  ALPHABET: '23456789BCDFGHJKLMNPQRSTVWXZ',
  SEED_SPACE: 28 ** 6,          // 481,890,304

  toCode(seed) {
    const A = this.ALPHABET;
    let n = ((seed % this.SEED_SPACE) + this.SEED_SPACE) % this.SEED_SPACE;
    let out = '';
    for (let i = 0; i < 6; i++) { out = A[n % A.length] + out; n = Math.floor(n / A.length); }
    return out;
  },

  /* Accepts a code we issued, or any other text (hashed into the same space)
     so "#seed=matt" works too. */
  fromCode(text) {
    const A = this.ALPHABET;
    const up = String(text).toUpperCase().trim();
    if (up.length === 6 && [...up].every((c) => A.includes(c))) {
      let n = 0;
      for (const c of up) n = n * A.length + A.indexOf(c);
      return n % this.SEED_SPACE;
    }
    return this.hash(up) % this.SEED_SPACE;
  },

  randomSeed() { return Math.floor(Math.random() * this.SEED_SPACE); },

  /* One shared dungeon per calendar day, so "did you do today's?" works. */
  dailySeed() {
    const d = new Date();
    return this.hash(`daily-${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`)
      % this.SEED_SPACE;
  },
};
