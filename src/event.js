import * as THREE from 'three';
import { WALL, LINEUP_X, STRIP, FLIP_PAD, SPAWNS } from './track.js';

// Event mode: replays the launch show in order, with the car on autopilot and broadcast-style
// cameras. Each stunt is driven by the same physics and controls a player has, so what you see
// is reproducible by hand.

const clamp = THREE.MathUtils.clamp;
const NONE = () => ({ throttle: 0, brake: 0, steer: 0, pitch: 0, roll: 0, yaw: 0, boost: false, lift: false, handbrake: false });

// Hold a lane: z target and +x heading.
function laneSteer(v, zT) {
  return clamp(0.08 * (zT - v.pos.z) - 1.6 * v.fwd.z, -1, 1);
}

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

export const SEGMENTS = [
  {
    key: 'reveal', title: 'The reveal', sub: 'Tesla Roadster · McGregor, Texas', variant: 'rocket', spawn: 'start', len: 9,
    ctl(s, v, t) {
      const c = NONE();
      s.doors = t > 1.5 && t < 6 ? 1 : 0;
      s.lights = t > 0.6 ? 1 : 0;
      if (t > 7) { c.throttle = 0.25; c.steer = laneSteer(v, 0); }
      return { c };
    },
    cam(v, t) {
      const a = -2.2 + t * 0.22;
      return { pos: V3(v.pos.x + Math.cos(a) * 7.2, 1.25 + t * 0.05, v.pos.z + Math.sin(a) * 7.2), look: V3(v.pos.x, v.pos.y + 0.05, v.pos.z), fov: 38 };
    },
  },
  {
    key: 'wall', title: 'Stunt 1 · The C-wall', sub: 'Fans pull 2 g. It drives up, over and hangs upside down.', variant: 'rocket', spawn: 'wall', len: 24,
    ctl(s, v, t) {
      const c = NONE();
      const th = v.onWall ? v.wallTh : 0;
      let P;
      s.ph = s.ph || 'approach';
      if (s.ph === 'approach') {
        c.throttle = v.vFwd < 16 ? 0.6 : 0; c.steer = laneSteer(v, WALL.zc);
        if (v.onWall && th > 0.5) s.ph = 'climb';
      } else if (s.ph === 'climb') {
        c.throttle = v.vFwd < 6 ? 0.6 : 0.05;
        if (th > 2.75) s.ph = 'stop';
      } else if (s.ph === 'stop') {
        c.brake = v.vFwd > 0.3 ? 1 : 0;
        if (v.hangT > 2.2) { s.ph = 'fall'; P = { release: true }; }
      } else if (s.ph === 'fall') {
        c.lift = true; c.brake = v.pos.y > 3 ? 0.6 : 0.18;
        if (v.contacts >= 3) { s.ph = 'down'; s.tl = t; }
      } else {
        c.brake = Math.abs(v.vFwd) > 0.3 ? 0.4 : 0;
        if (t - s.tl > 1.6) return { c, done: true };
      }
      return { c, P };
    },
    cam(v, t, s) {
      if (s.ph === 'approach' && v.pos.x < WALL.x0 - 22) {
        return { pos: V3(v.pos.x - 9, 1.6, WALL.zc - 7), look: V3(v.pos.x + 4, 0.8, v.pos.z), fov: 44 };
      }
      return { pos: V3(WALL.x0 + 1.5, 7.5, WALL.zc - 31), look: V3(v.pos.x * 0.7 + (WALL.x0 + 3) * 0.3, v.pos.y * 0.8 + 3, v.pos.z), fov: 44 };
    },
  },
  {
    key: 'lineup', title: 'Stunt 2 · The lineup', sub: 'A thruster hop and a kickflip over Model 3, Model Y, Cybertruck, Cybercab and Semi.', variant: 'rocket', spawn: 'lineup', len: 14,
    ctl(s, v, t) {
      const c = NONE();
      let P;
      s.ph = s.ph || 'run';
      if (s.ph === 'run') {
        c.throttle = v.vFwd < 18 ? 0.8 : 0; c.steer = laneSteer(v, 0);
        if (v.pos.x >= LINEUP_X - 30) { s.ph = 'air'; s.th = t; P = { lift: true }; }
      } else if (s.ph === 'air') {
        const a = t - s.th;
        c.lift = a < 0.42;
        c.roll = a > 0.25 && a < 1.05 ? 1 : 0;
        if (a > 0.6 && v.contacts >= 2) { s.ph = 'out'; s.tl = t; }
      } else {
        c.brake = v.vFwd > 0.3 ? 0.55 : 0;
        if (t - s.tl > 2.2) return { c, done: true };
      }
      return { c, P };
    },
    cam(v, t, s) {
      if (s.ph === 'run' && v.pos.x < LINEUP_X - 55) {
        return { pos: V3(v.pos.x - 8.5, 1.9, 2.6), look: V3(v.pos.x + 10, 1.2, 0), fov: 46 };
      }
      if (s.ph === 'out' && t - s.tl > 0.8) return { pos: V3(LINEUP_X + 30, 2.2, 9), look: V3(v.pos.x, 1, v.pos.z), fov: 34 };
      return { pos: V3(LINEUP_X - 3, 2.4, -24), look: V3(clamp(v.pos.x, LINEUP_X - 22, LINEUP_X + 20), Math.max(2.4, v.pos.y * 0.7 + 1), 0), fov: 46 };
    },
  },
  {
    key: 'flip', title: 'Stunt 3 · The standing flip', sub: 'From a standstill: lift, backflip, hover down.', variant: 'rocket', spawn: 'flip', len: 9,
    ctl(s, v, t) {
      const c = NONE();
      let P;
      s.ph = s.ph || 'wait';
      if (s.ph === 'wait') { if (t > 1.6) { s.ph = 'air'; s.th = t; P = { lift: true }; } }
      else if (s.ph === 'air') {
        const a = t - s.th;
        c.lift = true; c.brake = 0.4;
        c.pitch = a > 0.15 && a < 1.2 ? -1 : 0;
        if (a > 1 && v.contacts >= 3) { s.ph = 'out'; s.tl = t; }
      } else if (t - s.tl > 1.8) return { c, done: true };
      return { c, P };
    },
    cam(v, t) {
      const a = 2.0 + t * 0.12;
      return { pos: V3(FLIP_PAD.x + Math.cos(a) * 15, 2.4, FLIP_PAD.z + Math.sin(a) * 15), look: V3(v.pos.x, v.pos.y + 0.8, v.pos.z), fov: 40 };
    },
  },
  {
    key: 'strip', title: 'Stunt 4 · 0-60', sub: 'Rear thrusters plus tyres. The event run: 0.81 s.', variant: 'thrust', spawn: 'strip', len: 9,
    ctl(s, v, t) {
      const c = NONE();
      s.ph = s.ph || 'stage';
      c.steer = laneSteer(v, STRIP.zc);
      if (s.ph === 'stage') { if (t > 2.2) s.ph = 'go'; }
      else if (s.ph === 'go') {
        c.throttle = 1; c.boost = true;
        if (v.pos.x > 160) s.ph = 'stop';
      } else {
        c.brake = v.vFwd > 0.3 ? 1 : 0;
        if (v.vFwd < 0.5) return { c, done: true };
      }
      return { c };
    },
    cam(v, t, s) {
      if (s.ph === 'stage') return { pos: V3(v.pos.x + 9, 1.1, STRIP.zc - 5.5), look: V3(v.pos.x, 0.6, v.pos.z), fov: 36 };
      return { pos: V3(v.pos.x + 3.5, 1.4, STRIP.zc - 11), look: V3(v.pos.x + 1, 0.7, v.pos.z), fov: 50 };
    },
  },
];

export class EventShow {
  constructor(game) {
    this.g = game;
    this.active = false;
  }

  start(from = 0) {
    this.active = true;
    this.i = from - 1;
    this.next();
  }

  stop() {
    this.active = false;
    this.g.ui.eventCard(null);
  }

  next() {
    this.i++;
    if (this.i >= SEGMENTS.length) { this.stop(); this.g.ui.eventDone(); return; }
    const seg = SEGMENTS[this.i];
    this.seg = seg;
    this.state = { doors: 0, lights: 0 };
    this.t = 0;
    this.intro = this.i === 0 ? 3.6 : 2.4;
    this.g.setVariant(seg.variant, seg.spawn);
    this.g.ui.eventCard(seg, this.i === 0);
  }

  // Returns the scripted controls for this frame and sets the camera.
  update(dt) {
    const v = this.g.vehicle;
    const seg = this.seg;
    let out = { c: NONE(), P: {} };
    if (this.intro > 0) {
      this.intro -= dt;
      this.g.ui.countdown(this.i === 0 ? Math.ceil(this.intro - 0.6) : 0);
      if (this.intro <= 0) this.g.ui.eventCard(seg, false, true);
    } else {
      this.t += dt;
      out = seg.ctl(this.state, v, this.t) || out;
      out.P = out.P || {};
      if (out.done || this.t > seg.len + 14 || (v.mode === 'crashed' && v.crashT < 0.3)) {
        this.next();
        return { c: NONE(), P: {} };
      }
    }
    const cam = seg.cam(v, this.t, this.state);
    this.g.setCam(cam);
    this.g.mst.doorsT = this.state.doors;
    this.g.setLights(this.state.lights || this.i > 0);
    return out;
  }
}

export function stuntFor(pos) {
  let best = SPAWNS[0], bd = Infinity;
  for (const s of SPAWNS) {
    const d = Math.hypot(s.x - pos.x, s.z - pos.z) * (s.key === 'start' ? 1.6 : 1);
    if (d < bd) { bd = d; best = s; }
  }
  if (Math.abs(pos.z - WALL.zc) < 12 && pos.x > WALL.x0 - 140) return SPAWNS.find((s) => s.key === 'wall');
  if (Math.abs(pos.z - STRIP.zc) < 10 && pos.x > -10) return SPAWNS.find((s) => s.key === 'strip');
  if (Math.abs(pos.z) < 10 && pos.x > LINEUP_X - 160 && pos.x < LINEUP_X + 40) return SPAWNS.find((s) => s.key === 'lineup');
  return best;
}

