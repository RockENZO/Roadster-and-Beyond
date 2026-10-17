import * as THREE from 'three';
import { G, BOUNDS, RAMPS, OBSTACLES, WALL, SPAWNS, groundH, groundN, wallSurfaceY, inWallFootprint } from './track.js';

const MPH = 2.23694;

// a0: tyre-limited acceleration (m/s^2). boost: extra push from the cold-gas thrusters.
// 0-60 mph is 26.8 m/s, so a0 17.5 gives ~1.5 s, +15 gives ~0.83 s, +30 on the Rocket gives ~0.55 s,
// the same ballpark as the numbers Tesla quoted for the three versions.
export const VARIANTS = {
  performance: {
    key: 'performance', name: 'Performance', tag: 'Multi-mode suction fans. Track Mode wings.',
    a0: 18.2, boost: 0, vmax: 106, tank: 0, drain: 0, regen: 0, airControl: 0.3, seats: 2,
    claim: '0-60 under 1.6 s',
  },
  thrust: {
    key: 'thrust', name: 'Thrust', tag: 'Rear cold-gas thrusters from SpaceX tech.',
    a0: 17.5, boost: 15, vmax: 112, tank: 100, drain: 26, regen: 9, airControl: 0.7, seats: 2,
    claim: '0-60 under 0.9 s',
  },
  rocket: {
    key: 'rocket', name: 'Rocket', tag: 'Ten perimeter thrusters. One seat. Flight system.',
    a0: 19, boost: 30, vmax: 125, tank: 140, drain: 30, regen: 10, airControl: 1.0, seats: 1,
    claim: '0-60 under 0.6 s',
  },
};

const V = () => new THREE.Vector3();
const _a = V(), _b = V(), _c = V(), _n = V(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion();
const WHEEL_PTS = [[1.32, -0.5, 0.88], [1.32, -0.5, -0.88], [-1.32, -0.5, 0.88], [-1.32, -0.5, -0.88]].map((p) => new THREE.Vector3(...p));
const ROOF_PTS = [[0.1, 0.62, 0], [-0.7, 0.58, 0.5], [-0.7, 0.58, -0.5]].map((p) => new THREE.Vector3(...p));
const COM_H = 0.5;

export class Vehicle {
  constructor() {
    this.pos = V();          // centre of mass, world
    this.vel = V();          // world
    this.q = new THREE.Quaternion();
    this.w = V();            // angular velocity, body frame
    this.gp = V();           // ground contact point (ground mode)
    this.upSm = new THREE.Vector3(0, 1, 0);
    this.fwd = new THREE.Vector3(1, 0, 0);
    this.up = new THREE.Vector3(0, 1, 0);
    this.set('performance');
  }

  set(key) {
    this.p = VARIANTS[key];
    this.tank = this.p.tank;
    this.respawn(0);
  }

  respawn(x = this.pos.x) {
    let sp = SPAWNS[0];
    for (const s of SPAWNS) if (s.x <= x + 1) sp = s;
    this.mode = 'ground';
    this.psi = 0;
    this.gp.set(sp.x, 0, 0);
    this.vel.set(0, 0, 0);
    this.vyG = 0;
    this.upSm.set(0, 1, 0);
    this.w.set(0, 0, 0);
    this.trackMode = false;
    this.boosting = false;
    this.hovering = false;
    this.braking = false;
    this.steerVis = 0;
    this.slip = 0;
    this.crashT = 0;
    this.air = null;
    this.wall = null;
    this.wallRide = 0;
    this.tank = this.p.tank;
    this.t60 = { state: 'idle', t: 0, result: this.t60 ? this.t60.result : null };
    this.events = [];
    this.syncFromGround(1);
    this.lastSpawn = sp;
  }

  get speed() { return Math.hypot(this.vel.x, this.vel.z); }
  get mph() { return this.mode === 'wall' ? this.wall.v * MPH : this.vel.length() * MPH; }

  basis() {
    this.fwd.set(1, 0, 0).applyQuaternion(this.q);
    this.up.set(0, 1, 0).applyQuaternion(this.q);
  }

  syncFromGround(snap) {
    const f = _a.set(Math.cos(this.psi), 0, -Math.sin(this.psi));
    const n = this.upSm;
    f.addScaledVector(n, -f.dot(n)).normalize();
    const r = _b.crossVectors(f, n).normalize();
    _m.makeBasis(f, n, r);
    _q.setFromRotationMatrix(_m);
    if (snap) this.q.copy(_q); else this.q.slerp(_q, 0.35);
    this.basis();
    this.pos.copy(this.gp).addScaledVector(this.up, COM_H);
  }

  crash(reason) {
    if (this.mode === 'crashed') return;
    this.events.push({ type: 'crash', reason, pos: this.pos.clone(), speed: this.vel.length() });
    this.mode = 'crashed';
    this.crashT = 1.9;
    this.boosting = false;
    this.air = null;
  }

  step(dt, inp, pressed) {
    this.events.length = 0;
    this.boosting = false;
    this.hovering = false;
    if (pressed.track) this.trackMode = !this.trackMode;
    switch (this.mode) {
      case 'ground': this.stepGround(dt, inp); break;
      case 'air': this.stepAir(dt, inp); break;
      case 'wall': this.stepWall(dt, inp, pressed); break;
      case 'crashed': this.stepCrashed(dt); break;
    }
    if (this.p.tank && !this.boosting && this.mode !== 'crashed') {
      this.tank = Math.min(this.p.tank, this.tank + this.p.regen * (this.mode === 'ground' ? 1 : 0.35) * dt);
    }
    this.basis();
  }

  stepCrashed(dt) {
    this.crashT -= dt;
    this.vel.multiplyScalar(Math.exp(-3 * dt));
    this.vel.y -= G * dt;
    this.pos.addScaledVector(this.vel, dt);
    const h = groundH(this.pos.x, this.pos.z) + 0.3;
    if (this.pos.y < h) { this.pos.y = h; this.vel.y = 0; }
    this.q.multiply(_q.setFromAxisAngle(_a.set(0.4, 0.2, 1).normalize(), 0.6 * dt * Math.max(0, this.crashT)));
    if (this.crashT <= 0) {
      this.events.push({ type: 'respawn' });
      this.respawn(this.pos.x);
    }
  }

  stepGround(dt, inp) {
    const p = this.p;
    const gp = this.gp;
    const fwd = _a.set(Math.cos(this.psi), 0, -Math.sin(this.psi));
    const right = _b.set(Math.sin(this.psi), 0, Math.cos(this.psi));
    let vF = this.vel.dot(fwd);
    let vL = this.vel.dot(right);
    const speed = Math.abs(vF);
    const sp = Math.min(Math.max(vF, 0) / p.vmax, 1);

    let a = 0;
    if (inp.throttle > 0.02) {
      if (vF < -0.5) a += 40 * inp.throttle;
      else a += p.a0 * (1 - sp * sp) * inp.throttle * (this.trackMode ? 1.04 : 1);
    }
    this.braking = false;
    if (inp.brake > 0.02) {
      if (vF > 0.8) { a -= 42 * inp.brake; this.braking = true; }
      else if (vF > -14) a -= 12 * inp.brake;
    }
    if (inp.thrust && p.boost > 0 && this.tank > 1) {
      a += p.boost * (1 - sp * sp * 0.5);
      this.tank = Math.max(0, this.tank - p.drain * dt);
      this.boosting = true;
    }
    if (inp.handbrake) a -= 12 * Math.sign(vF);
    a -= 0.00022 * vF * Math.abs(vF) + (Math.abs(vF) > 0.3 ? 0.6 * Math.sign(vF) : 0);
    const before = vF;
    vF += a * dt;
    if (inp.throttle < 0.02 && inp.brake < 0.02 && !this.boosting && Math.sign(before) !== Math.sign(vF) && Math.abs(before) < 1.5) vF = 0;
    if (inp.brake > 0.02 && inp.throttle < 0.02 && before > 0 && vF < 0) vF = 0;

    // Steering: limited by tyre grip (plus downforce in Track Mode) once the car is fast.
    const down = this.trackMode ? 1 : 0;
    const aLat = 13 + down * (6 + 0.0016 * vF * vF) + (p.key === 'performance' ? 3 : 0);
    const maxSteer = 0.55 / (1 + Math.pow(speed / 22, 1.6)) + 0.03;
    const yawMax = Math.min(speed / 2.65 * Math.tan(maxSteer), aLat / Math.max(speed, 6));
    const yawRate = -inp.steer * yawMax * (inp.handbrake ? 1.5 : 1) * Math.sign(vF || 1);
    this.psi += yawRate * dt;
    this.steerVis += (inp.steer * 0.45 / (1 + speed / 25) - this.steerVis) * Math.min(1, dt * 12);

    const grip = inp.handbrake ? 1.2 : this.trackMode ? 10 : 6;
    vL *= Math.exp(-grip * dt);
    this.slip = vL;

    const f2 = _a.set(Math.cos(this.psi), 0, -Math.sin(this.psi));
    const r2 = _b.set(Math.sin(this.psi), 0, Math.cos(this.psi));
    this.vel.set(0, 0, 0).addScaledVector(f2, vF).addScaledVector(r2, vL);
    const px = gp.x, pz = gp.z;
    gp.x += this.vel.x * dt;
    gp.z += this.vel.z * dt;

    // World bounds: soft wall.
    if (gp.x < BOUNDS.x0 || gp.x > BOUNDS.x1) { gp.x = THREE.MathUtils.clamp(gp.x, BOUNDS.x0, BOUNDS.x1); this.vel.x *= -0.2; }
    if (gp.z < BOUNDS.z0 || gp.z > BOUNDS.z1) { gp.z = THREE.MathUtils.clamp(gp.z, BOUNDS.z0, BOUNDS.z1); this.vel.z *= -0.2; }

    // The wall ramp: drive into the mouth fast and straight to ride it, otherwise it is solid.
    if (inWallFootprint(gp.x, gp.z)) {
      const inMouth = Math.abs(gp.z - WALL.zc) < WALL.hw - 0.8 && px < WALL.x0 && gp.x >= WALL.x0;
      if (inMouth && vF > 11 && f2.x > 0.74) {
        this.enterWall(vF, gp.z - WALL.zc);
        return;
      }
      // push back out the way we came
      const dxl = gp.x - WALL.x0, dxr = WALL.x0 + WALL.R + WALL.thick - gp.x;
      const dzl = gp.z - (WALL.zc - WALL.hw), dzr = WALL.zc + WALL.hw - gp.z;
      const m = Math.min(dxl, dxr, dzl, dzr);
      if (m === dxl) { gp.x = WALL.x0 - 0.01; this.vel.x = -Math.abs(this.vel.x) * 0.25; }
      else if (m === dxr) { gp.x = WALL.x0 + WALL.R + WALL.thick + 0.01; this.vel.x = Math.abs(this.vel.x) * 0.25; }
      else if (m === dzl) { gp.z = WALL.zc - WALL.hw - 0.01; this.vel.z = -Math.abs(this.vel.z) * 0.25; }
      else { gp.z = WALL.zc + WALL.hw + 0.01; this.vel.z = Math.abs(this.vel.z) * 0.25; }
      if (vF > 14) this.events.push({ type: 'bump' });
    }

    // Parked vehicles.
    const hitO = this.hitObstacle(gp.x, gp.z, gp.y + 0.3);
    if (hitO) { this.pos.copy(gp); this.pos.y += COM_H; this.crash('Smashed into a parked car'); return; }

    // Ground following, with take-off at ramp lips.
    const ny = groundH(gp.x, gp.z);
    if (ny - gp.y > 0.9) { this.pos.copy(gp); this.pos.y += COM_H; this.crash('Hit the ramp face'); return; }
    const ballistic = gp.y + this.vyG * dt - 0.5 * G * dt * dt;
    if (this.vyG > 1.0 && ny < ballistic - 0.04) {
      this.takeOff(this.vyG);
      return;
    }
    this.vyG = (ny - gp.y) / dt;
    gp.y = ny;

    groundN(gp.x, gp.z, _n);
    this.upSm.lerp(_n, Math.min(1, dt * 14)).normalize();
    this.syncFromGround(0);

    // 0-60 timer
    const t = this.t60;
    if (t.state === 'idle' && Math.abs(vF) < 0.5 && inp.throttle > 0.05) { t.state = 'run'; t.t = 0; }
    else if (t.state === 'run') {
      t.t += dt;
      if (vF * MPH >= 60) {
        t.state = 'done'; t.result = Math.round(t.t * 100) / 100;
        this.events.push({ type: 't60', time: t.result, variant: p.key });
      } else if (t.t > 8 || vF < 0) t.state = 'idle';
    } else if (t.state === 'done' && vF < 1) t.state = 'idle';
    else if (t.state === 'idle' && t.t !== 0) t.t = 0;
  }

  hitObstacle(x, z, y) {
    for (const o of OBSTACLES) {
      if (x > o.x0 - 1.0 && x < o.x1 + 1.0 && z > o.z0 - 0.9 && z < o.z1 + 0.9 && y < o.top) return o;
    }
    return null;
  }

  takeOff(vy) {
    this.pos.copy(this.gp).addScaledVector(this.up, COM_H);
    this.vel.y = vy;
    this.w.set(0, 0, 0);
    this.beginAir(false, 0);
    this.mode = 'air';
  }

  beginAir(fromWall, pitch0) {
    this.air = { t: 0, pitch: pitch0, roll: 0, yaw: 0, fromWall, wallTime: this.wallRide, maxH: 0, startY: this.pos.y };
    this.wallRide = 0;
  }

  stepAir(dt, inp) {
    const p = this.p;
    const air = this.air;
    this.vel.y -= G * dt;
    const sp = this.vel.length();
    this.vel.multiplyScalar(1 - 0.00012 * sp * dt);

    const c = p.airControl;
    const acc = 7.5 * c;
    const wMax = 1.8 + 4.5 * c;
    const w = this.w;
    const usesGas = p.tank > 0;
    let gasUse = 0;
    const axes = [['z', -inp.pitch], ['x', inp.roll], ['y', -inp.yaw]];
    for (const [ax, input] of axes) {
      if (Math.abs(input) > 0.05) {
        if (!usesGas || this.tank > 0) {
          w[ax] += input * acc * dt;
          if (usesGas) gasUse += Math.abs(input) * 6;
        }
        w[ax] = THREE.MathUtils.clamp(w[ax], -wMax, wMax);
      } else {
        w[ax] *= Math.exp(-0.7 * c * dt);
      }
    }
    // Thrusters as translation.
    this.basis();
    if (p.key === 'thrust' && inp.thrust && this.tank > 0) {
      this.vel.addScaledVector(this.fwd, 15 * dt);
      gasUse += p.drain;
      this.boosting = true;
    } else if (p.key === 'rocket') {
      if (inp.thrust && this.tank > 0) {
        this.vel.addScaledVector(this.up, 17 * dt);
        gasUse += p.drain;
        this.boosting = true;
        this.hovering = true;
      }
      if (inp.handbrake && this.tank > 0) {
        this.vel.addScaledVector(this.fwd, 15 * dt);
        gasUse += p.drain * 0.8;
        this.boosting = true;
      }
    }
    this.tank = Math.max(0, this.tank - gasUse * dt);

    this.pos.addScaledVector(this.vel, dt);
    const rate = w.length();
    if (rate > 1e-5) this.q.multiply(_q.setFromAxisAngle(_a.copy(w).divideScalar(rate), rate * dt)).normalize();
    air.pitch += w.z * dt;
    air.roll += w.x * dt;
    air.yaw += w.y * dt;
    air.t += dt;
    air.maxH = Math.max(air.maxH, this.pos.y - air.startY);

    this.basis();
    if (this.pos.x < BOUNDS.x0 || this.pos.x > BOUNDS.x1) { this.pos.x = THREE.MathUtils.clamp(this.pos.x, BOUNDS.x0, BOUNDS.x1); this.vel.x *= -0.2; }
    if (this.pos.z < BOUNDS.z0 || this.pos.z > BOUNDS.z1) { this.pos.z = THREE.MathUtils.clamp(this.pos.z, BOUNDS.z0, BOUNDS.z1); this.vel.z *= -0.2; }

    // Wall ramp body.
    if (inWallFootprint(this.pos.x, this.pos.z) && this.pos.y - COM_H < wallSurfaceY(this.pos.x) + 0.2) {
      this.crash('Hit the wall ramp');
      return;
    }
    if (air.t > 0.12 && this.hitObstacle(this.pos.x, this.pos.z, this.pos.y - 0.4)) {
      this.crash('Landed on the traffic');
      return;
    }

    // Ground contact.
    let contact = false;
    for (const lp of WHEEL_PTS) {
      _c.copy(lp).applyQuaternion(this.q).add(this.pos);
      if (_c.y < groundH(_c.x, _c.z)) { contact = true; break; }
    }
    let roofHit = false;
    for (const lp of ROOF_PTS) {
      _c.copy(lp).applyQuaternion(this.q).add(this.pos);
      if (_c.y < groundH(_c.x, _c.z)) { roofHit = true; break; }
    }
    if (air.t < 0.2 || (!contact && !roofHit)) return;
    groundN(this.pos.x, this.pos.z, _n, 1.6);
    const upDot = this.up.dot(_n);
    const impact = -this.vel.y;
    if (roofHit || upDot < 0.55) { this.crash('Landed upside down'); return; }
    if (impact > 42) { this.crash('Landing too hard'); return; }

    // Clean enough: hand over to ground driving.
    const f = _a.copy(this.fwd);
    f.y = 0;
    if (f.lengthSq() < 1e-4) f.set(this.vel.x, 0, this.vel.z);
    f.normalize();
    this.psi = Math.atan2(-f.z, f.x);
    const keep = 0.62 + 0.38 * Math.pow((upDot - 0.55) / 0.45, 1.5);
    this.vel.y = 0;
    this.vel.x *= keep; this.vel.z *= keep;
    this.gp.set(this.pos.x, groundH(this.pos.x, this.pos.z), this.pos.z);
    this.vyG = 0;
    this.upSm.copy(this.up);
    this.mode = 'ground';
    this.events.push({ type: 'land', air: { ...air }, quality: upDot, impact });
    this.air = null;
    this.w.set(0, 0, 0);
  }

  enterWall(v, zOff) {
    this.mode = 'wall';
    this.wall = { th: 0, v, z: zOff };
    this.wallRide = 0;
    this.events.push({ type: 'wall' });
  }

  stepWall(dt, inp, pressed) {
    const p = this.p;
    const W = this.wall;
    const R = WALL.R;
    let a = 0;
    const sp = Math.min(Math.max(W.v, 0) / p.vmax, 1);
    a += 0.85 * p.a0 * (1 - sp * sp) * inp.throttle;
    if (inp.thrust && p.boost > 0 && this.tank > 1) {
      a += p.boost * 0.7;
      this.tank = Math.max(0, this.tank - p.drain * dt);
      this.boosting = true;
    }
    if (inp.brake > 0.02) a -= 18 * inp.brake;
    a -= G * Math.sin(W.th);
    a -= 0.0032 * W.v * Math.abs(W.v) + 0.3 * Math.sign(W.v);
    W.v += a * dt;
    W.th += (W.v / R) * dt;
    W.z = THREE.MathUtils.clamp(W.z + inp.steer * 4.5 * dt, -(WALL.hw - 1.4), WALL.hw - 1.4);
    this.wallRide += dt;

    const th = W.th;
    const s = Math.sin(th), co = Math.cos(th);
    this.upSm.set(-s, co, 0);
    this.q.setFromAxisAngle(_a.set(0, 0, 1), th);
    this.basis();
    _b.set(WALL.x0 + R * s, R * (1 - co), WALL.zc + W.z);
    this.pos.copy(_b).addScaledVector(this.up, COM_H);
    this.vel.set(W.v * co, W.v * s, 0);
    this.gp.copy(_b);

    if (th <= 0) {
      this.mode = 'ground';
      this.gp.set(WALL.x0 - 0.2, 0, WALL.zc + W.z);
      this.psi = 0;
      this.vel.set(W.v, 0, 0);
      this.vyG = 0;
      this.upSm.set(0, 1, 0);
      this.wall = null;
      return;
    }
    const release = pressed.handbrake && th > 0.4;
    if (th >= WALL.thetaMax || release) {
      this.mode = 'air';
      this.w.set(0, 0, W.v / R);
      this.beginAir(true, th);
      this.wall = null;
      this.events.push({ type: 'release', th });
    }
  }
}
