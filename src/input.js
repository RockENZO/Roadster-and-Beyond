// Unified keyboard + gamepad input. update(dt) fills `s` (held/analog state) and `p` (pressed this frame).
// Gamepads use the standard mapping (Xbox layout names; PlayStation works the same by position).

const STICK_DEAD = 0.12;
const TRIGGER_DEAD = 0.04;

// Radial deadzone with a rescaled live zone, so small corrections near centre stay smooth.
function radial(x, y, dead) {
  const m = Math.hypot(x, y);
  if (m < dead) return [0, 0];
  const k = Math.min(1, (m - dead) / (1 - dead - 0.03)) / m;
  return [x * k, y * k];
}
// Response curve: gentle near centre, full lock at the edge.
const curve = (v, e) => Math.sign(v) * Math.pow(Math.abs(v), e);
const trig = (v) => (v < TRIGGER_DEAD ? 0 : Math.min(1, (v - TRIGGER_DEAD) / (1 - TRIGGER_DEAD * 2)));
// Some browser/pad pairs (non-standard mapping, e.g. Firefox or Safari on macOS) report the triggers
// as digital buttons and put the analog travel on an axis running -1 (released) to 1 (pressed).
// Untouched axes read 0 until their first event, so 0 with the button up counts as released.
// Move v toward t: slower when steering into a turn, quicker when centring or reversing.
const approach = (v, t, up, back, dt) => {
  const r = t === 0 || Math.sign(t) !== Math.sign(v) ? back : up;
  return Math.abs(t - v) <= r * dt ? t : v + Math.sign(t - v) * r * dt;
};

const ACTIONS = ['assist', 'lift', 'track', 'release', 'camera', 'lights', 'doors', 'frunk', 'reset', 'pause', 'confirm', 'back', 'left', 'right', 'up', 'down', 'prev', 'next', 'hints', 'mute', 'vibration', 'sp1', 'sp2', 'sp3', 'sp4', 'sp5'];

export class Input {
  constructor() {
    this.keys = new Set();
    this.tapped = new Set();   // keys pressed since the last update, so quick taps are never missed
    this.device = 'kbd';
    this.padName = null;
    this.s = { throttle: 0, brake: 0, steer: 0, pitch: 0, roll: 0, yaw: 0, boost: false, lift: false, handbrake: false, lookX: 0, lookY: 0 };
    this.p = {};
    this.prev = {};
    this.onDevice = null;
    this.kSteer = 0;
    this.kThrottle = 0;
    this.kBrake = 0;
    this.rumbleNext = 0;
    // Controller vibration on/off (N, or hold LS), remembered between visits.
    try { this.vibration = localStorage.getItem('roadster.vibration') !== '0'; } catch (e) { this.vibration = true; }
    this.lsHeld = 0;
    this.trigAxis = {};   // per-pad: axis index found to carry each trigger
    addEventListener('keydown', (e) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      this.tapped.add(e.code);
      this.setDevice('kbd');
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    addEventListener('gamepadconnected', (e) => { this.padName = e.gamepad.id; this.setDevice('pad'); });
    addEventListener('gamepaddisconnected', () => { this.padName = null; this.setDevice('kbd'); });
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

  // Analog trigger travel 0..1. Standard-mapped pads give it on the button's value; otherwise look
  // for the axis that moves while the button is held, and use that from then on.
  trigger(g, bi, side) {
    const btn = g.buttons[bi];
    const v = btn ? btn.value : 0;
    if (g.mapping === 'standard' || (v > 0 && v < 1)) return v;
    const key = g.index + side;
    let ai = this.trigAxis[key];
    if (ai === undefined && btn?.pressed) {
      const other = this.trigAxis[g.index + (side === 'rt' ? 'lt' : 'rt')];
      ai = [2, 3, 4, 5, 6, 7].find((i) => i < g.axes.length && i !== other && g.axes[i] > 0.3);
      this.trigAxis[key] = ai ?? null;
    }
    if (ai == null) return v;
    const a = g.axes[ai];
    return a === 0 && !btn?.pressed ? 0 : (a + 1) / 2;
  }

  setVibration(on) {
    this.vibration = on;
    try { localStorage.setItem('roadster.vibration', on ? '1' : '0'); } catch (e) { /* private mode */ }
    const a = this.pad()?.vibrationActuator;
    if (on) this.rumble(0.5, 0.5, 180);
    else { try { a?.reset?.(); } catch (e) { /* unsupported */ } }
  }

  // One-shot jolt (landings, crashes).
  rumble(strong, weak, ms) {
    if (!this.vibration) return;
    const a = this.pad()?.vibrationActuator;
    if (!a?.playEffect) return;
    try { a.playEffect('dual-rumble', { startDelay: 0, duration: ms, strongMagnitude: strong, weakMagnitude: weak }); } catch (e) { /* unsupported */ }
    this.rumbleNext = performance.now() + ms;
  }

  // Continuous feedback from the car, refreshed every ~90 ms: body rumble for thrusters, suction and
  // tyre slip, and (on pads that have them) trigger motors for traction limit and brake load.
  feedback(f) {
    const now = performance.now();
    if (!this.vibration || now < this.rumbleNext) return;
    const a = this.pad()?.vibrationActuator;
    if (!a?.playEffect) return;
    this.rumbleNext = now + 90;
    const strong = Math.min(1, f.thrust * 0.55 + f.suction * 0.12 + f.road * 0.1);
    const weak = Math.min(1, f.slip * 0.6 + f.thrust * 0.25 + f.road * 0.15);
    try {
      if (a.effects?.includes?.('trigger-rumble')) {
        a.playEffect('trigger-rumble', { startDelay: 0, duration: 110, strongMagnitude: strong, weakMagnitude: weak, leftTrigger: Math.min(1, f.brakeLoad * 0.6), rightTrigger: Math.min(1, f.traction * 0.5 + f.thrust * 0.3) });
      } else if (strong + weak > 0.02) {
        a.playEffect('dual-rumble', { startDelay: 0, duration: 110, strongMagnitude: strong, weakMagnitude: weak });
      }
    } catch (e) { /* unsupported */ }
  }

  rawActions(raw, k, b, lx, ly) {
    raw.lift = k('Space') || b(0);
    raw.track = k('KeyT') || b(2);
    raw.release = k('KeyF') || b(4);
    raw.camera = k('KeyC') || k('KeyV') || b(3);
    raw.lights = k('KeyL') || b(12);
    raw.doors = k('KeyO') || b(13);
    raw.frunk = k('KeyK');
    raw.prev = b(14);
    raw.next = b(15);
    raw.reset = k('KeyR') || b(8);
    raw.pause = k('Escape') || k('KeyP') || b(9);
    raw.confirm = k('Enter') || k('Space') || b(0);
    raw.back = k('Escape') || b(1);
    raw.left = k('ArrowLeft') || k('KeyA') || b(14) || lx < -0.6;
    raw.right = k('ArrowRight') || k('KeyD') || b(15) || lx > 0.6;
    raw.up = k('ArrowUp') || k('KeyW') || b(12) || ly < -0.6;
    raw.down = k('ArrowDown') || k('KeyS') || b(13) || ly > 0.6;
    raw.hints = k('KeyH');
    raw.vibration = k('KeyN');
    raw.assist = k('KeyG') || b(11);
    raw.mute = k('KeyM');
    for (let i = 1; i <= 5; i++) raw['sp' + i] = k('Digit' + i);
  }

  update(dt = 1 / 60) {
    const k = (c) => this.keys.has(c) || this.tapped.has(c);
    const g = this.pad();
    const s = this.s;
    const raw = {};
    let lx = 0, ly = 0, rx = 0, ry = 0, rt = 0, lt = 0;
    const b = (i) => !!(g && g.buttons[i] && g.buttons[i].pressed);
    if (g) {
      [lx, ly] = radial(g.axes[0] || 0, g.axes[1] || 0, STICK_DEAD);
      [rx, ry] = radial(g.axes[2] || 0, g.axes[3] || 0, STICK_DEAD);
      rt = trig(this.trigger(g, 7, 'rt'));
      lt = trig(this.trigger(g, 6, 'lt'));
      if (Math.abs(lx) + Math.abs(ly) + Math.abs(rx) + Math.abs(ry) + rt + lt > 0.3 || g.buttons.some((x) => x.pressed)) this.setDevice('pad');
    }
    // Keyboard: ramp the digital keys so steering and pedals behave like analog inputs.
    const kx = (k('KeyD') || k('ArrowRight') ? 1 : 0) - (k('KeyA') || k('ArrowLeft') ? 1 : 0);
    const kUp = k('KeyW') || k('ArrowUp'), kDown = k('KeyS') || k('ArrowDown');
    this.kSteer = approach(this.kSteer, kx, 3.2, 6, dt);
    this.kThrottle = kUp ? Math.min(1, this.kThrottle + dt * 7) : 0;
    this.kBrake = kDown ? Math.min(1, this.kBrake + dt * 7) : 0;
    const kyaw = (k('KeyE') ? 1 : 0) - (k('KeyQ') ? 1 : 0);

    s.steer = Math.max(-1, Math.min(1, curve(lx, 1.6) + this.kSteer));
    s.throttle = Math.max(rt, this.kThrottle);
    s.brake = Math.max(lt, this.kBrake);
    s.lift = k('Space') || b(0);
    // Flight controls (Rocket): stick forward = nose down, stick right = roll right.
    // On the keyboard W/S pitch only while the lift key is up (with it held they climb/descend).
    const kPitch = s.lift && !g ? 0 : (kUp ? 1 : 0) - (kDown ? 1 : 0);
    s.pitch = Math.max(-1, Math.min(1, curve(-ly, 1.3) + kPitch));
    s.roll = Math.max(-1, Math.min(1, curve(lx, 1.3) + kx));
    s.yaw = Math.max(-1, Math.min(1, curve(rx, 1.4) + kyaw));
    s.lookX = rx; s.lookY = ry;
    s.boost = k('ShiftLeft') || k('ShiftRight') || b(5);
    s.handbrake = k('KeyB') || b(1);

    this.rawActions(raw, k, b, lx, ly);
    for (const a of ACTIONS) {
      this.p[a] = !!raw[a] && !this.prev[a];
      this.prev[a] = !!raw[a];
    }
    // LS click: a tap hides the help, holding it for half a second turns vibration on or off.
    if (b(10)) {
      if (this.lsHeld < 0.5 && this.lsHeld + dt >= 0.5) this.p.vibration = true;
      this.lsHeld += dt;
    } else {
      if (this.lsHeld > 0 && this.lsHeld < 0.5) this.p.hints = true;
      this.lsHeld = 0;
    }
    // A tap that went down and up within one frame still counts once, then reads as released.
    if (this.tapped.size) {
      const held = {};
      this.rawActions(held, (c) => this.keys.has(c), b, lx, ly);
      for (const a of ACTIONS) this.prev[a] = !!held[a];
      this.tapped.clear();
    }
  }
}
