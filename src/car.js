import * as THREE from 'three';
import { WHEELS, FANS, SUSP, COM_H } from './spec.js';

// Low-poly model of the 2026 Roadster, built from the official launch photos.
// Body frame: origin at the centre of mass, +x forward, +y up, +z to the driver's right.
// The body is a loft of cross-sections: every section has the same nine points running from the
// floor centre-line up the right flank to the roof centre-line, so each point index traces one of
// the car's straight crease lines from nose to tail and every quad is a flat facet.

const PI = Math.PI;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const ease = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));

// Section point indices.
const F0 = 0; // floor, centre-line
const F1 = 1; // floor edge / inner wheel-well wall
const S = 2; // sill bottom, outer edge
const P = 3; // paint bottom (top of the black sill)
const C = 4; // lower flank crease
const B = 5; // shoulder / fender crest
const G = 6; // greenhouse base (glass bottom edge), hood side crease at the front
const R = 7; // roof edge / A-pillar line
const T = 8; // roof centre-line
const NP = 9;

// Key sections [x, [[y, z] for F0..T]]. Linear interpolation between keys keeps every crease straight.
const KEYS = [
  [2.14, [[-0.28, 0], [-0.28, 0.5], [-0.29, 0.64], [-0.24, 0.68], [-0.12, 0.7], [-0.04, 0.69], [-0.03, 0.675], [-0.03, 0.655], [-0.03, 0]]],
  [1.98, [[-0.32, 0], [-0.32, 0.58], [-0.33, 0.84], [-0.25, 0.88], [-0.06, 0.915], [0.07, 0.885], [0.085, 0.8], [0.075, 0.645], [0.085, 0]]],
  [1.36, [[-0.35, 0], [-0.35, 0.6], [-0.35, 0.95], [-0.27, 0.985], [0.0, 1.0], [0.27, 0.965], [0.275, 0.86], [0.26, 0.625], [0.27, 0]]],
  [1.18, [[-0.36, 0], [-0.36, 0.6], [-0.36, 0.96], [-0.27, 0.99], [0.02, 1.0], [0.285, 0.955], [0.29, 0.89], [0.29, 0.61], [0.3, 0]]],
  [0.84, [[-0.36, 0], [-0.36, 0.6], [-0.36, 0.97], [-0.255, 0.99], [0.02, 1.0], [0.265, 0.955], [0.28, 0.9], [0.4, 0.6], [0.41, 0]]],
  [0.2, [[-0.36, 0], [-0.36, 0.6], [-0.36, 0.97], [-0.21, 0.985], [0.03, 1.0], [0.33, 0.95], [0.35, 0.895], [0.585, 0.57], [0.6, 0]]],
  [-0.28, [[-0.36, 0], [-0.36, 0.6], [-0.36, 0.97], [-0.16, 0.98], [0.05, 0.995], [0.39, 0.945], [0.415, 0.875], [0.605, 0.56], [0.615, 0]]],
  [-0.65, [[-0.36, 0], [-0.36, 0.6], [-0.36, 0.965], [-0.13, 0.975], [0.06, 0.995], [0.42, 0.95], [0.46, 0.81], [0.59, 0.555], [0.6, 0]]],
  [-1.0, [[-0.36, 0], [-0.36, 0.6], [-0.36, 0.95], [-0.1, 0.97], [0.06, 1.0], [0.42, 0.965], [0.54, 0.56], [0.55, 0.54], [0.56, 0]]],
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
const ARCH_R = 0.4; // horizontal radius
const ARCH_RY = 0.36; // vertical radius (the fender sits tight over the tyre)
const ARCH_CY = SUSP.radius - COM_H; // wheel centre height at rest

function sectionAt(x) {
  let i = 0;
  while (i < KEYS.length - 2 && x < KEYS[i + 1][0]) i++;
  const [xa, a] = KEYS[i];
  const [xb, b] = KEYS[i + 1];
  const t = clamp01((x - xa) / (xb - xa));
  const out = [];
  for (let k = 0; k < NP; k++) out.push([a[k][0] + (b[k][0] - a[k][0]) * t, a[k][1] + (b[k][1] - a[k][1]) * t]);
  return out;
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
  geometry(key) {
    const arr = this.buf[key];
    if (!arr || !arr.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    g.computeVertexNormals();
    return g;
  }
}

function plateTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = '#e9ecef';
  g.fillRect(0, 0, 256, 96);
  g.strokeStyle = '#30343a';
  g.lineWidth = 6;
  g.strokeRect(5, 5, 246, 86);
  g.fillStyle = '#1b1e22';
  g.font = 'bold 58px Arial, Helvetica, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('RDSTR', 128, 52);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function screenTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 128);
  gr.addColorStop(0, '#15171c');
  gr.addColorStop(1, '#07080a');
  g.fillStyle = gr;
  g.fillRect(0, 0, 256, 128);
  g.strokeStyle = '#c9ccd2';
  g.lineWidth = 2;
  g.beginPath(); // tiny car outline
  g.moveTo(70, 82); g.lineTo(110, 60); g.lineTo(170, 56); g.lineTo(200, 70); g.lineTo(200, 84); g.closePath();
  g.stroke();
  g.fillStyle = '#e0242c';
  g.fillRect(14, 14, 50, 5); g.fillRect(14, 108, 228, 3);
  g.fillStyle = '#9aa0a8';
  g.fillRect(190, 14, 50, 5);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
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
  constructor(variant) {
    this.variant = variant;
    this.group = new THREE.Group();
    this.group.name = 'roadster';
    this.cockpit = new THREE.Vector3(-0.1, 0.33, variant.seats === 2 ? -0.33 : 0);
    this.nozzles = variant.nozzles;
    this.wheelObjs = [];
    this.fanRotors = [];
    this.nozzleFx = [];
    this.headLights = [];
    this.doorObjs = [];
    this.s = { doors: 0, wing: 0, airbrake: 0, lights: 0, brake: 0, fans: 0, fanAngle: 0 };
    this._q = new THREE.Quaternion();
    this.makeMaterials();
    this.buildBody();
    this.buildDetails();
    this.buildInterior(variant);
    this.buildWheels();
    this.buildWing();
    this.buildNozzles();
    this.group.traverse((o) => {
      if (o.isMesh && o.userData.shadow !== false && !o.material.transparent) o.castShadow = true;
    });
  }

  makeMaterials() {
    this.mat = {
      paint: new THREE.MeshPhysicalMaterial({
        color: 0xb9bdc2, metalness: 0.5, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.25, envMapIntensity: 1.15,
      }),
      black: new THREE.MeshStandardMaterial({ color: 0x0d0e10, metalness: 0.35, roughness: 0.55 }),
      gloss: new THREE.MeshPhysicalMaterial({ color: 0x08090a, metalness: 0.4, roughness: 0.18, clearcoat: 1 }),
      liner: new THREE.MeshStandardMaterial({ color: 0x141518, roughness: 0.85, side: THREE.FrontSide }),
      glass: new THREE.MeshPhysicalMaterial({
        color: 0x2a1d14, metalness: 0.35, roughness: 0.05, transparent: true, opacity: 0.9,
        side: THREE.DoubleSide, envMapIntensity: 0.75, clearcoat: 1, clearcoatRoughness: 0.03,
      }),
      gray: new THREE.MeshStandardMaterial({ color: 0x7c8187, metalness: 0.5, roughness: 0.4 }),
      rimFace: new THREE.MeshStandardMaterial({ color: 0xb4b8bd, metalness: 0.55, roughness: 0.35 }),
      tyre: new THREE.MeshStandardMaterial({ color: 0x0f0f10, roughness: 0.9 }),
      white: new THREE.MeshStandardMaterial({ color: 0xe8e8e6, roughness: 0.7 }),
      seatGray: new THREE.MeshStandardMaterial({ color: 0xb9bbbd, roughness: 0.85 }),
      metal: new THREE.MeshStandardMaterial({ color: 0x3b3f45, metalness: 0.9, roughness: 0.3 }),
      drl: new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xf2f6ff, emissiveIntensity: 2.2 }),
      tail: new THREE.MeshBasicMaterial({ color: 0xc00006, toneMapped: false }),
      amber: new THREE.MeshStandardMaterial({ color: 0x331800, emissive: 0xff8a10, emissiveIntensity: 1.4 }),
      head: new THREE.MeshStandardMaterial({ color: 0x15171a, emissive: 0xeaf2ff, emissiveIntensity: 0 }),
      ambient: new THREE.MeshStandardMaterial({ color: 0x300000, emissive: 0xff1a22, emissiveIntensity: 1.6 }),
      underglow: new THREE.MeshBasicMaterial({
        color: 0x39d6ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    };
  }

  // ---------------------------------------------------------------- body shell
  buildBody() {
    const m = this.group;
    // Station list: every key plus a polygonal arch at each axle. Any station inside an arch has its
    // sill points lifted to the arch line; the arch-edge stations are doubled so the arch drops
    // vertically to the sill.
    const xs = KEYS.map((k) => k[0]);
    const axles = [WHEELS[0].x, WHEELS[2].x];
    for (const wx of axles) for (let i = 1; i < 10; i++) xs.push(wx + ARCH_R * Math.cos((i / 10) * PI));
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
      stations.push({ x: s.x, pts, arch: s.arch !== null, skew });
    }
    this.stations = stations;

    const mesh = new Mesher();
    const doorMesh = [new Mesher(), new Mesher()];
    const V = (st, k, side) => [st.x + (st.skew ? st.skew[k] : 0), st.pts[k][0], st.pts[k][1] * side];
    const ST = this.stations;
    for (let si = 0; si < ST.length - 1; si++) {
      const s0 = ST[si], s1 = ST[si + 1];
      const xm = (s0.x + s1.x) / 2;
      if (s0.x - s1.x < 1e-5) {
        // doubled arch-edge station: only the faces that actually differ
      }
      for (let k = 0; k < NP - 1; k++) {
        let key = 'paint';
        if (k <= 2) key = 'black';
        else if (k === 3) key = xm < -1.02 ? 'black' : 'paint';
        else if (k === 6) key = xm < WIN_FRONT && xm > SIDE_GLASS_REAR ? 'glass' : 'paint';
        else if (k === 7) key = xm < WIN_FRONT && xm > REAR_GLASS_END ? 'glass' : 'paint';
        const door = k >= 3 && k <= 6 && xm < DOOR_FRONT && xm > DOOR_REAR;
        for (let side = 1; side >= -1; side -= 2) {
          const a = V(s0, k, side), b = V(s0, k + 1, side);
          const c = V(s1, k + 1, side), d = V(s1, k, side);
          const target = door ? doorMesh[side > 0 ? 0 : 1] : mesh;
          if (side > 0) {
            target.tri(key, a, b, c);
            target.tri(key, a, c, d);
            if (key !== 'glass') { target.tri(door ? 'doorIn' : 'liner', a, c, b); target.tri(door ? 'doorIn' : 'liner', a, d, c); }
          } else {
            target.tri(key, a, c, b);
            target.tri(key, a, d, c);
            if (key !== 'glass') { target.tri(door ? 'doorIn' : 'liner', a, b, c); target.tri(door ? 'doorIn' : 'liner', a, c, d); }
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
    cap(ST[0], 'black', [1, 0, 0]);
    cap(ST[ST.length - 1], 'black', [-1, 0, 0]);

    const add = (geo, mat, parent = m) => {
      if (!geo) return null;
      const o = new THREE.Mesh(geo, mat);
      parent.add(o);
      return o;
    };
    add(mesh.geometry('paint'), this.mat.paint);
    add(mesh.geometry('black'), this.mat.black);
    add(mesh.geometry('liner'), this.mat.liner);
    const glass = add(mesh.geometry('glass'), this.mat.glass);
    glass.renderOrder = 2;

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
      // red ambient strip on the door's inner panel
      const a = sectionAt(0.55), b = sectionAt(-0.15);
      const ya = a[C][0] + 0.13, yb = b[C][0] + 0.15;
      const strip = barBetween(
        new THREE.Vector3(0.55, ya, (a[C][1] - 0.04) * side),
        new THREE.Vector3(-0.15, yb, (b[C][1] - 0.04) * side), 0.025, 0.015, this.mat.ambient,
      );
      inner.add(strip);
      const panel = barBetween(
        new THREE.Vector3(0.62, ya - 0.06, (a[C][1] - 0.035) * side),
        new THREE.Vector3(-0.2, yb - 0.06, (b[C][1] - 0.035) * side), 0.12, 0.012, this.mat.seatGray,
      );
      inner.add(panel);
      m.add(pivot);
      this.doorObjs.push({ pivot, inner, axis, sign: -side });
    }
  }

  // ---------------------------------------------------------------- lights, trim, tail
  buildDetails() {
    const m = this.group;
    const ST = this.stations;
    const nose = ST[0].pts;

    // Full-width DRL along the nose's leading edge.
    const drlZ = nose[B][1] - 0.02;
    const drl = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.018, drlZ * 2), this.mat.drl);
    drl.position.set(NOSE_X + 0.004, nose[T][0] - 0.012, 0);
    m.add(drl);
    for (const side of [1, -1]) {
      // the light line wraps a little down the folded corners
      const a = new THREE.Vector3(NOSE_X + 0.004, nose[B][0] - 0.012, nose[B][1] * side * 0.97);
      const b = new THREE.Vector3(NOSE_X - 0.05, nose[C][0] - 0.0, nose[C][1] * side * 1.0);
      m.add(barBetween(a, b, 0.016, 0.02, this.mat.drl));
    }
    // Black lower intake with slats on the front face.
    const intake = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.12, 1.1), this.mat.gloss);
    intake.position.set(NOSE_X - 0.005, -0.18, 0);
    m.add(intake);
    for (let i = 0; i < 3; i++) {
      const sl = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.008, 1.08), this.mat.metal);
      sl.position.set(NOSE_X + 0.018, -0.215 + i * 0.035, 0);
      m.add(sl);
    }
    const splitter = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.02, 1.36), this.mat.black);
    splitter.position.set(NOSE_X - 0.1, -0.285, 0);
    m.add(splitter);

    // Pop-down headlight pods: hidden under the leading edge, drop out when the lights are on.
    this.pods = [];
    for (const side of [1, -1]) {
      const pod = new THREE.Group();
      pod.position.set(NOSE_X - 0.08, -0.05, 0.5 * side);
      const housing = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.24), this.mat.gloss);
      const lens = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.045, 0.21), this.mat.head);
      lens.position.x = 0.05;
      pod.add(housing, lens);
      m.add(pod);
      this.pods.push(pod);
      const spot = new THREE.SpotLight(0xeef4ff, 0, 90, 0.42, 0.55, 1.1);
      spot.castShadow = false;
      spot.position.set(NOSE_X, -0.1, 0.56 * side);
      spot.target.position.set(NOSE_X + 25, -0.6, 0.9 * side);
      m.add(spot, spot.target);
      this.headLights.push(spot);
    }

    // Amber marker behind the front wheel, on the flank just under the shoulder.
    for (const side of [1, -1]) {
      const x0 = 1.02, x1 = 0.87;
      const s0 = sectionAt(x0), s1 = sectionAt(x1);
      const y0 = s0[C][0] + (s0[B][0] - s0[C][0]) * 0.6, y1 = s1[C][0] + (s1[B][0] - s1[C][0]) * 0.6;
      const z0 = (s0[C][1] + (s0[B][1] - s0[C][1]) * 0.6 + 0.004) * side, z1 = (s1[C][1] + (s1[B][1] - s1[C][1]) * 0.6 + 0.004) * side;
      m.add(barBetween(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1), 0.025, 0.01, this.mat.amber));
      // small red reflector near the tail
      const s2 = sectionAt(-1.95);
      m.add(barBetween(new THREE.Vector3(-1.9, s2[C][0] + 0.02, (s2[C][1] + 0.004) * side),
        new THREE.Vector3(-2.0, s2[C][0] + 0.02, (sectionAt(-2.0)[C][1] + 0.004) * side), 0.02, 0.01, this.mat.tail));
    }

    // Thin dark pillar lines over the glass (the parts on a door move with it).
    const stAt = (x) => this.stations.find((q) => Math.abs(q.x - x) < 1e-6 && !q.arch) || { x, pts: sectionAt(x), skew: null };
    const pt = (st, k, side, out = 1.006, dy = 0.004) =>
      new THREE.Vector3(st.x + (st.skew ? st.skew[k] : 0), st.pts[k][0] + dy, st.pts[k][1] * side * out);
    const line = (pts, w, parentFor) => {
      for (let i = 0; i < pts.length - 1; i++) {
        const xm = (pts[i].x + pts[i + 1].x) / 2;
        (parentFor ? parentFor(xm) : m).add(barBetween(pts[i], pts[i + 1], w, w * 0.6, this.mat.black));
      }
    };
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      const door = this.doorObjs[i].inner;
      const onDoor = (xm) => (xm < DOOR_FRONT && xm > DOOR_REAR ? door : m);
      const xsR = [WIN_FRONT, DOOR_FRONT, 0.2, DOOR_REAR, -0.65, -1.0, -1.36, REAR_GLASS_END];
      line(xsR.map((x) => pt(stAt(x), R, side)), 0.014, onDoor);
      line([WIN_FRONT, DOOR_FRONT, 0.2, DOOR_REAR, -0.65, SIDE_GLASS_REAR].map((x) => pt(stAt(x), G, side)), 0.012, onDoor);
      // door shut lines
      for (const x of [DOOR_FRONT, DOOR_REAR]) {
        const st = stAt(x);
        line([P, C, B, G, R].map((k) => pt(st, k, side, 1.004, 0)), 0.008);
      }
    }
    // windshield header bar and rear-glass end bar
    {
      const s = sectionAt(WIN_FRONT);
      line([new THREE.Vector3(WIN_FRONT, s[T][0] + 0.004, 0), new THREE.Vector3(WIN_FRONT, s[R][0] + 0.004, s[R][1]), new THREE.Vector3(WIN_FRONT, s[G][0] + 0.004, s[G][1])], 0.02);
      line([new THREE.Vector3(WIN_FRONT, s[T][0] + 0.004, 0), new THREE.Vector3(WIN_FRONT, s[R][0] + 0.004, -s[R][1]), new THREE.Vector3(WIN_FRONT, s[G][0] + 0.004, -s[G][1])], 0.02);
    }

    // ----- Tail: flat Kamm face with light bar, grey band, plate, diffuser and fan openings.
    const tail = ST[ST.length - 1].pts;
    const tw = tail[B][1];
    const tx = TAIL_X;
    const lip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.035, tw * 2 + 0.02), this.mat.gloss);
    lip.position.set(tx - 0.02, tail[T][0] - 0.005, 0);
    m.add(lip);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.022, tw * 2 - 0.06), this.mat.tail);
    bar.position.set(tx - 0.008, 0.29, 0);
    m.add(bar);
    this.tailBar = bar;
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.06, tw * 2 - 0.1), this.mat.gray);
    band.position.set(tx - 0.006, 0.22, 0);
    m.add(band);
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.13),
      new THREE.MeshStandardMaterial({ map: plateTexture(), emissive: 0xffffff, emissiveMap: null, emissiveIntensity: 0.35, roughness: 0.5, metalness: 0.1 }));
    plate.material.emissiveMap = plate.material.map;
    plate.position.set(tx - 0.012, 0.07, 0);
    plate.rotation.y = -PI / 2;
    m.add(plate);
    // diffuser block and fins
    for (let i = -2; i <= 2; i++) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.04, 0.012), this.mat.gloss);
      fin.position.set(tx + 0.2, -0.395, i * 0.4);
      m.add(fin);
    }
    // four round recessed fan openings with spinning rotors inside
    const ringGeo = new THREE.RingGeometry(0.09, 0.108, 20);
    const wellGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.12, 20, 1, true);
    wellGeo.rotateZ(PI / 2);
    const backGeo = new THREE.CircleGeometry(0.09, 20);
    const bladeGeo = new THREE.BoxGeometry(0.008, 0.085, 0.03);
    bladeGeo.translate(0, 0.045, 0);
    const wellMat = new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.9, side: THREE.BackSide });
    for (const f of FANS) {
      const g = new THREE.Group();
      g.position.set(tx - 0.012, -0.255, f.z); // FANS.y sits a touch low for the visible face
      const ring = new THREE.Mesh(ringGeo, this.mat.gray);
      ring.rotation.y = -PI / 2;
      const well = new THREE.Mesh(wellGeo, wellMat);
      well.position.x = 0.06;
      const back = new THREE.Mesh(backGeo, this.mat.black);
      back.rotation.y = -PI / 2;
      back.position.x = 0.11;
      const rotor = new THREE.Group();
      rotor.position.x = 0.05;
      for (let i = 0; i < 7; i++) {
        const bl = new THREE.Mesh(bladeGeo, this.mat.metal);
        bl.rotation.x = (i / 7) * PI * 2;
        bl.rotation.y = 0.5;
        rotor.add(bl);
      }
      g.add(ring, well, back, rotor);
      m.add(g);
      this.fanRotors.push(rotor);
    }
    // underglow (suction fans)
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(3.8, 1.9), this.mat.underglow);
    glow.rotation.x = -PI / 2;
    glow.position.set(-0.1, -0.47, 0);
    glow.renderOrder = 3;
    glow.userData.shadow = false;
    m.add(glow);
  }

  // ---------------------------------------------------------------- cabin
  buildInterior(variant) {
    const m = this.group;
    const box = (w, h, d, mat, x, y, z, rz = 0, ry = 0) => {
      const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      o.position.set(x, y, z);
      o.rotation.set(0, ry, rz, 'YXZ');
      m.add(o);
      return o;
    };
    const seatZ = variant.seats === 2 ? [-0.33, 0.33] : [0];
    for (const z of seatZ) {
      box(0.5, 0.09, 0.48, this.mat.white, -0.10, -0.24, z, 0.06);
      box(0.5, 0.06, 0.08, this.mat.white, -0.10, -0.17, z - 0.22, 0.06);
      box(0.5, 0.06, 0.08, this.mat.white, -0.10, -0.17, z + 0.22, 0.06);
      box(0.1, 0.6, 0.48, this.mat.white, -0.41, 0.03, z, -0.42);
      box(0.06, 0.55, 0.08, this.mat.seatGray, -0.37, 0.06, z - 0.22, -0.42);
      box(0.06, 0.55, 0.08, this.mat.seatGray, -0.37, 0.06, z + 0.22, -0.42);
      box(0.1, 0.14, 0.26, this.mat.white, -0.52, 0.36, z, -0.42);
    }
    // centre tunnel (white) between the seats
    box(1.1, 0.16, variant.seats === 2 ? 0.16 : 0.08, this.mat.white, 0.05, -0.2, variant.seats === 2 ? 0 : 0.36);
    // dashboard and bulkheads
    box(0.4, 0.12, 1.7, this.mat.black, 0.72, 0.2, 0, 0.25);
    box(0.08, 0.5, 1.7, this.mat.liner, 0.95, -0.05, 0);
    box(0.08, 0.6, 1.7, this.mat.liner, -0.8, 0.05, 0);
    box(2.0, 0.02, 1.7, this.mat.liner, 0.0, -0.33, 0);
    // landscape screen
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.22),
      new THREE.MeshStandardMaterial({ map: screenTexture(), emissive: 0xffffff, emissiveMap: screenTexture(), emissiveIntensity: 0.6, roughness: 0.2 }));
    scr.position.set(0.5, 0.33, variant.seats === 2 ? 0.0 : 0.3);
    scr.rotation.set(0, PI / 2, 0);
    scr.rotateX(-0.2);
    m.add(scr);
    box(0.02, 0.24, 0.44, this.mat.black, 0.508, 0.33, scr.position.z, -0.2);
    // squared yoke
    const yz = variant.seats === 2 ? -0.33 : 0;
    const yoke = new THREE.Group();
    yoke.position.set(0.36, 0.12, yz);
    yoke.rotation.z = -0.35;
    const yb = (w, h, d, x, y, z, mat = this.mat.seatGray) => {
      const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      o.position.set(x, y, z);
      yoke.add(o);
    };
    yb(0.035, 0.035, 0.3, 0, 0.12, 0);
    yb(0.035, 0.035, 0.24, 0, -0.1, 0);
    yb(0.04, 0.24, 0.045, 0, 0.01, 0.15);
    yb(0.04, 0.24, 0.045, 0, 0.01, -0.15);
    yb(0.05, 0.1, 0.12, 0.01, 0.01, 0, this.mat.black);
    m.add(yoke);
    box(0.24, 0.05, 0.05, this.mat.black, 0.48, 0.09, yz, -0.35);
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
    // sidewall lettering hint: a thin lighter ring
    const lipGeo = new THREE.RingGeometry(rim - 0.018, rim + 0.003, 30);
    const faceGeo = new THREE.CircleGeometry(rim - 0.01, 30);
    const barrelGeo = new THREE.CylinderGeometry(rim - 0.01, rim - 0.01, w * 0.9, 30, 1, true);
    barrelGeo.rotateX(PI / 2);
    // one turbine spoke: tapered and swept, standing proud of the grey face
    const spokeGeo = (() => {
      const g = new Mesher();
      const r0 = 0.05, r1 = rim - 0.012, h0 = 0.034, h1 = 0.012, sweep = 0.32, z0 = 0.0, z1 = 0.045;
      const pt = (rad, ang, z) => [rad * Math.cos(ang), rad * Math.sin(ang), z];
      const a0 = h0 / r0, a1 = h1 / r1;
      const A = pt(r0, -a0, z1), Bp = pt(r0, a0, z1), Cp = pt(r1, sweep + a1, z1 - 0.02), D = pt(r1, sweep - a1, z1 - 0.02);
      const A2 = pt(r0, -a0, z0), B2 = pt(r0, a0, z0), C2 = pt(r1, sweep + a1, z0), D2 = pt(r1, sweep - a1, z0);
      // raised ridge along the middle for a faceted blade
      const M0 = pt(r0, 0, z1 + 0.012), M1 = pt(r1, sweep, z1 - 0.012);
      g.triHint('s', A, M0, M1, [0, 0, 1]); g.triHint('s', A, M1, D, [0, 0, 1]);
      g.triHint('s', M0, Bp, Cp, [0, 0, 1]); g.triHint('s', M0, Cp, M1, [0, 0, 1]);
      const side = (p, q, p2, q2) => { g.quad('s', p, q, q2, p2); g.quad('s', p, p2, q2, q); };
      side(A, D, A2, D2); side(Bp, Cp, B2, C2);
      return g.geometry('s');
    })();
    const capGeo = new THREE.CylinderGeometry(0.055, 0.06, 0.03, 6);
    capGeo.rotateX(PI / 2);

    WHEELS.forEach((wd, i) => {
      const steer = new THREE.Group();
      steer.position.set(wd.x, -0.14, wd.z);
      const spin = new THREE.Group();
      const mirror = new THREE.Group();
      mirror.scale.z = wd.z > 0 ? 1 : -1;
      const tyre = new THREE.Mesh(tyreGeo, this.mat.tyre);
      const lip = new THREE.Mesh(lipGeo, this.mat.gloss);
      lip.position.z = w / 2 + 0.002;
      const face = new THREE.Mesh(faceGeo, this.mat.rimFace);
      face.position.z = w / 2 - 0.06;
      const barrel = new THREE.Mesh(barrelGeo, this.mat.gloss);
      barrel.material = this.mat.black;
      const spokes = new THREE.Group();
      spokes.position.z = w / 2 - 0.06;
      for (let k = 0; k < 6; k++) {
        const s = new THREE.Mesh(spokeGeo, this.mat.gloss);
        s.rotation.z = (k / 6) * PI * 2;
        spokes.add(s);
      }
      const cap = new THREE.Mesh(capGeo, this.mat.gloss);
      cap.position.z = w / 2 - 0.01;
      mirror.add(tyre, lip, face, barrel, spokes, cap);
      spin.add(mirror);
      steer.add(spin);
      this.group.add(steer);
      this.wheelObjs.push({ steer, spin, data: wd });
    });
  }

  // ---------------------------------------------------------------- active wing
  buildWing() {
    const m = this.group;
    const deck = sectionAt(-1.92);
    this.wingBaseY = deck[T][0] + 0.004;
    this.wingLift = 0.5;
    const wing = new THREE.Group();
    wing.position.set(-1.92, this.wingBaseY, 0);
    // flat faceted plate: paint on top, black underneath, with end plates
    const g = new Mesher();
    const c = 0.3, span = 0.86, th = 0.025;
    const top = [[c / 2, 0, -span], [c / 2, 0, span], [-c / 2, th * 0.6, span], [-c / 2, th * 0.6, -span]];
    const bot = top.map((p) => [p[0], p[1] - th, p[2]]);
    g.triHint('p', top[0], top[1], top[2], [0, 1, 0]); g.triHint('p', top[0], top[2], top[3], [0, 1, 0]);
    g.triHint('b', bot[0], bot[1], bot[2], [0, -1, 0]); g.triHint('b', bot[0], bot[2], bot[3], [0, -1, 0]);
    g.triHint('b', top[0], top[1], bot[1], [1, 0, 0]); g.triHint('b', top[0], bot[1], bot[0], [1, 0, 0]);
    g.triHint('b', top[3], top[2], bot[2], [-1, 0, 0]); g.triHint('b', top[3], bot[2], bot[3], [-1, 0, 0]);
    for (const i of [[0, 3, 1], [1, 2, -1]]) {
      const zz = i[2];
      const a = zz > 0 ? top[1] : top[0], b = zz > 0 ? top[2] : top[3];
      const a2 = zz > 0 ? bot[1] : bot[0], b2 = zz > 0 ? bot[2] : bot[3];
      g.triHint('b', a, b, b2, [0, 0, zz]); g.triHint('b', a, b2, a2, [0, 0, zz]);
    }
    const plate = new THREE.Group();
    plate.add(new THREE.Mesh(g.geometry('p'), this.mat.paint), new THREE.Mesh(g.geometry('b'), this.mat.black));
    // thin red edge light on the trailing edge (visible when raised, as in the launch photos)
    const edge = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.012, span * 1.9), this.mat.tail);
    edge.position.set(-c / 2 - 0.004, th * 0.3, 0);
    plate.add(edge);
    wing.add(plate);
    m.add(wing);
    this.wing = wing;
    this.wingPlate = plate;
    // tall struts: unit-height boxes scaled to the lift
    this.struts = [];
    for (const z of [-0.42, 0.42]) {
      const geo = new THREE.BoxGeometry(0.12, 1, 0.03);
      geo.translate(0, 0.5, 0);
      const s = new THREE.Mesh(geo, this.mat.black);
      s.position.set(-1.92, this.wingBaseY - 0.04, z);
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
    this.nozzleMouth = this.nozzles.map((n) => n.pos.clone().addScaledVector(n.dir, n.group === 'rear' ? 0.06 : n.group === 'nose' ? 0.13 : 0));
    for (const n of this.nozzles) {
      const g = new THREE.Group();
      g.position.copy(this.nozzleMouth[n.id]);
      g.quaternion.setFromUnitVectors(up, n.dir);
      const bell = new THREE.Mesh(bellGeo, bellMat);
      const throat = new THREE.Mesh(throatGeo, this.mat.black);
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
      g.add(bell, throat, plume, disc);
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
    // doors
    s.doors = ease(s.doors, clamp01(st.doors || 0), 3.5, dt);
    const doorAng = s.doors * 1.5;
    for (const d of this.doorObjs) d.pivot.quaternion.setFromAxisAngle(d.axis, doorAng * d.sign);
    // wing and airbrake
    s.wing = ease(s.wing, clamp01(st.wing || 0), 4, dt);
    s.airbrake = ease(s.airbrake, clamp01(st.airbrake || 0), 6, dt);
    const lift = Math.max(s.wing, s.airbrake * 0.9) * this.wingLift;
    this.wing.position.y = this.wingBaseY + lift;
    // at rest the plate lies on the sloping deck; raised it trims slightly nose-down; airbrake ~75 deg
    this.wingPlate.rotation.z = (0.19 - 0.29 * s.wing) * (1 - s.airbrake) + 1.31 * s.airbrake;
    for (const sp of this.struts) {
      sp.visible = lift > 0.01;
      sp.scale.y = Math.max(0.001, lift + 0.03);
    }
    // lights
    s.lights = ease(s.lights, clamp01(st.lights || 0), 6, dt);
    // pods slide forward out of the nose and drop below the leading edge
    for (const p of this.pods) { p.position.x = NOSE_X - 0.08 + 0.11 * s.lights; p.position.y = -0.05 - 0.06 * s.lights; }
    this.mat.head.emissiveIntensity = 6 * s.lights;
    this.mat.drl.emissiveIntensity = 2.2 + 2.5 * s.lights;
    for (const h of this.headLights) h.intensity = 160 * s.lights;
    s.brake = ease(s.brake, clamp01(st.brake || 0), 18, dt);
    const tb = Math.min(1, 0.62 + 0.08 * s.lights + 0.38 * s.brake);
    this.mat.tail.color.setRGB(tb, 0.012 * tb, 0.03 * tb);
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
  }
}
