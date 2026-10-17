import './style.css';
import * as THREE from 'three';
import { Vehicle, VARIANTS, MPH } from './physics.js';
import { RoadsterModel } from './car.js';
import { buildWorld, updateWorld } from './world.js';
import { Particles } from './fx.js';
import { Input } from './input.js';
import { Sound } from './audio.js';
import { WALL, SPAWNS, LINEUP, STRIP, PAD } from './track.js';
import { EventShow, stuntFor } from './event.js';

const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;
const params = new URLSearchParams(location.search);

const renderer = new THREE.WebGLRenderer({ canvas: $('c'), antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.3, 6000);
const world = buildWorld(scene, renderer);
renderer.toneMappingExposure = world.exposure || 1;
const fx = new Particles(scene, 2600);
const input = new Input();
const sound = new Sound();
const vehicle = new Vehicle();

let model = null;
let lights = true;
let started = false;
let menuOpen = true;
let selected = 0;
let menuBtn = 0;
const keys = Object.keys(VARIANTS);
const mst = {
  wheels: [0, 1, 2, 3].map(() => ({ steer: 0, spin: 0, y: 0 })),
  doors: 0, doorsT: 0, wing: 0, airbrake: 0, lights: 0, brake: 0, fans: 0, nozzles: null, speed: 0,
};

function loadModel() {
  if (model) scene.remove(model.group);
  model = new RoadsterModel(vehicle.p);
  scene.add(model.group);
}

function setVariant(key, spawn) {
  const changed = !model || vehicle.p.key !== key;
  vehicle.set(key);
  if (spawn) vehicle.respawn(spawn);
  if (changed) loadModel();
  mst.nozzles = vehicle.nozzleU;
  syncModel(0);
}

// ---------- Menu ----------
const cardsEl = $('cards');
const stat = (label, v) => `<div><div class="bl"><span>${label}</span></div><div class="bar"><i style="width:${v * 100}%"></i></div></div>`;
const STATS = {
  performance: { acc: 0.55, grip: 1, air: 0 },
  thrust: { acc: 0.82, grip: 1, air: 0.15 },
  rocket: { acc: 1, grip: 1, air: 1 },
};
keys.forEach((k, i) => {
  const v = VARIANTS[k];
  const el = document.createElement('button');
  el.className = 'card';
  el.innerHTML = `<h3>${v.name}</h3><div class="claim">${v.claim}</div><p>${v.tag}</p><div class="bars">${stat('LAUNCH', STATS[k].acc)}${stat('GRIP', STATS[k].grip)}${stat('FLIGHT', STATS[k].air)}</div>`;
  el.addEventListener('click', () => select(i));
  el.addEventListener('dblclick', () => beginDrive());
  cardsEl.appendChild(el);
});
function select(i) {
  selected = (i + keys.length) % keys.length;
  [...cardsEl.children].forEach((c, n) => c.classList.toggle('sel', n === selected));
  setVariant(keys[selected], show.active ? undefined : 'start');
}
function menuButtons() {
  $('go').classList.toggle('sel', menuBtn === 0);
  $('watch').classList.toggle('sel', menuBtn === 1);
}
$('go').addEventListener('click', () => beginDrive());
$('watch').addEventListener('click', () => beginShow());

function menuHint() {
  $('menuhint').innerHTML = input.device === 'pad'
    ? `Controller ready. <kbd>D-pad</kbd> to choose a car and a button, <kbd>A</kbd> to start.`
    : `<kbd>Left</kbd> <kbd>Right</kbd> choose a car, <kbd>Up</kbd> <kbd>Down</kbd> choose Drive or Watch, <kbd>Enter</kbd> to start. Plug in a controller and press any button to use it.`;
}

function closeMenu() {
  sound.start();
  started = true;
  menuOpen = false;
  $('menu').classList.add('hidden');
}

function beginDrive() {
  if (show.active) show.stop();
  closeMenu();
  $('show').classList.add('hidden');
  $('hud').classList.remove('hidden');
  if (vehicle.p.key !== keys[selected]) setVariant(keys[selected], 'start');
  camOverride = null;
  renderHints();
}

function beginShow() {
  closeMenu();
  $('hud').classList.add('hidden');
  $('show').classList.remove('hidden');
  score = 0;
  show.start(+(params.get('seg') || 0));
}

function openMenu() {
  if (show.active) { show.stop(); $('show').classList.add('hidden'); }
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
  let gas = '';
  if (v.key === 'thrust') gas = `<div>${pad ? k('RB') + ' or ' + k('A') : k('Shift') + ' or ' + k('Space')} <b>Rear thrusters</b></div>`;
  if (v.key === 'rocket') {
    gas = pad
      ? `<div>${k('RB')} <b>Rear thrusters</b> &nbsp; ${k('A')} <b>Hop</b>, hold to <b>hover</b> (${k('RT')} climb, ${k('LT')} descend)</div>
         <div>In the air: ${k('L stick')} <b>flip and roll</b>, ${k('R stick')} <b>yaw</b>. Let go and it levels itself.</div>`
      : `<div>${k('Shift')} <b>Rear thrusters</b> &nbsp; ${k('Space')} <b>Hop</b>, hold to <b>hover</b> (${k('W')} climb, ${k('S')} descend)</div>
         <div>In the air: ${k('W')} ${k('S')} <b>flip</b>, ${k('A')} ${k('D')} <b>roll</b>, ${k('Q')} ${k('E')} <b>yaw</b>. Let go and it levels itself.</div>`;
  }
  $('hints').innerHTML = pad
    ? `<div>${k('RT')} / ${k('LT')} <b>Throttle / brake</b> (hold ${k('LT')} at a stop to reverse) &nbsp; ${k('L stick')} <b>Steer</b></div>
       ${gas}
       <div>${k('X')} <b>Track Mode</b> &nbsp; ${k('LB')} <b>Fans off</b> (drop from the wall) &nbsp; ${k('B')} <b>Handbrake</b></div>
       <div>${k('Y')} Camera &nbsp; ${k('R stick')} Look &nbsp; ${k('D-pad')} ${k('↑')} Lights ${k('↓')} Doors ${k('←')}${k('→')} Stunts &nbsp; ${k('View')} Respawn &nbsp; ${k('LS')} Hide help</div>`
    : `<div>${k('W')} ${k('S')} <b>Throttle / brake</b> (hold ${k('S')} at a stop to reverse) &nbsp; ${k('A')} ${k('D')} <b>Steer</b></div>
       ${gas}
       <div>${k('T')} <b>Track Mode</b> &nbsp; ${k('F')} <b>Fans off</b> (drop from the wall) &nbsp; ${k('B')} <b>Handbrake</b></div>
       <div>${k('C')} Camera &nbsp; ${k('L')} Lights &nbsp; ${k('O')} Doors &nbsp; ${k('1')}-${k('5')} Stunts &nbsp; ${k('R')} Respawn &nbsp; ${k('H')} Hide help &nbsp; ${k('M')} Mute &nbsp; ${k('Esc')} Menu</div>`;
}
input.onDevice = (d) => { renderHints(); menuHint(); toast(d === 'pad' ? `Controller active${input.padName ? ': ' + input.padName.replace(/\(.*\)/, '').trim() : ''}` : 'Keyboard active'); };

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
  if (window.__manual) {
    // Frame-by-frame recording: drive the animation from game time instead of the wall clock.
    d.style.animationPlayState = 'paused';
    d.dataset.age = '0';
  } else setTimeout(() => d.remove(), 2700);
}
let centerT = 0;
function centerMsg(html, cls, s) {
  const el = $('center');
  el.className = cls || '';
  el.innerHTML = html;
  centerT = s || 0;
}

let best60 = {};
try { best60 = JSON.parse(localStorage.getItem('roadster-best60') || '{}'); } catch (e) { /* storage blocked */ }

const STUNT_TEXT = {
  start: ['Launch pad', 'Pick a stunt with the D-pad or 1-5, or just drive.'],
  strip: ['0-60 strip', 'From a stop, floor it. Thrust and Rocket: hold the rear thrusters too.'],
  lineup: ['Lineup jump', 'Rocket: hop with lift before the cars, roll the stick for a kickflip.'],
  flip: ['Standing flip', 'Rocket: hold lift and pull back (W) for a backflip. Let go to level.'],
  wall: ['C-wall', 'Drive in at ~35 mph and keep climbing. Brake at the top to hang, then fans off to drop.'],
};

const gctx = $('gmeter').getContext('2d');
const nctx = $('nozmap').getContext('2d');
let hudTick = 0;
function updateHud(dt) {
  const v = vehicle;
  $('speed').textContent = Math.round(Math.abs(v.vFwd) * MPH);
  $('variant').textContent = v.p.name;
  const tags = [];
  if (v.trackMode) tags.push('Track');
  if (v.releaseT > 0) tags.push('Fans off');
  if (v.onWall) tags.push(`Wall ${Math.round(v.wallTh * 180 / Math.PI)}°`);
  if (v.hovering) tags.push('Hover');
  $('mode').textContent = tags.join(' · ');
  $('suc').style.width = `${v.suction * 100}%`;
  $('sucv').textContent = `${(v.suction * 2).toFixed(1)} g`;
  $('gaswrap').style.display = v.p.gas ? '' : 'none';
  if (v.p.gas) {
    $('gas').style.width = `${(v.gas / v.p.gas) * 100}%`;
    $('gas').classList.toggle('low', v.gas / v.p.gas < 0.2);
    $('gasv').textContent = `${Math.round(v.gas)} kg`;
  }
  const t = v.t60;
  const box = $('t60');
  box.className = t.state === 'run' ? 'run' : t.state === 'done' ? 'done' : '';
  $('t60v').textContent = t.state === 'run' ? t.t.toFixed(2) + ' s' : t.result != null ? t.result.toFixed(2) + ' s' : '--';
  $('t60b').textContent = best60[v.p.key] ? `Best ${best60[v.p.key].toFixed(2)} s` : 'Throttle from a stop';
  $('scorev').textContent = Math.round(score).toLocaleString();
  hudTick -= dt;
  if (hudTick <= 0) {
    hudTick = 0.25;
    const st = stuntFor(v.pos);
    const [title, desc] = STUNT_TEXT[st.key];
    $('stuntt').textContent = title.toUpperCase();
    $('stuntd').textContent = desc;
  }
  // G meter: longitudinal (up = accelerating) and lateral, 2.5 g full scale.
  const g = gctx, W = 120, c = W / 2;
  g.clearRect(0, 0, W, W);
  g.strokeStyle = 'rgba(255,255,255,.18)'; g.lineWidth = 1;
  for (const r of [0.4, 0.8]) { g.beginPath(); g.arc(c, c, r * 50, 0, TAU); g.stroke(); }
  g.beginPath(); g.moveTo(c - 50, c); g.lineTo(c + 50, c); g.moveTo(c, c - 50); g.lineTo(c, c + 50); g.stroke();
  const gx = THREE.MathUtils.clamp(v.acc.z / 9.81 / 2.5, -1, 1), gy = THREE.MathUtils.clamp(v.acc.x / 9.81 / 2.5, -1, 1);
  g.fillStyle = '#9fd8ff'; g.beginPath(); g.arc(c + gx * 50, c - gy * 50, 6, 0, TAU); g.fill();
  g.fillStyle = '#dfe5ee'; g.font = '700 13px system-ui'; g.textAlign = 'center';
  g.fillText(`${(Math.hypot(v.acc.x, v.acc.z) / 9.81).toFixed(1)} g`, c, W - 12);
  // Thruster map: car outline from above, a dot per nozzle lit by its throttle.
  const n = nctx;
  n.clearRect(0, 0, W, W);
  $('nozmap').style.display = v.p.nozzles.length ? '' : 'none';
  if (v.p.nozzles.length) {
    const sx = 22, sz = 30;
    n.strokeStyle = 'rgba(255,255,255,.35)'; n.lineWidth = 2;
    n.beginPath();
    n.moveTo(c - 0.75 * sz, c - 2.14 * sx); n.lineTo(c + 0.75 * sz, c - 2.14 * sx); n.lineTo(c + 1.0 * sz, c - 1.0 * sx);
    n.lineTo(c + 0.95 * sz, c + 2.06 * sx); n.lineTo(c - 0.95 * sz, c + 2.06 * sx); n.lineTo(c - 1.0 * sz, c - 1.0 * sx); n.closePath(); n.stroke();
    for (const nz of v.p.nozzles) {
      const u = v.nozzleU[nz.id];
      const px = c + nz.pos.z * sz, py = c - nz.pos.x * sx;
      n.fillStyle = u > 0.02 ? `rgba(170,225,255,${0.35 + 0.65 * u})` : 'rgba(255,255,255,.18)';
      n.beginPath(); n.arc(px + nz.dir.z * 6, py - nz.dir.x * 6, 3 + 4 * u, 0, TAU); n.fill();
    }
  }
}

// ---------- Scoring + events ----------
function handleEvents() {
  for (const ev of vehicle.events) {
    if (window.__events) window.__events.push({ ...ev, pos: undefined });
    switch (ev.type) {
      case 'land': {
        const a = ev.air;
        sound.thump(Math.min(1, ev.impact / 8));
        shake = Math.max(shake, Math.min(0.6, ev.impact / 14));
        input.rumble(Math.min(1, ev.impact / 8), 0.5, 200);
        burstDust(vehicle.pos, 16, Math.min(1, ev.impact / 6));
        if (a.t < 0.35) break;
        const lines = [];
        let pts = 0;
        const flips = Math.floor(Math.abs(a.pitch) / TAU + 0.15);
        const rolls = Math.floor(Math.abs(a.roll) / TAU + 0.15);
        const spins = Math.floor(Math.abs(a.yaw) / TAU + 0.15);
        const cleared = LINEUP.filter((c) => a.over.includes(c.name) && vehicle.pos.x > c.x1);
        if (cleared.length === LINEUP.length) { pts += 3000; lines.push(`CLEARED THE LINEUP<em>+3000</em>`); }
        else if (cleared.length) { const n = cleared.length * 400; pts += n; lines.push(`OVER ${cleared.length} VEHICLE${cleared.length > 1 ? 'S' : ''}<em>+${n}</em>`); }
        if (rolls) {
          const n = rolls * (cleared.length ? 2000 : 900);
          pts += n; lines.push(`${cleared.length ? 'KICKFLIP' : 'BARREL ROLL'}${rolls > 1 ? ' x' + rolls : ''}<em>+${n}</em>`);
        }
        if (flips) {
          const standing = a.startSpeed < 3;
          const n = flips * (standing ? 2500 : 1200);
          pts += n; lines.push(`${standing ? 'STANDING ' : ''}${a.pitch > 0 ? 'BACKFLIP' : 'FRONT FLIP'}${flips > 1 ? ' x' + flips : ''}<em>+${n}</em>`);
        }
        if (spins) { const n = spins * 700; pts += n; lines.push(`${spins * 360} SPIN<em>+${n}</em>`); }
        if (a.fromWall) { const n = vehicle.hungBefore ? 3000 : 1200; pts += n; lines.push(`${vehicle.hungBefore ? 'C-WALL HANG AND DROP' : 'OFF THE C-WALL'}<em>+${n}</em>`); }
        if (a.t > 1) { const n = Math.round(a.t * 120 + (a.maxH - a.startY) * 40); pts += n; lines.push(`AIR ${a.t.toFixed(1)} s<em>+${n}</em>`); }
        if (pts > 0 && ev.quality > 0.985 && ev.impact < 3) { pts = Math.round(pts * 1.25); lines.push('SOFT LANDING x1.25'); }
        if (pts > 0) {
          score += pts;
          lines.forEach((l) => popup(l, false));
          popup(`+${pts.toLocaleString()}`, true);
          sound.ding();
        }
        vehicle.hungBefore = false;
        break;
      }
      case 'crash':
        centerMsg(`CRASH<small>${ev.reason}</small>`, 'crash', 2);
        sound.crash();
        shake = 1;
        input.rumble(1, 1, 450);
        burstCrash(ev.pos);
        break;
      case 'respawn':
        centerMsg(ev.label, '', 1.2);
        break;
      case 't60': {
        popup(`0 - 60 MPH  ${ev.time.toFixed(2)} s`, true);
        sound.ding();
        if (!show.active && (!best60[ev.variant] || ev.time < best60[ev.variant])) {
          best60[ev.variant] = ev.time;
          try { localStorage.setItem('roadster-best60', JSON.stringify(best60)); } catch (e) { /* storage blocked */ }
          popup('NEW BEST', false);
        }
        break;
      }
      case 'wall': popup('SUCTION 2 G', false); sound.burst(0.4, 3000, 0.3); break;
      case 'hang': popup('HANGING UPSIDE DOWN', true); vehicle.hungBefore = true; sound.ding(); break;
      case 'fans-off': popup('FANS OFF', false); break;
      case 'track': toast(ev.on ? 'Track Mode: lower, stiffer, wing up, more suction' : 'Track Mode off'); break;
      case 'hop': sound.burst(0.35, 2600, 0.45); input.rumble(0.6, 0.8, 160); break;
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
    _v.set(rnd(5) * power, Math.random() * 2.5 * power, rnd(5) * power);
    fx.emit(_p, _v, { life: 1.2 + Math.random(), size: 1.2, grow: 3, alpha: 0.3, color: [0.75, 0.75, 0.78], drag: 2, grav: -0.3 });
  }
}
function burstCrash(at) {
  for (let i = 0; i < 50; i++) {
    _v.set(rnd(10), Math.random() * 9, rnd(10));
    const smoke = i % 3 !== 0;
    fx.emit(at, _v, smoke
      ? { life: 1.8 + Math.random(), size: 1.5, grow: 5, alpha: 0.5, color: [0.3, 0.3, 0.32], drag: 1.4, grav: -1 }
      : { life: 0.7, size: 0.3, grow: -0.2, alpha: 1, color: [1, 0.7, 0.3], drag: 0.3, grav: 22 });
  }
}

let smokeAcc = 0;
function emitFx(dt) {
  const v = vehicle;
  // Cold gas: a plume from every firing nozzle, scaled by its throttle.
  const noz = v.p.nozzles;
  for (const n of noz) {
    const u = v.nozzleU[n.id];
    if (u < 0.04) continue;
    model.nozzleWorld(n, _p, _d);
    const k = u > 0.6 ? 3 : u > 0.25 ? 2 : 1;
    for (let i = 0; i < k; i++) {
      _v.copy(_d).multiplyScalar(14 + 16 * u).addScaledVector(v.vel, 0.6);
      _v.x += rnd(1.4); _v.y += rnd(1.4); _v.z += rnd(1.4);
      fx.emit(_p, _v, { life: 0.35 + 0.35 * u, size: 0.25 + 0.3 * u, grow: 3 + 2 * u, alpha: 0.35 + 0.25 * u, color: [0.88, 0.95, 1], drag: 2.8 });
    }
  }
  // Tyre smoke when sliding.
  if (v.mode === 'drive') {
    for (const w of v.wheels) {
      if (!w.contact) continue;
      const slide = Math.abs(w.slip) > 2.6 || (v.handbrake && !w.front && v.vel.length() > 4);
      if (!slide || Math.random() > 0.6) continue;
      _v.set(rnd(1.5), 0.8 + Math.random() * 1.5, rnd(1.5)).addScaledVector(v.vel, 0.15);
      fx.emit(w.cp, _v, { life: 1.1, size: 0.8, grow: 3, alpha: 0.32, color: [0.92, 0.92, 0.94], drag: 1.6 });
    }
    // Fan exhaust under hard suction.
    if (v.suction > 0.5 && v.contacts >= 2) {
      for (const z of [-0.4, 0.4]) {
        v.toWorld(_r.set(-2.1, -0.32, z), _p);
        _d.copy(v.fwd).multiplyScalar(-6).addScaledVector(v.vel, 0.5);
        _d.x += rnd(0.8); _d.y += rnd(0.8); _d.z += rnd(0.8);
        if (Math.random() < v.suction * 0.6) fx.emit(_p, _d, { life: 0.5, size: 0.3, grow: 2, alpha: 0.18, color: [0.8, 0.85, 0.9], drag: 2 });
      }
    }
  }
  // Smoke machines around the venue.
  smokeAcc += dt * (world.smoke?.length || 0) * 2.2;
  while (smokeAcc > 1) {
    smokeAcc -= 1;
    const s = world.smoke[(Math.random() * world.smoke.length) | 0];
    _p.set(s.x + rnd(1.2), s.y + 0.3, s.z + rnd(1.2));
    _v.set(rnd(0.8), 0.3 + Math.random() * 0.6, rnd(0.8));
    fx.emit(_p, _v, { life: 5 + Math.random() * 3, size: 2.5, grow: 2.2, alpha: 0.16, color: [0.72, 0.76, 0.84], drag: 0.4, grav: -0.05 });
  }
}

// ---------- Camera ----------
let camMode = 0;
let camOverride = null;
const camPos = new THREE.Vector3(-10, 4, 10);
const camLook = new THREE.Vector3();
const flat = new THREE.Vector3(1, 0, 0);
const lastFlat = new THREE.Vector3(1, 0, 0);
let fovNow = 60;
let orbit = 0, orbitP = 0;
const CAMS = ['Chase camera', 'Far chase camera', 'Cockpit camera', 'Broadcast camera'];
// Fixed broadcast positions around the pad, like the event's camera towers.
const TV = [
  [-30, 6, -40], [120, 9, -70], [260, 7, -40], [400, 10, -70], [WALL.x0 + 1.5, 7.5, WALL.zc - 31], [WALL.x0 - 40, 4, WALL.zc + 18],
  [200, 4, 40], [40, 5, 60], [STRIP.x1 - 60, 3, STRIP.zc - 14], [600, 6, -10],
].map((a) => new THREE.Vector3(...a));

function setCam(c) { camOverride = c; }

function updateCamera(dt, t) {
  const v = vehicle;
  if (window.__cam) { camera.position.fromArray(window.__cam.p); camera.lookAt(...window.__cam.l); camera.fov = window.__cam.fov || 40; camera.updateProjectionMatrix(); return; }
  const k = (r) => 1 - Math.exp(-dt * r);
  if (menuOpen && !show.active) {
    const a = t * 0.2 + 0.7;
    camPos.set(v.pos.x + Math.cos(a) * 7.2, v.pos.y + 1.0, v.pos.z + Math.sin(a) * 7.2);
    camera.position.copy(camPos);
    camLook.copy(v.pos); camLook.y += 0.05;
    camera.up.set(0, 1, 0);
    camera.lookAt(camLook);
    camera.fov = 40;
    if (innerWidth > 760) camera.setViewOffset(innerWidth, innerHeight, -innerWidth * 0.2, 0, innerWidth, innerHeight);
    camera.updateProjectionMatrix();
    return;
  }
  if (camera.view && camera.view.enabled) camera.clearViewOffset();
  camera.up.set(0, 1, 0);
  if (show.active && camOverride) {
    const c = camOverride;
    if (c.cut || camPos.distanceTo(c.pos) > 25) camPos.copy(c.pos); else camPos.lerp(c.pos, k(5));
    camLook.lerp(c.look, k(9));
    camera.position.copy(camPos);
    camera.lookAt(camLook);
    camera.fov = c.fov || 45;
    camera.near = 0.3;
    camera.updateProjectionMatrix();
    return;
  }
  const speed = v.vel.length();
  const f = _d.copy(v.fwd); f.y = 0;
  if (f.lengthSq() > 0.08 && v.up.y > 0.3) { f.normalize(); lastFlat.copy(f); } else f.copy(lastFlat);
  let aim = f;
  if ((v.airborne || v.onWall) && speed > 6) {
    aim = _r.set(v.vel.x, 0, v.vel.z);
    if (aim.lengthSq() > 4) aim.normalize(); else aim.copy(f);
  }
  flat.lerp(aim, k(v.airborne ? 2 : 6)).normalize();
  // Right stick (or nothing on keyboard) orbits; it springs back when released.
  orbit += ((input.s.lookX || 0) * 2.6 - orbit) * k(6);
  orbitP += ((input.s.lookY || 0) * 0.6 - orbitP) * k(6);
  const dir = _r.copy(flat).applyAxisAngle(_p.set(0, 1, 0), -orbit);
  const target = _v.copy(v.pos);
  let desired, look;
  let fov = 58 + Math.min(speed, 90) * 0.18;
  if (camMode === 3) {
    let best = TV[0], bd = Infinity;
    for (const c of TV) { const d = c.distanceTo(target); if (d < bd) { bd = d; best = c; } }
    if (camPos.distanceTo(best) > 0.5) camPos.copy(best);
    look = target.clone();
    fov = THREE.MathUtils.clamp(900 / Math.max(bd, 1), 8, 55);
  } else if (v.onWall && camMode !== 2) {
    desired = new THREE.Vector3(WALL.x0 + 1.5, WALL.R * 0.95, WALL.zc - 30);
    look = new THREE.Vector3(v.pos.x * 0.7 + (WALL.x0 + 3) * 0.3, v.pos.y * 0.8 + 3, v.pos.z);
    fov = 46;
    camPos.lerp(desired, k(3));
  } else if (camMode === 2) {
    _p.copy(model.cockpit || new THREE.Vector3(0.0, 0.32, -0.33));
    desired = _p.applyQuaternion(v.q).add(v.pos);
    camPos.copy(desired);
    look = new THREE.Vector3(12, -0.4, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), -orbit * 1.2).applyQuaternion(v.q).add(v.pos);
    camera.up.copy(v.up);
    fov = 68;
  } else {
    const dist = camMode === 1 ? 11 : v.airborne ? 7.4 : 6.4;
    const height = (camMode === 1 ? 3.6 : 1.9) + orbitP * 3;
    desired = target.clone().addScaledVector(dir, -dist - Math.min(speed, 80) * 0.012);
    desired.y += height + (v.airborne ? 0.6 : 0);
    camPos.lerp(desired, k(v.airborne ? 8 : 12));
    look = target.clone().addScaledVector(dir, 4.5);
    look.y += 0.35;
  }
  if (shake > 0.01) {
    camPos.x += rnd(0.22) * shake; camPos.y += rnd(0.22) * shake; camPos.z += rnd(0.22) * shake;
    shake *= Math.exp(-dt * 6);
  }
  if (camMode !== 2) camPos.y = Math.max(camPos.y, 0.5);
  camera.position.copy(camPos);
  camLook.lerp(look, camMode >= 2 ? 1 : k(14));
  camera.lookAt(camLook);
  fovNow += (fov - fovNow) * k(camMode === 3 ? 30 : 4);
  camera.near = camMode === 2 ? 0.05 : 0.3;
  camera.fov = fovNow;
  camera.updateProjectionMatrix();
}

// ---------- Model sync ----------
function syncModel(dt) {
  const v = vehicle;
  const kk = (r) => Math.min(1, dt * r);
  for (let i = 0; i < 4; i++) {
    const w = v.wheels[i], m = mst.wheels[i];
    m.steer = w.steer; m.spin = w.spin; m.y = w.y;
  }
  if (Math.abs(v.vFwd) > 3) mst.doorsT = 0;
  mst.doors += (mst.doorsT - mst.doors) * kk(2.2);
  mst.wing += ((v.wingUp ? 1 : 0) - mst.wing) * kk(4);
  mst.airbrake = v.airbrake;
  mst.lights += ((lights ? 1 : 0) - mst.lights) * kk(5);
  mst.brake = v.braking ? 1 : 0;
  mst.fans = v.suction;
  mst.nozzles = v.nozzleU;
  mst.speed = v.vFwd;
  model.group.position.copy(v.pos);
  model.group.quaternion.copy(v.q);
  model.update(dt, mst);
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
  if (window.__manual) return;
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  update(dt);
}

const ui = {
  eventCard(seg, first, dim) {
    const card = $('showcard');
    if (!seg) { card.classList.add('dim'); $('count').textContent = ''; return; }
    $('showk').textContent = first ? 'Live from McGregor, Texas' : seg.key === 'reveal' ? '' : 'Launch night';
    $('showt').textContent = seg.title;
    $('shows').textContent = seg.sub;
    card.classList.toggle('dim', !!dim);
  },
  countdown(n) { $('count').textContent = n > 0 ? String(n) : ''; },
  eventDone() { $('show').classList.add('hidden'); openMenu(); },
};
const show = new EventShow({ vehicle, setVariant, setCam, ui, mst, setLights: (on) => { lights = !!on; } });

// One full game frame. `window.__demo` (set by the demo recorder) replaces live input with scripted input.
function update(dt) {
  clock += dt;
  if (window.__manual) {
    for (const d of [...$('popups').children]) {
      const age = +d.dataset.age + dt;
      d.dataset.age = String(age);
      d.style.animationDelay = `${-age}s`;
      if (age > 2.7) d.remove();
    }
  }
  if (centerT > 0) { centerT -= dt; if (centerT <= 0) $('center').innerHTML = ''; }
  let P;
  if (window.__demo) {
    Object.assign(input.s, { throttle: 0, brake: 0, steer: 0, pitch: 0, roll: 0, yaw: 0, boost: false, lift: false, handbrake: false, lookX: 0, lookY: 0 }, window.__demo.ctrl);
    P = window.__demo.pressed || {};
    window.__demo.pressed = {};
  } else {
    input.update(dt);
    P = input.p;
  }
  if (P.mute) { sound.muted = !sound.muted; toast(sound.muted ? 'Sound off' : 'Sound on'); }

  let ctrl = input.s;
  let stepP = P;
  let run = false;
  if (menuOpen) {
    if (P.left) select(selected - 1);
    if (P.right) select(selected + 1);
    if (P.up || P.down) { menuBtn = 1 - menuBtn; menuButtons(); }
    if (P.confirm) { if (menuBtn === 1) beginShow(); else beginDrive(); }
    else if (P.pause && started) beginDrive();
  } else if (show.active) {
    if (P.pause || P.back) { show.stop(); beginDrive(); }
    else {
      const o = show.update(dt);
      ctrl = o.c; stepP = o.P; run = true;
    }
  } else {
    run = true;
    if (P.pause) openMenu();
    if (P.camera) { camMode = (camMode + 1) % CAMS.length; toast(CAMS[camMode]); }
    if (P.lights) { lights = !lights; toast(lights ? 'Headlights up' : 'Headlights hidden'); }
    if (P.doors) { mst.doorsT = mst.doorsT ? 0 : 1; if (Math.abs(vehicle.vFwd) > 3) toast('Stop to open the doors'); }
    if (P.hints) $('hints').classList.toggle('off');
    if (P.reset) { vehicle.respawn(stuntFor(vehicle.pos)); centerMsg(vehicle.spawn.label, '', 1); }
    let jump = null;
    for (let i = 1; i <= 5; i++) if (P['sp' + i]) jump = SPAWNS[i - 1];
    if (P.next || P.prev) {
      const i = SPAWNS.indexOf(stuntFor(vehicle.pos));
      jump = SPAWNS[(i + (P.next ? 1 : -1) + SPAWNS.length) % SPAWNS.length];
    }
    if (jump) { vehicle.respawn(jump); centerMsg(jump.label, '', 1.2); camPos.set(jump.x - 8, 2.5, jump.z); }
  }
  if (run) {
    acc += window.__freeze ? 0 : dt;
    let first = true;
    let n = 0;
    while (acc >= STEP && n < 10) {
      vehicle.step(STEP, ctrl, first ? stepP : NONE);
      first = false;
      acc -= STEP;
      n++;
      handleEvents();
    }
    if (n === 10) acc = 0;
  }
  vehicle.handbrake = ctrl.handbrake;
  syncModel(dt);
  if (!menuOpen || show.active) emitFx(dt);
  fx.update(dt);
  updateCamera(dt, clock);
  updateWorld(world, dt, clock, vehicle.pos, {
    mph: Math.abs(vehicle.vFwd) * MPH, variant: vehicle.p.name, gas: vehicle.p.gas ? vehicle.gas / vehicle.p.gas : undefined,
    suction: vehicle.suction, t60: vehicle.t60.result, stunt: show.active ? show.seg.title : stuntFor(vehicle.pos).label,
  });
  if (!menuOpen && !show.active) updateHud(dt);
  if (!menuOpen) {
    const slip = vehicle.wheels.reduce((s, w) => s + (w.contact ? Math.abs(w.slip) : 0), 0) / 4;
    let thrust = 0;
    for (let i = 0; i < vehicle.nozzleU.length; i++) thrust += vehicle.nozzleU[i];
    thrust = Math.min(1, thrust / 4);
    sound.update(Math.min(1, vehicle.vel.length() / 100), ctrl.throttle, thrust > 0.05, vehicle.suction > 0.5, slip, vehicle.airborne);
    if (!show.active) {
      input.feedback({
        thrust, suction: vehicle.suction, slip: Math.min(1, slip / 4), road: vehicle.contacts ? Math.min(1, vehicle.vel.length() / 80) : 0,
        brakeLoad: vehicle.braking ? ctrl.brake : 0, traction: vehicle.t60.state === 'run' ? ctrl.throttle : 0,
      });
    }
  }
  renderer.render(scene, camera);
}

select(0);
menuButtons();
menuHint();
renderHints();
if (params.get('start')) {
  const i = keys.indexOf(params.get('start'));
  if (i >= 0) { select(i); beginDrive(); }
}
if (params.get('event') != null) beginShow();

function advance(seconds, ctrl = {}, pressed = {}) {
  Object.assign(input.s, ctrl);
  const n = Math.round(seconds / STEP);
  for (let i = 0; i < n; i++) { vehicle.step(STEP, input.s, i === 0 ? pressed : NONE); handleEvents(); }
}
window.__game = {
  advance, tick: update, snapCamera: () => { updateCamera(10, clock); updateCamera(10, clock); }, fx, vehicle, input, camera, scene,
  setVariant, select, beginDrive, beginShow, show, get model() { return model; }, SPAWNS, mst, world,
};
requestAnimationFrame(frame);
