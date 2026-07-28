/* ============================================================================
   UTIL — small math/helpers. Nothing game-specific lives here.
   ========================================================================== */
window.G = window.G || {};

G.U = {
  clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; },
  lerp(a, b, t) { return a + (b - a) * t; },
  // Frame-rate independent smoothing. `t` is "fraction closed per second".
  damp(a, b, t, dt) { return G.U.lerp(a, b, 1 - Math.pow(1 - t, dt * 60)); },

  rand(a = 1, b = 0) { return b + Math.random() * (a - b); },
  randInt(a, b) { return Math.floor(a + Math.random() * (b - a + 1)); },
  pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; },

  dist(ax, ay, bx, by) { return Math.hypot(bx - ax, by - ay); },
  dist2(ax, ay, bx, by) { const dx = bx - ax, dy = by - ay; return dx * dx + dy * dy; },

  // Shortest signed difference between two angles.
  angleDiff(a, b) {
    let d = (b - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
  },

  // Normalize a vector, returning [x, y]. Zero-safe.
  norm(x, y) {
    const m = Math.hypot(x, y);
    return m > 1e-6 ? [x / m, y / m] : [0, 0];
  },

  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  },

  // Weighted pick. `weights` parallel to `items`. Falls back to last item.
  weightedPick(items, weights) {
    let total = 0;
    for (const w of weights) total += Math.max(0, w);
    if (total <= 0) return items[items.length - 1];
    let r = Math.random() * total;
    for (let i = 0; i < items.length; i++) {
      r -= Math.max(0, weights[i]);
      if (r <= 0) return items[i];
    }
    return items[items.length - 1];
  },

  roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  },
};
