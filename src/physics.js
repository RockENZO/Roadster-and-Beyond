import * as THREE from 'three';
import { G, BOUNDS, BOXES, WALL, SPAWNS } from './track.js';
import { SUSP, WHEELS, HULL, VARIANTS } from './spec.js';

export { VARIANTS };
export const MPH = 2.23694;

// Rigid-body Roadster: six degrees of freedom, four raycast wheels with springs and tyre
// models, fan suction, aero, cold-gas thrusters and (on the Rocket) a flight computer that
// fires them to hold an attitude. Everything runs at 240 Hz in substeps.

const SUB = 2;            // substeps per game step (game steps at 120 Hz)
const MU = 1.26;          // tyre friction: launch coverage quoted ~1.26 g from tyres alone
const SUCTION_KG = 4700;  // fans: 4,700 kg of downforce at full suction (the broadcast HUD peaked at ~4,700 kg)
const POWER = 1.0e6;      // ~1 MW
const VMAX = 104;         // ~232 mph governor
const G0 = 9.80665;
const RHO = 1.2;
const CDA = 0.55;
const LAUNCH_G = 2.05;    // motor force ceiling at low speed, about what the tyres hold with launch suction
const FAN_MAX = 1;        // fan boost: full suction on any surface, the 4,700 kg the broadcast showed

const V = () => new THREE.Vector3();
const _a = V(), _b = V(), _c = V(), _d = V(), _e = V(), _f = V(), _n = V(), _r = V(), _vp = V(), _t = V(), _s = V();
const _q = new THREE.Quaternion(), _qi = new THREE.Quaternion();
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const clamp = THREE.MathUtils.clamp;

// ---------- World queries ----------
// Each returns a surface tag ('ground' | 'wall' | 'box') or null, and writes the normal into outN.
const hitInfo = { t: 0, tag: null, box: null };

// A map other than the launch site (Spa) supplies its own surface and barriers; null = launch site.
let MAP = null;
export function setMap(m) { MAP = m; }
export function currentMap() { return MAP; }

function raycast(o, d, maxT, outN) {
  hitInfo.box = null;
  hitInfo.grip = 1;
  if (MAP) { hitInfo.tag = MAP.raycast(o, d, maxT, outN, hitInfo); return hitInfo.tag; }
  let best = maxT;
  let tag = null;
  // Flat ground.
  if (d.y < -1e-6) {
    const t = -o.y / d.y;
    if (t >= 0 && t < best) { best = t; tag = 'ground'; outN.set(0, 1, 0); }
  }
  // Inside of the C-wall.
  const dz0 = o.z - WALL.zc;
  if (Math.abs(dz0) < WALL.hw + 3) {
    const px = o.x - WALL.x0, py = o.y - WALL.R;
    const cc = px * px + py * py - WALL.R * WALL.R;
    const a = d.x * d.x + d.y * d.y;
    if (cc < 0 && a > 1e-8) {
      const b = 2 * (px * d.x + py * d.y);
      const t = (-b + Math.sqrt(b * b - 4 * a * cc)) / (2 * a);
      if (t >= 0 && t < best) {
        const hx = px + t * d.x, hy = py + t * d.y, hz = dz0 + t * d.z;
        const th = Math.atan2(hx, -hy);
        if (th >= 0 && th <= WALL.thetaMax && Math.abs(hz) <= WALL.hw) {
          best = t; tag = 'wall';
          outN.set(-hx / WALL.R, -hy / WALL.R, 0);
        }
      }
    }
  }
  // Tops and sides of the parked vehicles.
  for (const bx of BOXES) {
    let t0 = 0, t1 = best, ax = -1, sg = 0;
    const lo = [bx.x0, bx.y0, bx.z0], hi = [bx.x1, bx.y1, bx.z1], oo = [o.x, o.y, o.z], dd = [d.x, d.y, d.z];
    let ok = true;
    for (let k = 0; k < 3 && ok; k++) {
      if (Math.abs(dd[k]) < 1e-9) { if (oo[k] < lo[k] || oo[k] > hi[k]) ok = false; continue; }
      let ta = (lo[k] - oo[k]) / dd[k], tb = (hi[k] - oo[k]) / dd[k];
      let s = -1;
      if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; s = 1; }
      if (ta > t0) { t0 = ta; ax = k; sg = s; }
      if (tb < t1) t1 = tb;
      if (t0 > t1) ok = false;
    }
    if (ok && ax >= 0 && t0 < best) {
      best = t0; tag = 'box'; hitInfo.box = bx;
      outN.set(0, 0, 0).setComponent(ax, sg);
    }
  }
  hitInfo.t = best;
  hitInfo.tag = tag;
  return tag;
}

// Penetration of a point into anything solid. Returns depth (0 if free) and writes the push-out normal.
const penInfo = { tag: null, box: null };
function penetrate(p, outN) {
  let depth = 0;
  penInfo.tag = null; penInfo.box = null;
  if (MAP) return MAP.penetrate(p, outN, penInfo);
  if (p.y < 0) { depth = -p.y; outN.set(0, 1, 0); penInfo.tag = 'ground'; }
  // C-wall structure: a box with the drive-surface cylinder cut out of it.
  const dz = p.z - WALL.zc;
  const side = WALL.hw + 0.35;
  const top = 2 * WALL.R + WALL.thick;
  const xr = WALL.x0 + WALL.R + WALL.thick;
  if (Math.abs(dz) < side && p.x > WALL.x0 && p.x < xr && p.y > 0 && p.y < top) {
    const hx = p.x - WALL.x0, hy = p.y - WALL.R;
    const r = Math.hypot(hx, hy);
    const inner = Math.abs(dz) < WALL.hw;
    if (!(inner && r < WALL.R)) {
      // candidates: exit through the cylinder (inner slab), or through the box faces
      let best = Infinity;
      if (inner) { best = r - WALL.R; _t.set(-hx / r, -hy / r, 0); }
      const faces = [
        [p.x - WALL.x0, -1, 0, 0], [xr - p.x, 1, 0, 0], [top - p.y, 0, 1, 0], [side - Math.abs(dz), 0, 0, Math.sign(dz) || 1],
      ];
      for (const f of faces) if (f[0] < best) { best = f[0]; _t.set(f[1], f[2], f[3]); }
      if (best > depth) { depth = best; outN.copy(_t); penInfo.tag = 'wall'; }
    }
  }
  for (const bx of BOXES) {
    if (p.x <= bx.x0 || p.x >= bx.x1 || p.y <= bx.y0 || p.y >= bx.y1 || p.z <= bx.z0 || p.z >= bx.z1) continue;
    const faces = [[p.x - bx.x0, -1, 0, 0], [bx.x1 - p.x, 1, 0, 0], [bx.y1 - p.y, 0, 1, 0], [p.z - bx.z0, 0, 0, -1], [bx.z1 - p.z, 0, 0, 1]];
    let best = Infinity;
    for (const f of faces) if (f[0] < best) { best = f[0]; _t.set(f[1], f[2], f[3]); }
    if (best > depth) { depth = best; outN.copy(_t); penInfo.tag = 'box'; penInfo.box = bx; }
  }
  return depth;
}

export function wallTheta(p) {
  return Math.atan2(p.x - WALL.x0, -(p.y - WALL.R));
}

// ---------- Vehicle ----------
export class Vehicle {
  constructor() {
    this.pos = V();
    this.vel = V();
    this.q = new THREE.Quaternion();
    this.w = V();                 // angular velocity, body frame
    this.fwd = V(); this.up = V(); this.right = V();
    this.F = V(); this.T = V();   // force / torque accumulators (world)
    this.acc = V();               // smoothed acceleration (body frame) for the G meter
    this.lastVel = V();
    this.wheels = WHEELS.map((w) => ({
      ...w, anchor: new THREE.Vector3(w.x, SUSP.anchorY, w.z), contact: false, comp: 0, y: SUSP.anchorY - SUSP.rest,
      spin: 0, steer: 0, n: V(), cp: V(), tag: null, slip: 0, load: 0,
    }));
    this.events = [];
    this.set('performance');
  }

  set(key) {
    const p = VARIANTS[key];
    this.p = p;
    this.mass = p.mass;
    this.I = new THREE.Vector3(...p.inertia);
    this.nozzleU = new Float32Array(p.nozzles.length);
    const first = MAP ? MAP.spawns[0] : SPAWNS[0];
    this.spawn = first;
    this.respawn(first);
  }

  respawn(sp = this.spawn) {
    const list = MAP ? MAP.spawns : SPAWNS;
    if (typeof sp === 'string') sp = list.find((s) => s.key === sp) || list[0];
    this.spawn = sp;
    this.mode = 'drive';
    this.pos.set(sp.x, (sp.y || 0) + 0.5, sp.z);
    this.q.setFromAxisAngle(WORLD_UP, sp.yaw || 0);
    this.vel.set(0, 0, 0);
    this.lastVel.set(0, 0, 0);
    this.w.set(0, 0, 0);
    this.acc.set(0, 0, 0);
    for (const w of this.wheels) { w.contact = false; w.comp = 0.06; w.steer = 0; w.slip = 0; w.load = 0; }
    this.gas = this.p.gas;
    this.nozzleU.fill(0);
    this.steer = 0;
    this.trackMode = this.trackMode || false;
    this.fanBoost = this.fanBoost || false;
    this.releaseT = 0;
    this.revT = 0;
    this.hopT = 0;
    this.suction = 0;
    this.suctionTarget = 0;
    this.braking = false;
    this.airbrake = 0;
    this.boosting = false;
    this.hovering = false;
    this.airborne = false;
    this.airT = 0;
    this.groundT = 1;
    this.air = null;
    this.onWall = false;
    this.wallTh = 0;
    this.wallMax = 0;
    this.hangT = 0;
    this.hung = false;
    this.crashT = 0;
    this.tipT = 0;
    this.contacts = 0;
    this.t60 = { state: 'idle', t: 0, result: this.t60 ? this.t60.result : null };
    this.basis();
    this.settle();
  }

  // Drop the car onto its wheels at the spawn so it starts at rest.
  settle() {
    const save = this.events;
    this.events = [];
    for (let i = 0; i < 240; i++) this.substep(1 / 240, NOINPUT);
    this.vel.set(0, 0, 0); this.w.set(0, 0, 0);
    this.events = save;
    this.events.length = 0;
    this.airborne = false; this.air = null; this.airT = 0;
    if (this.t60) this.t60.state = 'idle';
  }

  get mph() { return this.vel.length() * MPH; }
  get vFwd() { return this.vel.dot(this.fwd); }

  basis() {
    this.fwd.set(1, 0, 0).applyQuaternion(this.q);
    this.up.set(0, 1, 0).applyQuaternion(this.q);
    this.right.set(0, 0, 1).applyQuaternion(this.q);
  }

  // world-space point from a body-frame point
  toWorld(lp, out) { return out.copy(lp).applyQuaternion(this.q).add(this.pos); }

  addForceAt(F, at) {
    this.F.add(F);
    _r.subVectors(at, this.pos);
    this.T.add(_s.crossVectors(_r, F));
  }

  // velocity of a world point on the body
  pointVel(at, out) {
    _r.subVectors(at, this.pos);
    _e.copy(this.w).applyQuaternion(this.q);
    return out.crossVectors(_e, _r).add(this.vel);
  }

  crash(reason) {
    if (this.mode === 'crashed') return;
    this.mode = 'crashed';
    this.crashT = 2.2;
    this.events.push({ type: 'crash', reason, pos: this.pos.clone(), speed: this.vel.length() });
  }

  step(dt, inp, pressed) {
    this.events.length = 0;
    if (this.mode !== 'crashed') {
      if (pressed.track) { this.trackMode = !this.trackMode; this.events.push({ type: 'track', on: this.trackMode }); }
      // LB / F: on the wall it cuts the fans so the car drops; on the road it toggles fan boost,
      // full suction for maximum grip (Tesla: the fans pull the car down for more traction).
      if (pressed.release) {
        if (this.onWall || this.steepNow) { this.releaseT = 1.2; this.events.push({ type: 'fans-off' }); }
        else { this.fanBoost = !this.fanBoost; this.events.push({ type: 'fans', on: this.fanBoost }); }
      }
      if (pressed.lift && this.p.fLift && !this.airborne && this.gas > 5) { this.hopT = 0.6; this.hopAge = 0; this.events.push({ type: 'hop' }); }
      // A tap is a short hop; holding the button stretches it to full height.
      if (this.hopT > 0 && !inp.lift && this.hopAge > 0.3) this.hopT = 0;
    }
    const ctl = this.mode === 'crashed' ? NOINPUT : inp;
    const h = dt / SUB;
    for (let i = 0; i < SUB; i++) this.substep(h, ctl);
    this.track(dt, ctl);
    if (this.mode === 'crashed') {
      this.crashT -= dt;
      if (this.crashT <= 0) {
        let best = SPAWNS[0], bd = Infinity;
        if (MAP) best = MAP.respawnNear(this.pos);
        else for (const s of SPAWNS) {
          const d = Math.hypot(s.x - this.pos.x, s.z - this.pos.z);
          if (d < bd) { bd = d; best = s; }
        }
        this.respawn(best);
        this.events.push({ type: 'respawn', label: best.label });
      }
    }
  }

  substep(h, inp) {
    const p = this.p;
    const m = this.mass;
    this.basis();
    this.F.set(0, -m * G, 0);
    this.T.set(0, 0, 0);
    const speed = this.vel.length();
    const vF = this.vel.dot(this.fwd);

    // ---- Driver demand ----
    let drive = 0;      // 0..1 forward, negative = reverse
    let brake = 0;
    this.braking = false;
    if (inp.throttle > 0.02) drive = inp.throttle;
    // Brake to a stop and hold; keep holding the brake at a standstill to engage reverse.
    if (inp.brake > 0.02 && inp.throttle < 0.02 && Math.abs(vF) < 0.8) this.revT += h; else if (vF > 0.8 || inp.throttle > 0.02) this.revT = 0;
    if (inp.brake > 0.02) {
      if (this.revT > 0.35 && inp.throttle < 0.02) drive = -inp.brake;
      else { brake = inp.brake; this.braking = vF > 0.8; }
    }
    const steerMax = 0.6 / (1 + Math.pow(Math.abs(vF) / 18, 1.4)) + 0.035;
    const steerT = -inp.steer * steerMax;    // positive = left
    this.steer += clamp(steerT - this.steer, -3 * h, 3 * h);

    // ---- Suction fans ----
    const nAvg = _n.set(0, 0, 0);
    let nc = 0;
    for (const w of this.wheels) if (w.contact) { nAvg.add(w.n); nc++; }
    if (nc) nAvg.normalize();
    const steep = nc ? nAvg.y < 0.6 : false;
    this.steepNow = steep;
    let target = 0;
    if (nc >= 2 && this.releaseT <= 0) {
      target = 0.24 * m / SUCTION_KG;
      if (this.trackMode) target = 0.5;
      if (this.fanBoost) target = FAN_MAX;
      // Launch suction rises with the pedal instead of switching on at half throttle.
      if (drive > 0 && Math.abs(vF) < 30) target = Math.max(target, (0.24 + 0.2 * clamp((drive - 0.2) / 0.5, 0, 1)) * m / SUCTION_KG);
      if (speed > 15) target = Math.max(target, 0.45 * Math.min(1, Math.abs(this.steer) / 0.12));
      if (brake > 0.3) target = Math.max(target, 0.5);
      if (steep || this.onWall) target = 1;
    }
    this.suctionTarget = target;
    this.suction += (target - this.suction) * Math.min(1, h * (target > 0.9 ? 8 : 3));
    if (nc >= 2 && this.suction > 0.01) {
      this.F.addScaledVector(nAvg, -this.suction * SUCTION_KG * G);
    }

    // ---- Aero ----
    const wingUp = this.trackMode || speed > 50 || this.braking;
    this.wingUp = wingUp;
    this.airbrake += ((this.braking && speed > 25 && brake > 0.5 ? 1 : 0) - this.airbrake) * Math.min(1, h * 6);
    const cda = CDA + 0.7 * this.airbrake;
    if (speed > 0.1) this.F.addScaledVector(this.vel, -0.5 * RHO * cda * speed);
    const aero = this.contacts && vF > 0 ? 0.5 * RHO * (wingUp ? 1.4 : 0.35) * vF * vF : 0;
    if (aero) this.F.addScaledVector(this.up, -aero);
    this.downforce = (nc >= 2 ? this.suction * SUCTION_KG : 0) + aero / G;

    // ---- Wheels ----
    const k = SUSP.k * (1 + this.suction * 1.4) * (this.trackMode ? 1.4 : 1);
    const maxT = SUSP.rest + SUSP.radius;
    let contacts = 0;
    const totalDrive = drive > 0
      ? drive * Math.min(m * G0 * LAUNCH_G, POWER / Math.max(Math.abs(vF), 1)) * (vF > VMAX ? 0 : 1)
      : drive * m * 8 * (vF < -14 ? 0 : 1);
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      const a = this.toWorld(w.anchor, _a);
      const dir = _b.copy(this.up).negate();
      const tag = raycast(a, dir, maxT, w.n);
      const was = w.contact;
      if (!tag) {
        w.contact = false;
        w.comp = 0;
        w.load = 0;
        w.y = SUSP.anchorY - SUSP.rest;
        w.spin += (drive * 30 - 0) * h * (drive ? 1 : 0);
        continue;
      }
      contacts++;
      w.contact = true;
      w.tag = tag;
      w.grip = hitInfo.grip;
      const comp = maxT - hitInfo.t;
      const compVel = was ? (comp - w.comp) / h : 0;
      w.comp = comp;
      w.y = SUSP.anchorY - (hitInfo.t - SUSP.radius);
      let Fs = k * comp + SUSP.c * compVel;
      if (comp > SUSP.rest * 0.92) Fs += 4e5 * (comp - SUSP.rest * 0.92); // bump stop
      Fs = Math.max(0, Fs);
      const cp = w.cp.copy(a).addScaledVector(dir, hitInfo.t);
      const n = w.n;
      // Load on the tyre: suspension force projected on the contact normal.
      const N = Fs * Math.max(0.2, this.up.dot(n));
      w.load = N;
      // Tyre axes in the contact plane.
      const steer = w.front ? this.steer : 0;
      w.steer = steer;
      const fw = _c.copy(this.fwd);
      if (steer) fw.applyAxisAngle(this.up, steer);
      fw.addScaledVector(n, -fw.dot(n)).normalize();
      const lat = _d.crossVectors(fw, n);
      const vp = this.pointVel(cp, _vp);
      const vLong = vp.dot(fw), vLat = vp.dot(lat);
      const mu = MU * (w.grip ?? 1) * (inp.handbrake && !w.front ? 0.55 : 1);
      const muN = mu * N;
      // longitudinal
      let Fx = totalDrive * (w.front ? 0.35 : 0.65) / 2;
      let bq = brake * muN * 1.05;
      if (inp.handbrake && !w.front) bq = Math.max(bq, muN * 0.9);
      const hold = Math.abs(drive) < 0.02 && (Math.abs(vLong) < 0.8 || brake > 0);
      if (hold) bq = Math.max(bq, muN * 0.9);
      if (bq > 0) Fx -= clamp(vLong * 9000, -bq, bq);
      Fx -= 0.012 * N * Math.sign(vLong) * Math.min(1, Math.abs(vLong));
      // lateral (slip-angle model, saturating)
      const lsc = Math.max(0.15 * Math.abs(vLong), 0.5);
      let Fy = -muN * Math.tanh(1.6 * vLat / lsc);
      // friction circle
      const Ft = Math.hypot(Fx, Fy);
      if (Ft > muN && Ft > 0) { const s = muN / Ft; Fx *= s; Fy *= s; }
      w.slip = vLat;
      _f.copy(n).multiplyScalar(Fs).addScaledVector(fw, Fx).addScaledVector(lat, Fy);
      this.addForceAt(_f, cp);
      w.spin += (vLong / SUSP.radius) * h;
    }
    this.contacts = contacts;

    // ---- Thrusters ----
    this.boosting = false;
    this.hovering = false;
    this.nozzleU.fill(0);
    if (this.gas > 0 && p.nozzles.length) this.thrusters(h, inp, nc ? nAvg : null);

    // ---- Body contacts ----
    let roof = false, hard = 0, hardTag = null, hardBox = null, hardSide = false, side = false;
    for (const hp of HULL) {
      const at = this.toWorld(hp.p, _a);
      const d = penetrate(at, _c);
      if (d <= 0) continue;
      const vp = this.pointVel(at, _vp);
      const vn = vp.dot(_c);
      if (hp.roof) roof = true;
      if (Math.abs(hp.p.z) > 0.9) side = true;
      if (-vn > hard) { hard = -vn; hardTag = penInfo.tag; hardBox = penInfo.box; hardSide = Math.abs(_c.y) < 0.5; }
      const Fn = Math.max(0, 3e5 * Math.min(d, 0.3) - 2.2e4 * vn);
      _f.copy(_c).multiplyScalar(Fn);
      _t.copy(vp).addScaledVector(_c, -vn);
      const vt = _t.length();
      if (vt > 1e-3) _f.addScaledVector(_t, -Math.min(0.5 * Fn / vt, 6000));
      this.addForceAt(_f, at);
    }
    if (this.mode === 'drive') {
      if (roof) this.crash(this.onWall ? 'Fell off the wall' : 'Rolled onto the roof');
      else if ((hard > 11 && hardTag !== 'barrier') || (hardTag === 'barrier' && hard > 16) || (hardSide && hardTag === 'box' && hard > 5) || (hardSide && hardTag === 'wall' && hard > 7)) {
        this.crash(hardTag === 'box' ? `Hit the ${hardBox.car.name}` : hardTag === 'wall' ? 'Hit the C-wall structure' : hardTag === 'barrier' ? 'Hit the barrier' : 'Hit the ground too hard');
      }
      if (side && contacts < 2 && speed < 2) this.tipT += h; else this.tipT = 0;
      if (this.tipT > 1.5) this.crash('Tipped over');
    }

    // ---- World bounds ----
    if (!MAP && (this.pos.x < BOUNDS.x0 || this.pos.x > BOUNDS.x1)) { this.F.x += (this.pos.x < BOUNDS.x0 ? 1 : -1) * m * 30; this.vel.x *= 0.98; }
    if (!MAP && (this.pos.z < BOUNDS.z0 || this.pos.z > BOUNDS.z1)) { this.F.z += (this.pos.z < BOUNDS.z0 ? 1 : -1) * m * 30; this.vel.z *= 0.98; }

    // ---- Integrate ----
    this.vel.addScaledVector(this.F, h / m);
    const Tb = _t.copy(this.T).applyQuaternion(_qi.copy(this.q).invert());
    const w = this.w, I = this.I;
    // Euler's equations: I dw/dt = T - w x (I w)
    const ix = I.x * w.x, iy = I.y * w.y, iz = I.z * w.z;
    const gx = w.y * iz - w.z * iy, gy = w.z * ix - w.x * iz, gz = w.x * iy - w.y * ix;
    w.x += (Tb.x - gx) / I.x * h;
    w.y += (Tb.y - gy) / I.y * h;
    w.z += (Tb.z - gz) / I.z * h;
    if (!contacts) w.multiplyScalar(1 - 0.08 * h);
    this.pos.addScaledVector(this.vel, h);
    const rate = w.length();
    if (rate > 1e-7) {
      _q.setFromAxisAngle(_a.copy(w).divideScalar(rate), rate * h);
      this.q.multiply(_q).normalize();
    }
    this.releaseT = Math.max(0, this.releaseT - h);
    this.hopT = Math.max(0, this.hopT - h);
    this.hopAge = (this.hopAge || 0) + h;
  }

  // Cold-gas thrusters. Rear nozzles push the car forward; on the Rocket a flight computer
  // fires the four lift nozzles and the two nose nozzles to hop, hover and hold or change attitude.
  thrusters(h, inp, nAvg) {
    const p = this.p;
    const m = this.mass;
    const u = this.nozzleU;
    const airborne = this.contacts === 0;
    const boost = !!inp.boost || (p.key === 'thrust' && !!inp.lift);
    if (boost && p.fRear) {
      for (const n of p.nozzles) if (n.group === 'rear') u[n.id] = 1;
      this.boosting = true;
    }
    if (p.fLift) {
      // Body-frame quantities.
      _qi.copy(this.q).invert();
      const upW = _a.copy(WORLD_UP).applyQuaternion(_qi); // world up in body frame
      const I = this.I, w = this.w;
      const Lmax = 4 * p.fLift;
      let L = 0;
      // The hop fires the lift jets along the car's own up axis; the flight computer scales them by how
      // upright the car is, so a roll during the hop doesn't shove the car sideways off its line.
      if (this.hopT > 0) L = Math.min(Lmax, 2.15 * m * G) * clamp(upW.y, 0, 1);
      else if (inp.lift && airborne && upW.y > 0.5) {
        // Hover lift only once the car is nearly upright (faded in from 30 to 60 deg of tilt), so jets
        // fired mid-roll don't shove the car sideways.
        const vyT = 5 * (inp.throttle || 0) - 6 * (inp.brake || 0);
        L = clamp(m * (G + 3 * (vyT - this.vel.y)) / upW.y, 0, Lmax) * clamp((upW.y - 0.5) / 0.37, 0, 1);
        this.hovering = true;
      }
      // Attitude: rate commands from the sticks. With flight assist on, the car levels itself when the
      // sticks are released; with it off, it only holds its rates while hovering and otherwise coasts.
      // The flight computer ignores a wheel briefly leaving the road over a bump.
      let cx = 0, cy = 0, cz = 0;
      const assist = this.assist || this.autopilot;
      const flying = this.hopT > 0 || (airborne && (inp.lift || this.airT > 0.3));
      const sticks = Math.abs(inp.roll) > 0.08 || Math.abs(inp.pitch) > 0.08 || Math.abs(inp.yaw) > 0.08;
      if (flying && (sticks || assist || L > 0)) {
        if (sticks) {
          cx = inp.roll * 5.5;
          cz = -inp.pitch * 5;
          cy = -inp.yaw * 2.4;
        } else if (assist) {
          // Level the car. While hovering, lean against horizontal drift like a drone (up to ~25 deg).
          const tg = _f.set(0, 1, 0);
          if (inp.lift && this.hopT <= 0) {
            // ...but not while dropping fast: then every jet points straight down to brake the fall.
            const lk = 0.12 * clamp(1 - (Math.abs(this.vel.y) - 1) / 4, 0, 1) * clamp((this.pos.y - 1.5) / 3, 0, 1); // and flat for touchdown
            tg.set(-this.vel.x * lk, 1, -this.vel.z * lk);
            const hl = Math.hypot(tg.x, tg.z);
            if (hl > 0.47) { tg.x *= 0.47 / hl; tg.z *= 0.47 / hl; }
            tg.normalize();
          }
          tg.applyQuaternion(_qi);
          // Split the error into roll (about the long axis) and pitch, so an upside-down car rights
          // itself with a barrel roll rather than a flip. Each axis follows a braking curve: the rate
          // falls off as the error closes so the car stops level instead of rolling past it.
          const prof = (e, a, rmax) => Math.sign(e) * Math.min(rmax, 4 * Math.abs(e), Math.sqrt(2 * a * Math.abs(e)));
          if (tg.y < 0 && Math.abs(w.z) > 2 && Math.abs(w.z) > 2 * Math.abs(w.x)) {
            // Upside down and already flipping fast: finish the flip about the pitch axis rather than rolling out of it.
            cz = prof(Math.atan2(-tg.x, tg.y), 5, 4.2); cx = prof(Math.atan2(tg.z, Math.hypot(tg.x, tg.y)), 7, 3); cy = 0;
          } else {
            const er = Math.atan2(tg.z, tg.y), ep = Math.atan2(-tg.x, Math.hypot(tg.y, tg.z));
            // Pitch is about the horizontal axis across the car (body x cross world up), so the nose is
            // pulled level even while the car is on its side or upside down mid-roll. During a big roll
            // the pitch is only held, so the jets spend their torque on the roll first.
            const pr = prof(ep, 5, 3) * clamp(1.6 - Math.abs(er), 0, 1), pn = Math.hypot(tg.y, tg.z) || 1;
            cx = prof(er, 9, 6); cy = -tg.z / pn * pr; cz = tg.y / pn * pr;
          }
        } // else: hold the current attitude (zero rates) while lift is firing

        // Heading hold (flight assist): keep the nose on the heading it left the ground with, so a roll
        // or flip flies a straight line. Applied through whichever body axis currently points up.
        if (assist && Math.abs(inp.yaw) < 0.08) {
          const hd = Math.atan2(-this.fwd.z, this.fwd.x);
          if (this.hdgRef == null) this.hdgRef = hd;
          let e = this.hdgRef - hd;
          e = Math.atan2(Math.sin(e), Math.cos(e));
          const wy = clamp(3 * e, -1.5, 1.5);
          cx += upW.x * wy; cy += upW.y * wy; cz += upW.z * wy; // yaw about world up
        } else this.hdgRef = null;
        const K = 9;
        const tx = I.x * K * (cx - w.x), ty = I.y * K * (cy - w.y), tz = I.z * K * (cz - w.z);
        // Allocate total lift L, pitch torque tz and roll torque tx across the four lift nozzles
        // (FR, FL, RR, RL) with as little total thrust as possible, since gas can only push and every
        // newton of it also shoves the car along its up axis. Pitch sets the front and rear pair totals;
        // roll is a split within each pair, shared front:rear as xr:xf so it adds no pitch. If a pair
        // can't make its split, both totals rise by the torque-free mix (front xr : rear xf).
        // Attitude comes first: if the four jets can't give the full lift and the torque together,
        // the lift is cut back until the torque fits, so the car can always stop a roll.
        const xf = 0.8, xr = 1.92, zz = 0.72, span = xf + xr;
        const A = -tx / (2 * zz), af = A * xr / span, ar = A * xf / span;
        const alloc = (Lc) => {
          let Ff = (xr * Lc + tz) / span, Fr = (xf * Lc - tz) / span;
          let lam = Math.max(0, -Ff / xr, -Fr / xf);
          Ff += lam * xr; Fr += lam * xf;
          lam = Math.max(0, (2 * Math.abs(af) - Ff) / xr, (2 * Math.abs(ar) - Fr) / xf);
          Ff += lam * xr; Fr += lam * xf;
          return [Ff / 2 + af, Ff / 2 - af, Fr / 2 + ar, Fr / 2 - ar];
        };
        let F = alloc(L);
        if (L > 0 && Math.max(...F) > p.fLift) {
          let lo = 0, hi = L;
          for (let k = 0; k < 10; k++) { const mid = (lo + hi) / 2; if (Math.max(...alloc(mid)) > p.fLift) hi = mid; else lo = mid; }
          F = alloc(lo);
        }
        const lim = p.fLift;
        let li = 0;
        for (const n of p.nozzles) {
          if (n.group !== 'lift') continue;
          u[n.id] = clamp(F[li++] / lim, 0, 1);
        }
        // Yaw from the nose pair: right nozzle (exhaust +z) yaws the nose left (+y).
        for (const n of p.nozzles) {
          if (n.group !== 'nose') continue;
          const want = ty / (1.35 * p.fNose); // yaw arm of a diagonal nose jet: 1.92*0.893 - 0.8*0.45
          u[n.id] = n.dir.z > 0 ? clamp(want, 0, 1) : clamp(-want, 0, 1);
        }
      }
    }
    // Apply nozzle forces and burn gas.
    let flow = 0;
    for (const n of p.nozzles) {
      const uu = u[n.id];
      if (uu <= 0.001) continue;
      const Fmag = uu * (n.group === 'rear' ? p.fRear : n.group === 'lift' ? p.fLift : p.fNose);
      this.toWorld(n.pos, _c);
      _d.copy(n.dir).applyQuaternion(this.q).multiplyScalar(-Fmag);
      this.addForceAt(_d, _c);
      flow += Fmag / (p.isp * G0);
    }
    this.gas = Math.max(0, this.gas - flow * h);
  }

  // Per-frame bookkeeping: air time, wall riding, timers, events.
  track(dt, inp) {
    this.basis();
    const p = this.p;
    // smoothed acceleration in the body frame (for the G meter)
    _a.subVectors(this.vel, this.lastVel).divideScalar(dt);
    this.lastVel.copy(this.vel);
    _a.applyQuaternion(_qi.copy(this.q).invert());
    this.acc.lerp(_a, Math.min(1, dt * 10));

    // gas: slow top-up from the compressor while on the ground and not firing
    let firing = false;
    for (let i = 0; i < this.nozzleU.length; i++) if (this.nozzleU[i] > 0.01) firing = true;
    if (p.gas && !firing && this.contacts >= 3) this.gas = Math.min(p.gas, this.gas + p.gas * 0.04 * dt);

    // wall
    let onWall = 0;
    for (const w of this.wheels) if (w.contact && w.tag === 'wall') onWall++;
    const wasWall = this.onWall;
    this.onWall = onWall >= 2;
    if (this.onWall) {
      this.wallTh = wallTheta(this.pos);
      if (!wasWall && this.wallTh > 0.3) this.events.push({ type: 'wall' });
      this.wallMax = Math.max(this.wallMax, this.wallTh);
      if (this.wallTh > 2.7 && this.vel.length() < 2.5) this.hangT += dt; else this.hangT = 0;
      if (this.hangT > 0.6 && !this.hung) { this.hung = true; this.events.push({ type: 'hang' }); }
    } else if (this.contacts >= 3) { this.wallMax = 0; this.hung = false; }

    // air time
    const air = this.contacts === 0;
    if (air) {
      this.airT += dt;
      this.groundT = 0;
      if (!this.air && this.airT > 0.12) {
        this.air = { t: 0, pitch: 0, roll: 0, yaw: 0, maxH: this.pos.y, fromWall: wasWall || this.wallMax > 1.2, hop: this.hopT > 0, startY: this.pos.y, startSpeed: Math.hypot(this.vel.x, this.vel.z), over: new Set() };
        if (this.air.fromWall) this.events.push({ type: 'release', th: this.wallMax });
      }
      if (this.air) {
        const a = this.air;
        a.t += dt;
        a.pitch += this.w.z * dt;
        a.roll += this.w.x * dt;
        a.yaw += this.w.y * dt;
        a.maxH = Math.max(a.maxH, this.pos.y);
        for (const bx of BOXES) {
          if (this.pos.x > bx.x0 && this.pos.x < bx.x1 && this.pos.z > bx.z0 - 0.5 && this.pos.z < bx.z1 + 0.5 && this.pos.y > bx.y1) a.over.add(bx.car.name);
        }
      }
    } else {
      this.groundT += dt;
      if (this.air && this.contacts >= 2 && this.mode === 'drive') {
        const a = this.air;
        _a.set(0, 0, 0);
        for (const w of this.wheels) if (w.contact) _a.add(w.n);
        _a.normalize();
        this.events.push({ type: 'land', air: { ...a, over: [...a.over] }, quality: this.up.dot(_a), impact: Math.max(0, -this.vel.dot(_a)) });
        this.air = null;
      }
      if (this.groundT > 0.1) { this.airT = 0; if (this.air && this.mode !== 'drive') this.air = null; }
    }
    this.airborne = air && this.airT > 0.12;
    if (this.mode === 'crashed') { this.air = null; return; }

    // 0-60 timer
    const vF = this.vFwd;
    const t = this.t60;
    if (t.state === 'idle' && Math.abs(vF) < 0.5 && inp.throttle > 0.05 && this.contacts >= 3) { t.state = 'run'; t.t = 0; }
    else if (t.state === 'run') {
      t.t += dt;
      if (vF * MPH >= 60) {
        t.state = 'done'; t.result = Math.round(t.t * 100) / 100;
        this.events.push({ type: 't60', time: t.result, variant: p.key });
      } else if (t.t > 8 || vF < -0.5 || (inp.throttle < 0.05 && !inp.boost)) t.state = 'idle';
    } else if (t.state === 'done' && Math.abs(vF) < 0.5) t.state = 'idle';
  }
}

const NOINPUT = { throttle: 0, brake: 0, steer: 0, pitch: 0, roll: 0, yaw: 0, boost: false, lift: false, handbrake: false };
