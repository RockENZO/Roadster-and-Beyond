import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { TRACK, SPA, locate, inPit, onPitWall } from './spa-track.js';

// The Spa-Francorchamps track day: its own scene, away from the launch site. The circuit, its
// kerbs, run-off, barriers, pit lane and garages, start gantry, grandstands and the Ardennes forest
// on a terrain that follows the track's 100 m of climb and fall. Day or night: by night the
// circuit is lit by floodlight towers (their light baked into the surfaces as pools).

const TAU = Math.PI * 2;
const T = TRACK;
const N = T.N;

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}
// Smooth 2D value noise for the hills.
function noise2(seed) {
  const R = rng(seed), P = new Float32Array(256 * 256);
  for (let i = 0; i < P.length; i++) P[i] = R();
  const at = (x, z) => P[((z & 255) << 8) | (x & 255)];
  return (x, z) => {
    const xi = Math.floor(x), zi = Math.floor(z), fx = x - xi, fz = z - zi;
    const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
    const a = at(xi, zi), b = at(xi + 1, zi), c = at(xi, zi + 1), d = at(xi + 1, zi + 1);
    return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
  };
}

// Point at distance-index i (fractional allowed via two samples) and lateral offset lat.
function at(i, lat, yOff = 0, out = []) {
  const rx = -T.tz[i], rz = T.tx[i];
  out[0] = T.x[i] + rx * lat; out[1] = T.y[i] + yOff; out[2] = T.z[i] + rz * lat;
  return out;
}

// Strip along the lap between two lateral offsets (functions of the sample index). Samples where
// keep(i) is false are skipped (the strip is broken there). v runs along the lap in metres / vScale.
function strip(latA, latB, { yA = 0, yB = 0, keep = null, vScale = 8, uSpan = 1, glow = null, i0 = 0, i1 = N } = {}) {
  const pos = [], uv = [], gl = [], idx = [];
  let prev = -1;
  const pa = [], pb = [];
  for (let n = i0; n <= i1; n++) {
    const i = n % N;
    if (keep && !keep(i)) { prev = -1; continue; }
    const a = latA(i), b = latB(i);
    at(i, a, typeof yA === 'function' ? yA(i) : yA, pa);
    at(i, b, typeof yB === 'function' ? yB(i) : yB, pb);
    const base = pos.length / 3;
    pos.push(...pa, ...pb);
    const v = (n * T.ds) / vScale;
    uv.push(0, v, uSpan, v);
    if (glow) gl.push(glow(pa[0], pa[2]), glow(pb[0], pb[2]));
    if (prev >= 0) idx.push(prev, prev + 1, base, prev + 1, base + 1, base);
    prev = base;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (glow) g.setAttribute('glow', new THREE.Float32BufferAttribute(gl, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  // strips are built left-to-right going forward: make sure the faces point up
  const n0 = g.attributes.normal;
  if (n0.count && n0.getY(0) < 0) { for (let k = 0; k < idx.length; k += 3) { const t = idx[k]; idx[k] = idx[k + 1]; idx[k + 1] = t; } g.setIndex(idx); g.computeVertexNormals(); }
  return g;
}

// Adds the baked floodlight pools to a standard material: emissive += albedo * glow * night.
function lightPools(mat, uni, gain = 1) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = uni;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float glow;\nvarying float vGlow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = glow;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vGlow;\nuniform float uNight;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.93, 0.8) * vGlow * uNight * ' + gain.toFixed(2) + ';');
  };
  mat.customProgramCacheKey = () => 'pools' + gain;
  return mat;
}

export function buildSpa(renderer) {
  const scene = new THREE.Scene();
  const R = rng(1925);
  const night = { value: 0 };
  const spa = { scene, night: false, lights: [] };

  // ---- textures ------------------------------------------------------------------------------
  const asphalt = canvasTex(256, 256, (g, w, h) => {
    const r = rng(3);
    g.fillStyle = '#3a3b3e'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 14000; i++) { const v = 40 + r() * 40; g.fillStyle = `rgba(${v},${v},${v + 3},${0.25 + r() * 0.4})`; g.fillRect(r() * w, r() * h, 1 + r() * 1.5, 1 + r() * 1.5); }
    // a darker racing line down the middle
    const gr = g.createLinearGradient(0, 0, w, 0);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.35, 'rgba(10,10,12,0.22)'); gr.addColorStop(0.65, 'rgba(10,10,12,0.22)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
  const grass = canvasTex(256, 256, (g, w, h) => {
    const r = rng(5);
    g.fillStyle = '#3d6a2c'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 16000; i++) { const v = r(); g.fillStyle = `rgba(${40 + v * 50},${80 + v * 60},${25 + v * 25},${0.35})`; g.fillRect(r() * w, r() * h, 1, 2 + r() * 3); }
    // mowing stripes
    for (let y = 0; y < h; y += 64) { g.fillStyle = 'rgba(255,255,255,0.04)'; g.fillRect(0, y, w, 32); }
  });
  const kerbTex = canvasTex(64, 128, (g, w, h) => {
    g.fillStyle = '#c8141c'; g.fillRect(0, 0, w, h / 2);
    g.fillStyle = '#f2f2ee'; g.fillRect(0, h / 2, w, h / 2);
  });
  const forestFloor = canvasTex(256, 256, (g, w, h) => {
    const r = rng(9);
    g.fillStyle = '#2c3d22'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) { const v = r(); g.fillStyle = `rgba(${30 + v * 40},${45 + v * 45},${20 + v * 20},0.4)`; g.fillRect(r() * w, r() * h, 2 + r() * 4, 2 + r() * 4); }
  });

  // ---- floodlight towers (night): one every ~70 m, alternating sides --------------------------
  const poles = [];
  for (let n = 0, side = 1; n < N; n += 35, side = -side) {
    const lat = side > 0 ? T.bR[n] + 2.5 : -(T.bL[n] + 2.5);
    const p = at(n, lat);
    poles.push({ x: p[0], y: p[1], z: p[2], i: n, side });
  }
  const pg = new Map();
  for (const p of poles) { const k = Math.floor(p.x / 60) * 1000 + Math.floor(p.z / 60); (pg.get(k) || pg.set(k, []).get(k)).push(p); }
  const glow = (x, z) => {
    let g = 0;
    const cx = Math.floor(x / 60), cz = Math.floor(z / 60);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const list = pg.get((cx + a) * 1000 + cz + b);
      if (list) for (const p of list) { const d2 = (x - p.x) ** 2 + (z - p.z) ** 2; g += Math.exp(-d2 / (2 * 22 * 22)); }
    }
    return Math.min(1.3, g) * 0.55;
  };

  // ---- the circuit -----------------------------------------------------------------------------
  const hw = SPA.hw, kw = SPA.kerb;
  const corner = new Uint8Array(N);
  for (let i = 0; i < N; i++) corner[i] = Math.abs(T.k[i]) > 1 / 260 ? 1 : 0;
  // grow the kerbed stretches a little either side of each bend
  const cK = Uint8Array.from(corner);
  for (let i = 0; i < N; i++) if (corner[i]) for (let d = -8; d <= 8; d++) cK[(i + d + N) % N] = 1;
  const pitI0 = Math.round((T.L - SPA.pit.before) / T.ds), pitI1 = Math.round(SPA.pit.after / T.ds);
  const pitAt = (i) => i >= pitI0 || i <= pitI1;
  // pit lane offset: tapers in from the track edge at both ends
  const pitLat = (i) => {
    const s = i * T.ds, p = SPA.pit;
    const fromIn = s >= T.L - p.before ? s - (T.L - p.before) : s + p.before;
    const total = p.before + p.after;
    const t = Math.min(1, fromIn / p.taper, (total - fromIn) / p.taper);
    const e = t * t * (3 - 2 * t);
    return hw - 1 + (p.lane - hw + 1) * e;
  };

  const matRoad = lightPools(new THREE.MeshStandardMaterial({ map: asphalt, roughness: 0.92, metalness: 0 }), night, 3.2);
  asphalt.repeat.set(1, 1);
  const road = new THREE.Mesh(strip(() => -hw, () => hw, { vScale: 12, glow }), matRoad);
  road.receiveShadow = true;
  scene.add(road);

  // white edge lines, and the kerbs (red and white) through the bends
  const lineMat = lightPools(new THREE.MeshStandardMaterial({ color: 0xe9e9e4, roughness: 0.7 }), night);
  for (const sg of [1, -1]) {
    const a = (i) => sg * (hw - 0.45), b = (i) => sg * (hw - 0.2);
    scene.add(new THREE.Mesh(strip(sg > 0 ? a : b, sg > 0 ? b : a, { yA: 0.012, yB: 0.012, glow }), lineMat));
  }
  const kerbMat = lightPools(new THREE.MeshStandardMaterial({ map: kerbTex, roughness: 0.6 }), night);
  for (const sg of [1, -1]) {
    const a = (i) => sg * hw, b = (i) => sg * (hw + kw);
    const g = strip(sg > 0 ? a : b, sg > 0 ? b : a, { yA: sg > 0 ? 0.02 : 0.07, yB: sg > 0 ? 0.07 : 0.02, keep: (i) => cK[i] && !(sg > 0 && pitAt(i)), vScale: 4, glow });
    scene.add(new THREE.Mesh(g, kerbMat));
  }
  // grass run-off out to the barriers, then a few metres past them; tarmac on the pit side of the straight
  const grassMat = lightPools(new THREE.MeshStandardMaterial({ map: grass, roughness: 1 }), night, 0.7);
  grass.repeat.set(3, 1);
  for (const sg of [1, -1]) {
    const inner = (i) => sg * (cK[i] && !(sg > 0 && pitAt(i)) ? hw + kw : hw);
    const outer = (i) => sg * ((sg > 0 ? T.bR[i] : T.bL[i]) + 6);
    const g = strip(sg > 0 ? inner : outer, sg > 0 ? outer : inner, { yA: -0.02, yB: -0.02, keep: (i) => !(sg > 0 && pitAt(i)), vScale: 10, uSpan: 3, glow });
    const m = new THREE.Mesh(g, grassMat); m.receiveShadow = true; scene.add(m);
  }
  // pit lane, pit apron and the garages' forecourt
  {
    const lane = strip((i) => hw, (i) => SPA.pit.garage + 6, { keep: pitAt, yA: -0.005, yB: -0.005, vScale: 12, uSpan: 2, glow });
    const m = new THREE.Mesh(lane, matRoad); m.receiveShadow = true; scene.add(m);
    // pit lane lines: the fast-lane edge (white) and the speed-limit line at each end
    scene.add(new THREE.Mesh(strip((i) => pitLat(i) - SPA.pit.laneHw, (i) => pitLat(i) - SPA.pit.laneHw + 0.2, { keep: pitAt, yA: 0.012, yB: 0.012, glow }), lineMat));
    scene.add(new THREE.Mesh(strip((i) => pitLat(i) + SPA.pit.laneHw - 0.2, (i) => pitLat(i) + SPA.pit.laneHw, { keep: pitAt, yA: 0.012, yB: 0.012, glow }), lineMat));
  }
  // start/finish line and the grid slots behind it
  {
    const g = [];
    const box = (i, latA, latB, len) => {
      const a = at(i, latA, 0.015), b = at(i, latB, 0.015);
      const j = (i + Math.max(1, Math.round(len / T.ds))) % N;
      const c = at(j, latB, 0.015), d = at(j, latA, 0.015);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c, ...a, ...c, ...d], 3));
      geo.computeVertexNormals();
      if (geo.attributes.normal.getY(0) < 0) geo.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...c, ...b, ...a, ...d, ...c], 3));
      geo.computeVertexNormals();
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(12).fill(0), 2));
      geo.setAttribute('glow', new THREE.Float32BufferAttribute(new Array(6).fill(glow(a[0], a[2])), 1));
      g.push(geo);
    };
    box(0, -hw, hw, 1.2);
    for (let k = 1; k <= 12; k++) {
      const i = (N - Math.round((k * 8) / T.ds)) % N;
      const lat = k % 2 ? -2.6 : 2.6;
      box(i, lat - 1.6, lat + 1.6, 0.25);
    }
    scene.add(new THREE.Mesh(mergeGeometries(g), lineMat));
  }

  // ---- barriers: armco on posts, skipped where another part of the track is closer -----------
  {
    const L = {};
    const okBarrier = (i, sg) => {
      const lat = sg > 0 ? T.bR[i] : -T.bL[i];
      const p = at(i, lat);
      if (!locate(p[0], p[2], L)) return true;
      let di = Math.abs(L.i - i); di = Math.min(di, N - di);
      return di < 40;
    };
    const rail = new THREE.MeshStandardMaterial({ color: 0xaeb4ba, metalness: 0.75, roughness: 0.35, side: THREE.DoubleSide });
    const post = new THREE.MeshStandardMaterial({ color: 0x5b6066, metalness: 0.5, roughness: 0.6 });
    const postGeo = new THREE.BoxGeometry(0.12, 0.8, 0.12);
    const posts = [];
    for (const sg of [1, -1]) {
      const keep = (i) => okBarrier(i, sg) && !(sg > 0 && pitAt(i));
      const lat = (i) => sg * ((sg > 0 ? T.bR[i] : T.bL[i]) + 0.1);
      for (const [y0, y1] of [[0.35, 0.65], [0.72, 0.95]]) {
        const g = new THREE.BufferGeometry();
        const pos = [], idx = []; let prev = -1;
        for (let i = 0; i <= N; i++) {
          const k = i % N;
          if (!keep(k)) { prev = -1; continue; }
          const a = at(k, lat(k), y0), b = at(k, lat(k), y1);
          const base = pos.length / 3; pos.push(...a, ...b);
          if (prev >= 0) idx.push(prev, prev + 1, base, prev + 1, base + 1, base);
          prev = base;
          if (k % 2 === 0 && y0 < 0.5) posts.push(at(k, lat(k) + sg * 0.12, 0.4));
        }
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
        scene.add(new THREE.Mesh(g, rail));
      }
    }
    const im = new THREE.InstancedMesh(postGeo, post, posts.length);
    const m4 = new THREE.Matrix4();
    posts.forEach((p, n) => { m4.makeTranslation(p[0], p[1], p[2]); im.setMatrixAt(n, m4); });
    scene.add(im);
    // pit wall: white concrete with a catch fence, between the two pit tapers
    const conc = lightPools(new THREE.MeshStandardMaterial({ color: 0xdcdcd6, roughness: 0.85 }), night);
    const pw = SPA.pit.wall;
    const wallKeep = (i) => onPitWall(i * T.ds);
    for (const [la, lb, ya, yb] of [[pw - 0.3, pw - 0.3, 0, 1.1], [pw + 0.3, pw + 0.3, 1.1, 0], [pw - 0.3, pw + 0.3, 1.1, 1.1]]) {
      const g = new THREE.BufferGeometry(); const pos = [], idx = [], gl = []; let prev = -1;
      for (let i = 0; i <= N; i++) {
        const k = i % N; if (!wallKeep(k)) { prev = -1; continue; }
        const a = at(k, la, ya), b = at(k, lb, yb); const base = pos.length / 3; pos.push(...a, ...b); gl.push(glow(a[0], a[2]), glow(b[0], b[2]));
        if (prev >= 0) idx.push(prev, prev + 1, base, prev + 1, base + 1, base); prev = base;
      }
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('glow', new THREE.Float32BufferAttribute(gl, 1)); g.setIndex(idx); g.computeVertexNormals();
      const m = new THREE.Mesh(g, conc); m.material.side = THREE.DoubleSide; scene.add(m);
    }
    const fence = new THREE.MeshBasicMaterial({ color: 0x9aa2aa, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false });
    const fg = new THREE.BufferGeometry(); const fp = [], fi = []; let prev = -1;
    for (let i = 0; i <= N; i++) {
      const k = i % N; if (!wallKeep(k)) { prev = -1; continue; }
      const a = at(k, pw, 1.1), b = at(k, pw, 4); const base = fp.length / 3; fp.push(...a, ...b);
      if (prev >= 0) fi.push(prev, prev + 1, base, prev + 1, base + 1, base); prev = base;
    }
    fg.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3)); fg.setIndex(fi);
    scene.add(new THREE.Mesh(fg, fence));
  }

  // ---- pit building: a long row of garages behind the pit lane ---------------------------------
  {
    const g0 = SPA.pit.garage;
    const garagesFace = canvasTex(1024, 128, (g, w, h) => {
      g.fillStyle = '#e8e9eb'; g.fillRect(0, 0, w, h);
      for (let k = 0; k < 8; k++) {
        const x = k * (w / 8) + 10;
        g.fillStyle = '#1b1d21'; g.fillRect(x, 34, w / 8 - 20, h - 34);
        g.fillStyle = '#c9161e'; g.fillRect(x, 26, w / 8 - 20, 6);
        g.fillStyle = 'rgba(255,240,210,0.55)'; g.fillRect(x + 6, 40, w / 8 - 32, 10);
      }
      g.fillStyle = '#25282d'; g.fillRect(0, 0, w, 18);
    });
    const faceMat = new THREE.MeshStandardMaterial({ map: garagesFace, roughness: 0.8, emissive: 0xffffff, emissiveMap: garagesFace, emissiveIntensity: 0 });
    spa.garageMat = faceMat;
    garagesFace.repeat.set(0.25, 1);
    const shell = new THREE.MeshStandardMaterial({ color: 0xcfd2d6, roughness: 0.75 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x1c2733, roughness: 0.15, metalness: 0.6, emissive: 0xffe6b8, emissiveIntensity: 0 });
    spa.boxGlass = glass;
    const step = 16;
    const len = (SPA.pit.before + SPA.pit.after - 2 * SPA.pit.taper - 10);
    const sStart = T.L - SPA.pit.before + SPA.pit.taper + 5;
    for (let s = 0; s < len; s += step) {
      const i = Math.round(((sStart + s) % T.L) / T.ds) % N;
      const j = Math.round(((sStart + s + step) % T.L) / T.ds) % N;
      const a = at(i, g0), b = at(j, g0);
      const cx = (a[0] + b[0]) / 2, cz = (a[2] + b[2]) / 2, cy = Math.min(a[1], b[1]);
      const yaw = Math.atan2(-(b[2] - a[2]), b[0] - a[0]);
      const grp = new THREE.Group();
      grp.position.set(cx, cy, cz); grp.rotation.y = yaw;
      const depth = 14;
      // local x runs along the lap, local +z away from the track: the -z faces look at the pit lane
      const faces = (front) => [shell, shell, shell, shell, shell, front];
      const body = new THREE.Mesh(new THREE.BoxGeometry(step, 6, depth), faces(faceMat));
      body.position.set(0, 3, depth / 2);
      body.castShadow = true; body.receiveShadow = true;
      // hospitality floor above with dark glass, and a roof overhang
      const upper = new THREE.Mesh(new THREE.BoxGeometry(step, 3.4, depth - 2), faces(glass));
      upper.position.set(0, 7.7, depth / 2 + 1);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(step, 0.4, depth + 3), shell);
      roof.position.set(0, 9.6, depth / 2 - 1.5);
      grp.add(body, upper, roof);
      scene.add(grp);
    }
  }

  // ---- start gantry, with the five red start lights --------------------------------------------
  {
    const i = Math.round(6 / T.ds);
    const grp = new THREE.Group();
    const steel = new THREE.MeshStandardMaterial({ color: 0x2a2d33, metalness: 0.6, roughness: 0.45 });
    const p = at(i, 0);
    grp.position.set(p[0], p[1], p[2]);
    grp.rotation.y = Math.atan2(-T.tz[i], T.tx[i]);
    for (const z of [-hw - 1.5, hw + 1.5]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.6, 7.5, 0.6), steel); leg.position.set(0, 3.75, z); grp.add(leg); }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.4, 2 * hw + 3.6), steel); beam.position.set(0, 7.2, 0); grp.add(beam);
    const lamp = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff1010, emissiveIntensity: 0.3 });
    spa.startLamps = lamp;
    for (let k = 0; k < 5; k++) { const l = new THREE.Mesh(new THREE.CircleGeometry(0.22, 16), lamp); l.position.set(-0.61, 7.2, -1.4 + k * 0.7); l.rotation.y = -Math.PI / 2; grp.add(l); }
    grp.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    scene.add(grp);
  }

  // ---- grandstands at La Source, Eau Rouge, Les Combes, Pouhon, Blanchimont and the main straight
  {
    const stands = [[150, -1, 80], [880, -1, 110], [1030, 1, 70], [2240, -1, 70], [3700, 1, 90], [6550, -1, 120], [60, -1, 140]];
    const crowd = canvasTex(256, 64, (g, w, h) => {
      const r = rng(11);
      g.fillStyle = '#30343b'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 1400; i++) { const c = ['#c9161e', '#f2c218', '#e9e9e9', '#1f4e9a', '#2d2d2d', '#d97b2a'][(r() * 6) | 0]; g.fillStyle = c; g.fillRect(r() * w, r() * h, 2, 3); }
    });
    const seatMat = new THREE.MeshStandardMaterial({ map: crowd, roughness: 0.9 });
    const frame = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.6, metalness: 0.4 });
    for (const [s, sg, len] of stands) {
      const i = Math.round(s / T.ds) % N;
      const off = (sg > 0 ? T.bR[i] : T.bL[i]) + 6;
      const p = at(i, sg * off);
      const grp = new THREE.Group();
      grp.position.set(p[0], p[1], p[2]);
      grp.rotation.y = Math.atan2(-T.tz[i], T.tx[i]) + (sg > 0 ? Math.PI : 0);
      for (let r = 0; r < 8; r++) {
        const tier = new THREE.Mesh(new THREE.BoxGeometry(len, 0.9, 1.2), seatMat);
        tier.position.set(0, 0.6 + r * 0.9, -(r * 1.2 + 0.6));
        grp.add(tier);
      }
      const roof = new THREE.Mesh(new THREE.BoxGeometry(len, 0.3, 11), frame); roof.position.set(0, 9.6, -5); grp.add(roof);
      for (let x = -len / 2; x <= len / 2; x += 12) { const c = new THREE.Mesh(new THREE.BoxGeometry(0.3, 9.6, 0.3), frame); c.position.set(x, 4.8, -10); grp.add(c); }
      grp.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      scene.add(grp);
    }
  }

  // ---- terrain: the valley floor and the wooded hills, following the track's height ----------
  let xmin = Infinity, xmax = -Infinity, zmin = Infinity, zmax = -Infinity;
  for (let i = 0; i < N; i++) { xmin = Math.min(xmin, T.x[i]); xmax = Math.max(xmax, T.x[i]); zmin = Math.min(zmin, T.z[i]); zmax = Math.max(zmax, T.z[i]); }
  const M = 700;
  xmin -= M; xmax += M; zmin -= M; zmax += M;
  const cell = 12;
  const nx = Math.ceil((xmax - xmin) / cell), nz = Math.ceil((zmax - zmin) / cell);
  const hill = noise2(77);
  // nearest centreline sample for every terrain vertex: coarse pass over every 8th sample, then refine
  const near = new Int32Array((nx + 1) * (nz + 1)), dist = new Float32Array((nx + 1) * (nz + 1));
  for (let gz = 0; gz <= nz; gz++) {
    for (let gx = 0; gx <= nx; gx++) {
      const x = xmin + gx * cell, z = zmin + gz * cell;
      let bd = Infinity, bi = 0;
      for (let i = 0; i < N; i += 8) { const d = (x - T.x[i]) ** 2 + (z - T.z[i]) ** 2; if (d < bd) { bd = d; bi = i; } }
      for (let i = bi - 8; i <= bi + 8; i++) { const k = (i + N) % N; const d = (x - T.x[k]) ** 2 + (z - T.z[k]) ** 2; if (d < bd) { bd = d; bi = k; } }
      near[gz * (nx + 1) + gx] = bi; dist[gz * (nx + 1) + gx] = Math.sqrt(bd);
    }
  }
  const terrH = (gx, gz) => {
    const k = gz * (nx + 1) + gx, i = near[k], d = dist[k];
    const x = xmin + gx * cell, z = zmin + gz * cell;
    const edge = Math.max(T.bL[i], T.bR[i]) + 4;
    const t = Math.min(1, Math.max(0, (d - edge) / 140));
    const e = t * t * (3 - 2 * t);
    const n = hill(x / 160, z / 160) * 0.65 + hill(x / 55, z / 55) * 0.35;
    // dip a little under the run-off so the strips always sit on top
    return T.y[i] - 0.6 * (1 - e) + e * (n * 70 - 10) + (d < edge ? -0.4 : 0);
  };
  {
    const pos = new Float32Array((nx + 1) * (nz + 1) * 3), uv = new Float32Array((nx + 1) * (nz + 1) * 2), gl = new Float32Array((nx + 1) * (nz + 1));
    const hs = new Float32Array((nx + 1) * (nz + 1));
    for (let gz = 0; gz <= nz; gz++) for (let gx = 0; gx <= nx; gx++) {
      const k = gz * (nx + 1) + gx, x = xmin + gx * cell, z = zmin + gz * cell, y = terrH(gx, gz);
      hs[k] = y;
      pos.set([x, y, z], k * 3); uv.set([x / 24, z / 24], k * 2); gl[k] = glow(x, z) * 0.5;
    }
    const idx = [];
    for (let gz = 0; gz < nz; gz++) for (let gx = 0; gx < nx; gx++) {
      const a = gz * (nx + 1) + gx, b = a + 1, c = a + nx + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('glow', new THREE.BufferAttribute(gl, 1));
    g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, lightPools(new THREE.MeshStandardMaterial({ map: forestFloor, roughness: 1 }), night));
    m.receiveShadow = true;
    scene.add(m);

    // the forest: conifers and some broadleaf, thick on the hills, clear of the circuit
    const cone = new THREE.ConeGeometry(1, 1, 7); cone.translate(0, 0.5, 0);
    const ball = new THREE.IcosahedronGeometry(1, 0); ball.translate(0, 1, 0);
    const trunk = new THREE.CylinderGeometry(0.12, 0.18, 1, 5); trunk.translate(0, 0.5, 0);
    const conMat = new THREE.MeshStandardMaterial({ color: 0x1f3a22, roughness: 0.95, flatShading: true });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x3a5a26, roughness: 0.95, flatShading: true });
    const barkMat = new THREE.MeshStandardMaterial({ color: 0x3b2d22, roughness: 1 });
    const trees = [];
    const RT = rng(42);
    for (let gz = 0; gz < nz; gz++) for (let gx = 0; gx < nx; gx++) {
      const k = gz * (nx + 1) + gx, i = near[k];
      const clear = Math.max(T.bL[i], T.bR[i]) + 10 + (pitAt(i) ? 30 : 0);
      if (dist[k] < clear) continue;
      // dense near the circuit, where you see each tree; sparser and larger further out
      const dens = 0.45 + 0.5 * hill(gx * 0.11 + 9, gz * 0.11);
      const far = dist[k] > 260;
      const n = far ? (RT() < dens - 0.15 ? 1 : 0) : dens > 0.6 ? 2 : 1;
      for (let q = 0; q < n; q++) {
        const fx = RT(), fz = RT();
        const x = xmin + (gx + fx) * cell, z = zmin + (gz + fz) * cell;
        const y = hs[k] * (1 - fx) * (1 - fz) + hs[k + 1] * fx * (1 - fz) + hs[k + nx + 1] * (1 - fx) * fz + hs[k + nx + 2] * fx * fz;
        trees.push([x, y, z, (14 + RT() * 14) * (far ? 1.35 : 1), RT() < 0.75, far]);
      }
    }
    const conifers = trees.filter((t) => t[4]), broad = trees.filter((t) => !t[4]);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3();
    const inst = (geo, mat, list, f) => {
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((t, n) => { f(t, ps, sc); q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (t[0] * 7.1) % TAU); m4.compose(ps, q, sc); im.setMatrixAt(n, m4); });
      im.castShadow = false; im.receiveShadow = false;
      scene.add(im);
      return im;
    };
    inst(cone, conMat, conifers, (t, p, s) => { p.set(t[0], t[1] + t[3] * 0.18, t[2]); s.set(t[3] * 0.2, t[3] * 0.85, t[3] * 0.2); });
    inst(trunk, barkMat, trees.filter((t) => !t[5]), (t, p, s) => { p.set(t[0], t[1], t[2]); s.set(1.3, t[3] * 0.3, 1.3); });
    inst(ball, leafMat, broad, (t, p, s) => { p.set(t[0], t[1] + t[3] * 0.25, t[2]); s.set(t[3] * 0.28, t[3] * 0.3, t[3] * 0.28); });
    spa.treeCount = trees.length;
  }

  // ---- floodlight towers: mast and lamp head; the heads glow at night ---------------------------
  {
    const mast = new THREE.CylinderGeometry(0.18, 0.25, 1, 6); mast.translate(0, 0.5, 0);
    const head = new THREE.BoxGeometry(2.4, 0.9, 0.5);
    const mastMat = new THREE.MeshStandardMaterial({ color: 0x5d636b, metalness: 0.6, roughness: 0.5 });
    const headMat = new THREE.MeshStandardMaterial({ color: 0x333333, emissive: 0xfff2d8, emissiveIntensity: 0 });
    spa.headMat = headMat;
    const H = 16;
    const im1 = new THREE.InstancedMesh(mast, mastMat, poles.length), im2 = new THREE.InstancedMesh(head, headMat, poles.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
    poles.forEach((p, n) => {
      m4.compose(new THREE.Vector3(p.x, p.y, p.z), q.identity(), new THREE.Vector3(1, H, 1)); im1.setMatrixAt(n, m4);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-T.tz[p.i], T.tx[p.i]));
      m4.compose(new THREE.Vector3(p.x, p.y + H, p.z), q, new THREE.Vector3(1, 1, 1)); im2.setMatrixAt(n, m4);
    });
    scene.add(im1, im2);
  }

  // ---- sky, sun, fog, environment ---------------------------------------------------------------
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { hor: { value: new THREE.Color() }, zen: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3(0.4, 0.5, 0.3).normalize() }, sunK: { value: 1 }, stars: { value: 0 } },
    vertexShader: 'varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 hor; uniform vec3 zen; uniform vec3 sunDir; uniform float sunK; uniform float stars; varying vec3 vD;
      float h21(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }
      void main(){ vec3 d = normalize(vD); float h = max(d.y, 0.0);
        vec3 c = mix(hor, zen, pow(h, 0.5));
        float sd = max(dot(d, sunDir), 0.0);
        c += vec3(1.0, 0.86, 0.62) * (pow(sd, 900.0) * 6.0 + pow(sd, 12.0) * 0.25) * sunK;
        if (stars > 0.0) { vec3 q = floor(d * 380.0); float s = h21(q); c += vec3(0.8, 0.85, 1.0) * step(0.9975, s) * smoothstep(0.02, 0.2, d.y) * stars * (0.5 + 0.5 * h21(q + 3.1)); }
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }));
  sky.frustumCulled = false; sky.renderOrder = -1000;
  sky.onBeforeRender = (r, s, cam) => { sky.position.copy(cam.position); sky.scale.setScalar(cam.far * 0.85); sky.updateMatrixWorld(true); };
  scene.add(sky);
  spa.sky = sky;

  const hemi = new THREE.HemisphereLight(0xbcd3f0, 0x3a4a2a, 1);
  const sun = new THREE.DirectionalLight(0xfff1dc, 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 400 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.05;
  scene.add(hemi, sun, sun.target);
  spa.hemi = hemi; spa.sun = sun;

  // environment maps for paint and glass: a daylight sky and a dark night with lamp heads
  const pm = new THREE.PMREMGenerator(renderer);
  const envDay = new THREE.Scene();
  {
    envDay.background = new THREE.Color(0x9fc0e6);
    const g = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshBasicMaterial({ color: 0x4b5a3c }));
    g.rotation.x = -Math.PI / 2; g.position.y = -3; envDay.add(g);
    const s = new THREE.Mesh(new THREE.SphereGeometry(6, 16, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff2da).multiplyScalar(30) }));
    s.position.set(60, 70, 40); envDay.add(s);
  }
  const envNight = new THREE.Scene();
  {
    envNight.background = new THREE.Color(0x03050a);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * TAU;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(6, 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff0d0).multiplyScalar(9), side: THREE.DoubleSide }));
      m.position.set(Math.cos(a) * 40, 14, Math.sin(a) * 40); m.lookAt(0, 0, 0); envNight.add(m);
    }
    const g = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshBasicMaterial({ color: 0x0b0c0e }));
    g.rotation.x = -Math.PI / 2; g.position.y = -3; envNight.add(g);
  }
  spa.envDay = pm.fromScene(envDay, 0.02, 0.1, 500).texture;
  spa.envNight = pm.fromScene(envNight, 0.02, 0.1, 500).texture;
  pm.dispose();

  spa.setNight = (on) => setNight(spa, on, night);
  spa.setNight(false);
  return spa;
}

function setNight(spa, on, night) {
  spa.night = on;
  night.value = on ? 1 : 0;
  const s = spa.scene, u = spa.sky.material.uniforms;
  if (on) {
    s.fog = new THREE.FogExp2(0x05070c, 0.0026);
    u.hor.value.set(0x0b111c); u.zen.value.set(0x010206); u.sunK.value = 0; u.stars.value = 1;
    spa.hemi.color.set(0x5f78a8); spa.hemi.groundColor.set(0x0b0d0a); spa.hemi.intensity = 0.25;
    spa.sun.color.set(0x9fb6e0); spa.sun.intensity = 0.25; // moonlight
    s.environment = spa.envNight; s.environmentIntensity = 0.6;
    spa.headMat.emissiveIntensity = 4;
    spa.garageMat.emissiveIntensity = 0.6;
    spa.boxGlass.emissiveIntensity = 0.8;
    spa.exposure = 1.05;
  } else {
    s.fog = new THREE.FogExp2(0xb4c4d4, 0.0011);
    u.hor.value.set(0xc4d6ea); u.zen.value.set(0x3f7cc4); u.sunK.value = 1; u.stars.value = 0;
    spa.hemi.color.set(0xbcd3f0); spa.hemi.groundColor.set(0x3a4a2a); spa.hemi.intensity = 0.9;
    spa.sun.color.set(0xfff1dc); spa.sun.intensity = 2.6;
    s.environment = spa.envDay; s.environmentIntensity = 0.9;
    spa.headMat.emissiveIntensity = 0;
    spa.garageMat.emissiveIntensity = 0;
    spa.boxGlass.emissiveIntensity = 0;
    spa.exposure = 0.85;
  }
  s.background = null;
  u.sunDir.value.set(0.45, 0.55, 0.35).normalize();
}

// Per frame: keep the sun's shadow box on the car.
const _o = new THREE.Vector3();
export function updateSpa(spa, dt, pos) {
  _o.copy(spa.sky.material.uniforms.sunDir.value).multiplyScalar(160);
  spa.sun.position.copy(pos).add(_o);
  spa.sun.target.position.copy(pos);
}

// Lap timing: a lap counts once the car has passed both split points and crosses the line forward.
export class LapTimer {
  constructor() {
    this.L = {};
    this.reset();
    try { this.best = +localStorage.getItem('roadster.spa.best') || null; } catch (e) { this.best = null; }
  }
  reset() { this.lastS = null; this.t = 0; this.running = false; this.splits = 0; this.last = null; this.out = true; }
  // returns an event string when a lap completes
  update(dt, pos) {
    if (!locate(pos.x, pos.z, this.L)) return null;
    const s = this.L.s, Lt = TRACK.L;
    let ev = null;
    if (this.running) this.t += dt;
    if (this.lastS != null) {
      if (this.lastS < Lt / 3 && s >= Lt / 3) this.splits |= 1;
      if (this.lastS < (2 * Lt) / 3 && s >= (2 * Lt) / 3) this.splits |= 2;
      const crossed = this.lastS > Lt - 60 && s < 60;
      if (crossed) {
        if (this.running && this.splits === 3) {
          this.last = this.t;
          ev = { type: 'lap', time: this.t, best: !this.best || this.t < this.best };
          if (ev.best) { this.best = this.t; try { localStorage.setItem('roadster.spa.best', String(this.t)); } catch (e) { /* storage blocked */ } }
        }
        this.running = true; this.out = false; this.t = 0; this.splits = 0;
      }
    }
    this.lastS = s;
    this.s = s;
    this.inPit = inPit(s) && this.L.lat > SPA.pit.wall - 1;
    return ev;
  }
}

export const fmtLap = (t) => (t == null ? '--:--.---' : `${Math.floor(t / 60)}:${(t % 60).toFixed(3).padStart(6, '0')}`);
