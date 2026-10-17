import './style.css';
import * as THREE from 'three';
import { Vehicle, VARIANTS } from './physics.js';
import { RoadsterModel } from './car.js';
import { buildWorld, followSun } from './world.js';
import { Particles } from './fx.js';
import { Input } from './input.js';
import { Sound } from './audio.js';
import { WALL, RUNWAY, SPAWNS } from './track.js';

const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;
const params = new URLSearchParams(location.search);

const renderer = new THREE.WebGLRenderer({ canvas: $('c'), antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.85;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, 1, 0.4, 9000);
const world = buildWorld(scene, renderer);
const fx = new Particles(scene);
const input = new Input();
const sound = new Sound();
const vehicle = new Vehicle();

let model = null;
let lights = false;
let started = false;
let menuOpen = true;
let selected = 0;
const keys = Object.keys(VARIANTS);

function loadModel() {
  if (model) scene.remove(model.group);
  model = new RoadsterModel(vehicle.p);
  scene.add(model.group);
}

function setVariant(key) {
  vehicle.set(key);
  loadModel();
  vehicle.syncFromGround(1);
  model.update(0, vehicle, input.s, lights);
}

// ---------- Menu ----------
const cardsEl = $('cards');
const stat = (label, v) => `<div><div class="bl"><span>${label}</span></div><div class="bar"><i style="width:${v * 100}%"></i></div></div>`;
const STATS = {
  performance: { acc: 0.55, air: 0.3, spd: 0.7 },
  thrust: { acc: 0.82, air: 0.7, spd: 0.8 },
  rocket: { acc: 1, air: 1, spd: 0.95 },
};
keys.forEach((k, i) => {
  const v = VARIANTS[k];
  const el = document.createElement('button');
  el.className = 'card';
  el.innerHTML = `<h3>${v.name}</h3><div class="claim">${v.claim}</div><p>${v.tag}</p><div class="bars">${stat('LAUNCH', STATS[k].acc)}${stat('AIR CONTROL', STATS[k].air)}${stat('TOP SPEED', STATS[k].spd)}</div>`;
  el.addEventListener('click', () => { select(i); });
  el.addEventListener('dblclick', () => beginDrive());
  cardsEl.appendChild(el);
});
function select(i) {
  selected = (i + keys.length) % keys.length;
  [...cardsEl.children].forEach((c, n) => c.classList.toggle('sel', n === selected));
  setVariant(keys[selected]);
}
$('go').addEventListener('click', () => beginDrive());

function menuHint() {
  $('menuhint').innerHTML = input.device === 'pad'
    ? `Controller detected. <kbd>D-pad</kbd> or left stick to choose, <kbd>A</kbd> to drive.`
    : `<kbd>Left</kbd> <kbd>Right</kbd> to choose, <kbd>Enter</kbd> to drive. Plug in a controller and press any button to use it.`;
}

function beginDrive() {
  sound.start();
  started = true;
  menuOpen = false;
  $('menu').classList.add('hidden');
  $('hud').classList.remove('hidden');
  renderHints();
}

function openMenu() {
  menuOpen = true;
  $('menu').classList.remove('hidden');
  $('go').textContent = started ? 'Resume' : 'Drive';
  menuHint();
}

// ---------- HUD ----------
let score = 0;
function renderHints() {
  const pad = input.device === 'pad';
  const k = (t) => `<kbd>${t}</kbd>`;
  const v = vehicle.p;
  const thrustLine = v.key === 'performance'
    ? ''
    : v.key === 'thrust'
      ? `<div>${pad ? k('A') : k('Space')} <b>Thrusters</b> (ground boost, air push)</div>`
      : `<div>${pad ? k('A') : k('Space')} <b>Thrusters</b> (boost, hover) &nbsp; ${pad ? k('B') : k('Shift')} <b>Forward push</b> in air</div>`;
  $('hints').innerHTML = pad
    ? `<div>${k('RT')} / ${k('LT')} <b>Throttle / brake</b> &nbsp; ${k('L stick')} <b>Steer</b></div>
       ${thrustLine}
       <div>${k('B')} <b>Handbrake</b>, release on wall &nbsp; ${k('X')} <b>Track Mode</b></div>
       <div>In air: ${k('L stick')} <b>flip / roll</b> &nbsp; ${k('R stick')} <b>spin</b></div>
       <div>${k('Y')} Camera &nbsp; ${k('D-pad up')} Lights &nbsp; ${k('Back')} Respawn &nbsp; ${k('Start')} Menu &nbsp; ${k('LB')} Hide help</div>`
    : `<div>${k('W')} ${k('S')} <b>Throttle / brake</b> &nbsp; ${k('A')} ${k('D')} <b>Steer</b></div>
       ${thrustLine}
       <div>${k('Shift')} <b>Handbrake</b>, release on wall &nbsp; ${k('T')} <b>Track Mode</b></div>
       <div>In air: ${k('W')} ${k('S')} <b>flip</b> &nbsp; ${k('A')} ${k('D')} <b>roll</b> &nbsp; ${k('Q')} ${k('E')} <b>spin</b></div>
       <div>${k('C')} Camera &nbsp; ${k('L')} Lights &nbsp; ${k('R')} Respawn &nbsp; ${k('H')} Hide help &nbsp; ${k('M')} Mute &nbsp; ${k('Esc')} Menu</div>`;
}
input.onDevice = (d) => { renderHints(); menuHint(); toast(d === 'pad' ? 'Controller active' : 'Keyboard active'); };

let toastT = 0;
function toast(t) {
  const el = $('toast');
  el.textContent = t;
  el.classList.add('on');
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove('on'), 1800);
}
function popup(html, big) {
  const d = document.createElement('div');
  d.className = 'pop' + (big ? ' big' : '');
  d.innerHTML = html;
  $('popups').appendChild(d);
  while ($('popups').children.length > 6) $('popups').firstChild.remove();
  setTimeout(() => d.remove(), 2700);
}
function centerMsg(html, cls, ms) {
  const el = $('center');
  el.className = cls || '';
  el.innerHTML = html;
  clearTimeout(centerMsg.t);
  if (ms) centerMsg.t = setTimeout(() => { el.innerHTML = ''; }, ms);
}

let best60 = {};
try { best60 = JSON.parse(localStorage.getItem('roadster-best60') || '{}'); } catch (e) { /* storage blocked */ }

function updateHud() {
  const v = vehicle;
  $('speed').textContent = Math.round(Math.abs(v.mph));
  $('variant').textContent = v.p.name;
  $('mode').textContent = v.mode === 'wall' ? 'Suction active' : v.trackMode ? 'Track mode' : '';
  const tankWrap = $('tankwrap');
  tankWrap.style.visibility = v.p.tank ? 'visible' : 'hidden';
  if (v.p.tank) {
    $('tank').style.width = `${(v.tank / v.p.tank) * 100}%`;
    $('tank').classList.toggle('low', v.tank / v.p.tank < 0.2);
  }
  const t = v.t60;
  const box = $('t60');
  box.className = t.state === 'run' ? 'run' : t.state === 'done' ? 'done' : '';
  $('t60v').textContent = t.state === 'run' ? t.t.toFixed(2) + ' s' : t.result != null ? t.result.toFixed(2) + ' s' : '--';
  $('t60b').textContent = best60[v.p.key] ? `Best ${best60[v.p.key].toFixed(2)} s` : 'Hold throttle from a stop';
  $('scorev').textContent = Math.round(score).toLocaleString();
}

// ---------- Stunt scoring + events ----------
function handleEvents() {
  for (const ev of vehicle.events) {
    if (window.__events) window.__events.push(ev);
    switch (ev.type) {
      case 'land': {
        const a = ev.air;
        const lines = [];
        let pts = 0;
        const flips = Math.floor(Math.abs(a.pitch) / TAU + 0.2);
        const rolls = Math.floor(Math.abs(a.roll) / TAU + 0.2);
        const spins = Math.floor(Math.abs(a.yaw) / TAU + 0.2);
        if (flips) {
          const n = flips * (a.fromWall ? 1400 : 1000);
          pts += n;
          lines.push(`${a.fromWall ? 'WALL ' : ''}${a.pitch < 0 ? 'FRONT FLIP' : 'BACKFLIP'}${flips > 1 ? ' x' + flips : ''}<em>+${n}</em>`);
        } else if (a.fromWall) { pts += 300; lines.push(`WALL RIDE<em>+300</em>`); }
        if (rolls) { const n = rolls * 800; pts += n; lines.push(`BARREL ROLL${rolls > 1 ? ' x' + rolls : ''}<em>+${n}</em>`); }
        if (spins) { const n = spins * 600; pts += n; lines.push(`${spins * 360} SPIN<em>+${n}</em>`); }
        if (a.t > 0.8) {
          const n = Math.round((a.t - 0.6) * 90 + a.maxH * 6);
          pts += n; lines.push(`AIR TIME ${a.t.toFixed(1)} s<em>+${n}</em>`);
        }
        if (pts > 0 && ev.quality > 0.985) { pts = Math.round(pts * 1.25); lines.push(`PERFECT LANDING x1.25`); }
        if (pts > 0) {
          score += pts;
          lines.forEach((l, i) => popup(l, false));
          popup(`+${pts.toLocaleString()}`, true);
          sound.ding();
        }
        sound.thump(Math.min(1, ev.impact / 18));
        shake = Math.max(shake, Math.min(0.7, ev.impact / 25));
        input.rumble(0.8, 0.4, 180);
        burstDust(vehicle.pos, 18, Math.min(1, ev.impact / 12));
        break;
      }
      case 'crash':
        centerMsg(`CRASH<small>${ev.reason}</small>`, 'crash', 1800);
        sound.crash();
        shake = 1;
        input.rumble(1, 1, 400);
        burstCrash(ev.pos);
        break;
      case 'respawn':
        centerMsg(`${vehicle.lastSpawn.label}`, '', 1200);
        break;
      case 't60': {
        popup(`0 - 60 MPH  ${ev.time.toFixed(2)} s`, true);
        sound.ding();
        if (!best60[ev.variant] || ev.time < best60[ev.variant]) {
          best60[ev.variant] = ev.time;
          try { localStorage.setItem('roadster-best60', JSON.stringify(best60)); } catch (e) { /* storage blocked */ }
          popup('NEW BEST', false);
        }
        break;
      }
      case 'wall': popup('SUCTION ENGAGED', false); sound.burst(0.4, 3000, 0.3); break;
      case 'bump': sound.thump(0.5); shake = Math.max(shake, 0.4); break;
      case 'release': break;
    }
  }
}

// ---------- Effects ----------
const _p = new THREE.Vector3(), _d = new THREE.Vector3(), _v = new THREE.Vector3(), _r = new THREE.Vector3();
let shake = 0;
const rnd = (s) => (Math.random() - 0.5) * 2 * s;

function burstDust(at, n, power) {
  for (let i = 0; i < n; i++) {
    _p.set(at.x + rnd(1.5), Math.max(0.1, at.y - 0.4), at.z + rnd(1.5));
    _v.set(rnd(6) * power, Math.random() * 3 * power, rnd(6) * power);
    fx.emit(_p, _v, { life: 1.2 + Math.random(), size: 1.2, grow: 3, alpha: 0.4, color: [0.85, 0.74, 0.55], drag: 2, grav: -0.3 });
  }
}
function burstCrash(at) {
  for (let i = 0; i < 50; i++) {
    _v.set(rnd(14), Math.random() * 12, rnd(14));
    const smoke = i % 3 !== 0;
    fx.emit(at, _v, smoke
      ? { life: 1.8 + Math.random(), size: 1.5, grow: 5, alpha: 0.55, color: [0.25, 0.25, 0.27], drag: 1.4, grav: -1 }
      : { life: 0.7, size: 0.35, grow: -0.2, alpha: 1, color: [1, 0.7, 0.3], drag: 0.3, grav: 22 });
  }
}

function emitFx(dt, ctrl) {
  const v = vehicle;
  if (v.mode === 'crashed') return;
  // Cold-gas thrusters
  const m = model;
  const active = new Set();
  if (v.boosting) {
    active.add('rear');
    if (v.hovering) active.add('down');
    if (v.p.key === 'rocket' && v.mode === 'air' && ctrl.handbrake) active.add('rear');
  }
  if (v.mode === 'air' && v.p.key === 'rocket') {
    if (Math.abs(ctrl.pitch) > 0.2) { active.add(ctrl.pitch > 0 ? 'front' : 'rear'); active.add('down'); }
    if (Math.abs(ctrl.roll) > 0.2) active.add('side');
  }
  if (active.size) {
    for (const n of m.nozzles) {
      if (!active.has(n.group)) continue;
      m.nozzleWorld(n, _p, _d);
      const big = (n.group === 'rear' || n.group === 'down') && v.boosting;
      for (let k = 0; k < (big ? 3 : 1); k++) {
        _v.copy(_d).multiplyScalar(big ? 22 : 9).addScaledVector(v.vel, 0.55);
        _v.x += rnd(1.2); _v.y += rnd(1.2); _v.z += rnd(1.2);
        fx.emit(_p, _v, { life: big ? 0.5 : 0.3, size: big ? 0.5 : 0.28, grow: big ? 4 : 2, alpha: big ? 0.55 : 0.4, color: [0.85, 0.94, 1], drag: 2.5 });
      }
    }
  }
  // Dust off the tarmac and tyre smoke when sliding.
  if (v.mode === 'ground' && v.speed > 6) {
    const p = v.gp;
    const off = Math.abs(p.z) > RUNWAY.hw - 1 || p.x < RUNWAY.x0 || p.x > RUNWAY.x1;
    const slide = Math.abs(v.slip) > 3.5;
    if (off || slide) {
      for (const s of [-1, 1]) {
        _r.set(-1.35, -0.2, 0.9 * s).applyQuaternion(v.q);
        _p.copy(v.pos).add(_r);
        _v.set(rnd(2), 1 + Math.random() * 2, rnd(2)).addScaledVector(v.vel, -0.1);
        fx.emit(_p, _v, off
          ? { life: 1.1, size: 0.9, grow: 3.5, alpha: 0.3, color: [0.82, 0.7, 0.5], drag: 1.5 }
          : { life: 0.9, size: 0.8, grow: 3, alpha: 0.4, color: [0.9, 0.9, 0.92], drag: 1.5 });
      }
    }
  }
  if (v.mode === 'wall') {
    for (const s of [-1, 1]) {
      _r.set(-1.3, -0.4, 0.9 * s).applyQuaternion(v.q);
      _p.copy(v.pos).add(_r);
      _v.set(rnd(2), rnd(2), rnd(2));
      fx.emit(_p, _v, { life: 0.4, size: 0.3, grow: 1.5, alpha: 0.6, color: [0.5, 0.82, 1], drag: 2 });
    }
  }
}

// ---------- Camera ----------
let camMode = 0;
const camPos = new THREE.Vector3(-10, 4, 10);
const camLook = new THREE.Vector3();
const flat = new THREE.Vector3(1, 0, 0);
const lastFlat = new THREE.Vector3(1, 0, 0);
let fovNow = 62;

function updateCamera(dt, t) {
  const v = vehicle;
  if (window.__cam) { camera.position.fromArray(window.__cam.p); camera.lookAt(...window.__cam.l); camera.fov = window.__cam.fov || 40; camera.updateProjectionMatrix(); return; }
  if (menuOpen) {
    const a = t * 0.25 + 0.7;
    const target = _p.copy(v.pos);
    camPos.set(target.x + Math.cos(a) * 7.5, target.y + 1.7, target.z + Math.sin(a) * 7.5);
    camera.position.copy(camPos);
    camLook.copy(target); camLook.y += 0.2;
    camera.lookAt(camLook);
    camera.fov = 42;
    if (innerWidth > 760) camera.setViewOffset(innerWidth, innerHeight, -innerWidth * 0.2, 0, innerWidth, innerHeight);
    camera.updateProjectionMatrix();
    return;
  }
  if (camera.view && camera.view.enabled) camera.clearViewOffset();
  const k = (r) => 1 - Math.exp(-dt * r);
  const speed = v.vel.length();
  v.basis();
  const f = _d.copy(v.fwd); f.y = 0;
  if (f.lengthSq() > 0.08) { f.normalize(); lastFlat.copy(f); } else f.copy(lastFlat);
  let aim = f;
  if (v.mode === 'air' && speed > 8) {
    aim = _r.set(v.vel.x, 0, v.vel.z);
    if (aim.lengthSq() > 4) aim.normalize(); else aim.copy(f);
  }
  flat.lerp(aim, k(v.mode === 'air' ? 2.2 : 6)).normalize();
  const target = _v.copy(v.pos);

  let desired;
  let look;
  let fov = 62 + Math.min(speed, 90) * 0.28;
  if (v.mode === 'wall') {
    desired = new THREE.Vector3(WALL.x0 + WALL.R * 0.55, WALL.R * 0.85, WALL.zc + 52);
    look = target.clone();
    fov = 50;
    camPos.lerp(desired, k(3));
  } else if (camMode === 2) {
    desired = new THREE.Vector3(0.1, 0.38, -0.36).applyQuaternion(v.q).add(v.pos);
    camPos.copy(desired);
    look = new THREE.Vector3(10, 0.1, -0.2).applyQuaternion(v.q).add(v.pos);
  } else {
    const dist = camMode === 1 ? 13 : 7.8;
    const height = camMode === 1 ? 4.6 : 2.5;
    desired = target.clone().addScaledVector(flat, -dist - Math.min(speed, 80) * 0.03);
    desired.y += height + (v.mode === 'air' ? 0.8 : 0);
    camPos.lerp(desired, k(v.mode === 'air' ? 3 : 9));
    look = target.clone().addScaledVector(flat, 5.5);
    look.y += 0.4;
  }
  if (shake > 0.01) {
    camPos.x += rnd(0.25) * shake; camPos.y += rnd(0.25) * shake; camPos.z += rnd(0.25) * shake;
    shake *= Math.exp(-dt * 6);
  }
  camPos.y = Math.max(camPos.y, 0.6);
  camera.position.copy(camPos);
  camLook.lerp(look, camMode === 2 ? 1 : k(14));
  camera.lookAt(camLook);
  if (camMode === 2) { camera.up.set(0, 1, 0).applyQuaternion(v.q).lerp(_p.set(0, 1, 0), 0.5); } else camera.up.set(0, 1, 0);
  fovNow += (fov - fovNow) * k(4);
  camera.near = camMode === 2 ? 0.1 : 0.4;
  camera.fov = fovNow;
  camera.updateProjectionMatrix();
}

// ---------- Main loop ----------
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

const STEP = 1 / 120;
let acc = 0;
let last = performance.now();
let clock = 0;
const NONE = {};

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  clock += dt;
  input.update();
  const P = input.p;

  if (P.mute) { sound.muted = !sound.muted; toast(sound.muted ? 'Sound off' : 'Sound on'); }

  if (menuOpen) {
    if (P.left) select(selected - 1);
    if (P.right) select(selected + 1);
    if (P.confirm || (P.pause && started)) beginDrive();
  } else {
    if (P.pause) { openMenu(); }
    if (P.camera) { camMode = (camMode + 1) % 3; toast(['Chase camera', 'Wide camera', 'Cockpit camera'][camMode]); }
    if (P.lights) { lights = !lights; toast(lights ? 'Headlights on (they pop up from the nose)' : 'Headlights hidden'); }
    if (P.hints) $('hints').classList.toggle('off');
    if (P.reset) { vehicle.respawn(vehicle.pos.x); centerMsg(vehicle.lastSpawn.label, '', 1000); }

    acc += window.__freeze ? 0 : dt;
    let first = true;
    let n = 0;
    const ctrl = input.s;
    while (acc >= STEP && n < 10) {
      vehicle.step(STEP, ctrl, first ? P : NONE);
      first = false;
      acc -= STEP;
      n++;
      handleEvents();
    }
    if (n === 10) acc = 0;
  }

  model.update(dt, vehicle, input.s, lights);
  if (!menuOpen) emitFx(dt, input.s);
  fx.update(dt);
  updateCamera(dt, clock);
  followSun(world, vehicle.pos);
  if (!menuOpen) {
    updateHud();
    sound.update(Math.min(1, vehicle.vel.length() / 110), input.s.throttle, vehicle.boosting, vehicle.mode === 'wall', vehicle.slip, vehicle.mode === 'air');
  }
  renderer.render(scene, camera);
}

select(0);
menuHint();
renderHints();
if (params.get('start')) {
  const i = keys.indexOf(params.get('start'));
  if (i >= 0) { select(i); beginDrive(); }
}
function advance(seconds, ctrl = {}, pressed = {}) {
  Object.assign(input.s, ctrl);
  const n = Math.round(seconds / STEP);
  for (let i = 0; i < n; i++) { vehicle.step(STEP, input.s, i === 0 ? pressed : NONE); handleEvents(); }
  for (let i = 0; i < 4; i++) emitFx(STEP * 4, input.s);
}
window.__game = { advance, fx, vehicle, input, camera, scene, setVariant, select, beginDrive, get model() { return model; }, SPAWNS };
requestAnimationFrame(frame);
