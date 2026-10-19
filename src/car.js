import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { WHEELS, FANS, SUSP, COM_H } from './spec.js';
import { CockpitScreen } from './screen.js';

// Low-poly model of the 2026 Roadster, built from the official launch photos and the close-look
// video: satin white faceted wedge, nose light line, headlamps under sinking triangular hood panels, hood vent,
// opening front lid over the carbon gas sphere, butterfly doors, six-spoke wheels on aero discs,
// full-width tail bar, diffuser with four cold-gas nozzles over four suction-fan bays, and the
// active wing on swan-neck struts. Inside: white buckets with lit badges, a dark alcantara dash
// with carbon trim and a red ambient strip, the squared yoke, the floating touchscreen, the
// console tray, belts and the roll hoop.
// Body frame: origin at the centre of mass, +x forward, +y up, +z to the driver's right.
// The body is a loft of cross-sections: every section has the same nine points running from the
// floor centre-line up the right flank to the roof centre-line, so each point index traces one of
// the car's straight crease lines from nose to tail and every quad is a flat facet.

const PI = Math.PI;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const ease = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
const lerp = (a, b, t) => a + (b - a) * t;

// Section point indices.
const F0 = 0; // floor, centre-line
const F1 = 1; // floor edge / inner wheel-well wall
const S = 2; // sill bottom, outer edge
const P = 3; // paint bottom (top of the sill)
const C = 4; // lower flank crease
const B = 5; // shoulder / fender crest
const G = 6; // greenhouse base (glass bottom edge), hood side crease at the front
const R = 7; // roof edge / A-pillar line; front-lid seam on the hood
const T = 8; // roof centre-line
const NP = 9;
const CREASE = 0.7; // rad: facets meeting at more than this keep a hard edge

// Key sections [x, [[y, z] for F0..T]]. Linear interpolation between keys keeps every crease straight.
const KEYS = [
  [2.14, [[-0.28, 0], [-0.28, 0.5], [-0.29, 0.64], [-0.24, 0.68], [-0.12, 0.7], [-0.04, 0.69], [-0.03, 0.675], [-0.035, 0.655], [-0.035, 0]]],
  [1.98, [[-0.32, 0], [-0.32, 0.58], [-0.33, 0.84], [-0.25, 0.88], [-0.06, 0.915], [0.07, 0.885], [0.09, 0.8], [0.065, 0.645], [0.07, 0]]],
  [1.36, [[-0.35, 0], [-0.35, 0.6], [-0.35, 0.95], [-0.27, 0.985], [0.0, 1.0], [0.275, 0.965], [0.29, 0.86], [0.255, 0.625], [0.255, 0]]],
  [1.18, [[-0.36, 0], [-0.36, 0.6], [-0.36, 0.96], [-0.27, 0.99], [0.02, 1.0], [0.285, 0.955], [0.295, 0.89], [0.29, 0.61], [0.3, 0]]],
  [0.84, [[-0.36, 0], [-0.36, 0.6], [-0.36, 0.91], [-0.255, 0.945], [0.02, 1.0], [0.265, 0.955], [0.28, 0.9], [0.4, 0.6], [0.41, 0]]],
  [0.2, [[-0.36, 0], [-0.36, 0.6], [-0.36, 0.9], [-0.21, 0.93], [0.03, 1.0], [0.33, 0.95], [0.35, 0.895], [0.585, 0.57], [0.6, 0]]],
  [-0.28, [[-0.36, 0], [-0.36, 0.6], [-0.36, 0.9], [-0.16, 0.93], [0.05, 0.995], [0.39, 0.945], [0.415, 0.875], [0.605, 0.56], [0.615, 0]]],
  [-0.65, [[-0.36, 0], [-0.36, 0.6], [-0.36, 0.9], [-0.13, 0.93], [0.06, 0.995], [0.42, 0.95], [0.46, 0.81], [0.59, 0.555], [0.6, 0]]],
  [-1.0, [[-0.36, 0], [-0.36, 0.6], [-0.36, 0.91], [-0.1, 0.94], [0.06, 1.0], [0.42, 0.965], [0.54, 0.56], [0.55, 0.54], [0.56, 0]]],
  [-1.36, [[-0.37, 0], [-0.37, 0.6], [-0.37, 0.95], [-0.1, 0.99], [0.07, 1.0], [0.39, 0.975], [0.49, 0.6], [0.5, 0.5], [0.505, 0]]],
  [-1.75, [[-0.37, 0], [-0.37, 0.6], [-0.37, 0.93], [-0.1, 0.97], [0.07, 0.98], [0.37, 0.955], [0.42, 0.64], [0.425, 0.48], [0.43, 0]]],
  [-1.84, [[-0.375, 0], [-0.375, 0.6], [-0.375, 0.79], [-0.1, 0.81], [0.07, 0.9], [0.36, 0.94], [0.41, 0.66], [0.415, 0.47], [0.42, 0]]],
  [-2.06, [[-0.38, 0], [-0.38, 0.6], [-0.38, 0.77], [-0.1, 0.79], [0.06, 0.84], [0.34, 0.87], [0.37, 0.72], [0.37, 0.45], [0.37, 0]]],
];
const NOSE_X = KEYS[0][0];
const TAIL_X = KEYS[KEYS.length - 1][0];
const WIN_FRONT = 1.18; // windshield base
const SIDE_GLASS_REAR = -1.0;
const REAR_GLASS_END = -1.75;
const DOOR_FRONT = 0.84;
const DOOR_REAR = -0.28;
const LID_FRONT = 1.98; // front lid: the hood panel between the two lamp seams
// Headlamps: on each front corner the hood facet between the lid seam (R) and the side crease (G)
// is a long triangle from the nose tip back to a short cross seam here. Lights on, the panel pivots
// on its tip and its rear edge sinks, showing the lamp bar on the back wall of the recess.
const LAMP_X = 1.72;
const LAMP_SINK = 0.045; // how far the rear edge drops (m)
const LAMP_DEPTH = 0.065; // recess depth under the panel
// Rear trunk lid over the gas sphere: the deck and rear glass behind the cabin, hinged at its rear
// edge just ahead of the wing; the front edge swings up tall.
const TRUNK_FRONT = SIDE_GLASS_REAR, TRUNK_HINGE = -1.64;
const ARCH_R = 0.4; // horizontal radius
const ARCH_RY = 0.36; // vertical radius (the fender sits tight over the tyre)
const ARCH_CY = SUSP.radius - COM_H; // wheel centre height at rest
const SILL_F = WHEELS[0].x - ARCH_R, SILL_R = WHEELS[2].x + ARCH_R;
const REAR_Z = [-0.58, -0.22, 0.22, 0.58]; // the four rear nozzles (spec.js REAR)

// Between keys each point follows a monotone cubic (Fritsch-Carlson) along x, so the creases run
// as smooth, fair curves (no overshoot past the keys) instead of straight segments with kinks.
const KX = KEYS.map((k) => -k[0]); // ascending
const SLOPES = [];
for (let k = 0; k < NP; k++) {
  for (let c = 0; c < 2; c++) {
    const y = KEYS.map((key) => key[1][k][c]);
    const n = y.length, d = [], m = new Array(n).fill(0);
    for (let i = 0; i < n - 1; i++) d.push((y[i + 1] - y[i]) / (KX[i + 1] - KX[i]));
    m[0] = d[0]; m[n - 1] = d[n - 2];
    for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
    for (let i = 0; i < n - 1; i++) {
      if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
      const a = m[i] / d[i], b = m[i + 1] / d[i], h = a * a + b * b;
      if (h > 9) { const t = 3 / Math.sqrt(h); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
    }
    SLOPES.push(m);
  }
}
function sectionAt(x) {
  const u = -x;
  let i = 0;
  while (i < KX.length - 2 && u > KX[i + 1]) i++;
  const h = KX[i + 1] - KX[i];
  const t = clamp01((u - KX[i]) / h);
  const t2 = t * t, t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
  const a = KEYS[i][1], b = KEYS[i + 1][1];
  const out = [];
  for (let k = 0; k < NP; k++) {
    const p = [0, 0];
    for (let c = 0; c < 2; c++) {
      const m = SLOPES[k * 2 + c];
      p[c] = h00 * a[k][c] + h10 * h * m[i] + h01 * b[k][c] + h11 * h * m[i + 1];
    }
    out.push(p);
  }
  return out;
}
// Height of the top surface at (x, |z|), walking the T-R-G-B creases.
function topY(x, z) {
  const s = sectionAt(x);
  const az = Math.abs(z);
  const pts = [s[T], s[R], s[G], s[B]];
  for (let i = 0; i < 3; i++) {
    const a = pts[i], b = pts[i + 1];
    if (az <= b[1] || i === 2) return lerp(a[0], b[0], clamp01((az - a[1]) / (b[1] - a[1])));
  }
  return s[T][0];
}

// Accumulates flat-shaded triangles per material.
class Mesher {
  constructor() { this.buf = {}; }
  tri(key, a, b, c) {
    const arr = this.buf[key] || (this.buf[key] = []);
    arr.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  }
  quad(key, a, b, c, d) { this.tri(key, a, b, c); this.tri(key, a, c, d); }
  // Triangle oriented so its normal faces along hint.
  triHint(key, a, b, c, hint) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * hint[0] + ny * hint[1] + nz * hint[2] >= 0) this.tri(key, a, b, c); else this.tri(key, a, c, b);
  }
  quadHint(key, a, b, c, d, hint) { this.triHint(key, a, b, c, hint); this.triHint(key, a, c, d, hint); }
  // A thin slab from four corners (in order) offset by th along -n for the underside.
  slab(top, bot, edge, q, n, th) {
    const lo = q.map((p) => [p[0] - n[0] * th, p[1] - n[1] * th, p[2] - n[2] * th]);
    this.quadHint(top, q[0], q[1], q[2], q[3], n);
    this.quadHint(bot, lo[0], lo[1], lo[2], lo[3], [-n[0], -n[1], -n[2]]);
    const cx = (q[0][0] + q[2][0]) / 2, cy = (q[0][1] + q[2][1]) / 2, cz = (q[0][2] + q[2][2]) / 2;
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      const out = [(q[i][0] + q[j][0]) / 2 - cx, (q[i][1] + q[j][1]) / 2 - cy, (q[i][2] + q[j][2]) / 2 - cz];
      this.quadHint(edge, q[i], q[j], lo[j], lo[i], out);
    }
  }
  geometry(key) {
    const arr = this.buf[key];
    if (!arr || !arr.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    // Smooth shading across the gentle bends between facets; the car's crease lines stay sharp.
    return toCreasedNormals(g, CREASE);
  }
}

// Collects transformed copies of small static parts per material and merges them into one mesh each.
const _o = new THREE.Object3D();
class Batch {
  constructor() { this.parts = {}; }
  add(key, geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, order = 'XYZ') {
    _o.position.set(x, y, z);
    _o.rotation.set(rx, ry, rz, order);
    _o.scale.set(1, 1, 1);
    _o.updateMatrix();
    return this.addM(key, geo, _o.matrix);
  }
  addM(key, geo, m) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.applyMatrix4(m);
    (this.parts[key] || (this.parts[key] = [])).push(g);
  }
  box(key, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0, order = 'XYZ') { this.add(key, new THREE.BoxGeometry(w, h, d), x, y, z, rx, ry, rz, order); }
  rbox(key, w, h, d, r, x, y, z, rx = 0, ry = 0, rz = 0, order = 'XYZ') {
    this.add(key, new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3)), x, y, z, rx, ry, rz, order);
  }
  // Box stretched between two points.
  bar(key, a, b, w, h, roll = 0) {
    const d = new THREE.Vector3().subVectors(b, a);
    _o.position.addVectors(a, b).multiplyScalar(0.5);
    _o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
    if (roll) _o.rotateY(roll);
    _o.scale.set(1, 1, 1);
    _o.updateMatrix();
    this.addM(key, new THREE.BoxGeometry(w, d.length(), h), _o.matrix);
  }
  build(parent, mats) {
    const out = [];
    for (const key of Object.keys(this.parts)) {
      const list = this.parts[key];
      const keepUv = list.every((g) => g.attributes.uv);
      for (const g of list) {
        for (const n of Object.keys(g.attributes)) if (n !== 'position' && n !== 'normal' && !(keepUv && n === 'uv')) g.deleteAttribute(n);
        g.clearGroups();
      }
      const merged = mergeGeometries(list, false);
      const mesh = new THREE.Mesh(merged, mats[key]);
      mesh.name = key;
      parent.add(mesh);
      out.push(mesh);
    }
    this.parts = {};
    return out;
  }
}

function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function plateTexture() {
  return canvasTex(256, 112, (g) => {
    g.fillStyle = '#e4e6e6';
    g.fillRect(0, 0, 256, 112);
    g.strokeStyle = '#bfc3c5';
    g.lineWidth = 6;
    g.strokeRect(6, 6, 244, 100);
    // embossed lettering: shadow then face
    g.font = 'bold 60px "Arial Narrow", Arial, Helvetica, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#9da2a6';
    g.fillText('RDSTR', 130, 60);
    g.fillStyle = '#f4f5f5';
    g.fillText('RDSTR', 127, 57);
  });
}

// Tail bar: a bright red line under a dark segmented band, broken in the middle by lit lettering.
function tailTexture() {
  return canvasTex(2048, 64, (g, w, h) => {
    g.fillStyle = '#0a0102';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#3a0406';
    for (let x = 20; x < w - 20; x += 46) g.fillRect(x, 8, 40, 12);
    const grd = g.createLinearGradient(0, 26, 0, 50);
    grd.addColorStop(0, '#5a0008');
    grd.addColorStop(0.5, '#ff2818');
    grd.addColorStop(1, '#5a0008');
    g.fillStyle = grd;
    g.fillRect(8, 26, w / 2 - 230, 24);
    g.fillRect(w / 2 + 222, 26, w / 2 - 230, 24);
    g.font = 'bold 34px Arial, Helvetica, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#ff3a26';
    g.fillText('R O A D S T E R', w / 2, 39);
  });
}

function badgeTexture() {
  return canvasTex(256, 64, (g) => {
    g.fillStyle = '#120708';
    g.fillRect(0, 0, 256, 64);
    g.font = 'italic bold 38px Arial, Helvetica, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = '#ff2020';
    g.shadowBlur = 10;
    g.fillStyle = '#ff3b30';
    g.fillText('ROADSTER', 128, 34);
  });
}

function carbonTexture(light = false) {
  const c0 = light ? '#4a4e54' : '#1c1e21', c1 = light ? '#8a8f96' : '#34373c', c2 = light ? '#6c7178' : '#2a2d31', c3 = light ? '#3c4045' : '#16171a';
  const t = canvasTex(64, 64, (g) => {
    g.fillStyle = c3;
    g.fillRect(0, 0, 64, 64);
    // 2x2 twill: offset diagonal tows
    for (let y = 0; y < 64; y += 8) {
      for (let x = 0; x < 64; x += 8) {
        const k = ((x + y) / 8) % 4;
        const hor = k < 2;
        const gr = hor ? g.createLinearGradient(x, y, x, y + 8) : g.createLinearGradient(x, y, x + 8, y);
        gr.addColorStop(0, c0);
        gr.addColorStop(0.5, hor ? c1 : c2);
        gr.addColorStop(1, c3);
        g.fillStyle = gr;
        g.fillRect(x, y, 8, 8);
      }
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 3);
  return t;
}

// Rounded rectangle path centred on the origin (for the yoke and the binnacle).
function roundRect(sh, w, h, r) {
  const x = -w / 2, y = -h / 2;
  sh.moveTo(x + r, y); sh.lineTo(x + w - r, y); sh.quadraticCurveTo(x + w, y, x + w, y + r);
  sh.lineTo(x + w, y + h - r); sh.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  sh.lineTo(x + r, y + h); sh.quadraticCurveTo(x, y + h, x, y + h - r);
  sh.lineTo(x, y + r); sh.quadraticCurveTo(x, y, x + r, y);
  return sh;
}

// Box stretched between two points (for thin trim lines and struts).
function barBetween(a, b, w, h, mat) {
  const d = new THREE.Vector3().subVectors(b, a);
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, d.length(), h), mat);
  m.position.addVectors(a, b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  return m;
}

export class RoadsterModel {
  // opts.interior === false skips the cabin and the live screen (the HUD's attitude globe).
  constructor(variant, opts = {}) {
    this.variant = variant;
    this.opts = opts;
    this.group = new THREE.Group();
    this.group.name = 'roadster';
    this.driverZ = variant.seats === 2 ? -0.33 : 0;
    // eye point for the first-person camera: in the driver's seat, behind the yoke
    this.cockpit = new THREE.Vector3(-0.34, 0.44, this.driverZ);
    this.nozzles = variant.nozzles;
    this.wheelObjs = [];
    this.fanRotors = [];
    this.nozzleFx = [];
    this.headLights = [];
    this.doorObjs = [];
    this.pods = [];
    this.s = { doors: 0, wing: 0, airbrake: 0, lights: 0, brake: 0, fans: 0, fanAngle: 0, frunk: 0, yoke: 0, cockpit: 0 };
    this._q = new THREE.Quaternion();
    this.makeMaterials();
    this.buildBody();
    this.buildTrunk();
    this.buildDetails();
    this.buildTail();
    if (opts.interior !== false) this.buildInterior(variant);
    this.buildWheels();
    this.buildWing();
    this.buildNozzles();
    this.group.traverse((o) => {
      if (o.isMesh && o.userData.shadow !== false && !o.material.transparent) o.castShadow = true;
    });
  }

  makeMaterials() {
    const carbon = carbonTexture();
    this.mat = {
      // satin silver-white paint: a metallic base under a soft clearcoat, so the flanks pick up broad
      // reflections and fall off into shade like the studio footage instead of reading flat white
      paint: new THREE.MeshPhysicalMaterial({
        color: 0xc9cbcc, metalness: 0.5, roughness: 0.34, clearcoat: 0.6, clearcoatRoughness: 0.22, envMapIntensity: 1.15,
      }),
      black: new THREE.MeshStandardMaterial({ color: 0x0c0d0f, metalness: 0.3, roughness: 0.55 }),
      gloss: new THREE.MeshPhysicalMaterial({ color: 0x08090a, metalness: 0.4, roughness: 0.18, clearcoat: 1 }),
      nose: new THREE.MeshStandardMaterial({ color: 0x060607, metalness: 0.2, roughness: 0.45, envMapIntensity: 0.25 }),
      tailPanel: new THREE.MeshStandardMaterial({ color: 0xb4b7b8, metalness: 0.1, roughness: 0.55 }),
      spoke: new THREE.MeshPhysicalMaterial({ color: 0x0b0b0c, metalness: 0.45, roughness: 0.32, clearcoat: 0.8, envMapIntensity: 0.45 }),
      liner: new THREE.MeshStandardMaterial({ color: 0x141518, roughness: 0.85, side: THREE.FrontSide }),
      glass: new THREE.MeshPhysicalMaterial({
        color: 0x17110c, metalness: 0.45, roughness: 0.04, transparent: true, opacity: 0.9,
        side: THREE.DoubleSide, envMapIntensity: 0.75, clearcoat: 1, clearcoatRoughness: 0.03, depthWrite: false,
      }),
      sill: new THREE.MeshStandardMaterial({ color: 0x9a9fa4, metalness: 0.7, roughness: 0.32 }),
      gray: new THREE.MeshStandardMaterial({ color: 0x7c8187, metalness: 0.5, roughness: 0.4 }),
      rimFace: new THREE.MeshStandardMaterial({ color: 0xc4c7ca, metalness: 0.35, roughness: 0.42 }),
      tyre: new THREE.MeshStandardMaterial({ color: 0x0f0f10, roughness: 0.9 }),
      white: new THREE.MeshStandardMaterial({ color: 0xe9e9e6, roughness: 0.78 }),
      seatGray: new THREE.MeshStandardMaterial({ color: 0xb4b6b8, roughness: 0.9 }),
      alcantara: new THREE.MeshStandardMaterial({ color: 0x2b2d30, roughness: 1 }),
      padGray: new THREE.MeshStandardMaterial({ color: 0x46494d, roughness: 0.8 }),
      trim: new THREE.MeshStandardMaterial({ color: 0x3c3f44, roughness: 0.75, metalness: 0.15 }),
      carbon: new THREE.MeshStandardMaterial({ color: 0xffffff, map: carbon, metalness: 0.35, roughness: 0.38 }),
      metal: new THREE.MeshStandardMaterial({ color: 0x3b3f45, metalness: 0.9, roughness: 0.3 }),
      silver: new THREE.MeshStandardMaterial({ color: 0xc8cbce, metalness: 0.95, roughness: 0.22 }),
      gold: new THREE.MeshStandardMaterial({ color: 0x8a6a36, metalness: 1, roughness: 0.38, side: THREE.DoubleSide }),
      copv: new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: carbonTexture(true), metalness: 0.55, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.1 }),
      darkGlass: new THREE.MeshPhysicalMaterial({ color: 0x0b0c0e, metalness: 0.2, roughness: 0.08, clearcoat: 1 }),
      drl: new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xf2f6ff, emissiveIntensity: 2.2 }),
      tail: new THREE.MeshBasicMaterial({ color: 0xffffff, map: tailTexture(), toneMapped: false }),
      red: new THREE.MeshBasicMaterial({ color: 0xc00006, toneMapped: false }),
      amber: new THREE.MeshStandardMaterial({ color: 0x331800, emissive: 0xff8a10, emissiveIntensity: 1.4 }),
      head: new THREE.MeshStandardMaterial({ color: 0x15171a, emissive: 0xeaf2ff, emissiveIntensity: 0 }),
      chrome: new THREE.MeshStandardMaterial({ color: 0xc8ccd0, metalness: 1, roughness: 0.15 }),
      recess: new THREE.MeshStandardMaterial({ color: 0x1a1c1f, metalness: 0.2, roughness: 0.6, side: THREE.DoubleSide }),
      plateLight: new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffffff, emissiveIntensity: 1.6 }),
      ambient: new THREE.MeshStandardMaterial({ color: 0x300000, emissive: 0xff1a22, emissiveIntensity: 1.8 }),
      underglow: new THREE.MeshBasicMaterial({
        color: 0x39d6ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    };
    this.mat.carbon.map.repeat.set(4, 4);
    this.mat.copv.map.repeat.set(10, 5);
  }

  // ---------------------------------------------------------------- body shell
  buildBody() {
    const m = this.group;
    // Station list: every key plus a polygonal arch at each axle. Any station inside an arch has its
    // sill points lifted to the arch line; the arch-edge stations are doubled so the arch drops
    // vertically to the sill.
    const xs = KEYS.map((k) => k[0]);
    // fill in between the keys so the curved creases are smooth
    for (let i = 0; i < KEYS.length - 1; i++) {
      const xa = KEYS[i][0], xb = KEYS[i + 1][0], n = Math.ceil((xa - xb) / 0.07);
      for (let j = 1; j < n; j++) {
        const x = xa + (xb - xa) * (j / n);
        // keep clear of the leaning door cuts and the raked nose so their skewed stations can't cross a neighbour
        if (Math.abs(x - DOOR_REAR) < 0.14 || Math.abs(x - DOOR_FRONT) < 0.08 || NOSE_X - x < 0.15) continue;
        xs.push(x);
      }
    }
    const axles = [WHEELS[0].x, WHEELS[2].x];
    for (const wx of axles) for (let i = 1; i < 18; i++) xs.push(wx + ARCH_R * Math.cos((i / 18) * PI));
    xs.push(TRUNK_HINGE, LAMP_X);
    const archY = (x) => {
      for (const wx of axles) {
        const dx = (x - wx) / ARCH_R;
        if (Math.abs(dx) < 1 - 1e-6) return ARCH_CY + ARCH_RY * Math.sqrt(1 - dx * dx);
      }
      return null;
    };
    const st = xs.map((x) => ({ x, arch: archY(x), order: 0 }));
    for (const wx of axles) {
      for (const sgn of [1, -1]) {
        const x = wx + ARCH_R * sgn;
        st.push({ x, arch: null, order: sgn > 0 ? 0 : 2 }, { x, arch: ARCH_CY, order: 1 });
      }
    }
    st.sort((a, b) => b.x - a.x || a.order - b.order);
    const stations = [];
    for (const s of st) {
      const pts = sectionAt(s.x);
      if (s.arch !== null) {
        const y = s.arch;
        pts[S] = [y, pts[F1][1]];
        pts[P] = [Math.max(pts[P][0], y), pts[P][1] + 0.01];
        if (pts[C][0] < pts[P][0] + 0.03) pts[C][0] = pts[P][0] + 0.03;
        if (pts[B][0] < pts[C][0] + 0.04) pts[B][0] = pts[C][0] + 0.04;
      }
      // door shut lines lean: the rear cut is further forward at the sill than at the roof
      let skew = null;
      if (Math.abs(s.x - DOOR_REAR) < 1e-6) skew = [0, 0, 0.12, 0.12, 0.09, 0.03, 0.02, 0, 0];
      if (Math.abs(s.x - DOOR_FRONT) < 1e-6) skew = [0, 0, -0.06, -0.06, -0.05, -0.01, 0, 0, 0];
      // the black front face rakes back from the light line to the chin
      if (Math.abs(s.x - NOSE_X) < 1e-6) skew = [-0.13, -0.13, -0.13, -0.11, -0.06, -0.012, 0, 0, 0];
      stations.push({ x: s.x, pts, arch: s.arch !== null, skew });
    }
    this.stations = stations;

    const mesh = new Mesher();
    const doorMesh = [new Mesher(), new Mesher()];
    const lidMesh = new Mesher();
    const trunkMesh = new Mesher();
    const lampMesh = [new Mesher(), new Mesher()];
    const V = (st, k, side) => [st.x + (st.skew ? st.skew[k] : 0), st.pts[k][0], st.pts[k][1] * side];
    const ST = this.stations;
    for (let si = 0; si < ST.length - 1; si++) {
      const s0 = ST[si], s1 = ST[si + 1];
      const xm = (s0.x + s1.x) / 2;
      for (let k = 0; k < NP - 1; k++) {
        let key = 'paint';
        if (k <= 1) key = 'black';
        else if (k === 2) key = 'black';
        else if (k === 3) key = xm < -1.02 ? 'black' : 'paint';
        else if (k === 6) key = xm < WIN_FRONT && xm > SIDE_GLASS_REAR ? 'glass' : 'paint';
        else if (k === 7) key = xm < WIN_FRONT && xm > REAR_GLASS_END ? 'glass' : 'paint';
        const door = k >= 3 && k <= 6 && xm < DOOR_FRONT && xm > DOOR_REAR;
        const lid = k === 7 && xm < LID_FRONT && xm > WIN_FRONT;
        const trunk = (k === 6 || k === 7) && xm < TRUNK_FRONT && xm > TRUNK_HINGE;
        const lamp = k === 6 && xm > LAMP_X;
        for (let side = 1; side >= -1; side -= 2) {
          const a = V(s0, k, side), b = V(s0, k + 1, side);
          const c = V(s1, k + 1, side), d = V(s1, k, side);
          if (lamp) {
            if (side > 0) lampMesh[0].quad(key, a, b, c, d); else lampMesh[1].quad(key, a, d, c, b);
            continue;
          }
          const target = door ? doorMesh[side > 0 ? 0 : 1] : lid ? lidMesh : trunk ? trunkMesh : mesh;
          const inner = door ? 'doorIn' : 'liner';
          if (side > 0) {
            target.tri(key, a, b, c);
            target.tri(key, a, c, d);
            if (key !== 'glass') { target.tri(inner, a, c, b); target.tri(inner, a, d, c); }
          } else {
            target.tri(key, a, c, b);
            target.tri(key, a, d, c);
            if (key !== 'glass') { target.tri(inner, a, b, c); target.tri(inner, a, c, d); }
          }
        }
      }
    }
    // End caps.
    const cap = (s, key, hint) => {
      const ring = [];
      for (let k = 0; k < NP; k++) ring.push(V(s, k, 1));
      for (let k = NP - 2; k >= 1; k--) ring.push(V(s, k, -1));
      let cy = 0;
      for (const p of ring) cy += p[1];
      cy /= ring.length;
      const c = [s.x, cy, 0];
      for (let i = 0; i < ring.length; i++) mesh.triHint(key, c, ring[i], ring[(i + 1) % ring.length], hint);
    };
    cap(ST[0], 'nose', [1, 0, 0]);
    cap(ST[ST.length - 1], 'black', [-1, 0, 0]);

    const add = (geo, mat, parent = m) => {
      if (!geo) return null;
      const o = new THREE.Mesh(geo, mat);
      parent.add(o);
      return o;
    };
    this.lampMesh = lampMesh;
    add(mesh.geometry('paint'), this.mat.paint);
    add(mesh.geometry('black'), this.mat.black);
    add(mesh.geometry('nose'), this.mat.nose);
    add(mesh.geometry('sill'), this.mat.sill);
    add(mesh.geometry('liner'), this.mat.liner);
    const glass = add(mesh.geometry('glass'), this.mat.glass);
    glass.renderOrder = 2;

    // Front lid: hinged at the windshield base, the front edge lifts.
    {
      const hy = sectionAt(WIN_FRONT)[T][0];
      const pivot = new THREE.Group();
      pivot.position.set(WIN_FRONT, hy, 0);
      const inner = new THREE.Group();
      inner.position.set(-WIN_FRONT, -hy, 0);
      pivot.add(inner);
      add(lidMesh.geometry('paint'), this.mat.paint, inner);
      add(lidMesh.geometry('liner'), this.mat.liner, inner);
      m.add(pivot);
      this.lid = { pivot, inner };
    }
    // Rear trunk lid (deck and rear glass): hinged at its rear edge, the front edge lifts.
    {
      const hy = sectionAt(TRUNK_HINGE)[T][0];
      const pivot = new THREE.Group();
      pivot.position.set(TRUNK_HINGE, hy, 0);
      const inner = new THREE.Group();
      inner.position.set(-TRUNK_HINGE, -hy, 0);
      pivot.add(inner);
      add(trunkMesh.geometry('paint'), this.mat.paint, inner);
      add(trunkMesh.geometry('liner'), this.mat.liner, inner);
      const tg = add(trunkMesh.geometry('glass'), this.mat.glass, inner);
      if (tg) tg.renderOrder = 2;
      m.add(pivot);
      this.trunk = { pivot, inner };
    }

    // Hinge at the front of the door just under the A-pillar; the axis is mostly transverse (the
    // door's rear edge swings up) and leans so the door also splays outward, as in the photos.
    const hp = sectionAt(DOOR_FRONT);
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      const hinge = new THREE.Vector3(DOOR_FRONT - 0.02, (hp[G][0] + hp[R][0]) / 2, ((hp[G][1] + hp[R][1]) / 2) * side);
      const pivot = new THREE.Group();
      pivot.position.copy(hinge);
      const axis = new THREE.Vector3(0.1, -0.28, side).normalize();
      const dm = doorMesh[i];
      const inner = new THREE.Group();
      inner.position.copy(hinge).negate();
      pivot.add(inner);
      add(dm.geometry('paint'), this.mat.paint, inner);
      add(dm.geometry('doorIn'), this.mat.liner, inner);
      const dg = add(dm.geometry('glass'), this.mat.glass, inner);
      if (dg) dg.renderOrder = 2;
      // door card: dark upper, grey mid panel, red ambient light along its top edge
      const a = sectionAt(0.62), b = sectionAt(-0.18);
      const zin = (s, k, d) => (s[k][1] - d) * side;
      const ya = a[C][0] + 0.13, yb = b[C][0] + 0.16;
      inner.add(barBetween(new THREE.Vector3(0.62, ya - 0.07, zin(a, C, 0.075)), new THREE.Vector3(-0.18, yb - 0.07, zin(b, C, 0.075)), 0.16, 0.014, this.mat.trim));
      inner.add(barBetween(new THREE.Vector3(0.55, ya, zin(a, C, 0.08)), new THREE.Vector3(-0.12, yb + 0.02, zin(b, C, 0.08)), 0.018, 0.012, this.mat.ambient));
      inner.add(barBetween(new THREE.Vector3(0.62, ya + 0.05, zin(a, C, 0.075)), new THREE.Vector3(-0.18, yb + 0.07, zin(b, C, 0.075)), 0.06, 0.014, this.mat.alcantara));
      // pull handle
      inner.add(barBetween(new THREE.Vector3(0.18, ya - 0.02, zin(a, C, 0.1)), new THREE.Vector3(0.02, yb - 0.01, zin(b, C, 0.1)), 0.02, 0.025, this.mat.silver));
      m.add(pivot);
      this.doorObjs.push({ pivot, inner, axis, sign: -side });
    }
  }

  // ---------------------------------------------------------------- rear trunk
  // Behind the seat backs, under the rear deck lid: the carbon-wrapped gas sphere (COPV) with a
  // grey girth band over its top, a cross tube in front of it and the valve block on its side.
  buildTrunk() {
    const m = this.group;
    const b = new Batch();
    // tub (inside faces only), between the cabin bulkhead and the tail
    const tub = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.62, 1.24), new THREE.MeshStandardMaterial({ color: 0x1a1b1e, roughness: 0.8, side: THREE.BackSide }));
    tub.position.set(-1.25, -0.01, 0);
    tub.userData.shadow = false;
    m.add(tub);
    const cx = -1.22, cy = 0.1, r = 0.27;
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(r, 28, 18), this.mat.copv);
    sphere.position.set(cx, cy, 0);
    m.add(sphere);
    // girth band across the top with a vent grille, and the cradle feet
    b.add('trim', new THREE.TorusGeometry(r + 0.006, 0.02, 6, 36), cx, cy, 0, 0, PI / 2, 0);
    for (let i = -2; i <= 2; i++) b.box('black', 0.012, 0.008, 0.03, cx + i * 0.02, cy + r + 0.022, 0.05);
    for (const s of [1, -1]) {
      b.bar('metal', new THREE.Vector3(cx, cy - 0.12, s * (r - 0.02)), new THREE.Vector3(cx + s * 0.0, -0.3, s * 0.3), 0.03, 0.03);
    }
    // cross tube in front of the sphere, from the driver's side across
    b.bar('metal', new THREE.Vector3(cx + r + 0.04, cy + 0.04, -0.6), new THREE.Vector3(cx + r + 0.04, cy + 0.04, 0.6), 0.035, 0.035);
    b.bar('metal', new THREE.Vector3(cx + r + 0.04, cy + 0.04, 0.42), new THREE.Vector3(cx + 0.05, cy + r + 0.05, 0.3), 0.03, 0.03);
    // valve / regulator block in a bracket on the driver's side of the sphere
    const vx = cx + 0.12, vy = cy - 0.02, vz = -(r - 0.02);
    b.rbox('gloss', 0.18, 0.06, 0.035, 0.008, vx, vy, vz - 0.01, 0, 0.6, -0.5, 'YXZ');
    b.add('trim', new THREE.CylinderGeometry(0.032, 0.032, 0.2, 14), vx, vy, vz - 0.05, 0, 0.6, PI / 2 - 0.5, 'YXZ');
    b.add('silver', new THREE.CylinderGeometry(0.035, 0.035, 0.02, 14), vx + 0.08, vy + 0.05, vz - 0.08, 0, 0.6, PI / 2 - 0.5, 'YXZ');
    b.box('silver', 0.04, 0.035, 0.04, vx - 0.08, vy - 0.05, vz - 0.03);
    b.add('metal', new THREE.CylinderGeometry(0.012, 0.012, 0.2, 8), vx - 0.06, vy - 0.1, vz + 0.05, PI / 2, 0, 0);
    b.build(m, this.mat);
  }

  // ---------------------------------------------------------------- lights, trim
  buildDetails() {
    const m = this.group;
    const ST = this.stations;
    const nose = ST[0].pts;
    const lidIn = this.lid.inner;

    // Thin full-width light line along the nose's top edge, wrapping a little down the corners.
    const drlZ = nose[B][1] - 0.02;
    const drl = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.011, drlZ * 2), this.mat.drl);
    drl.position.set(NOSE_X + 0.003, nose[T][0] - 0.008, 0);
    m.add(drl);
    for (const side of [1, -1]) {
      const a = new THREE.Vector3(NOSE_X + 0.003, nose[B][0] - 0.01, nose[B][1] * side * 0.97);
      const b = new THREE.Vector3(NOSE_X - 0.04, nose[C][0] + 0.03, nose[C][1] * side * 1.0);
      m.add(barBetween(a, b, 0.011, 0.014, this.mat.drl));
    }
    // Black front face: subtle lower opening and splitter.
    const splitter = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.022, 1.36), this.mat.black);
    splitter.position.set(NOSE_X - 0.2, -0.29, 0);
    m.add(splitter);

    // Hood vent: a dark recess with slats ahead of the windshield, on the front lid.
    {
      const mv = new Mesher();
      const x0 = 1.48, x1 = 1.21, zf = 0.4, zr = 0.54;
      const pt = (x, z) => [x, topY(x, z) + 0.004, z];
      mv.quadHint('v', pt(x0, -zf), pt(x0, zf), pt(x1, zr), pt(x1, -zr), [0, 1, 0]);
      lidIn.add(new THREE.Mesh(mv.geometry('v'), this.mat.nose));
      const vb = new Batch();
      for (let i = 1; i <= 3; i++) {
        const x = lerp(x0, x1, i / 4);
        const zz = lerp(zf, zr, i / 4) - 0.02;
        vb.bar('black', new THREE.Vector3(x, topY(x, 0) + 0.012, -zz), new THREE.Vector3(x, topY(x, zz) + 0.012, zz), 0.022, 0.006);
      }
      // raised white lip on the front edge of the vent
      vb.bar('paint', new THREE.Vector3(x0 + 0.015, topY(x0, 0) + 0.012, -zf - 0.02), new THREE.Vector3(x0 + 0.015, topY(x0, zf) + 0.012, zf + 0.02), 0.03, 0.035);
      vb.build(lidIn, this.mat);
    }
    // Lid shut lines.
    for (const side of [1, -1]) {
      const p0 = sectionAt(LID_FRONT), p1 = sectionAt(WIN_FRONT + 0.01);
      m.add(barBetween(new THREE.Vector3(LID_FRONT, p0[R][0] + 0.004, p0[R][1] * side), new THREE.Vector3(WIN_FRONT + 0.01, p1[R][0] + 0.004, p1[R][1] * side), 0.008, 0.006, this.mat.black));
    }
    {
      const p0 = sectionAt(LID_FRONT);
      m.add(barBetween(new THREE.Vector3(LID_FRONT, p0[T][0] + 0.004, -p0[R][1]), new THREE.Vector3(LID_FRONT, p0[T][0] + 0.004, p0[R][1]), 0.008, 0.006, this.mat.black));
    }

    // Headlamps (see LAMP_X): the triangular corner panel pivots on its nose tip and the rear edge
    // sinks into a dark recess, uncovering the lamp bar across the recess's back wall.
    const lampStations = ST.filter((st) => st.x >= LAMP_X - 1e-6);
    const rb = new Batch();
    for (const side of [1, -1]) {
      const vec = (p) => new THREE.Vector3(p[0], p[1], p[2]);
      const edge = (k) => lampStations.map((st) => new THREE.Vector3(st.x, st.pts[k][0], st.pts[k][1] * side));
      const rIn = edge(R), gOut = edge(G); // front to rear
      const tip = rIn[0].clone().lerp(gOut[0], 0.5);
      const rR = rIn[rIn.length - 1], gR = gOut[gOut.length - 1];
      const rearMid = rR.clone().lerp(gR, 0.5);
      const len = tip.distanceTo(rearMid);
      const n = new THREE.Vector3().crossVectors(gR.clone().sub(tip), rR.clone().sub(tip)).normalize();
      if (n.y < 0) n.negate();
      const along = rearMid.clone().sub(tip).normalize();
      const axis = new THREE.Vector3().crossVectors(along, n).normalize();

      // the panel, with dark shut lines along its three edges
      const pivot = new THREE.Group();
      pivot.position.copy(tip);
      const inner = new THREE.Group();
      inner.position.copy(tip).negate();
      pivot.add(inner);
      const pm = this.lampMesh[side > 0 ? 0 : 1];
      inner.add(new THREE.Mesh(pm.geometry('paint'), this.mat.paint));
      const up = n.clone().multiplyScalar(0.003);
      for (const line of [rIn, gOut]) {
        for (let i = 0; i < line.length - 1; i++) {
          if (line[i].distanceTo(line[i + 1]) < 1e-4) continue;
          inner.add(barBetween(line[i].clone().add(up), line[i + 1].clone().add(up), 0.006, 0.004, this.mat.black));
        }
      }
      inner.add(barBetween(rR.clone().add(up), gR.clone().add(up), 0.006, 0.004, this.mat.black));
      m.add(pivot);
      this.pods.push({ pivot, axis, angle: LAMP_SINK / len });

      // recess: walls hanging below each edge and a floor, all dark
      const mr = new Mesher();
      const down = (v) => [v.x, v.y - LAMP_DEPTH, v.z];
      const P3 = (v) => [v.x, v.y, v.z];
      for (let i = 0; i < rIn.length - 1; i++) {
        mr.quadHint('w', P3(rIn[i]), P3(rIn[i + 1]), down(rIn[i + 1]), down(rIn[i]), [0, 0, side]);
        mr.quadHint('w', P3(gOut[i]), P3(gOut[i + 1]), down(gOut[i + 1]), down(gOut[i]), [0, 0, -side]);
        mr.quadHint('w', down(rIn[i]), down(rIn[i + 1]), down(gOut[i + 1]), down(gOut[i]), [0, 1, 0]);
      }
      mr.quadHint('w', P3(rR), P3(gR), down(gR), down(rR), [1, 0, 0]);
      const rec = new THREE.Mesh(mr.geometry('w'), this.mat.recess);
      rec.userData.shadow = false;
      m.add(rec);

      // lamp bar on the back wall: a slim chrome bezel over a bright lens strip, following the cross seam
      const off = (v, dy, dx) => [v.x + dx, v.y + dy, v.z - side * 0.006];
      const offO = (v, dy, dx) => [v.x + dx, v.y + dy, v.z + side * 0.004];
      const ml = new Mesher();
      ml.quadHint('l', off(rR, -0.016, 0.004), offO(gR, -0.016, 0.004), offO(gR, -0.034, 0.004), off(rR, -0.034, 0.004), [1, 0, 0]);
      ml.quadHint('c', off(rR, -0.008, 0.005), offO(gR, -0.008, 0.005), offO(gR, -0.015, 0.005), off(rR, -0.015, 0.005), [1, 0, 0]);
      m.add(new THREE.Mesh(ml.geometry('l'), this.mat.head), new THREE.Mesh(ml.geometry('c'), this.mat.chrome));
      // a light reflector behind the lens, so the glow reads through the gap from the side as well
      rb.bar('head', rR.clone().add(new THREE.Vector3(0.012, -0.04, -side * 0.01)), gR.clone().add(new THREE.Vector3(0.012, -0.04, side * 0.006)), 0.006, 0.01);

      const spot = new THREE.SpotLight(0xeef4ff, 0, 90, 0.42, 0.55, 1.1);
      spot.castShadow = false;
      spot.position.set(rearMid.x + 0.02, rearMid.y - 0.025, rearMid.z);
      spot.target.position.set(rearMid.x + 25, -0.6, 0.9 * side);
      m.add(spot, spot.target);
      this.headLights.push(spot);
    }
    rb.build(m, this.mat);

    // Behind the front wheel: the amber marker in a dark slot at the top of the door seam, and the
    // vertical air-outlet gap between the arch and the door.
    const db = new Batch();
    for (const side of [1, -1]) {
      const onFlank = (x, f, out = 0.004) => {
        const s = sectionAt(x);
        return new THREE.Vector3(x, lerp(s[C][0], s[B][0], f), (lerp(s[C][1], s[B][1], f) + out) * side);
      };
      db.bar('gloss', onFlank(0.99, 0.8), onFlank(0.83, 0.82), 0.032, 0.01);
      db.bar('amber', onFlank(0.88, 0.82, 0.008), onFlank(0.84, 0.83, 0.008), 0.016, 0.01);
      // outlet gap: from the slot down to the sill, leaning like the door cut
      const s0 = sectionAt(0.96), s1 = sectionAt(0.99);
      db.bar('black', new THREE.Vector3(0.955, lerp(s0[C][0], s0[B][0], 0.75), (lerp(s0[C][1], s0[B][1], 0.75) + 0.004) * side),
        new THREE.Vector3(0.985, s1[P][0] + 0.03, (s1[P][1] + 0.006) * side), 0.014, 0.008);
      db.bar('black', new THREE.Vector3(0.985, s1[P][0] + 0.03, (s1[P][1] + 0.006) * side), new THREE.Vector3(0.985, s1[C][0], (s1[C][1] + 0.005) * side), 0.014, 0.008);
      // Track Mode aero flap: the flank panel between the front arch and the door, hinged on its
      // front edge; with the wing up its rear edge swings out, opening a dark outlet behind it.
      {
        const xa = 0.952, xb = 0.858, fTop = 0.7;
        const pt = (x, f, out) => {
          const sc = sectionAt(x);
          const y = f < 0 ? sc[P][0] + 0.025 : lerp(sc[C][0], sc[B][0], f);
          const z = f < 0 ? sc[P][1] : lerp(sc[C][1], sc[B][1], f);
          return [x, y, (z + out) * side];
        };
        const corners = [pt(xa, fTop, 0.007), pt(xb, fTop, 0.007), pt(xb, 0, 0.007), pt(xb, -1, 0.007), pt(xa, -1, 0.007), pt(xa, 0, 0.007)];
        const hinge = new THREE.Vector3(...corners[0]).add(new THREE.Vector3(...corners[4])).multiplyScalar(0.5);
        const fm = new Mesher(), rm = new Mesher();
        const n = [0, 0, side];
        const cen = [0, 1, 2, 3, 4, 5].reduce((a, i) => [a[0] + corners[i][0] / 6, a[1] + corners[i][1] / 6, a[2] + corners[i][2] / 6], [0, 0, 0]);
        for (let i = 0; i < 6; i++) {
          const a = corners[i], b = corners[(i + 1) % 6];
          fm.triHint('paint', cen, a, b, n);
          const ai = [a[0], a[1], a[2] - 0.012 * side], bi = [b[0], b[1], b[2] - 0.012 * side], ci = [cen[0], cen[1], cen[2] - 0.012 * side];
          fm.triHint('black', ci, ai, bi, [0, 0, -side]);
          fm.quadHint('black', a, b, bi, ai, [a[0] + b[0] - 2 * cen[0], a[1] + b[1] - 2 * cen[1], 0]);
          // the outlet behind the flap: a dark recess just inside the skin
          const ar = [a[0], a[1], a[2] - 0.02 * side], br = [b[0], b[1], b[2] - 0.02 * side], cr = [cen[0], cen[1], cen[2] - 0.02 * side];
          rm.triHint('black', cr, ar, br, n);
        }
        const pivot = new THREE.Group();
        pivot.position.copy(hinge);
        const inner = new THREE.Group();
        inner.position.copy(hinge).negate();
        pivot.add(inner);
        inner.add(new THREE.Mesh(fm.geometry('paint'), this.mat.paint), new THREE.Mesh(fm.geometry('black'), this.mat.black));
        const recess = new THREE.Mesh(rm.geometry('black'), this.mat.recess);
        recess.visible = false;
        this.group.add(pivot, recess);
        const axis = new THREE.Vector3(...corners[0]).sub(new THREE.Vector3(...corners[4])).normalize();
        (this.flaps || (this.flaps = [])).push({ pivot, axis, sign: side, recess });
      }
      // silver sill blade between the wheels
      const sf = sectionAt(SILL_F - 0.03), sr = sectionAt(SILL_R + 0.03);
      db.bar('sill', new THREE.Vector3(SILL_F - 0.03, sf[S][0] + 0.03, (sf[S][1] + 0.02) * side), new THREE.Vector3(SILL_R + 0.03, sr[S][0] + 0.06, (sr[S][1] + 0.02) * side), 0.035, 0.03);
      // small red reflector near the tail
      const s2 = sectionAt(-1.95);
      db.bar('red', new THREE.Vector3(-1.9, s2[C][0] + 0.02, (s2[C][1] + 0.004) * side),
        new THREE.Vector3(-2.0, s2[C][0] + 0.02, (sectionAt(-2.0)[C][1] + 0.004) * side), 0.02, 0.01);
    }
    db.build(m, this.mat);

    // Thin dark pillar lines over the glass (the parts on a door move with it).
    const stAt = (x) => this.stations.find((q) => Math.abs(q.x - x) < 1e-6 && !q.arch) || { x, pts: sectionAt(x), skew: null };
    const pt = (st, k, side, out = 1.006, dy = 0.004) =>
      new THREE.Vector3(st.x + (st.skew ? st.skew[k] : 0), st.pts[k][0] + dy, st.pts[k][1] * side * out);
    const lb = new Batch();
    const line = (pts, w, parentFor) => {
      for (let i = 0; i < pts.length - 1; i++) {
        const xm = (pts[i].x + pts[i + 1].x) / 2;
        if (parentFor && parentFor(xm) !== m) parentFor(xm).add(barBetween(pts[i], pts[i + 1], w, w * 0.6, this.mat.black));
        else lb.bar('black', pts[i], pts[i + 1], w, w * 0.6);
      }
    };
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      const door = this.doorObjs[i].inner;
      const onDoor = (xm) => (xm < DOOR_FRONT && xm > DOOR_REAR ? door : xm < TRUNK_FRONT && xm > TRUNK_HINGE ? this.trunk.inner : m);
      const xsR = [WIN_FRONT, DOOR_FRONT, 0.2, DOOR_REAR, -0.65, -1.0, -1.36, TRUNK_HINGE, REAR_GLASS_END];
      // trunk lid shut line along the G crease
      line([TRUNK_FRONT, -1.36, TRUNK_HINGE].map((x) => pt(stAt(x), G, side, 1.004)), 0.009);
      line(xsR.map((x) => pt(stAt(x), R, side)), 0.014, onDoor);
      line([WIN_FRONT, DOOR_FRONT, 0.2, DOOR_REAR, -0.65, SIDE_GLASS_REAR].map((x) => pt(stAt(x), G, side)), 0.012, onDoor);
      // door shut lines
      for (const x of [DOOR_FRONT, DOOR_REAR]) {
        const st = stAt(x);
        line([P, C, B, G, R].map((k) => pt(st, k, side, 1.004, 0)), 0.008);
      }
    }
    // windshield header bar
    {
      const s = sectionAt(WIN_FRONT);
      for (const z of [1, -1]) line([new THREE.Vector3(WIN_FRONT, s[T][0] + 0.004, 0), new THREE.Vector3(WIN_FRONT, s[R][0] + 0.004, s[R][1] * z), new THREE.Vector3(WIN_FRONT, s[G][0] + 0.004, s[G][1] * z)], 0.02);
    }
    lb.build(m, this.mat);

    // underglow (suction fans)
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(3.8, 1.9), this.mat.underglow);
    glow.rotation.x = -PI / 2;
    glow.position.set(-0.1, -0.47, 0);
    glow.renderOrder = 3;
    glow.userData.shadow = false;
    m.add(glow);
  }

  // ---------------------------------------------------------------- tail
  // Top to bottom: tail bar with lettering, a white band, the light panel with the plate and its
  // lamps, then the black lower face carrying the carbon diffuser: four round cold-gas nozzles in
  // a row over four suction-fan bays.
  buildTail() {
    const m = this.group;
    const tx = TAIL_X;
    const tail = this.stations[this.stations.length - 1].pts;
    const tw = tail[B][1];
    const b = new Batch();
    // tail bar
    const bar = new THREE.Mesh(new THREE.PlaneGeometry(tw * 2 - 0.08, 0.05), this.mat.tail);
    bar.position.set(tx - 0.007, 0.325, 0);
    bar.rotation.y = -PI / 2;
    m.add(bar);
    this.tailBar = bar;
    b.box('gloss', 0.03, 0.03, tw * 2 + 0.01, tx - 0.012, tail[T][0] - 0.01, 0);
    // white band and the plate panel
    b.box('paint', 0.03, 0.035, tw * 2 - 0.04, tx - 0.008, 0.268, 0);
    b.box('tailPanel', 0.02, 0.22, tw * 2 - 0.16, tx - 0.004, 0.13, 0);
    b.box('black', 0.024, 0.012, tw * 2 - 0.16, tx - 0.006, 0.245, 0);
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.33, 0.145),
      new THREE.MeshStandardMaterial({ map: plateTexture(), roughness: 0.55, metalness: 0.05, emissive: 0xffffff, emissiveIntensity: 0.12 }));
    plate.material.emissiveMap = plate.material.map;
    plate.position.set(tx - 0.03, 0.1, 0);
    plate.rotation.y = -PI / 2;
    m.add(plate);
    b.box('black', 0.012, 0.16, 0.345, tx - 0.022, 0.1, 0);
    for (const z of [-0.07, 0.07]) b.box('plateLight', 0.02, 0.008, 0.04, tx - 0.02, 0.192, z);
    const plateGlow = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.12), new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    plateGlow.position.set(tx - 0.035, 0.14, 0);
    plateGlow.rotation.y = -PI / 2;
    plateGlow.userData.shadow = false;
    m.add(plateGlow);

    // diffuser: carbon frame protruding from the black lower face
    const dx = tx - 0.06; // frame mid-depth
    b.box('carbon', 0.14, 0.022, 1.56, dx, -0.04, 0);
    b.box('carbon', 0.14, 0.02, 1.5, dx, -0.195, 0);
    b.box('carbon', 0.2, 0.03, 1.66, dx + 0.02, -0.385, 0);
    for (const z of [-0.79, 0.79]) b.box('carbon', 0.14, 0.36, 0.03, dx, -0.21, z);
    for (const z of [-0.4, 0, 0.4]) b.box('carbon', 0.16, 0.18, 0.012, dx, -0.29, z);
    // nozzle tubes: silver lips, gold inside
    const tube = new THREE.CylinderGeometry(0.05, 0.05, 0.1, 20, 1, true);
    const liner = new THREE.CylinderGeometry(0.044, 0.044, 0.1, 20, 1, true);
    const lip = new THREE.TorusGeometry(0.046, 0.007, 6, 20);
    const disc = new THREE.CircleGeometry(0.044, 20);
    for (const z of REAR_Z) {
      b.add('metal', tube, tx - 0.04, -0.12, z, 0, 0, PI / 2);
      b.add('gold', liner, tx - 0.04, -0.12, z, 0, 0, PI / 2);
      b.add('silver', lip, tx - 0.09, -0.12, z, 0, PI / 2, 0);
      b.add('gold', disc, tx - 0.01, -0.12, z, 0, -PI / 2, 0);
    }
    // small round openings between the nozzles
    for (const z of [-0.4, 0, 0.4]) {
      b.add('gloss', new THREE.CircleGeometry(0.026, 14), tx - 0.012, -0.12, z, 0, -PI / 2, 0);
      b.add('trim', new THREE.TorusGeometry(0.027, 0.004, 4, 14), tx - 0.013, -0.12, z, 0, PI / 2, 0);
    }
    b.build(m, this.mat);
    // fan rotors in the bays: hub and swept blades
    const rot = new Mesher();
    const nb = 9;
    for (let i = 0; i < nb; i++) {
      const a0 = (i / nb) * PI * 2;
      const pts = [];
      for (let j = 0; j <= 4; j++) {
        const r = lerp(0.025, 0.074, j / 4);
        const a = a0 + 0.9 * (j / 4) * (j / 4);
        pts.push([r, a]);
      }
      for (let j = 0; j < 4; j++) {
        const [r0, a0_] = pts[j], [r1, a1] = pts[j + 1];
        const w0 = 0.22 * (1 - j / 6), w1 = 0.22 * (1 - (j + 1) / 6);
        const P0 = [0.012, r0 * Math.cos(a0_), r0 * Math.sin(a0_)], P1 = [0.012, r1 * Math.cos(a1), r1 * Math.sin(a1)];
        const Q0 = [-0.012, r0 * Math.cos(a0_ + w0), r0 * Math.sin(a0_ + w0)], Q1 = [-0.012, r1 * Math.cos(a1 + w1), r1 * Math.sin(a1 + w1)];
        rot.quadHint('r', P0, P1, Q1, Q0, [-1, 0, 0]);
        rot.quadHint('r', P0, P1, Q1, Q0, [1, 0, 0]);
      }
    }
    const rotorGeo = rot.geometry('r');
    const hubGeo = new THREE.CylinderGeometry(0.028, 0.03, 0.03, 12);
    hubGeo.rotateZ(PI / 2);
    const ringGeo = new THREE.TorusGeometry(0.08, 0.005, 4, 24);
    ringGeo.rotateY(PI / 2);
    for (const f of FANS) {
      const g = new THREE.Group();
      g.position.set(tx - 0.035, -0.29, f.z);
      const ring = new THREE.Mesh(ringGeo, this.mat.trim);
      ring.position.x = -0.03;
      const rotor = new THREE.Group();
      rotor.add(new THREE.Mesh(rotorGeo, this.mat.metal), new THREE.Mesh(hubGeo, this.mat.gloss));
      g.add(ring, rotor);
      m.add(g);
      this.fanRotors.push(rotor);
    }
  }

  // ---------------------------------------------------------------- cabin
  buildInterior(variant) {
    const m = this.group;
    const b = new Batch();
    const two = variant.seats === 2;
    const z0 = this.driverZ;
    const seatZ = two ? [-0.33, 0.33] : [0];
    const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

    // tub: floor, bulkheads, carbon sills inside the door openings
    b.box('liner', 2.0, 0.02, 1.7, 0.0, -0.33, 0);
    b.box('liner', 0.08, 0.5, 1.7, 0.98, -0.07, 0);
    b.box('alcantara', 0.06, 0.62, 1.7, -0.84, 0.03, 0);
    for (const s of [1, -1]) b.box('carbon', 1.1, 0.16, 0.06, 0.25, -0.24, s * 0.86);

    // dash: alcantara top sloping up to the windshield, carbon fascia, knee panel
    b.rbox('alcantara', 0.6, 0.09, 1.78, 0.03, 0.86, 0.18, 0, 0, 0, 0.12);
    b.box('carbon', 0.05, 0.08, 1.74, 0.575, 0.13, 0, 0, 0, 0.1);
    b.rbox('alcantara', 0.32, 0.32, 1.72, 0.04, 0.82, -0.06, 0, 0, 0, -0.25);
    b.box('trim', 0.012, 0.012, 1.7, 0.555, 0.172, 0);
    // red ambient strip on the passenger side of the dash fascia
    b.box('ambient', 0.012, 0.012, 0.7, 0.548, 0.1, 0.45);
    // dark oval binnacle / vent housing behind the yoke, silver bezel set into the dash
    {
      const ring = roundRect(new THREE.Shape(), 0.44, 0.13, 0.065);
      ring.holes.push(roundRect(new THREE.Path(), 0.41, 0.1, 0.05));
      const bez = new THREE.ExtrudeGeometry(ring, { depth: 0.03, bevelEnabled: false, curveSegments: 8 });
      bez.rotateY(PI / 2);
      b.add('silver', bez, 0.55, 0.14, z0, 0, 0, -0.15);
      const hole = new THREE.ExtrudeGeometry(roundRect(new THREE.Shape(), 0.41, 0.1, 0.05), { depth: 0.08, bevelEnabled: false, curveSegments: 8 });
      hole.rotateY(PI / 2);
      b.add('gloss', hole, 0.565, 0.14, z0, 0, 0, -0.15);
      for (let i = 0; i < 3; i++) b.box('trim', 0.008, 0.006, 0.38, 0.566, 0.116 + i * 0.024, z0, 0, 0, -0.15);
    }
    // yoke column
    b.add('gloss', new THREE.CylinderGeometry(0.035, 0.042, 0.2, 14), 0.45, 0.1, z0, 0, 0, PI / 2 - 0.25);
    b.add('silver', new THREE.CylinderGeometry(0.04, 0.04, 0.015, 14), 0.37, 0.12, z0, 0, 0, PI / 2 - 0.25);
    // pedals
    b.rbox('silver', 0.012, 0.11, 0.09, 0.004, 0.9, -0.2, z0 - 0.04, 0, 0, 0.5);
    b.rbox('silver', 0.012, 0.13, 0.05, 0.004, 0.92, -0.2, z0 + 0.1, 0, 0, 0.5);
    b.rbox('silver', 0.012, 0.12, 0.07, 0.004, 0.88, -0.22, z0 - 0.2, 0, 0, 0.7);
    for (const dz of [-0.06, -0.04, -0.02]) b.box('black', 0.014, 0.1, 0.004, 0.902, -0.2, z0 + dz + 0.02, 0, 0, 0.5);

    // seats: one-piece white buckets, reclined
    const badge = badgeTexture();
    const badgeMat = new THREE.MeshBasicMaterial({ map: badge, toneMapped: false });
    const rec = 0.4; // recline from vertical
    const up = V3(-Math.sin(rec), Math.cos(rec), 0), fw = V3(Math.cos(rec), Math.sin(rec), 0);
    for (const z of seatZ) {
      const out = two ? Math.sign(z) : 1;
      const base = V3(-0.36, -0.27, z);
      const sp = (u, f, dz = 0) => base.clone().addScaledVector(up, u).addScaledVector(fw, f).setZ(z + dz);
      b.box('black', 0.5, 0.05, 0.42, -0.15, -0.31, z);
      b.rbox('white', 0.46, 0.075, 0.36, 0.03, -0.13, -0.255, z, 0, 0, 0.1);
      for (const s of [1, -1]) b.rbox('white', 0.44, 0.1, 0.075, 0.035, -0.14, -0.215, z + s * 0.2, 0, 0, 0.1);
      b.rbox('seatGray', 0.36, 0.012, 0.22, 0.005, -0.1, -0.214, z, 0, 0, 0.1);
      // backrest, side wings and the grey centre insert
      let c = sp(0.36, 0);
      b.rbox('white', 0.08, 0.74, 0.36, 0.035, c.x, c.y, z, 0, 0, rec);
      for (const s of [1, -1]) {
        c = sp(0.33, 0.045);
        b.rbox('white', 0.13, 0.66, 0.08, 0.035, c.x, c.y, z + s * 0.2, 0, 0, rec);
      }
      c = sp(0.3, 0.042);
      b.rbox('seatGray', 0.012, 0.44, 0.2, 0.005, c.x, c.y, z, 0, 0, rec);
      // head slot near the top
      c = sp(0.64, 0.042);
      b.rbox('trim', 0.012, 0.05, 0.12, 0.01, c.x, c.y, z, 0, 0, rec);
      // lit badge on the outboard wing at shoulder height
      c = sp(0.5, 0.05, out * 0.242);
      const bd = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.025), badgeMat);
      bd.position.copy(c);
      bd.rotation.set(0, out > 0 ? 0 : PI, out > 0 ? rec : -rec);
      bd.userData.shadow = false;
      m.add(bd);
      b.box('black', 0.13, 0.04, 0.004, c.x, c.y, c.z - out * 0.001, 0, 0, rec);
      // belts: shoulder strap across the chest to the inboard buckle, lap belt
      const sh = sp(0.7, 0.03, out * 0.12);
      const buckle = V3(-0.2, -0.17, z - out * 0.2);
      const hip = V3(-0.27, -0.18, z + out * 0.21);
      b.bar('trim', sh, sp(0.25, 0.14, 0.0), 0.048, 0.004);
      b.bar('trim', sp(0.25, 0.14, 0.0), buckle, 0.048, 0.004);
      b.bar('trim', hip, buckle, 0.048, 0.004);
      b.box('silver', 0.05, 0.03, 0.02, buckle.x, buckle.y + 0.01, buckle.z);
    }

    // centre console: white padded armrest, carbon front section, dark glass tray with red light
    if (two) {
      b.rbox('white', 0.62, 0.16, 0.2, 0.05, -0.2, -0.16, 0);
      b.rbox('carbon', 0.5, 0.16, 0.2, 0.02, 0.32, -0.21, 0, 0, 0, 0.2);
      b.rbox('darkGlass', 0.3, 0.02, 0.15, 0.01, 0.38, -0.105, 0, 0, 0, 0.32);
      for (const s of [1, -1]) b.box('ambient', 0.24, 0.006, 0.006, 0.38, -0.093, s * 0.07, 0, 0, 0.32);
    } else {
      // single seat: a narrow carbon tunnel along the right with the tray
      b.rbox('carbon', 0.8, 0.14, 0.14, 0.02, 0.1, -0.24, 0.42);
      b.rbox('darkGlass', 0.26, 0.02, 0.12, 0.01, 0.32, -0.15, 0.42, 0, 0, 0.3);
      b.box('ambient', 0.22, 0.006, 0.006, 0.32, -0.138, 0.36, 0, 0, 0.3);
    }

    // roll hoop behind the seats and the roof side rails; the glass roof between them is clear
    const hx = -0.78;
    const hs = sectionAt(hx);
    for (const s of [1, -1]) {
      const foot = V3(hx, -0.3, s * 0.8), knee = V3(hx, hs[G][0] - 0.03, s * (hs[G][1] - 0.06));
      const top = V3(hx, hs[R][0] - 0.04, s * (hs[R][1] - 0.05));
      b.bar('trim', foot, knee, 0.075, 0.06);
      b.bar('trim', knee, top, 0.075, 0.06);
      // side rail along the roof edge up to the A-pillar
      const xs = [hx, -0.28, 0.2, DOOR_FRONT];
      for (let i = 0; i < xs.length - 1; i++) {
        const a = sectionAt(xs[i]), c = sectionAt(xs[i + 1]);
        b.bar('trim', V3(xs[i], a[R][0] - 0.04, s * (a[R][1] - 0.05)), V3(xs[i + 1], c[R][0] - 0.04, s * (c[R][1] - 0.05)), 0.07, 0.05);
      }
    }
    b.bar('trim', V3(hx, hs[R][0] - 0.04, -(hs[R][1] - 0.05)), V3(hx, hs[R][0] - 0.04, hs[R][1] - 0.05), 0.075, 0.06);
    b.build(m, this.mat);

    // yoke, after the closer-look video: a dark grey body shaped like a sideways figure 8 (two loops
    // joined through the middle), whose grips flare outward at the top and bottom corners. Only the
    // outer grips are wrapped in white; the bars through the middle stay grey. A horizontal grey
    // crossbar carrying the button clusters joins the two grips straight through the centre, and the
    // large pillowed pad sits on it.
    const yokeMount = new THREE.Group();
    yokeMount.position.set(0.32, 0.125, z0);
    yokeMount.rotation.z = -0.2; // top leans forward, column runs forward and down
    const yoke = new THREE.Group();
    yokeMount.add(yoke);
    {
      const yb = new Batch();
      const depth = 0.066;
      const ext = (shape, d, bevel) => {
        const g = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 12 });
        g.translate(0, 0, -d / 2);
        g.rotateY(PI / 2);
        return g;
      };
      // one lobe's outline: from the middle bar's top, up into the flared ear, down the inward-curving
      // outer grip, round the bottom ear and back to the bar's bottom (sx = side). Inset by t for the
      // opening, which then closes along x0 at the pad.
      const OUT = { H: 0.25, Hw: 0.172, x1: 0.06, x2: 0.166, rO: 0.042, fl: 0.014 };
      const lobe = (sx, t, x0) => {
        const X = (x) => x * sx;
        const H = OUT.H - 2 * t, Hw = OUT.Hw - 2 * t, x2 = OUT.x2 - t * 1.6, rO = Math.max(0.012, OUT.rO - t), fl = OUT.fl;
        const P = new THREE.Path();
        P.moveTo(X(x0), Hw / 2);
        P.quadraticCurveTo(X(OUT.x1 + 0.03), Hw / 2, X(x2 - rO), H / 2);       // bar rises into the ear
        P.quadraticCurveTo(X(x2 + fl), H / 2, X(x2 + fl * 0.6), H / 2 - rO);   // flared top corner
        P.quadraticCurveTo(X(x2 - 0.016), 0, X(x2 + fl * 0.6), -H / 2 + rO);   // outer edge curves in
        P.quadraticCurveTo(X(x2 + fl), -H / 2, X(x2 - rO), -H / 2);            // flared bottom corner
        P.quadraticCurveTo(X(OUT.x1 + 0.03), -Hw / 2, X(x0), -Hw / 2);
        return P.getPoints(14);
      };
      const T = 0.017, HX0 = 0.062; // rim thickness, inner edge of each opening (beside the pad)
      // dark grey body: right lobe top to bottom, then the left lobe bottom to top
      const body = new THREE.Shape([...lobe(1, 0, 0), ...lobe(-1, 0, 0).reverse()]);
      for (const sx of [1, -1]) body.holes.push(new THREE.Path(lobe(sx, T, sx * 0 + HX0)));
      yb.add('trim', ext(body, depth - 0.006, 0.003));
      // white wrap on the outer grips only, from ear to ear, stopping just short of each opening
      const hx1 = OUT.x2 - 0.038;
      for (const sx of [1, -1]) {
        const xcut = 0.112;
        const outer = lobe(sx, -0.0015, 0).filter((v) => Math.abs(v.x) >= xcut);
        const inner = lobe(sx, T - 0.003, HX0).filter((v) => Math.abs(v.x) >= xcut).reverse();
        yb.add('white', ext(new THREE.Shape([...outer, ...inner]), depth + 0.002, 0.003));
      }
      // horizontal crossbar through the middle, grip to grip, carrying the button clusters
      yb.rbox('alcantara', 0.03, 0.046, 2 * hx1 + 0.01, 0.012, -0.008, -0.006, 0);
      // large pillowed centre pad on the crossbar, slightly proud toward the driver
      const pw = 0.12, ph = 0.16;
      yb.rbox('padGray', 0.045, ph, pw, 0.03, -0.03, 0, 0);
      yb.rbox('padGray', 0.02, ph - 0.03, pw - 0.03, 0.014, -0.05, 0, 0);
      for (const s of [1, -1]) {
        const zc = (pw / 2 + hx1) / 2;
        yb.rbox('gloss', 0.008, 0.034, 0.05, 0.006, -0.026, -0.004, s * zc);
        for (const dz of [-0.013, 0, 0.013]) yb.box('black', 0.006, 0.009, 0.009, -0.031, 0.005, s * (zc + dz));
        yb.box('black', 0.006, 0.008, 0.026, -0.031, -0.012, s * zc);
        yb.add('silver', new THREE.CylinderGeometry(0.007, 0.007, 0.005, 10), -0.032, 0.0, s * (zc + 0.03), 0, 0, PI / 2);
      }
      yb.build(yoke, this.mat);
    }
    m.add(yokeMount);
    this.yoke = yoke;

    // floating touchscreen to the right of the yoke, turned towards the driver
    this.screen = new CockpitScreen();
    const sw = 0.4, sh = 0.225;
    const scr = new THREE.Group();
    scr.position.set(0.5, 0.27, z0 + 0.42);
    const eye = this.cockpit.clone();
    scr.lookAt(eye);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), new THREE.MeshBasicMaterial({ map: this.screen.texture, toneMapped: false }));
    face.userData.shadow = false;
    const bezel = new THREE.Mesh(new RoundedBoxGeometry(sw + 0.016, sh + 0.016, 0.012, 2, 0.005), this.mat.gloss);
    bezel.position.z = -0.0065;
    scr.add(face, bezel);
    m.add(scr);
    // stalk down to the dash
    m.add(barBetween(new THREE.Vector3(0.52, 0.27, z0 + 0.42), new THREE.Vector3(0.66, 0.2, z0 + 0.42), 0.05, 0.03, this.mat.alcantara));
    this.screenObj = scr;
  }

  // ---------------------------------------------------------------- wheels
  buildWheels() {
    const r = SUSP.radius;
    const rim = 0.265;
    const w = 0.28;
    const tp = [
      [rim, -w / 2], [r - 0.03, -w / 2 - 0.004], [r, -w / 2 + 0.03], [r, w / 2 - 0.03], [r - 0.03, w / 2 + 0.004], [rim, w / 2],
    ].map((p) => new THREE.Vector2(p[0], p[1]));
    const tyreGeo = new THREE.LatheGeometry(tp, 30);
    tyreGeo.rotateX(PI / 2); // axis along z
    const lipGeo = new THREE.RingGeometry(rim - 0.02, rim + 0.003, 30);
    const faceGeo = new THREE.CircleGeometry(rim - 0.012, 30);
    const barrelGeo = new THREE.CylinderGeometry(rim - 0.01, rim - 0.01, w * 0.9, 30, 1, true);
    barrelGeo.rotateX(PI / 2);
    // six straight blade spokes standing proud of the light aero disc, merged into one geometry
    const spokesGeo = (() => {
      const g = new Mesher();
      const r0 = 0.05, r1 = rim - 0.016, h0 = 0.05, h1 = 0.03, z0 = 0.0, z1 = 0.05;
      for (let k = 0; k < 6; k++) {
        const ang = (k / 6) * PI * 2;
        const pt = (rad, off, z) => {
          const ca = Math.cos(ang), sa = Math.sin(ang);
          return [rad * ca - off * sa, rad * sa + off * ca, z];
        };
        const A = pt(r0, -h0 / 2, z1), Bp = pt(r0, h0 / 2, z1), Cp = pt(r1, h1 / 2, z1 - 0.022), D = pt(r1, -h1 / 2, z1 - 0.022);
        const A2 = pt(r0, -h0 / 2, z0), B2 = pt(r0, h0 / 2, z0), C2 = pt(r1, h1 / 2, z0), D2 = pt(r1, -h1 / 2, z0);
        // raised ridge along the middle for a faceted blade
        const M0 = pt(r0, 0, z1 + 0.014), M1 = pt(r1, 0, z1 - 0.012);
        g.triHint('s', A, M0, M1, [0, 0, 1]); g.triHint('s', A, M1, D, [0, 0, 1]);
        g.triHint('s', M0, Bp, Cp, [0, 0, 1]); g.triHint('s', M0, Cp, M1, [0, 0, 1]);
        const side = (p, q, p2, q2) => { g.quad('s', p, q, q2, p2); g.quad('s', p, p2, q2, q); };
        side(A, D, A2, D2); side(Bp, Cp, B2, C2);
      }
      return g.geometry('s');
    })();
    const capGeo = new THREE.CylinderGeometry(0.05, 0.058, 0.03, 6);
    capGeo.rotateX(PI / 2);

    WHEELS.forEach((wd) => {
      const steer = new THREE.Group();
      steer.position.set(wd.x, -0.14, wd.z);
      const spin = new THREE.Group();
      const mirror = new THREE.Group();
      mirror.scale.z = wd.z > 0 ? 1 : -1;
      const tyre = new THREE.Mesh(tyreGeo, this.mat.tyre);
      const lip = new THREE.Mesh(lipGeo, this.mat.gloss);
      lip.position.z = w / 2 + 0.002;
      const face = new THREE.Mesh(faceGeo, this.mat.rimFace);
      face.position.z = w / 2 - 0.05;
      const barrel = new THREE.Mesh(barrelGeo, this.mat.black);
      const spokes = new THREE.Mesh(spokesGeo, this.mat.spoke);
      spokes.position.z = w / 2 - 0.05;
      const cap = new THREE.Mesh(capGeo, this.mat.spoke);
      cap.position.z = w / 2 + 0.0;
      mirror.add(tyre, lip, face, barrel, spokes, cap);
      spin.add(mirror);
      steer.add(spin);
      this.group.add(steer);
      this.wheelObjs.push({ steer, spin, data: wd });
    });
  }

  // ---------------------------------------------------------------- active wing
  // The rear deck panel lifts on two swan-neck struts; its tips fold down into end plates. At rest
  // it lies on the deck and the end plates sink into the rear quarters.
  buildWing() {
    const m = this.group;
    const wx = -1.88;
    this.wingX = wx;
    this.wingBaseY = topY(wx, 0) + 0.008;
    this.wingLift = 0.4;
    const wing = new THREE.Group();
    wing.position.set(wx, this.wingBaseY, 0);
    const g = new Mesher();
    const c = 0.44, span = 0.82, th = 0.028;
    // main plane, cambered slightly: the leading edge sits a touch higher
    g.slab('p', 'b', 'b', [[c / 2, 0.012, -span], [c / 2, 0.012, span], [-c / 2, 0, span], [-c / 2, 0, -span]], [0, 1, 0], th);
    // end plates folding down and outward
    for (const s of [1, -1]) {
      const q = [[c / 2, 0.012, s * span], [-c / 2, 0, s * span], [-c / 2 + 0.03, -0.26, s * 0.92], [c / 2 - 0.1, -0.24, s * 0.92]];
      g.slab('p', 'b', 'b', q, [0, 0.55, s * 0.84], th * 0.8);
    }
    const plate = new THREE.Group();
    plate.add(new THREE.Mesh(g.geometry('p'), this.mat.paint), new THREE.Mesh(g.geometry('b'), this.mat.trim));
    wing.add(plate);
    // swan necks: hang from the plane's underside, curve back and down to the posts
    this.necks = [];
    const nb = new Batch();
    for (const z of [-0.34, 0.34]) {
      const pts = [[0.05, -0.02], [0.02, -0.08], [-0.05, -0.12], [-0.08, -0.16], [-0.08, -0.24]].map(([x, y]) => new THREE.Vector3(x, y, z));
      for (let i = 0; i < pts.length - 1; i++) nb.bar('gloss', pts[i], pts[i + 1], 0.03, 0.025);
      nb.box('gloss', 0.1, 0.012, 0.05, 0.04, -0.012, z);
    }
    const neckMeshes = nb.build(wing, this.mat);
    for (const n of neckMeshes) { n.visible = false; this.necks.push(n); }
    m.add(wing);
    this.wing = wing;
    this.wingPlate = plate;
    // posts: unit-height boxes scaled to reach the necks
    this.struts = [];
    for (const z of [-0.34, 0.34]) {
      const geo = new THREE.BoxGeometry(0.035, 1, 0.03);
      geo.translate(0, 0.5, 0);
      const s = new THREE.Mesh(geo, this.mat.gloss);
      s.position.set(wx - 0.08, topY(wx - 0.08, z) - 0.05, z);
      s.scale.y = 0.001;
      s.visible = false;
      m.add(s);
      this.struts.push(s);
    }
  }

  // ---------------------------------------------------------------- cold-gas nozzles
  buildNozzles() {
    const up = new THREE.Vector3(0, 1, 0);
    const bellGeo = new THREE.CylinderGeometry(0.045, 0.028, 0.09, 12, 1, true);
    bellGeo.translate(0, -0.045, 0); // mouth at origin, throat behind it (+y is exhaust direction)
    const throatGeo = new THREE.CircleGeometry(0.03, 12);
    throatGeo.rotateX(PI / 2);
    throatGeo.translate(0, -0.08, 0);
    const plumeGeo = new THREE.ConeGeometry(0.045, 1, 12, 1, true);
    plumeGeo.rotateX(PI); // tip at +y
    plumeGeo.translate(0, 0.5, 0);
    const bellMat = new THREE.MeshStandardMaterial({ color: 0x55595f, metalness: 0.9, roughness: 0.3, side: THREE.DoubleSide });
    // The visible nozzle mouth sits on the body surface just outboard of the spec point.
    this.nozzleMouth = this.nozzles.map((n) => n.pos.clone().addScaledVector(n.dir, n.group === 'rear' ? 0.03 : n.group === 'nose' ? 0.13 : 0));
    for (const n of this.nozzles) {
      const g = new THREE.Group();
      g.position.copy(this.nozzleMouth[n.id]);
      g.quaternion.setFromUnitVectors(up, n.dir);
      // the rear four are the diffuser's tubes (buildTail); the rest get a bell
      if (n.group !== 'rear') g.add(new THREE.Mesh(bellGeo, bellMat), new THREE.Mesh(throatGeo, this.mat.black));
      const mat = new THREE.MeshBasicMaterial({
        color: 0xbfe6ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      });
      const plume = new THREE.Mesh(plumeGeo, mat);
      plume.userData.shadow = false;
      plume.scale.set(1, 0.001, 1);
      plume.visible = false;
      const disc = new THREE.Mesh(new THREE.CircleGeometry(0.04, 12), mat);
      disc.rotation.x = -PI / 2;
      disc.position.y = 0.002;
      g.add(plume, disc);
      this.group.add(g);
      this.nozzleFx.push({ mat, plume, t: 0 });
    }
  }

  nozzleWorld(n, outPos, outDir) {
    const g = this.group;
    outPos.copy(this.nozzleMouth[n.id] || n.pos).multiply(g.scale).applyQuaternion(g.quaternion).add(g.position);
    outDir.copy(n.dir).applyQuaternion(g.quaternion);
    return outPos;
  }

  // st: { wheels[{steer, spin, y}], doors, wing, airbrake, lights, brake, fans, nozzles, speed,
  //       frunk (0..1, optional: opens the rear trunk lid over the gas sphere), steer (yoke, optional), cockpit (bool: first-person view live),
  //       telemetry (optional, see screen.js) }
  update(dt, st) {
    const s = this.s;
    // wheels
    const ws = st.wheels;
    for (let i = 0; i < this.wheelObjs.length; i++) {
      const w = this.wheelObjs[i];
      const d = ws && ws[i];
      if (!d) continue;
      w.steer.position.y = d.y;
      w.steer.rotation.y = d.steer || 0;
      w.spin.rotation.z = -(d.spin || 0);
    }
    // yoke follows the steering (positive = left); about 3:1 to the road wheels
    if (this.yoke) {
      const steer = st.steer ?? (ws ? ((ws[0] && ws[0].steer) || 0) * 0.5 + ((ws[1] && ws[1].steer) || 0) * 0.5 : 0);
      s.yoke = ease(s.yoke, Math.max(-1.9, Math.min(1.9, -steer * 3)), 20, dt);
      this.yoke.rotation.x = s.yoke;
    }
    // doors
    s.doors = ease(s.doors, clamp01(st.doors || 0), 3.5, dt);
    const doorAng = s.doors * 1.5;
    for (const d of this.doorObjs) d.pivot.quaternion.setFromAxisAngle(d.axis, doorAng * d.sign);
    // front lid
    s.frunk = ease(s.frunk, clamp01(st.frunk || 0), 3, dt);
    this.trunk.pivot.rotation.z = s.frunk * 1.2; // st.frunk opens the rear trunk lid
    // wing and airbrake
    s.wing = ease(s.wing, clamp01(st.wing || 0), 4, dt);
    s.airbrake = ease(s.airbrake, clamp01(st.airbrake || 0), 6, dt);
    const lift = Math.max(s.wing, s.airbrake * 0.9) * this.wingLift;
    this.wing.position.y = this.wingBaseY + lift;
    this.wing.position.x = this.wingX - 0.3 * lift; // rises up and back on the swan necks
    // at rest the plate lies on the sloping deck; raised it trims slightly nose-down; airbrake ~75 deg
    this.wingPlate.rotation.z = (0.2 - 0.4 * s.wing) * (1 - s.airbrake) + 1.31 * s.airbrake;
    for (const n of this.necks) n.visible = lift > 0.1;
    for (const sp of this.struts) {
      sp.position.x = this.wing.position.x - 0.08;
      const len = this.wingBaseY + lift - 0.24 - sp.position.y;
      sp.visible = lift > 0.1 && len > 0.005;
      sp.scale.y = Math.max(0.001, len);
    }
    // Track Mode flaps behind the front wheels open with the wing (not for the airbrake)
    if (this.flaps) {
      for (const f of this.flaps) {
        f.pivot.quaternion.setFromAxisAngle(f.axis, 0.42 * s.wing * f.sign);
        f.recess.visible = s.wing > 0.02;
      }
    }
    // lights: the corner panels sink and uncover the lamp bars
    s.lights = ease(s.lights, clamp01(st.lights || 0), 6, dt);
    for (const p of this.pods) p.pivot.quaternion.setFromAxisAngle(p.axis, -p.angle * s.lights);
    this.mat.head.emissiveIntensity = 6 * s.lights;
    this.mat.drl.emissiveIntensity = 2.2 + 2.5 * s.lights;
    for (const h of this.headLights) h.intensity = 160 * s.lights;
    s.brake = ease(s.brake, clamp01(st.brake || 0), 18, dt);
    const tb = 0.72 + 0.12 * s.lights + 0.75 * s.brake;
    this.mat.tail.color.setScalar(tb);
    this.mat.red.color.setRGB(0.62 + 0.38 * s.brake, 0.01, 0.02);
    // fans
    s.fans = ease(s.fans, clamp01(st.fans || 0), 5, dt);
    s.fanAngle = (s.fanAngle + dt * (4 + 70 * s.fans)) % (PI * 2);
    for (const r of this.fanRotors) r.rotation.x = s.fanAngle;
    this.mat.underglow.opacity = 0.22 * s.fans;
    this.mat.underglow.visible = s.fans > 0.01;
    // nozzle glow
    const thr = st.nozzles;
    for (let i = 0; i < this.nozzleFx.length; i++) {
      const fx = this.nozzleFx[i];
      const target = thr ? clamp01(thr[i] || 0) : 0;
      fx.t = ease(fx.t, target, 25, dt);
      fx.mat.opacity = 0.75 * fx.t;
      fx.plume.visible = fx.t > 0.01;
      fx.plume.scale.set(0.7 + 0.5 * fx.t, 0.4 * fx.t * (0.9 + 0.1 * Math.sin(s.fanAngle * 7 + i)), 0.7 + 0.5 * fx.t);
    }
    // first person: clearer glass, live screen
    s.cockpit = ease(s.cockpit, st.cockpit ? 1 : 0, 8, dt);
    this.mat.glass.opacity = 0.86 - 0.66 * s.cockpit;
    if (this.screen) this.screen.update(dt, st.telemetry, !!st.cockpit);
  }
}
