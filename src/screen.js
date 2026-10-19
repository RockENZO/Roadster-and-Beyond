import * as THREE from 'three';

// The Roadster's floating landscape touchscreen in Track Mode, after the close-look video: a
// near-black page of thin red outlined panels with orange-red text. Brake / Accel / Regen bars,
// battery, motor and brake temperatures, a g-g meter, a lap trace, tyres, a session list, the
// aero and fan settings, and the thruster gas bar along the bottom. The big speed readout in the
// Lap panel is the one addition, so the speed can be read from the driver's seat.
//
// Telemetry turns the vehicle state into the numbers the screen shows (temperatures drift with
// use; tyre pressures follow the wheel loads). CockpitScreen draws them into a CanvasTexture,
// redrawing ~12 times a second and only while it is being looked at.

const MPH = 2.23694;
const W = 1024, H = 576;
const RED = '#ff5a36';
const TXT = '#ff7a52';
const DIM = '#a5432f';
const LINE = 'rgba(255,72,44,0.62)';
const FAINT = 'rgba(255,72,44,0.22)';
const FONT = 'Inter, "Helvetica Neue", Arial, sans-serif';

const approach = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
const fmtT = (s) => {
  if (s == null || !isFinite(s)) return '--:--.---';
  const m = Math.floor(s / 60), r = s - m * 60;
  return `${String(m).padStart(2, '0')}:${r.toFixed(3).padStart(6, '0')}`;
};

export class Telemetry {
  constructor() {
    this.battery = 86;
    this.battT = 96;
    this.motorT = 150;
    this.brakeT = [420, 420, 300, 300];
    this.tyreT = [62, 62, 64, 64];
    this.trace = [];
    this.traceT = 0;
    this.runs = [];
    this.best = null;
    this.session = 0;
    this.still = 0;
    this.lastResult = null;
    this.lastState = 'idle';
    this.tel = {
      mph: 0, gear: 'P', battery: 86, brake: 0, accel: 0, regen: 0, battT: 96, motorT: 150, brakeT: this.brakeT,
      tyres: [0, 1, 2, 3].map(() => ({ psi: 28, temp: 62 })), gx: 0, gy: 0, trace: this.trace, elev: 0,
      runs: this.runs, best: null, last: null, t60: 0, t60run: false, session: 0, gas: null, gasPsi: 0,
      boosting: false, hovering: false, trackMode: false, fans: 0, downforce: 0, wing: false, variant: '',
    };
  }

  update(dt, v, ctrl = {}) {
    const t = this.tel;
    const vF = v.vFwd;
    const speed = v.vel.length();
    const thr = Math.max(0, ctrl.throttle || 0);
    const brk = Math.max(0, ctrl.brake || 0);
    this.session += dt;
    // gear: R while rolling backwards, P after a few seconds standing still, D otherwise
    if (Math.abs(vF) < 0.3 && thr < 0.02 && brk < 0.02) this.still += dt; else this.still = 0;
    t.gear = vF < -0.3 ? 'R' : this.still > 3 ? 'P' : v.airborne ? 'N' : 'D';
    t.mph = Math.abs(vF) * MPH;
    t.accel = thr;
    t.brake = v.braking ? brk : brk * 0.3;
    t.regen = thr < 0.05 && vF > 2 && !v.airborne ? Math.min(1, 0.35 + brk * 0.65) * Math.min(1, vF / 10) : 0;
    // battery: drains with power, recovers a touch under regen
    const power = thr * Math.min(1, 0.25 + speed / 40);
    this.battery = Math.max(5, this.battery - dt * (power * 0.06 - t.regen * 0.02));
    t.battery = this.battery;
    this.battT = approach(this.battT, 92 + 26 * power + 8 * (v.boosting ? 1 : 0), 0.08, dt);
    this.motorT = approach(this.motorT, 140 + 75 * power + 18 * Math.min(1, speed / 60), 0.1, dt);
    t.battT = this.battT;
    t.motorT = this.motorT;
    const bheat = (v.braking ? brk : 0) * speed;
    for (let i = 0; i < 4; i++) {
      const front = i < 2;
      const target = (front ? 380 : 280) + bheat * (front ? 28 : 18);
      this.brakeT[i] = approach(this.brakeT[i], Math.min(1600, target), bheat > 1 ? 0.6 : 0.05, dt);
      const w = v.wheels[i];
      const load = w && w.contact ? w.load : 0;
      const slip = w && w.contact ? (w.slide || 0) : 0;
      this.tyreT[i] = approach(this.tyreT[i], 58 + Math.min(60, slip * 6 + speed * 0.25 + (front ? 0 : thr * 8)), 0.12, dt);
      t.tyres[i].psi = 27 + Math.min(6, load / 4500);
      t.tyres[i].temp = this.tyreT[i];
    }
    t.gx = v.acc.x / 9.81;
    t.gy = v.acc.z / 9.81;
    t.elev = Math.max(0, v.pos.y - 0.48) * 3.281;
    // lap trace: recent x/z positions
    this.traceT += dt;
    const last = this.trace[this.trace.length - 1];
    if (this.traceT > 0.15 && (!last || Math.hypot(v.pos.x - last.x, v.pos.z - last.z) > 1.5)) {
      this.traceT = 0;
      this.trace.push({ x: v.pos.x, z: v.pos.z });
      if (this.trace.length > 360) this.trace.shift();
    }
    if (last && Math.hypot(v.pos.x - last.x, v.pos.z - last.z) > 60) this.trace.length = 0; // respawned
    t.hx = v.fwd.x; t.hz = v.fwd.z; t.px = v.pos.x; t.pz = v.pos.z;
    // 0-60 runs make up the session list
    const r = v.t60;
    if (r.state === 'done' && this.lastState !== 'done' && r.result != null) {
      this.runs.unshift(r.result);
      if (this.runs.length > 10) this.runs.pop();
      this.best = this.best == null ? r.result : Math.min(this.best, r.result);
    }
    this.lastState = r.state;
    t.last = this.runs[0] ?? null;
    t.best = this.best;
    t.t60run = r.state === 'run';
    t.t60 = r.state === 'run' ? r.t : (r.result ?? 0);
    t.session = this.session;
    const p = v.p;
    t.gas = p.gas ? v.gas / p.gas : null;
    t.gasPsi = t.gas == null ? 0 : 5500 * t.gas;
    t.boosting = v.boosting;
    t.hovering = v.hovering;
    t.trackMode = v.trackMode;
    t.fans = v.suction;
    t.downforce = v.downforce || 0;
    t.wing = !!v.wingUp;
    t.variant = p.name;
    return t;
  }
}

// Demo values for the screen when nothing live is driving it (the preview page, the menu car).
export const DEMO_TEL = {
  mph: 0, gear: 'P', battery: 86, brake: 0, accel: 0, regen: 0, battT: 96, motorT: 150, brakeT: [420, 420, 300, 300],
  tyres: [0, 1, 2, 3].map(() => ({ psi: 28, temp: 31 })), gx: 0, gy: 0, trace: [], elev: 0, runs: [], best: null, last: null,
  t60: 0, t60run: false, session: 0, gas: 1, gasPsi: 5500, boosting: false, hovering: false, trackMode: true, fans: 0,
  downforce: 0, wing: false, variant: '',
};

export class CockpitScreen {
  constructor() {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    this.canvas = c;
    this.g = c.getContext('2d');
    this.texture = new THREE.CanvasTexture(c);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
    this.timer = 1;
    this.drawn = false;
    this.draw(DEMO_TEL);
  }

  // active: the cockpit camera is on (or a preview wants it live). Redraws at ~12 Hz.
  update(dt, tel, active) {
    if (!active && this.drawn) return;
    this.timer += dt;
    if (this.timer < 1 / 12 && this.drawn) return;
    this.timer = 0;
    this.draw(tel || DEMO_TEL);
  }

  draw(t) {
    const g = this.g;
    this.drawn = true;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#060404';
    g.fillRect(0, 0, W, H);
    const vg = g.createRadialGradient(W * 0.55, H * 0.45, 50, W * 0.55, H * 0.45, W * 0.7);
    vg.addColorStop(0, 'rgba(60,10,6,0.35)');
    vg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = vg;
    g.fillRect(0, 0, W, H);
    g.textBaseline = 'alphabetic';
    this.top(t);
    // left column
    this.barPanel(18, 52, 178, 54, 'Brake', `${Math.round(t.brake * 100)}%`, t.brake);
    this.barPanel(18, 112, 178, 54, 'Regen', `${Math.round(t.regen * 100)}%`, t.regen);
    this.barPanel(18, 172, 178, 54, 'Battery Temp', `${Math.round(t.battT)}°F`, (t.battT - 60) / 90);
    this.barPanel(18, 232, 178, 54, 'Motor Temp', `${Math.round(t.motorT)}°F`, (t.motorT - 80) / 180);
    this.brakeTemps(18, 292, 178, 208, t);
    // second column
    this.barPanel(206, 52, 174, 48, 'Accel', `${Math.round(t.accel * 100)}%`, t.accel);
    this.meter(206, 106, 174, 180, t);
    this.tyres(206, 292, 174, 150, t);
    // centre
    this.lap(390, 52, 398, 234, t);
    this.sessionPanel(390, 292, 398, 150, t);
    this.thruster(206, 452, 582, 76, t);
    // right column
    this.settings(798, 52, 208, t);
    // bottom-left button
    g.fillStyle = TXT;
    g.font = `500 17px ${FONT}`;
    g.textAlign = 'center';
    g.fillText('Setup', 107, 540);
    g.textAlign = 'left';
    this.texture.needsUpdate = true;
  }

  top(t) {
    const g = this.g;
    g.font = `600 16px ${FONT}`;
    let x = 22;
    for (const ch of ['P', 'R', 'N', 'D']) {
      const on = ch === t.gear;
      g.fillStyle = on ? '#ffd2c2' : DIM;
      g.fillText(ch, x, 34);
      if (on) { g.fillStyle = RED; g.fillRect(x - 1, 39, 12, 2); }
      x += 16;
    }
    g.fillStyle = DIM;
    g.fillText('·', x + 2, 34);
    x += 14;
    // battery icon: little vertical bars
    const n = Math.round((t.battery / 100) * 8);
    for (let i = 0; i < 8; i++) {
      g.fillStyle = i < n ? TXT : 'rgba(255,90,54,0.25)';
      g.fillRect(x + i * 4, 22, 2, 13);
    }
    g.fillStyle = TXT;
    g.fillText(`${Math.round(t.battery)}%`, x + 38, 34);
    g.textAlign = 'center';
    g.font = `600 15px ${FONT}`;
    const runs = String(t.runs.length).padStart(2, '0');
    g.fillText(`${runs} / 60   ·   ${fmtT(t.t60).slice(1)}   ·   POS 1`, 512, 28);
    g.textAlign = 'right';
    g.font = `500 13px ${FONT}`;
    const d = new Date();
    const day = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '');
    const tm = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    g.fillText(`${day} · ${tm}`, 1004, 28);
    g.textAlign = 'left';
  }

  panel(x, y, w, h, title, right) {
    const g = this.g;
    g.fillStyle = 'rgba(70,10,6,0.22)';
    g.fillRect(x, y, w, h);
    g.strokeStyle = LINE;
    g.lineWidth = 1.5;
    g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    g.fillStyle = TXT;
    g.font = `500 15px ${FONT}`;
    if (title) g.fillText(title, x + 10, y + 21);
    if (right) {
      g.textAlign = 'right';
      g.fillText(right, x + w - 10, y + 21);
      g.textAlign = 'left';
    }
  }

  bar(x, y, w, v) {
    const g = this.g;
    v = Math.max(0, Math.min(1, v || 0));
    g.strokeStyle = LINE;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x, y); g.lineTo(x + w, y);
    for (let i = 0; i <= 4; i++) { const xx = x + (w * i) / 4; g.moveTo(xx, y); g.lineTo(xx, y - (i % 4 === 0 ? 7 : 4)); }
    g.stroke();
    if (v > 0.003) {
      const gr = g.createLinearGradient(x, 0, x + w, 0);
      gr.addColorStop(0, '#8a1d0e');
      gr.addColorStop(1, '#ff7a3a');
      g.fillStyle = gr;
      g.fillRect(x, y - 6, w * v, 6);
    }
  }

  barPanel(x, y, w, h, title, right, v) {
    this.panel(x, y, w, h, title, right);
    this.bar(x + 10, y + h - 12, w - 20, v);
  }

  // top-down car outline used by the brake and tyre panels
  car(cx, cy, s) {
    const g = this.g;
    g.strokeStyle = RED;
    g.lineWidth = 1.6;
    const P = [[0, -1], [0.3, -0.92], [0.42, -0.55], [0.4, 0.05], [0.44, 0.5], [0.4, 0.95], [-0.4, 0.95], [-0.44, 0.5], [-0.4, 0.05], [-0.42, -0.55], [-0.3, -0.92]];
    g.beginPath();
    P.forEach(([px, py], i) => (i ? g.lineTo(cx + px * s * 0.5, cy + py * s) : g.moveTo(cx + px * s * 0.5, cy + py * s)));
    g.closePath();
    g.stroke();
    g.beginPath(); // cabin
    g.moveTo(cx - 0.15 * s, cy - 0.35 * s); g.lineTo(cx + 0.15 * s, cy - 0.35 * s); g.lineTo(cx + 0.17 * s, cy + 0.3 * s); g.lineTo(cx - 0.17 * s, cy + 0.3 * s); g.closePath();
    g.moveTo(cx - 0.12 * s, cy - 0.1 * s); g.lineTo(cx + 0.12 * s, cy - 0.1 * s);
    g.stroke();
    g.fillStyle = 'rgba(255,72,44,0.55)';
    for (const [wx, wy] of [[-1, -0.55], [1, -0.55], [-1, 0.55], [1, 0.55]]) g.fillRect(cx + wx * 0.25 * s - 0.04 * s, cy + wy * s - 0.13 * s, 0.08 * s, 0.26 * s);
  }

  brakeTemps(x, y, w, h, t) {
    const g = this.g;
    this.panel(x, y, w, h, 'Brake Temp', '°F');
    const cx = x + w / 2, cy = y + h / 2 + 12;
    this.car(cx, cy, 70);
    g.font = `600 14px ${FONT}`;
    g.fillStyle = TXT;
    const b = t.brakeT;
    g.textAlign = 'right';
    g.fillText(`${Math.round(b[1])}°`, cx - 26, cy - 34);
    g.fillText(`${Math.round(b[3])}°`, cx - 26, cy + 50);
    g.textAlign = 'left';
    g.fillText(`${Math.round(b[0])}°`, cx + 26, cy - 34);
    g.fillText(`${Math.round(b[2])}°`, cx + 26, cy + 50);
  }

  tyres(x, y, w, h, t) {
    const g = this.g;
    this.panel(x, y, w, h, 'Tire', 'PSI · °C');
    const cx = x + w / 2, cy = y + h / 2 + 12;
    this.car(cx, cy, 52);
    g.font = `600 13px ${FONT}`;
    g.fillStyle = TXT;
    const ty = t.tyres;
    const put = (i, px, py, align) => {
      g.textAlign = align;
      g.fillText(`${Math.round(ty[i].psi)}`, px, py);
      g.fillText(`${Math.round(ty[i].temp)}°`, px, py + 15);
    };
    put(1, cx - 22, cy - 34, 'right');
    put(0, cx + 22, cy - 34, 'left');
    put(3, cx - 22, cy + 22, 'right');
    put(2, cx + 22, cy + 22, 'left');
    g.textAlign = 'left';
  }

  meter(x, y, w, h, t) {
    const g = this.g;
    this.panel(x, y, w, h, 'Meter');
    const cx = x + w / 2, cy = y + h / 2 + 10, r = Math.min(w, h) * 0.34;
    g.strokeStyle = FAINT;
    g.lineWidth = 1;
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.moveTo(cx + r * 0.5, cy); g.arc(cx, cy, r * 0.5, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = LINE;
    g.beginPath();
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      g.moveTo(cx + Math.cos(a) * r * 0.15, cy + Math.sin(a) * r * 0.15);
      g.lineTo(cx + Math.cos(a) * r * 0.85, cy + Math.sin(a) * r * 0.85);
    }
    g.stroke();
    g.fillStyle = TXT;
    g.font = `500 12px ${FONT}`;
    g.textAlign = 'center';
    g.fillText('3.5', cx, cy - r - 4);
    g.fillText('3.5', cx, cy + r + 14);
    g.fillText('3.5', cx - r - 14, cy + 4);
    g.fillText('3.5', cx + r + 14, cy + 4);
    // dot: lateral g right, braking down, acceleration up
    const k = r / 3.5;
    const dx = Math.max(-3.5, Math.min(3.5, t.gy)) * k, dy = -Math.max(-3.5, Math.min(3.5, t.gx)) * k;
    g.strokeStyle = '#ffb08f';
    g.lineWidth = 1.5;
    g.beginPath(); g.arc(cx + dx, cy + dy, 7, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#ff6a3d';
    g.beginPath(); g.arc(cx + dx, cy + dy, 3.5, 0, Math.PI * 2); g.fill();
    g.fillStyle = DIM;
    g.font = `500 12px ${FONT}`;
    g.textAlign = 'right';
    g.fillText(`${Math.hypot(t.gx, t.gy).toFixed(2)} g`, x + w - 10, y + 21);
    g.textAlign = 'left';
  }

  lap(x, y, w, h, t) {
    const g = this.g;
    this.panel(x, y, w, h, '');
    g.save();
    g.beginPath(); g.rect(x + 1, y + 1, w - 2, h - 2); g.clip();
    // perspective dot floor
    const hx = x + w * 0.6, hy = y + 28; // vanishing point
    const proj = (u, v) => { // u -1..1 across, v 0 (far) .. 1 (near)
      const s = 0.28 + 0.72 * v;
      return [hx + u * s * w * 0.62, hy + 22 + v * v * (h - 40)];
    };
    g.fillStyle = 'rgba(255,80,50,0.42)';
    for (let iv = 0; iv <= 16; iv++) {
      const v = iv / 16;
      for (let iu = -20; iu <= 20; iu++) {
        const [px, py] = proj(iu / 20, v);
        g.fillRect(px, py, 1.6, 1.6);
      }
    }
    // track trace fitted into the floor, heading up the screen
    const tr = t.trace;
    if (tr.length > 1) {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const p of tr) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
      x0 = Math.min(x0, t.px); x1 = Math.max(x1, t.px); z0 = Math.min(z0, t.pz); z1 = Math.max(z1, t.pz);
      const span = Math.max(60, x1 - x0, z1 - z0) * 1.15;
      const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
      // world x maps to depth (far = +x), world z maps across
      const map = (px, pz) => proj(((pz - mz) / span) * 2, 0.5 - ((px - mx) / span));
      g.lineJoin = 'round';
      g.lineCap = 'round';
      for (const [lw, col] of [[7, 'rgba(255,90,40,0.25)'], [2.6, '#ff7a3a']]) {
        g.strokeStyle = col;
        g.lineWidth = lw;
        g.beginPath();
        tr.forEach((p, i) => { const [px, py] = map(p.x, p.z); if (i) g.lineTo(px, py); else g.moveTo(px, py); });
        const [cx, cy] = map(t.px, t.pz);
        g.lineTo(cx, cy);
        g.stroke();
      }
      const [cx, cy] = map(t.px, t.pz);
      const [ax, ay] = map(t.px + t.hx * span * 0.05, t.pz + t.hz * span * 0.05);
      const a = Math.atan2(ay - cy, ax - cx);
      g.fillStyle = '#fff1ea';
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * 11, cy + Math.sin(a) * 11);
      g.lineTo(cx + Math.cos(a + 2.5) * 8, cy + Math.sin(a + 2.5) * 8);
      g.lineTo(cx + Math.cos(a - 2.5) * 8, cy + Math.sin(a - 2.5) * 8);
      g.closePath();
      g.fill();
    }
    g.restore();
    g.fillStyle = TXT;
    g.font = `500 15px ${FONT}`;
    g.fillText('Lap', x + 10, y + 21);
    g.textAlign = 'right';
    g.font = `500 12px ${FONT}`;
    g.fillText('Elevation', x + w - 10, y + 20);
    g.font = `600 13px ${FONT}`;
    g.fillText(`${Math.round(t.elev)} ft`, x + w - 10, y + 36);
    g.font = `500 12px ${FONT}`;
    g.fillStyle = DIM;
    g.fillText('S1', x + w - 46, y + h - 62); g.fillText('S2', x + w - 46, y + h - 44); g.fillText('S3', x + w - 46, y + h - 26);
    g.fillStyle = TXT;
    g.fillText(t.trackMode ? '5.1' : '--', x + w - 10, y + h - 62);
    g.fillText('--', x + w - 10, y + h - 44); g.fillText('--', x + w - 10, y + h - 26);
    // speed, big enough to read from the driver's seat
    g.textAlign = 'left';
    g.fillStyle = 'rgba(6,4,4,0.55)';
    g.fillRect(x + 8, y + 30, 170, 104);
    g.fillStyle = '#ffe3d8';
    g.font = `700 92px ${FONT}`;
    const sp = String(Math.round(t.mph));
    g.fillText(sp, x + 12, y + 112);
    const sw = g.measureText(sp).width;
    g.fillStyle = TXT;
    g.font = `600 18px ${FONT}`;
    g.fillText('MPH', x + 18 + sw, y + 112);
    g.font = `500 12px ${FONT}`;
    g.fillStyle = DIM;
    g.fillText(t.t60run ? '0-60 running' : t.last != null ? `0-60  ${t.last.toFixed(2)} s` : '0-60  --', x + 14, y + 130);
  }

  sessionPanel(x, y, w, h, t) {
    const g = this.g;
    this.panel(x, y, w, h, 'Session');
    g.fillStyle = TXT;
    g.font = `500 14px ${FONT}`;
    g.fillText('Last', x + 14, y + 52);
    g.fillText('Best', x + 14, y + 106);
    g.font = `600 22px ${FONT}`;
    g.fillStyle = '#ffd6c8';
    g.fillText(t.last != null ? fmtT(t.last) : '--:--.---', x + 14, y + 76);
    g.fillText(t.best != null ? fmtT(t.best) : '--:--.---', x + 14, y + 130);
    g.strokeStyle = FAINT;
    g.beginPath(); g.moveTo(x + 150, y + 34); g.lineTo(x + 150, y + h - 12); g.stroke();
    g.font = `500 13px ${FONT}`;
    for (let i = 0; i < 10; i++) {
      const col = i < 5 ? 0 : 1;
      const row = i % 5;
      const xx = x + 166 + col * 116, yy = y + 46 + row * 21;
      const n = t.runs.length - i;
      g.fillStyle = DIM;
      g.textAlign = 'right';
      g.fillText(n > 0 ? String(n) : String(i + 1), xx + 10, yy);
      g.fillStyle = TXT;
      g.fillText(t.runs[i] != null ? fmtT(t.runs[i]) : '--:--.---', xx + 96, yy);
      g.textAlign = 'left';
    }
  }

  thruster(x, y, w, h, t) {
    const g = this.g;
    const v = t.gas == null ? 0 : Math.max(0, Math.min(1, t.gas));
    g.strokeStyle = LINE;
    g.lineWidth = 1.5;
    g.strokeRect(x + 0.5, y + 28.5, w - 1, h - 29);
    const gr = g.createLinearGradient(x, 0, x + w, 0);
    gr.addColorStop(0, 'rgba(120,20,8,0.25)');
    gr.addColorStop(1, t.boosting ? '#ffb070' : '#ff5a20');
    g.fillStyle = gr;
    g.fillRect(x + 2, y + 30, (w - 4) * v, h - 32);
    const hg = g.createLinearGradient(0, y + 30, 0, y + h);
    hg.addColorStop(0, 'rgba(255,255,255,0.10)');
    hg.addColorStop(1, 'rgba(0,0,0,0.25)');
    g.fillStyle = hg;
    g.fillRect(x + 2, y + 30, (w - 4) * v, h - 32);
    g.fillStyle = '#fff0e8';
    g.font = `600 15px ${FONT}`;
    g.fillText(t.gas == null ? 'Thruster · Not fitted' : `Thruster · ${Math.round(t.gasPsi).toLocaleString('en-US')} PSI`, x + 14, y + h - 12);
    g.textAlign = 'right';
    g.fillStyle = TXT;
    g.font = `500 13px ${FONT}`;
    let state = 'Boost Ready';
    if (t.gas == null) state = 'Suction fans only';
    else if (t.boosting) state = 'BOOST';
    else if (t.hovering) state = 'Hover';
    else if (v < 0.08) state = 'Recharging';
    g.fillText(t.gas == null ? state : `${Math.round(v * 100)}% · ${state}`, x + w - 4, y + 20);
    g.textAlign = 'left';
  }

  settings(x, y, w, t) {
    const g = this.g;
    const row = (yy, a, b, bright) => {
      g.fillStyle = TXT; g.textAlign = 'left'; g.fillText(a, x + 10, yy);
      g.fillStyle = bright ? '#ffd6c8' : TXT; g.textAlign = 'right'; g.fillText(b, x + w - 10, yy);
      g.textAlign = 'left';
    };
    const tm = t.trackMode;
    this.panel(x, y, w, 148, '');
    g.font = `500 13px ${FONT}`;
    row(y + 21, 'Dynamics', tm ? 'High Downforce' : 'Street', true);
    row(y + 54, 'Front Wing', tm ? 'High Downforce' : 'Low Drag');
    row(y + 72, 'Rear Wing', t.wing ? 'High Downforce' : 'Stowed');
    row(y + 90, 'Hood Vent', 'Open');
    row(y + 108, 'Barge Boards', tm ? 'Deploy' : 'Stowed');
    row(y + 126, 'Aero Load', t.downforce > 50 ? `${Math.round(t.downforce).toLocaleString('en-US')} kg` : 'Max Grip');
    this.panel(x, y + 154, w, 50, '');
    row(y + 175, 'Fan', t.fans > 0.02 ? 'ON' : 'OFF', true);
    row(y + 194, `${Math.round(t.fans * 100)}%`, t.fans > 0.45 ? 'Max Grip' : 'Cruise');
    this.panel(x, y + 210, w, 50, '');
    row(y + 230, 'Brake Balance', '');
    row(y + 250, '57%    -1', '43%');
    this.panel(x, y + 266, w, 50, '');
    row(y + 286, 'Aero Balance', '');
    row(y + 306, '44%    +1', '56%');
    this.panel(x, y + 322, w, 46, '');
    row(y + 341, 'ESC', 'TCS');
    row(y + 359, 'OFF', 'OFF', true);
    // track mode button
    g.strokeStyle = LINE;
    g.strokeRect(x + 10.5, y + 392.5, 22, 18);
    g.beginPath(); g.moveTo(x + 18, y + 401); g.lineTo(x + 28, y + 401); g.stroke();
    g.fillStyle = tm ? TXT : '#ffd6c8';
    g.font = `600 14px ${FONT}`;
    g.fillText(tm ? 'Exit Track Mode' : 'Track Mode  (T)', x + 42, y + 406);
  }
}
