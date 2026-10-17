// Unified keyboard + gamepad input. update() fills `s` (held/analog state) and `p` (pressed this frame).
const DEAD = 0.14;

function dz(v) {
  const a = Math.abs(v);
  if (a < DEAD) return 0;
  return Math.sign(v) * (a - DEAD) / (1 - DEAD);
}

const ACTIONS = ['thrust', 'handbrake', 'track', 'camera', 'lights', 'reset', 'pause', 'confirm', 'left', 'right', 'up', 'down', 'hints', 'mute'];

export class Input {
  constructor() {
    this.keys = new Set();
    this.device = 'kbd';
    this.padName = null;
    this.s = { throttle: 0, brake: 0, steer: 0, pitch: 0, roll: 0, yaw: 0, thrust: false, handbrake: false };
    this.p = {};
    this.prev = {};
    this.onDevice = null;
    this.rumbleUntil = 0;
    addEventListener('keydown', (e) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      this.setDevice('kbd');
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    addEventListener('gamepadconnected', (e) => {
      this.padName = e.gamepad.id;
      this.setDevice('pad');
    });
    addEventListener('gamepaddisconnected', () => {
      this.padName = null;
      this.setDevice('kbd');
    });
  }

  setDevice(d) {
    if (d === this.device) return;
    this.device = d;
    if (this.onDevice) this.onDevice(d);
  }

  pad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const g of pads) if (g && g.connected) return g;
    return null;
  }

  rumble(strong, weak, ms) {
    const g = this.pad();
    const a = g && g.vibrationActuator;
    if (!a || !a.playEffect) return;
    try {
      a.playEffect('dual-rumble', { startDelay: 0, duration: ms, strongMagnitude: strong, weakMagnitude: weak });
    } catch (e) { /* not supported */ }
  }

  update() {
    const k = (c) => this.keys.has(c);
    const g = this.pad();
    const s = this.s;
    const raw = {};
    let lx = 0, ly = 0, rx = 0, rt = 0, lt = 0;
    const b = (i) => !!(g && g.buttons[i] && g.buttons[i].pressed);
    if (g) {
      lx = dz(g.axes[0] || 0);
      ly = dz(g.axes[1] || 0);
      rx = dz(g.axes[2] || 0);
      rt = g.buttons[7] ? g.buttons[7].value : 0;
      lt = g.buttons[6] ? g.buttons[6].value : 0;
      if (Math.abs(lx) + Math.abs(ly) + Math.abs(rx) + rt + lt > 0.3 || g.buttons.some((x) => x.pressed)) this.setDevice('pad');
    }
    const kx = (k('KeyD') || k('ArrowRight') ? 1 : 0) - (k('KeyA') || k('ArrowLeft') ? 1 : 0);
    const ky = (k('KeyW') || k('ArrowUp') ? 1 : 0) - (k('KeyS') || k('ArrowDown') ? 1 : 0);
    const kyaw = (k('KeyE') ? 1 : 0) - (k('KeyQ') ? 1 : 0);

    s.steer = Math.max(-1, Math.min(1, lx + kx));
    s.throttle = Math.max(rt, k('KeyW') || k('ArrowUp') ? 1 : 0);
    s.brake = Math.max(lt, k('KeyS') || k('ArrowDown') ? 1 : 0);
    // Air control: stick forward = nose down, stick right = roll right.
    s.pitch = Math.max(-1, Math.min(1, -ly + ky));
    s.roll = s.steer;
    s.yaw = Math.max(-1, Math.min(1, rx + kyaw));
    s.thrust = k('Space') || b(0) || b(5);
    s.handbrake = k('ShiftLeft') || k('ShiftRight') || b(1);

    raw.thrust = s.thrust;
    raw.handbrake = s.handbrake;
    raw.track = k('KeyT') || b(2);
    raw.camera = k('KeyC') || b(3);
    raw.lights = k('KeyL') || b(12) || b(10);
    raw.reset = k('KeyR') || b(8);
    raw.pause = k('Escape') || k('KeyP') || b(9);
    raw.confirm = k('Enter') || k('Space') || b(0);
    raw.left = k('ArrowLeft') || k('KeyA') || b(14) || lx < -0.6;
    raw.right = k('ArrowRight') || k('KeyD') || b(15) || lx > 0.6;
    raw.up = k('ArrowUp') || k('KeyW') || b(12) || ly < -0.6;
    raw.down = k('ArrowDown') || k('KeyS') || b(13) || ly > 0.6;
    raw.hints = k('KeyH') || b(4);
    raw.mute = k('KeyM');
    for (const a of ACTIONS) {
      this.p[a] = !!raw[a] && !this.prev[a];
      this.prev[a] = !!raw[a];
    }
  }
}
