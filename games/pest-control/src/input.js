/* ============================================================================
   INPUT — keyboard + mouse, with the board-space and tile coordinates the
   build phase needs. Right-click is a first-class input here (remove), so it
   gets tracked properly rather than being an afterthought.
   ========================================================================== */
window.G = window.G || {};

G.Input = {
  down: new Set(),
  _pressed: new Set(),
  mouse: {
    x: 0, y: 0,          // canvas space
    bx: 0, by: 0,        // board space (canvas minus the HUD offset)
    tx: -1, ty: -1,      // tile under the cursor
    onBoard: false,
    down: false, pressed: false,
    rightPressed: false,
  },
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
      if (e.button === 2) this.mouse.rightPressed = true;
      else { this.mouse.down = true; this.mouse.pressed = true; }
    });
    addEventListener('mouseup', () => { this.mouse.down = false; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('mouseleave', () => { this.mouse.onBoard = false; });
  },

  _setMouse(e) {
    const C = G.CFG;
    const r = this.canvas.getBoundingClientRect();
    const m = this.mouse;
    m.x = (e.clientX - r.left) / r.width * C.W;
    m.y = (e.clientY - r.top) / r.height * C.H;
    m.bx = m.x;
    m.by = m.y - C.BOARD_Y;
    m.tx = Math.floor(m.bx / C.TILE);
    m.ty = Math.floor(m.by / C.TILE);
    m.onBoard = m.tx >= 0 && m.ty >= 0 && m.tx < C.GRID_W && m.ty < C.GRID_H;
  },

  isDown(...codes) { return codes.some((c) => this.down.has(c)); },
  wasPressed(...codes) { return codes.some((c) => this._pressed.has(c)); },
  anyConfirm() { return this.wasPressed('Space', 'Enter') || this.mouse.pressed; },

  endFrame() {
    this._pressed.clear();
    this.mouse.pressed = false;
    this.mouse.rightPressed = false;
  },
};
