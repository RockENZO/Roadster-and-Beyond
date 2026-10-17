import * as THREE from 'three';
import { WALL, LINEUP_X, STRIP, FLIP_PAD, SPAWNS } from './track.js';

// Event mode: replays the launch-night highlights in the order and with the captions of the
// broadcast, with the car on autopilot and broadcast-style cameras. Every stunt is flown by the
// same physics and the same controls a player has, so it can all be done by hand.

const clamp = THREE.MathUtils.clamp;
const NONE = () => ({ throttle: 0, brake: 0, steer: 0, pitch: 0, roll: 0, yaw: 0, boost: false, lift: false, handbrake: false });
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

// Hold a lane: z target and +x heading.
function laneSteer(v, zT) {
  return clamp(0.08 * (zT - v.pos.z) - 1.6 * v.fwd.z, -1, 1);
}

// Camera at the axis of the wall, looking out at the car: the overhead shot of the car on the face.
function wallCams(v, s) {
  const th = v.onWall ? v.wallTh : 0;
  if (v.onWall && th > 1.15 && th < 1.85 && s.ph === 'climb') {
    return { shot: 'axis', pos: V3(WALL.x0 + 1.2, WALL.R + 0.6, WALL.zc), look: V3(v.pos.x, v.pos.y, v.pos.z), fov: 34 };
  }
  return { shot: 'wide', pos: V3(WALL.x0 + 4, 10, WALL.zc - 62), look: V3(WALL.x0 + 3, 9.5, WALL.zc), fov: 30 };
}

const wallStart = { key: 'wallbase', label: 'C-wall', x: WALL.x0 - 70, z: WALL.zc, yaw: 0 };

export const SEGMENTS = [
  {
    key: 'climb', variant: 'rocket', spawn: wallStart, hud: 'wall',
    ctl(s, v, t) {
      const c = NONE();
      const th = v.onWall ? v.wallTh : 0;
      s.ph = s.ph || 'approach';
      s.caption = s.ph === 'stop' || s.ph === 'down' || s.ph === 'out' ? 'Holding upside down' : 'Vertical wall climb';
      if (s.ph === 'approach') {
        c.throttle = v.vFwd < 16 ? 0.6 : 0; c.steer = laneSteer(v, WALL.zc);
        if (v.onWall && th > 0.5) s.ph = 'climb';
      } else if (s.ph === 'climb') {
        c.throttle = v.vFwd < 6 ? 0.6 : 0.05;
        if (th > 2.78) s.ph = 'stop';
      } else if (s.ph === 'stop') {
        c.brake = v.vFwd > 0.3 ? 1 : 0;
        if (v.hangT > 4) s.ph = 'down';
      } else if (s.ph === 'down') {
        // reverse back down the face, holding ~4 m/s
        if (v.vFwd < -4) c.throttle = 0.35; else if (v.vFwd > -2) c.brake = 0.25;
        if (!v.onWall && v.contacts >= 3 && v.pos.x < WALL.x0 - 4) { s.ph = 'out'; s.tl = t; }
      } else {
        c.brake = Math.abs(v.vFwd) > 0.3 ? 0.5 : 0;
        if (t - s.tl > 1.2) return { c, done: true };
      }
      return { c };
    },
    cam(v, t, s) {
      if (s.ph === 'approach' && t < 2.5) return { shot: 'base', pos: V3(v.pos.x - 9, 1.5, WALL.zc), look: V3(WALL.x0 + 4, 6, WALL.zc), fov: 42 };
      return wallCams(v, s);
    },
  },
  {
    key: 'flight', variant: 'rocket', spawn: wallStart, hud: 'flight',
    ctl(s, v, t) {
      const c = NONE();
      const th = v.onWall ? v.wallTh : 0;
      s.ph = s.ph || 'stage';
      s.caption = s.ph === 'stage' ? '' : 'Flight off the ramp';
      if (s.ph === 'stage') { if (t > 2.4) s.ph = 'approach'; }
      else if (s.ph === 'approach') {
        c.throttle = v.vFwd < 16 ? 0.6 : 0; c.steer = laneSteer(v, WALL.zc);
        if (v.onWall && th > 0.5) s.ph = 'climb';
      } else if (s.ph === 'climb') {
        c.throttle = v.vFwd < 8 ? 0.6 : 0.05;
        if (v.airborne) s.ph = 'fall';
      } else if (s.ph === 'fall') {
        c.lift = true; c.brake = v.pos.y > 5 ? 0.9 : 0.3;
        if (v.contacts >= 3) { s.ph = 'out'; s.tl = t; }
      } else {
        c.brake = Math.abs(v.vFwd) > 0.3 ? 0.5 : 0;
        if (t - s.tl > 3) return { c, done: true };
      }
      return { c };
    },
    cam(v, t, s) {
      if (s.ph === 'stage') return { shot: 'rear', pos: V3(v.pos.x - 7.5, 1.35, WALL.zc + 0.4), look: V3(v.pos.x + 6, 2.2, WALL.zc), fov: 40 };
      if (s.ph === 'fall' && v.pos.y < 9) return { shot: 'land', pos: V3(v.pos.x - 6, 3, WALL.zc - 30), look: V3(v.pos.x, v.pos.y * 0.7 + 1, v.pos.z), fov: 40 };
      if (s.ph === 'out') return { shot: 'land', pos: V3(s.lx || (s.lx = v.pos.x - 6), 3, WALL.zc - 30), look: V3(v.pos.x, 1.5, v.pos.z), fov: 40 };
      return wallCams(v, s);
    },
  },
  {
    key: 'lineup', variant: 'rocket', spawn: 'lineup', hud: 'flight',
    replay: {
      caption: 'Kickflip replay',
      cam: (v) => ({ shot: 'under', pos: V3(LINEUP_X + 2, 1.2, 7.5), look: V3(v.pos.x, v.pos.y, v.pos.z), fov: 50 }),
    },
    ctl(s, v, t) {
      const c = NONE();
      let P;
      s.ph = s.ph || 'run';
      s.caption = s.ph === 'run' && v.pos.x < LINEUP_X - 60 ? '' : 'Kickflip over the lineup';
      if (s.ph === 'run') {
        c.throttle = v.vFwd < 18 ? 0.8 : 0; c.steer = laneSteer(v, 0);
        if (v.pos.x >= LINEUP_X - 30) { s.ph = 'air'; s.th = t; s.m0 = s.f; P = { lift: true }; }
      } else if (s.ph === 'air') {
        const a = t - s.th;
        c.lift = a < 0.42;
        c.roll = a > 0.25 && a < 1.05 ? 1 : 0;
        if (a > 0.6 && v.contacts >= 2) { s.ph = 'out'; s.tl = t; s.m1 = s.f; }
      } else {
        c.brake = v.vFwd > 0.3 ? 0.55 : 0;
        if (t - s.tl > 2.6) return { c, done: true };
      }
      return { c, P };
    },
    cam(v, t, s) {
      if (s.ph === 'run' && v.pos.x < LINEUP_X - 52) {
        return { shot: 'lane', pos: V3(v.pos.x - 10, 3.2, 0), look: V3(v.pos.x + 30, 1.5, 0), fov: 40 };
      }
      return { shot: 'side', pos: V3(LINEUP_X - 6, 2.2, -30), look: V3(clamp(v.pos.x, LINEUP_X - 22, LINEUP_X + 22), Math.max(2.6, v.pos.y * 0.7 + 1), 0), fov: 42 };
    },
  },
  {
    key: 'flip', variant: 'rocket', spawn: 'flip', hud: null,
    replay: {
      caption: 'Vertical jump & flip - replay',
      cam: (v) => ({ shot: 'rside', pos: V3(FLIP_PAD.x + 2, 2, FLIP_PAD.z - 30), look: V3(v.pos.x, v.pos.y + 0.5, v.pos.z), fov: 34 }),
    },
    ctl(s, v, t) {
      const c = NONE();
      let P;
      s.ph = s.ph || 'wait';
      s.caption = 'Vertical jump & flip';
      if (s.ph === 'wait') { if (t > 2) { s.ph = 'air'; s.th = t; s.m0 = s.f; P = { lift: true }; } }
      else if (s.ph === 'air') {
        const a = t - s.th;
        c.lift = true; c.brake = 0.4;
        c.pitch = a > 0.15 && a < 1.2 ? -1 : 0;
        if (a > 1 && v.contacts >= 3) { s.ph = 'out'; s.tl = t; s.m1 = s.f; }
      } else if (t - s.tl > 2.6) return { c, done: true };
      return { c, P };
    },
    cam(v) {
      return { shot: 'front', pos: V3(FLIP_PAD.x + 30, 2.2, FLIP_PAD.z), look: V3(FLIP_PAD.x - 2, 4.5, FLIP_PAD.z), fov: 34 };
    },
  },
  {
    key: 'strip', variant: 'thrust', spawn: 'strip', hud: 'drive',
    ctl(s, v, t) {
      const c = NONE();
      s.ph = s.ph || 'stage';
      s.caption = s.ph === 'stage' ? '0-60 mph' : v.t60.result ? `0-60 mph in ${v.t60.result.toFixed(2)} s` : '0-60 mph';
      c.steer = laneSteer(v, STRIP.zc);
      if (s.ph === 'stage') { if (t > 2) s.ph = 'go'; }
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
      if (s.ph === 'stage') return { shot: 'stage', pos: V3(v.pos.x + 9, 1.1, STRIP.zc - 5.5), look: V3(v.pos.x, 0.6, v.pos.z), fov: 36 };
      return { shot: 'track', pos: V3(v.pos.x + 3.5, 1.4, STRIP.zc - 11), look: V3(v.pos.x + 1, 0.7, v.pos.z), fov: 50 };
    },
  },
];

// Snapshots of everything the renderer reads, for replays.
function snap(v) {
  return {
    pos: v.pos.clone(), q: v.q.clone(), vel: v.vel.clone(), w: v.w.clone(), acc: v.acc.clone(), noz: Float32Array.from(v.nozzleU),
    wh: v.wheels.map((w) => [w.steer, w.spin, w.y, w.contact, w.cp.clone(), w.slip]),
    suction: v.suction, contacts: v.contacts, downforce: v.downforce, airborne: v.airborne, onWall: v.onWall, wallTh: v.wallTh, braking: v.braking,
  };
}
function apply(v, s) {
  v.pos.copy(s.pos); v.q.copy(s.q); v.vel.copy(s.vel); v.w.copy(s.w); v.acc.copy(s.acc); v.nozzleU.set(s.noz);
  s.wh.forEach((a, i) => { const w = v.wheels[i]; [w.steer, w.spin, w.y, w.contact] = a; w.cp.copy(a[4]); w.slip = a[5]; });
  v.suction = s.suction; v.contacts = s.contacts; v.downforce = s.downforce; v.airborne = s.airborne; v.onWall = s.onWall; v.wallTh = s.wallTh; v.braking = s.braking;
  v.basis();
}

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
    this.replay = null;
    this.g.ui.caption('');
  }

  next() {
    this.i++;
    this.replay = null;
    if (this.i >= SEGMENTS.length) { this.stop(); this.g.ui.eventDone(); return; }
    const seg = SEGMENTS[this.i];
    this.seg = seg;
    this.state = { f: 0 };
    this.frames = [];
    this.t = 0;
    this.intro = 0.6;
    this.shot = null;
    this.g.setVariant(seg.variant, seg.spawn);
    this.g.ui.caption('');
  }

  startReplay() {
    const s = this.state, rate = this.rate;
    const a = Math.max(0, (s.m0 ?? 0) - Math.round(0.9 * rate));
    const b = Math.min(this.frames.length - 1, (s.m1 ?? this.frames.length - 1) + Math.round(1.6 * rate));
    this.replay = { i: a, end: b, acc: 0 };
    this.shot = null;
  }

  // Returns the scripted controls for this frame (or replay = true) and sets the camera.
  update(dt) {
    const v = this.g.vehicle;
    const seg = this.seg;
    let out = { c: NONE(), P: {} };
    let cam;
    if (this.replay) {
      const r = this.replay;
      r.acc += dt * 0.5 * this.rate;   // half speed
      while (r.acc >= 1 && r.i < r.end) { r.i++; r.acc -= 1; }
      apply(v, this.frames[r.i]);
      this.g.ui.caption(seg.replay.caption);
      this.g.ui.hud(null);
      if (r.i >= r.end) { this.next(); return { c: NONE(), P: {}, replay: true }; }
      cam = seg.replay.cam(v);
      out.replay = true;
    } else {
      if (this.intro > 0) this.intro -= dt;
      else {
        this.t += dt;
        out = seg.ctl(this.state, v, this.t) || out;
        out.P = out.P || {};
        this.frames.push(snap(v));
        this.state.f = this.frames.length;
        this.rate = 1 / Math.max(dt, 1 / 240);
        if (out.done || this.t > 60 || (v.mode === 'crashed' && v.crashT < 0.3)) {
          if (out.done && seg.replay && this.state.m0 != null) this.startReplay(); else this.next();
          return { c: NONE(), P: {}, replay: !!this.replay };
        }
      }
      this.g.ui.caption(this.state.caption || '');
      this.g.ui.hud(seg.hud);
      cam = seg.cam(v, this.t, this.state);
    }
    cam.cut = cam.shot !== this.shot;
    this.shot = cam.shot;
    this.g.setCam(cam);
    this.g.setLights(true);
    return out;
  }
}

export function stuntFor(pos) {
  if (Math.abs(pos.z - WALL.zc) < 12 && pos.x > WALL.x0 - 140) return SPAWNS.find((s) => s.key === 'wall');
  if (Math.abs(pos.z - STRIP.zc) < 10 && pos.x > -10) return SPAWNS.find((s) => s.key === 'strip');
  if (Math.abs(pos.z) < 10 && pos.x > LINEUP_X - 160 && pos.x < LINEUP_X + 40) return SPAWNS.find((s) => s.key === 'lineup');
  if (Math.hypot(pos.x - FLIP_PAD.x, pos.z - FLIP_PAD.z) < 30) return SPAWNS.find((s) => s.key === 'flip');
  let best = SPAWNS[0], bd = Infinity;
  for (const s of SPAWNS) {
    const d = Math.hypot(s.x - pos.x, s.z - pos.z) * (s.key === 'start' ? 1.6 : 1);
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}
