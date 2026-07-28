/* ============================================================================
   INPUT — keyboard + mouse, translated into game-space coordinates.

   Note the `pressed` vs `down` distinction: `down` is "held right now",
   `pressed` is "went down this frame". Almost every input bug in a small game
   comes from confusing those two.
   ========================================================================== */
window.G = window.G || {};

G.Input = {
  down: new Set(),
  _pressed: new Set(),
  mouse: { x: 0, y: 0, down: false, pressed: false },
  canvas: null,

  attach(canvas) {
    this.canvas = canvas;

    addEventListener('keydown', (e) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) {
        e.preventDefault();
      }
      if (e.repeat) return;
      this.down.add(e.code);
      this._pressed.add(e.code);
    });

    addEventListener('keyup', (e) => this.down.delete(e.code));
    addEventListener('blur', () => { this.down.clear(); this.mouse.down = false; });

    canvas.addEventListener('mousemove', (e) => this._setMouse(e));
    canvas.addEventListener('mousedown', (e) => {
      e.preventDefault();
      this._setMouse(e);
      this.mouse.down = true;
      this.mouse.pressed = true;
    });
    addEventListener('mouseup', () => { this.mouse.down = false; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  },

  _setMouse(e) {
    const r = this.canvas.getBoundingClientRect();
    this.mouse.x = (e.clientX - r.left) / r.width * G.CFG.W;
    this.mouse.y = (e.clientY - r.top) / r.height * G.CFG.H;
  },

  isDown(...codes) { return codes.some((c) => this.down.has(c)); },
  wasPressed(...codes) { return codes.some((c) => this._pressed.has(c)); },

  /* Movement vector from WASD / arrows, normalized so diagonals aren't faster. */
  moveAxis() {
    let x = 0, y = 0;
    if (this.isDown('KeyA', 'ArrowLeft')) x -= 1;
    if (this.isDown('KeyD', 'ArrowRight')) x += 1;
    if (this.isDown('KeyW', 'ArrowUp')) y -= 1;
    if (this.isDown('KeyS', 'ArrowDown')) y += 1;
    return G.U.norm(x, y);
  },

  anyConfirm() {
    return this.wasPressed('Space', 'Enter', 'KeyE') || this.mouse.pressed;
  },

  /* Call at the very end of each frame. */
  endFrame() {
    this._pressed.clear();
    this.mouse.pressed = false;
  },
};
