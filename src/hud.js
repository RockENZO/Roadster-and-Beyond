import * as THREE from 'three';
import { RoadsterModel } from './car.js';
import { MPH } from './physics.js';

// Broadcast-style telemetry, modelled on the launch stream's overlay: open-arc gauges with a
// label, a big number and a unit; a glass globe with the car inside showing its attitude; a
// top-down diagram that lights each cold-gas nozzle as it fires.

const TAU = Math.PI * 2;
const FONT = '"Rajdhani", "Saira Semi Condensed", "Arial Narrow", system-ui, sans-serif';
const slashZero = (s) => s.replace(/0/g, 'Ø');
const FT = 3.28084;

function gauge(ctx, label, value, unit, frac) {
  const W = ctx.canvas.width, c = W / 2, r = W * 0.42;
  ctx.clearRect(0, 0, W, W);
  const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
  const am = a0 + (a1 - a0) * Math.min(1, Math.max(0, frac));
  ctx.lineCap = 'butt';
  ctx.lineWidth = W * 0.022;
  ctx.strokeStyle = 'rgba(120,120,124,.55)';
  ctx.beginPath(); ctx.arc(c, c, r, am, a1); ctx.stroke();
  ctx.strokeStyle = '#ffffff';
  ctx.beginPath(); ctx.arc(c, c, r, a0, am); ctx.stroke();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(205,208,214,.9)';
  ctx.font = `600 ${W * 0.12}px ${FONT}`;
  ctx.fillText(label, c, c - r * 0.56);
  ctx.fillStyle = '#ffffff';
  const big = value.length > 4 ? 0.27 : 0.32;
  ctx.font = `500 ${W * big}px ${FONT}`;
  ctx.fillText(slashZero(value), c, c + r * 0.02);
  ctx.fillStyle = 'rgba(205,208,214,.9)';
  ctx.font = `600 ${W * 0.12}px ${FONT}`;
  ctx.fillText(unit, c, c + r * 0.56);
}

export class BroadcastHud {
  constructor(renderer, scene) {
    this.renderer = renderer;
    this.root = document.getElementById('bhud');
    this.cA = document.getElementById('gA').getContext('2d');
    this.cB = document.getElementById('gB').getContext('2d');
    this.cC = document.getElementById('gC').getContext('2d');
    this.cT = document.getElementById('thr').getContext('2d');
    this.cG = document.getElementById('globe').getContext('2d');
    this.globeEl = document.getElementById('globe');
    this.miniScene = new THREE.Scene();
    this.miniScene.environment = scene.environment;
    this.miniScene.environmentIntensity = 0.7;
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(2, 5, 6);
    this.miniScene.add(key, new THREE.HemisphereLight(0xffffff, 0x222222, 0.8));
    this.miniCam = new THREE.PerspectiveCamera(30, 1, 0.5, 50);
    this.miniCam.position.set(0, 1.2, 11);
    this.miniCam.lookAt(0, 0, 0);
    this.holder = new THREE.Group();
    this.miniScene.add(this.holder);
    this.model = null;
    this.key = null;
    this.peakG = 0;
    this.mode = null;
    this._q = new THREE.Quaternion();
    this._y = new THREE.Quaternion();
    this.visible = false;
  }

  setVariant(p) {
    if (this.key === p.key) return;
    this.key = p.key;
    if (this.model) this.holder.remove(this.model.group);
    this.model = new RoadsterModel(p, { interior: false });
    this.model.group.scale.setScalar(0.92);
    this.model.group.traverse((o) => { if (o.isLight) o.visible = false; });
    this.holder.add(this.model.group);
  }

  show(on) {
    this.visible = on;
    this.root.classList.toggle('hidden', !on);
  }

  // mode: 'wall' (downforce, pitch, altitude), 'flight' (g, thrusters, altitude) or 'drive' (adds speed)
  update(dt, v, mst, mode) {
    if (!this.visible) return;
    this.setVariant(v.p);
    const alt = Math.max(0, v.pos.y - (v.groundY || 0) - 0.48) * FT;
    const gRaw = Math.hypot(v.acc.x + 9.81 * v.fwd.y, v.acc.y + 9.81 * v.up.y, v.acc.z + 9.81 * v.right.y) / 9.81;
    this.g = (this.g ?? 1) + (Math.min(gRaw, 6) - (this.g ?? 1)) * Math.min(1, dt * 5);
    const g = this.g;
    const pitch = Math.atan2(v.fwd.y, Math.hypot(v.fwd.x, v.fwd.z)) * 180 / Math.PI;
    const pitchDeg = v.onWall ? v.wallTh * 180 / Math.PI : Math.abs(v.up.y < 0 ? 180 - pitch : pitch);
    const wall = mode === 'wall' || (mode === 'drive' && (v.onWall || v.downforce > 1500));
    this.root.classList.toggle('wall', wall);
    if (wall) gauge(this.cA, 'DOWNFORCE', String(Math.round(v.downforce)), 'KG', v.downforce / 5000);
    else gauge(this.cA, 'G-FORCE', g.toFixed(1), 'G', g / 4);
    const showPitch = v.onWall || mode === 'wall';
    const showSpeed = !showPitch && mode === 'drive';
    this.cB.canvas.style.display = showPitch || showSpeed ? '' : 'none';
    if (showPitch) gauge(this.cB, 'PITCH', pitchDeg >= 100 ? String(Math.round(pitchDeg)) : pitchDeg.toFixed(1), 'DEG', pitchDeg / 180);
    else if (showSpeed) gauge(this.cB, 'SPEED', String(Math.round(Math.abs(v.vFwd) * MPH)), 'MPH', Math.abs(v.vFwd) * MPH / 240);
    gauge(this.cC, 'ALTITUDE', alt.toFixed(1), 'FT', alt / 70);
    this.thrusters(v, !wall || mode === 'drive');
    this.globe();
    // the car in the globe: attitude only, heading removed
    const yaw = Math.atan2(-v.fwd.z, v.fwd.x);
    this._y.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -yaw);
    this.holder.quaternion.copy(this._y).multiply(v.q);
    this.model.update(dt, mst);
  }

  globe() {
    const ctx = this.cG, W = ctx.canvas.width, c = W / 2, r = W * 0.46;
    ctx.clearRect(0, 0, W, W);
    ctx.strokeStyle = 'rgba(150,150,155,.55)';
    ctx.lineWidth = W * 0.008;
    ctx.beginPath(); ctx.arc(c, c, r, 0, TAU); ctx.stroke();
    ctx.strokeStyle = 'rgba(150,150,155,.35)';
    ctx.beginPath(); ctx.ellipse(c, c + r * 0.12, r * 0.98, r * 0.3, 0, 0, TAU); ctx.stroke();
  }

  thrusters(v, on) {
    const ctx = this.cT, W = ctx.canvas.width, H = ctx.canvas.height;
    ctx.clearRect(0, 0, W, H);
    const has = v.p.nozzles.length > 0;
    ctx.canvas.style.display = on && has ? '' : 'none';
    if (!on || !has) return;
    const cx = W / 2, cy = H / 2, sx = H * 0.205, sz = W * 0.3; // metres to pixels (x forward = up)
    const P = (x, z) => [cx + z * sz, cy - x * sx];
    ctx.strokeStyle = 'rgba(190,190,195,.8)';
    ctx.lineWidth = W * 0.02;
    ctx.lineJoin = 'round';
    // outline from above: pointed nose, wide haunches, Kamm tail
    const outline = [[2.14, 0.55], [1.9, 0.86], [1.36, 1.0], [0.4, 0.96], [-1.36, 1.02], [-1.95, 0.92], [-2.06, 0.7],
      [-2.06, -0.7], [-1.95, -0.92], [-1.36, -1.02], [0.4, -0.96], [1.36, -1.0], [1.9, -0.86], [2.14, -0.55]];
    ctx.beginPath();
    outline.forEach(([x, z], i) => { const [px, py] = P(x, z); if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); });
    ctx.closePath(); ctx.stroke();
    // canopy
    ctx.lineWidth = W * 0.012;
    ctx.beginPath();
    [[1.05, 0.55], [0.1, 0.72], [-1.6, 0.6], [-1.6, -0.6], [0.1, -0.72], [1.05, -0.55]].forEach(([x, z], i) => { const [px, py] = P(x, z); if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); });
    ctx.closePath(); ctx.stroke();
    for (const [x, z] of [[0.6, 0.72], [-0.6, 0.72], [0.6, -0.72], [-0.6, -0.72]]) {
      const [a, b] = P(x * 0.9 - 0.25, z); const [c2, d] = P(x * 0.9 - 0.25, z * 0.2);
      ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(c2, d); ctx.stroke();
    }
    // wheels
    ctx.fillStyle = 'rgba(70,70,74,.95)';
    for (const [x, z] of [[1.36, 0.92], [1.36, -0.92], [-1.36, 0.92], [-1.36, -0.92]]) {
      const [px, py] = P(x, z);
      ctx.beginPath(); ctx.ellipse(px, py, W * 0.06, H * 0.075, 0, 0, TAU); ctx.fill();
    }
    // nozzles
    for (const n of v.p.nozzles) {
      const u = v.nozzleU[n.id];
      let x = n.pos.x, z = n.pos.z;
      if (n.group === 'lift') { x = n.pos.x > 0 ? 1.36 : -1.36; z = Math.sign(n.pos.z) * 0.92; }
      const [px, py] = P(x, z);
      const r = W * (n.group === 'lift' ? 0.055 : 0.035);
      ctx.lineWidth = W * 0.014;
      ctx.strokeStyle = u > 0.03 ? '#ffffff' : 'rgba(150,150,155,.5)';
      ctx.fillStyle = u > 0.03 ? '#ffffff' : 'rgba(0,0,0,0)';
      ctx.beginPath(); ctx.arc(px, py, r, 0, TAU); ctx.stroke();
      if (u > 0.03) { ctx.beginPath(); ctx.arc(px, py, r * (0.35 + 0.35 * u), 0, TAU); ctx.fill(); }
      if (u > 0.03 && n.group !== 'lift') {
        ctx.strokeStyle = `rgba(190,235,255,${0.4 + 0.6 * u})`;
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + n.dir.z * W * 0.12 * u, py - n.dir.x * W * 0.12 * u); ctx.stroke();
      }
    }
  }

  // Draw the little car inside the globe, straight into the main canvas.
  render() {
    if (!this.visible || !this.model) return;
    const rect = this.globeEl.getBoundingClientRect();
    if (rect.width < 4) return;
    const r = this.renderer;
    const y = innerHeight - rect.bottom;
    r.setScissorTest(true);
    r.setScissor(rect.left, y, rect.width, rect.height);
    r.setViewport(rect.left, y, rect.width, rect.height);
    this.miniCam.aspect = rect.width / rect.height;
    this.miniCam.updateProjectionMatrix();
    const ac = r.autoClear;
    r.autoClear = false;
    r.clearDepth();
    const sm = r.shadowMap.enabled;
    r.shadowMap.enabled = false;
    r.render(this.miniScene, this.miniCam);
    r.shadowMap.enabled = sm;
    r.autoClear = ac;
    r.setScissorTest(false);
    r.setViewport(0, 0, innerWidth, innerHeight);
  }
}
