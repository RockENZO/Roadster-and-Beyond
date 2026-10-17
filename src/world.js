import * as THREE from 'three';
import { mergeGeometries as mergeRaw } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Merge that tolerates mixed indexed / non-indexed inputs and uneven attribute sets.
function mergeGeometries(list) {
  const mixed = list.some((g) => g.index) && list.some((g) => !g.index);
  let gs = mixed ? list.map((g) => (g.index ? g.toNonIndexed() : g)) : list;
  const names = Object.keys(gs[0].attributes).filter((n) => gs.every((g) => g.attributes[n]));
  gs = gs.map((g) => { for (const n of Object.keys(g.attributes)) if (!names.includes(n)) g.deleteAttribute(n); return g; });
  const out = mergeRaw(gs);
  if (!out) throw new Error('mergeGeometries failed');
  return out;
}
import { BOUNDS, PAD, STRIP, LINEUP, WALL, FLIP_PAD, LOTUS, STANDS, SPAWNS } from './track.js';

// The night launch venue at McGregor: floodlit pad, grandstand, LED screens, the C-wall,
// the drag strip, the lineup, the Lotus display and the test stands on the horizon.
// Lighting budget: one shadowed DirectionalLight, one HemisphereLight, five unshadowed spots/points.
// Everything else that glows is an emissive / unlit material or a sprite.

const TAU = Math.PI * 2;
const V = (x, y, z) => new THREE.Vector3(x, y, z);

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function canvasTex(w, h, draw, opts = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (opts.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...opts.repeat); }
  return t;
}

function radialTex(stops, size = 128) {
  return canvasTex(size, size, (g, w) => {
    const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    for (const [o, c] of stops) gr.addColorStop(o, c);
    g.fillStyle = gr; g.fillRect(0, 0, w, w);
  });
}

// Darkens a Lambert material with distance outside the floodlit pad so the desert falls off into the night.
function padFalloff(mat, minK = 0.1, range = 120) {
  const f = (v) => v.toFixed(2);
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        { vec4 wp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          wp = instanceMatrix * wp;
        #endif
          vWP = (modelMatrix * wp).xyz; }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP;')
      .replace('#include <opaque_fragment>', `{
        vec2 d = max(vec2(${f(PAD.x0)} - vWP.x, ${f(PAD.z0)} - vWP.z), vec2(vWP.x - ${f(PAD.x1)}, vWP.z - ${f(PAD.z1)}));
        float o = length(max(d, 0.0));
        outgoingLight *= mix(${f(minK)}, 1.0, exp(-o / ${f(range)}));
      }
      #include <opaque_fragment>`);
  };
}

// Collects box instances (beams between two points, or oriented boxes) into one InstancedMesh.
class Boxes {
  constructor() { this.m = []; }
  beam(a, b, s = 0.25, s2 = s) {
    const d = new THREE.Vector3().subVectors(b, a);
    const len = d.length();
    if (len < 1e-4) return;
    const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d.multiplyScalar(1 / len));
    const p = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
    this.m.push(new THREE.Matrix4().compose(p, q, V(s, len, s2)));
  }
  box(cx, cy, cz, sx, sy, sz, yaw = 0) {
    const q = new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), yaw);
    this.m.push(new THREE.Matrix4().compose(V(cx, cy, cz), q, V(sx, sy, sz)));
  }
  build(mat, { cast = true, receive = true, geo = new THREE.BoxGeometry(1, 1, 1) } = {}) {
    const im = new THREE.InstancedMesh(geo, mat, Math.max(1, this.m.length));
    this.m.forEach((m, i) => im.setMatrixAt(i, m));
    im.count = this.m.length;
    im.castShadow = cast; im.receiveShadow = receive;
    im.computeBoundingSphere();
    return im;
  }
}

// Flat painted quads on the ground merged into one geometry per paint colour.
class Paint {
  constructor(y = 0.02) { this.p = []; this.y = y; }
  rect(cx, cz, lx, lz, ang = 0) {
    const c = Math.cos(ang), s = Math.sin(ang), y = this.y;
    const pt = (u, v) => [cx + u * c - v * s, y, cz + u * s + v * c];
    const a = pt(-lx / 2, -lz / 2), b = pt(lx / 2, -lz / 2), d = pt(lx / 2, lz / 2), e = pt(-lx / 2, lz / 2);
    this.p.push(...a, ...e, ...b, ...b, ...e, ...d);
  }
  span(x0, x1, z0, z1) { this.rect((x0 + x1) / 2, (z0 + z1) / 2, x1 - x0, z1 - z0); }
  chevron(cx, cz, size, w, dir = 1) {
    const a = 0.75;
    this.rect(cx, cz - size * 0.35, size, w, dir * a);
    this.rect(cx, cz + size * 0.35, size, w, -dir * a);
  }
  mesh(mat) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    const n = new Float32Array(this.p.length);
    for (let i = 1; i < n.length; i += 3) n[i] = 1;
    g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    return m;
  }
}

// All small signs share one canvas atlas and one merged mesh.
class SignAtlas {
  constructor(cols = 2, rows = 16, cw = 512, ch = 128) {
    Object.assign(this, { cols, rows, cw, ch, n: 0, geos: [] });
    this.canvas = document.createElement('canvas');
    this.canvas.width = cols * cw; this.canvas.height = rows * ch;
    this.g = this.canvas.getContext('2d');
  }
  // draw(g, w, h) paints the cell; the sign is a w-by-w/4 plane centred at pos, facing yaw.
  add(draw, width, pos, yaw) {
    const i = this.n++, col = i % this.cols, row = Math.floor(i / this.cols);
    const g = this.g;
    g.save(); g.translate(col * this.cw, row * this.ch);
    g.beginPath(); g.rect(0, 0, this.cw, this.ch); g.clip();
    draw(g, this.cw, this.ch);
    g.restore();
    const geo = new THREE.PlaneGeometry(width, width * this.ch / this.cw);
    const uv = geo.attributes.uv;
    for (let k = 0; k < uv.count; k++) {
      uv.setXY(k, (col + uv.getX(k)) / this.cols, 1 - (row + 1 - uv.getY(k)) / this.rows);
    }
    geo.rotateY(yaw);
    geo.translate(pos.x, pos.y, pos.z);
    this.geos.push(geo);
  }
  mesh() {
    const t = new THREE.CanvasTexture(this.canvas);
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    const m = new THREE.Mesh(mergeGeometries(this.geos), new THREE.MeshBasicMaterial({ map: t, toneMapped: false }));
    return m;
  }
}

function boardText(lines, { bg = '#07090c', border = '#e8412c', fg = '#ffffff' } = {}) {
  return (g, w, h) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    if (border) { g.strokeStyle = border; g.lineWidth = 10; g.strokeRect(5, 5, w - 10, h - 10); }
    g.textAlign = 'center'; g.textBaseline = 'middle';
    lines.forEach((l, i) => {
      g.font = `${l.weight || 800} ${l.size}px "Helvetica Neue", Arial, sans-serif`;
      g.fillStyle = l.color || fg;
      g.fillText(l.text, w / 2, h * (lines.length === 1 ? 0.53 : (0.3 + 0.44 * i / (lines.length - 1))));
    });
  };
}

// ---------------------------------------------------------------------------------------------
// Vehicles: an extruded side profile (nose toward -z), tapered above the beltline, with a glass
// overlay slab and wheels. Profiles are fractions of length (nose at +0.5) and height.

function profileGeo(pts, width, { bevel = 0.04, taper = 0.12, belt = 0.6, h = 1 } = {}) {
  const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const depth = Math.max(0.05, width - 2 * bevel);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.6, bevelSegments: 2, curveSegments: 4,
  });
  geo.translate(0, 0, -depth / 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    if (y > belt * h) p.setZ(i, p.getZ(i) * (1 - taper * (y - belt * h) / (h * (1 - belt))));
  }
  geo.rotateY(Math.PI / 2); // shape x (nose +) -> world -z; extrusion -> world x
  geo.computeVertexNormals();
  return geo;
}

const CAR_DEFS = {
  model3: {
    r: 0.34, axle: [0.305, -0.305], belt: 0.64, taper: 0.22,
    body: [[-0.5, 0.22], [-0.5, 0.55], [-0.47, 0.68], [-0.37, 0.71], [-0.25, 0.92], [-0.08, 1], [0.05, 0.99], [0.17, 0.66], [0.4, 0.58], [0.49, 0.45], [0.5, 0.3], [0.47, 0.2]],
    glass: [[-0.355, 0.715], [-0.25, 0.93], [-0.08, 1.01], [0.05, 1.0], [0.175, 0.66], [-0.355, 0.64]],
  },
  modely: {
    r: 0.36, axle: [0.31, -0.31], belt: 0.62, taper: 0.2,
    body: [[-0.5, 0.22], [-0.5, 0.55], [-0.48, 0.66], [-0.44, 0.73], [-0.36, 0.88], [-0.2, 0.99], [0, 1], [0.08, 0.98], [0.2, 0.63], [0.42, 0.55], [0.5, 0.42], [0.5, 0.3], [0.47, 0.2]],
    glass: [[-0.43, 0.745], [-0.36, 0.89], [-0.2, 1.0], [0, 1.01], [0.08, 0.99], [0.205, 0.63], [-0.43, 0.62]],
  },
  cybertruck: {
    r: 0.43, axle: [0.32, -0.32], belt: 0.55, taper: 0.06, bevel: 0.015, metal: true,
    body: [[-0.5, 0.25], [-0.5, 0.67], [-0.03, 1], [0.5, 0.6], [0.5, 0.42], [0.46, 0.25], [0.4, 0.22], [-0.42, 0.22]],
    glass: [[-0.25, 0.85], [-0.03, 1.006], [0.22, 0.815], [0.22, 0.7], [-0.25, 0.7]],
    bars: true,
  },
  cybercab: {
    r: 0.36, axle: [0.3, -0.3], belt: 0.62, taper: 0.22, metal: true,
    body: [[-0.5, 0.25], [-0.5, 0.6], [-0.46, 0.72], [-0.3, 0.9], [-0.1, 1], [0.08, 0.99], [0.26, 0.8], [0.42, 0.6], [0.5, 0.48], [0.5, 0.3], [0.46, 0.2]],
    glass: [[-0.32, 0.89], [-0.1, 1.01], [0.08, 1.0], [0.27, 0.8], [0.27, 0.66], [-0.32, 0.66]],
    bars: true,
  },
  lotus: {
    r: 0.31, axle: [0.31, -0.3], belt: 0.66, taper: 0.18,
    body: [[-0.5, 0.27], [-0.5, 0.7], [-0.42, 0.8], [-0.13, 1], [0, 1], [0.14, 0.72], [0.5, 0.47], [0.5, 0.34], [0.46, 0.22], [-0.44, 0.22]],
    glass: [[-0.3, 0.885], [-0.13, 1.01], [0, 1.01], [0.145, 0.715], [-0.3, 0.7]],
  },
};

function wheelSet(axles, w, r, tw, dual = false) {
  const tires = [], hubs = [];
  for (const z of axles) {
    for (const sx of [-1, 1]) {
      const offs = dual ? [w / 2 - tw / 2, w / 2 - tw * 1.55] : [w / 2 - tw / 2];
      for (const o of offs) {
        const t = new THREE.CylinderGeometry(r, r, tw, 18);
        t.rotateZ(Math.PI / 2); t.translate(sx * o, r, z); tires.push(t);
      }
      const hb = new THREE.CylinderGeometry(r * 0.62, r * 0.62, 0.02, 14);
      hb.rotateZ(Math.PI / 2); hb.translate(sx * (w / 2 - 0.004), r, z); hubs.push(hb);
    }
  }
  return { tires: mergeGeometries(tires), hubs: mergeGeometries(hubs) };
}

function makeMats(color, metal) {
  return {
    paint: new THREE.MeshPhysicalMaterial({
      color, metalness: metal ? 0.85 : 0.35, roughness: metal ? 0.3 : 0.32, clearcoat: metal ? 0.3 : 1, clearcoatRoughness: 0.08,
    }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x06080b, metalness: 0.6, roughness: 0.05, clearcoat: 1 }),
    tire: new THREE.MeshStandardMaterial({ color: 0x0c0c0d, roughness: 0.85 }),
    hub: new THREE.MeshStandardMaterial({ color: 0x3b3e44, metalness: 0.9, roughness: 0.3 }),
    lamp: new THREE.MeshBasicMaterial({ color: 0xf2f6ff, toneMapped: false }),
    tail: new THREE.MeshBasicMaterial({ color: 0xff1a12, toneMapped: false }),
  };
}

function buildCar(kind, w, len, h, color) {
  const d = CAR_DEFS[kind];
  const grp = new THREE.Group();
  const M = makeMats(color, d.metal);
  const sc = (pts, dy = 0) => pts.map(([x, y]) => [x * (len - 0.08), y * (h - 0.03) + dy]);
  const body = new THREE.Mesh(profileGeo(sc(d.body), w - 0.16, { bevel: d.bevel ?? 0.05, taper: d.taper, belt: d.belt, h }), M.paint);
  const glass = new THREE.Mesh(profileGeo(sc(d.glass, 0.004), w - 0.11, { bevel: 0, taper: d.taper, belt: d.belt, h }), M.glass);
  const ws = wheelSet(d.axle.map((a) => -a * len), w, d.r, 0.24);
  const tires = new THREE.Mesh(ws.tires, M.tire), hubs = new THREE.Mesh(ws.hubs, M.hub);
  grp.add(body, glass, tires, hubs);
  // light bars / lamps
  const lamps = [], tails = [];
  const yF = (d.body.find((p) => p[0] >= 0.49) || [0, 0.45])[1];
  if (d.bars) {
    const front = new THREE.BoxGeometry(w - 0.3, 0.035, 0.03); front.translate(0, yF * h - 0.04, -len / 2 + 0.05); lamps.push(front);
    const back = new THREE.BoxGeometry(w - 0.3, 0.05, 0.03); back.translate(0, (kind === 'cybertruck' ? 0.64 : 0.58) * h, len / 2 - 0.05); tails.push(back);
  } else {
    for (const sx of [-1, 1]) {
      const f = new THREE.BoxGeometry(0.42, 0.06, 0.05); f.translate(sx * (w / 2 - 0.36), 0.56 * h, -len / 2 + 0.12); lamps.push(f);
      const b = new THREE.BoxGeometry(0.46, 0.07, 0.05); b.translate(sx * (w / 2 - 0.34), 0.6 * h, len / 2 - 0.06); tails.push(b);
    }
  }
  grp.add(new THREE.Mesh(mergeGeometries(lamps), M.lamp), new THREE.Mesh(mergeGeometries(tails), M.tail));
  grp.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return grp;
}

function buildSemi(c) {
  const { w, len, h, color } = c;
  const grp = new THREE.Group();
  const M = makeMats(color, false);
  const L2 = len / 2; // shape x: +L2 is the nose (-z)
  const cab = [[L2 - 2.7, 0.62], [L2 - 2.7, h - 0.12], [L2 - 2.4, h - 0.02], [L2 - 1.3, h - 0.08], [L2 - 0.35, 2.95], [L2 - 0.1, 2.3], [L2 - 0.02, 1.2], [L2 - 0.06, 0.55], [L2 - 0.6, 0.5]];
  grp.add(new THREE.Mesh(profileGeo(cab, w - 0.16, { bevel: 0.06, taper: 0.08, belt: 0.6, h }), M.paint));
  const gl = [[L2 - 1.8, h - 0.12], [L2 - 1.3, h - 0.07], [L2 - 0.34, 2.965], [L2 - 0.2, 2.6], [L2 - 1.8, 2.6]];
  grp.add(new THREE.Mesh(profileGeo(gl, w - 0.11, { bevel: 0, taper: 0.08, belt: 0.6, h }), M.glass));
  // chassis, fifth wheel, side fairings
  const dark = new THREE.MeshStandardMaterial({ color: 0x1b1d21, metalness: 0.5, roughness: 0.6 });
  const ch = new THREE.BoxGeometry(1.0, 0.5, len - 2.9); ch.translate(0, 0.85, (len - 2.9) / 2 - L2 + 2.75);
  const fw = new THREE.CylinderGeometry(0.75, 0.75, 0.12, 16); fw.translate(0, 1.16, L2 - 1.6);
  grp.add(new THREE.Mesh(mergeGeometries([ch, fw]), dark));
  const fair = new THREE.BoxGeometry(w - 0.12, 0.8, 1.3); fair.translate(0, 0.78, -L2 + 3.55);
  grp.add(new THREE.Mesh(fair, M.paint));
  const ws = wheelSet([-L2 + 0.75], w, 0.52, 0.32);
  const wr = wheelSet([L2 - 1.65, L2 - 0.55], w, 0.52, 0.28, true);
  grp.add(new THREE.Mesh(mergeGeometries([ws.tires, wr.tires]), M.tire), new THREE.Mesh(mergeGeometries([ws.hubs, wr.hubs]), M.hub));
  const lb = new THREE.BoxGeometry(w - 0.4, 0.06, 0.04); lb.translate(0, 1.55, -L2 + 0.04);
  grp.add(new THREE.Mesh(lb, M.lamp));
  const tl = new THREE.BoxGeometry(w - 0.5, 0.08, 0.04); tl.translate(0, 3.2, -L2 + 2.72);
  grp.add(new THREE.Mesh(tl, M.tail));
  grp.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return grp;
}

function buildOptimus() {
  const white = [], black = [];
  const B = (arr, sx, sy, sz, x, y, z) => { const g = new THREE.BoxGeometry(sx, sy, sz); g.translate(x, y, z); arr.push(g); };
  const C = (arr, r0, r1, len, x, y, z, rz = 0) => { const g = new THREE.CylinderGeometry(r0, r1, len, 10); g.rotateZ(rz); g.translate(x, y, z); arr.push(g); };
  // facing -x: z is lateral
  for (const s of [-1, 1]) {
    C(white, 0.075, 0.065, 0.42, 0, 0.66, s * 0.12); // thigh
    C(black, 0.06, 0.05, 0.42, 0, 0.27, s * 0.12); // shin
    B(black, 0.24, 0.07, 0.11, -0.04, 0.035, s * 0.12); // foot
    C(white, 0.055, 0.05, 0.3, 0, 1.25, s * 0.28, s * 0.12); // upper arm
    C(black, 0.045, 0.04, 0.27, -0.02, 0.97, s * 0.3, s * 0.06); // forearm
    B(black, 0.08, 0.12, 0.05, -0.02, 0.79, s * 0.31);
  }
  B(black, 0.22, 0.16, 0.38, 0, 0.9, 0); // pelvis
  const torso = new THREE.CylinderGeometry(0.2, 0.15, 0.5, 10); torso.scale(0.75, 1, 1.2); torso.translate(0, 1.22, 0); white.push(torso);
  B(black, 0.04, 0.2, 0.24, -0.15, 1.27, 0); // chest panel
  C(black, 0.05, 0.05, 0.08, 0, 1.5, 0);
  const head = new THREE.SphereGeometry(0.115, 14, 10); head.scale(1.05, 1.15, 0.92); head.translate(0, 1.62, 0); white.push(head);
  const visor = new THREE.SphereGeometry(0.105, 14, 8, Math.PI * 0.6, Math.PI * 0.8, Math.PI * 0.32, Math.PI * 0.3); visor.translate(-0.015, 1.62, 0); black.push(visor);
  const g = new THREE.Group();
  g.add(new THREE.Mesh(mergeGeometries(white), new THREE.MeshPhysicalMaterial({ color: 0xf1f2f4, roughness: 0.35, clearcoat: 0.6 })));
  g.add(new THREE.Mesh(mergeGeometries(black.map((x) => x.toNonIndexed())), new THREE.MeshStandardMaterial({ color: 0x0b0c0e, metalness: 0.4, roughness: 0.25 })));
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

// ---------------------------------------------------------------------------------------------
// C-wall surface: inside of the circle (x0 + R sin t, R - R cos t), t in [0, thetaMax], width 2 hw on z.

function arcStrip(r, t0, t1, n, z0, z1, uvScale, wantNormalSign) {
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= n; i++) {
    const t = t0 + (t1 - t0) * i / n;
    const x = WALL.x0 + r * Math.sin(t), y = WALL.R - r * Math.cos(t);
    pos.push(x, y, z0, x, y, z1);
    const v = t * r / uvScale;
    uv.push(0, v, 1, v);
  }
  for (let i = 0; i < n; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // make sure the normal at t = t0 has the requested sign along the local radial-in (+y at bottom)
  const ny = g.attributes.normal.getY(0) * Math.cos(t0) - g.attributes.normal.getX(0) * Math.sin(t0);
  if (Math.sign(ny) !== wantNormalSign) { idx.reverse(); g.setIndex(idx); g.computeVertexNormals(); }
  return g;
}

// Annular side face at fixed z between radii r0 and r1, normal along nz.
function arcCap(r0, r1, t0, t1, n, z, nz) {
  const pos = [], idx = [];
  for (let i = 0; i <= n; i++) {
    const t = t0 + (t1 - t0) * i / n, s = Math.sin(t), c = Math.cos(t);
    pos.push(WALL.x0 + r0 * s, WALL.R - r0 * c, z, WALL.x0 + r1 * s, WALL.R - r1 * c, z);
  }
  for (let i = 0; i < n; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals();
  if (Math.sign(g.attributes.normal.getZ(0)) !== nz) { idx.reverse(); g.setIndex(idx); g.computeVertexNormals(); }
  return g;
}

// ---------------------------------------------------------------------------------------------

function drawTelemetry(g, w, h, info, t, overlay) {
  const grd = g.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, '#05070d'); grd.addColorStop(1, '#0c1222');
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
  g.textBaseline = 'alphabetic';
  // header
  g.fillStyle = '#e31937'; g.fillRect(0, 0, w, 64);
  g.fillStyle = '#fff'; g.textAlign = 'left';
  g.font = '800 40px "Helvetica Neue", Arial, sans-serif';
  g.fillText('ROADSTER', 28, 46);
  g.textAlign = 'right'; g.font = '600 26px "Helvetica Neue", Arial, sans-serif';
  g.fillText('LAUNCH NIGHT · McGREGOR, TX', w - 28, 43);
  const mph = Number.isFinite(info.mph) ? Math.max(0, Math.round(info.mph)) : null;
  // speed
  g.textAlign = 'right'; g.fillStyle = '#ffffff';
  g.font = '800 250px "Helvetica Neue", Arial, sans-serif';
  g.fillText(mph === null ? '--' : String(mph), 560, 330);
  g.fillStyle = '#8fb7ff'; g.textAlign = 'left'; g.font = '700 54px "Helvetica Neue", Arial, sans-serif';
  g.fillText('MPH', 575, 326);
  // right column
  const row = (label, val, y, col = '#ffffff') => {
    g.textAlign = 'left'; g.fillStyle = '#7e8aa3'; g.font = '700 24px "Helvetica Neue", Arial, sans-serif';
    g.fillText(label, 730, y - 40);
    g.fillStyle = col; g.font = '800 44px "Helvetica Neue", Arial, sans-serif';
    g.fillText(val, 730, y);
  };
  const up = (s) => (s === undefined || s === null || s === '' ? '—' : String(s).toUpperCase());
  row('VARIANT', up(info.variant), 150);
  row('0–60 MPH', Number.isFinite(info.t60) ? `${info.t60.toFixed(2)} s` : '—', 250, '#ffd75e');
  row('STUNT', up(info.stunt), 350, info.stunt ? '#5ef0ff' : '#ffffff');
  // bars
  const bar = (label, v, y, col) => {
    g.textAlign = 'left'; g.fillStyle = '#7e8aa3'; g.font = '700 24px "Helvetica Neue", Arial, sans-serif';
    g.fillText(label, 40, y + 22);
    g.fillStyle = '#1b2235'; g.fillRect(190, y, 780, 28);
    let f = 0, txt = '—';
    if (typeof v === 'boolean') { f = v ? 1 : 0; txt = v ? 'ON' : 'OFF'; } else if (Number.isFinite(v)) { f = v > 1.0001 ? Math.min(1, v / 100) : Math.max(0, v); txt = `${Math.round(f * 100)}%`; }
    g.fillStyle = col; g.fillRect(190, y, 780 * f, 28);
    g.fillStyle = '#fff'; g.textAlign = 'right'; g.font = '700 22px "Helvetica Neue", Arial, sans-serif';
    g.fillText(txt, 964, y + 21);
  };
  bar('COLD GAS', info.gas, 420, '#5ef0ff');
  bar('SUCTION', info.suction, 470, '#ff6a3d');
  // speed sweep strip
  const sw = mph === null ? 0 : Math.min(1, mph / 250);
  for (let i = 0; i < 40; i++) {
    g.fillStyle = i / 40 < sw ? (i > 32 ? '#ff3b30' : '#ffffff') : '#151b2b';
    g.fillRect(40 + i * 24, 520, 18, 26);
  }
  if (overlay) g.drawImage(overlay, 0, 0);
}

function drawTiming(g, w, h, info, best) {
  g.fillStyle = '#030405'; g.fillRect(0, 0, w, h);
  g.strokeStyle = '#e31937'; g.lineWidth = 8; g.strokeRect(4, 4, w - 8, h - 8);
  g.textAlign = 'center'; g.fillStyle = '#ffffff';
  g.font = '800 40px "Helvetica Neue", Arial, sans-serif';
  g.fillText('0–60 MPH', w / 2, 56);
  const v = Number.isFinite(info.t60) ? info.t60.toFixed(2) : '-.--';
  g.font = '800 120px "Courier New", monospace';
  g.fillStyle = '#ff2a1f';
  g.fillText(v, w / 2 - 20, 180);
  g.font = '700 40px "Helvetica Neue", Arial, sans-serif'; g.fillStyle = '#ffffff';
  g.fillText('s', w / 2 + 175, 180);
  g.font = '600 26px "Helvetica Neue", Arial, sans-serif'; g.fillStyle = '#9aa6bd';
  g.fillText(`BEST ${Number.isFinite(best) ? best.toFixed(2) : '-.--'}   ·   EVENT RUN 0.81`, w / 2, 232);
}

// ---------------------------------------------------------------------------------------------

export function buildWorld(scene, renderer) {
  const world = { smoke: [], exposure: 1.0, _acc: 1, _best: undefined };
  const R = rng(20261017);

  // ---- sky, fog, environment ------------------------------------------------------------
  const FOG = 0x0d1220;
  scene.background = new THREE.Color(FOG);
  scene.fog = new THREE.FogExp2(FOG, 0.0021);

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(1, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { hor: { value: new THREE.Color(FOG) }, zen: { value: new THREE.Color(0x010207) }, glow: { value: new THREE.Color(0x3a2a22) } },
      vertexShader: 'varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform vec3 hor; uniform vec3 zen; uniform vec3 glow; varying vec3 vD;
        void main(){ vec3 d = normalize(vD); float h = max(d.y, 0.0);
          vec3 c = mix(hor, zen, pow(h, 0.45));
          float az = max(dot(normalize(d.xz + 1e-5), normalize(vec2(0.8, 0.6))), 0.0);
          c += glow * pow(az, 6.0) * exp(-h * 14.0);
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }),
  );
  dome.renderOrder = -1000; dome.frustumCulled = false;
  // stars
  {
    const n = 2600, p = new Float32Array(n * 3), a = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const y = 0.04 + Math.pow(R(), 0.8) * 0.96, ang = R() * TAU, r = Math.sqrt(1 - y * y);
      p.set([Math.cos(ang) * r * 0.97, y * 0.97, Math.sin(ang) * r * 0.97], i * 3);
      a.set([0.6 + Math.pow(R(), 6) * 3.2, R() * 100], i * 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.setAttribute('sz', new THREE.BufferAttribute(a, 2));
    const stars = new THREE.Points(g, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
      uniforms: { time: { value: 0 }, pr: { value: Math.min(2, renderer.getPixelRatio()) } },
      vertexShader: `attribute vec2 sz; uniform float time; uniform float pr; varying float vA;
        void main(){ vA = (0.55 + 0.45 * sin(time * 1.7 + sz.y)) * smoothstep(0.03, 0.2, position.y) * (0.35 + 0.25 * sz.x);
          gl_PointSize = sz.x * pr * 1.4; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `varying float vA; void main(){ vec2 c = gl_PointCoord - 0.5; float d = dot(c,c);
        gl_FragColor = vec4(vec3(0.85, 0.9, 1.0) * vA * smoothstep(0.25, 0.0, d), 1.0); }`,
    }));
    stars.frustumCulled = false; stars.renderOrder = -999;
    dome.add(stars);
    world.stars = stars;
    const follow = (r, s, cam) => {
      dome.position.copy(cam.position);
      dome.scale.setScalar(cam.far * 0.85);
      dome.updateMatrixWorld(true);
    };
    dome.onBeforeRender = follow; stars.onBeforeRender = follow;
  }
  scene.add(dome);

  // Environment: a little studio of bright floodlight panels so paint and glass read at night.
  {
    const env = new THREE.Scene();
    env.background = new THREE.Color(0x05070c);
    const panel = (w, h, pos, color, k) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide }));
      m.position.copy(pos); m.lookAt(0, 0, 0); env.add(m);
    };
    panel(40, 18, V(0, 45, 0), 0xffffff, 2.2);
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * TAU;
      panel(14, 5, V(Math.cos(a) * 45, 16 + (i % 2) * 6, Math.sin(a) * 45), 0xeaf1ff, 5);
    }
    panel(30, 8, V(-50, 8, 10), 0xff6a3d, 1.6);
    panel(30, 8, V(40, 6, -40), 0x3d7bff, 1.6);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshBasicMaterial({ color: 0x24262a }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -4; env.add(floor);
    const pm = new THREE.PMREMGenerator(renderer);
    scene.environment = pm.fromScene(env, 0.02, 0.1, 300).texture;
    scene.environmentIntensity = 0.55;
    pm.dispose();
  }

  // ---- lights ---------------------------------------------------------------------------------
  const hemi = new THREE.HemisphereLight(0x9db4e6, 0x2a241d, 0.75);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xe8eeff, 2.6);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  const sc = key.shadow.camera;
  sc.left = -48; sc.right = 48; sc.top = 48; sc.bottom = -48; sc.near = 5; sc.far = 400;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.04;
  world.keyOffset = V(-70, 130, 55);
  key.position.copy(world.keyOffset);
  scene.add(key, key.target);
  world.key = key;

  // ---- ground ---------------------------------------------------------------------------------
  const sand = canvasTex(512, 512, (g, w, h) => {
    const r = rng(7);
    g.fillStyle = '#5d4d3b'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) {
      const v = 60 + r() * 50;
      g.fillStyle = `rgba(${v + 25},${v + 8},${v - 15},${0.15 + r() * 0.25})`;
      g.fillRect(r() * w, r() * h, 1 + r() * 3, 1 + r() * 3);
    }
    for (let i = 0; i < 30; i++) {
      g.strokeStyle = `rgba(30,22,14,${0.08 + r() * 0.08})`; g.lineWidth = 2 + r() * 8;
      g.beginPath(); g.moveTo(r() * w, r() * h); g.bezierCurveTo(r() * w, r() * h, r() * w, r() * h, r() * w, r() * h); g.stroke();
    }
  }, { repeat: [200, 200] });
  const desertMat = new THREE.MeshLambertMaterial({ map: sand });
  padFalloff(desertMat, 0.12, 110);
  const desert = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000), desertMat);
  desert.rotation.x = -Math.PI / 2; desert.position.set(300, -0.03, 0);
  desert.receiveShadow = true;
  scene.add(desert);

  // concrete pad: 6 m slabs with joints, stains
  const TILE = 24;
  const conc = canvasTex(1024, 1024, (g, w, h) => {
    const r = rng(11);
    g.fillStyle = '#a3a39f'; g.fillRect(0, 0, w, h);
    for (let sx = 0; sx < 4; sx++) for (let sy = 0; sy < 4; sy++) {
      const v = 150 + r() * 20;
      g.fillStyle = `rgba(${v},${v},${v - 4},0.35)`; g.fillRect(sx * 256, sy * 256, 256, 256);
    }
    const img = g.getImageData(0, 0, w, h), d = img.data;
    for (let i = 0; i < d.length; i += 4) { const n = (r() - 0.5) * 18; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
    g.putImageData(img, 0, 0);
    for (let i = 0; i < 70; i++) {
      const x = r() * w, y = r() * h, rad = 10 + r() * 70;
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, `rgba(40,38,34,${0.05 + r() * 0.1})`); gr.addColorStop(1, 'rgba(40,38,34,0)');
      g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    g.strokeStyle = 'rgba(30,30,30,0.55)'; g.lineWidth = 3;
    for (let k = 0; k <= 4; k++) {
      g.beginPath(); g.moveTo(k * 256, 0); g.lineTo(k * 256, h); g.stroke();
      g.beginPath(); g.moveTo(0, k * 256); g.lineTo(w, k * 256); g.stroke();
    }
    g.strokeStyle = 'rgba(20,20,20,0.25)'; g.lineWidth = 1.5;
    for (let i = 0; i < 25; i++) {
      g.beginPath(); let x = r() * w, y = r() * h; g.moveTo(x, y);
      for (let k = 0; k < 6; k++) { x += (r() - 0.5) * 40; y += (r() - 0.5) * 40; g.lineTo(x, y); }
      g.stroke();
    }
  });
  conc.wrapS = conc.wrapT = THREE.RepeatWrapping;
  const padW = PAD.x1 - PAD.x0, padD = PAD.z1 - PAD.z0;
  conc.repeat.set(padW / TILE, padD / TILE);
  const pad = new THREE.Mesh(new THREE.PlaneGeometry(padW, padD), new THREE.MeshStandardMaterial({ map: conc, roughness: 0.88, metalness: 0, envMapIntensity: 0.8 }));
  pad.rotation.x = -Math.PI / 2;
  pad.position.set((PAD.x0 + PAD.x1) / 2, 0, (PAD.z0 + PAD.z1) / 2);
  pad.receiveShadow = true;
  scene.add(pad);

  // ---- paint ----------------------------------------------------------------------------------
  const white = new Paint(0.02), yellow = new Paint(0.021), red = new Paint(0.022);
  // pad perimeter
  const inset = 3;
  yellow.span(PAD.x0 + inset, PAD.x1 - inset, PAD.z0 + inset, PAD.z0 + inset + 0.3);
  yellow.span(PAD.x0 + inset, PAD.x1 - inset, PAD.z1 - inset - 0.3, PAD.z1 - inset);
  yellow.span(PAD.x0 + inset, PAD.x0 + inset + 0.3, PAD.z0 + inset, PAD.z1 - inset);
  yellow.span(PAD.x1 - inset - 0.3, PAD.x1 - inset, PAD.z0 + inset, PAD.z1 - inset);
  // drag strip
  const S = STRIP;
  for (const zz of [S.zc - S.hw, S.zc + S.hw]) white.span(S.x0 - 25, S.x1, zz - 0.15, zz + 0.15);
  white.span(S.x0 - 0.25, S.x0 + 0.25, S.zc - S.hw, S.zc + S.hw); // start line
  for (let k = 0; k < 14; k++) { // checker band
    const zz = S.zc - S.hw + k;
    (k % 2 ? white : red).span(S.x0 - 1.6, S.x0 - 0.8, zz, zz + 1);
    (k % 2 ? red : white).span(S.x0 - 2.4, S.x0 - 1.6, zz, zz + 1);
  }
  white.span(S.x0 - 6.2, S.x0 - 5.9, S.zc - S.hw, S.zc + S.hw); // staging line
  for (const x of [18.3, 100, 201.2, 304.8, 402.3]) white.span(x - 0.15, x + 0.15, S.zc - S.hw, S.zc + S.hw);
  white.span(S.x1 - 0.6, S.x1, S.zc - S.hw, S.zc + S.hw);
  for (let x = S.x0 + 10; x < S.x1 - 10; x += 12) yellow.span(x, x + 4, S.zc - 0.08, S.zc + 0.08);
  // start box and route to the lineup
  for (const zz of [-6, 6]) white.span(-70, -50, zz - 0.15, zz + 0.15);
  white.span(-50.2, -49.8, -6, 6);
  for (let x = -40; x < 200; x += 10) white.span(x, x + 4, -0.1, 0.1);
  for (let x = 190; x < 236; x += 8) red.chevron(x, 0, 2.2, 0.5, 1);
  // lineup bays
  for (const c of LINEUP) {
    const pad2 = 0.35;
    white.span(c.x0 - pad2 - 0.1, c.x0 - pad2, -c.len / 2 - 0.6, c.len / 2 + 0.6);
    white.span(c.x1 + pad2, c.x1 + pad2 + 0.1, -c.len / 2 - 0.6, c.len / 2 + 0.6);
  }
  // C-wall approach lane
  for (const zz of [WALL.zc - WALL.hw, WALL.zc + WALL.hw]) yellow.span(WALL.x0 - 140, WALL.x0, zz - 0.15, zz + 0.15);
  for (let x = WALL.x0 - 40; x < WALL.x0 - 4; x += 5) red.chevron(x, WALL.zc, 2.6, 0.6, 1);
  // landing line on the flip pad approach
  const markMat = (c, o) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 - o, polygonOffsetUnits: -4 - o });
  scene.add(white.mesh(markMat(0xf3f3ee, 0)), yellow.mesh(markMat(0xf2b705, 1)), red.mesh(markMat(0xd8141f, 2)));

  // flip pad decal (ring + T)
  {
    const tex = canvasTex(1024, 1024, (g, w) => {
      const c = w / 2;
      g.clearRect(0, 0, w, w);
      g.fillStyle = 'rgba(16,16,18,0.85)'; g.beginPath(); g.arc(c, c, c - 4, 0, TAU); g.fill();
      g.strokeStyle = '#e31937'; g.lineWidth = 46; g.beginPath(); g.arc(c, c, c - 30, 0, TAU); g.stroke();
      g.strokeStyle = '#ffffff'; g.lineWidth = 10; g.beginPath(); g.arc(c, c, c - 70, 0, TAU); g.stroke();
      // T logo: arched top bar and tapered stem
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.moveTo(c - 300, c - 250); g.quadraticCurveTo(c, c - 330, c + 300, c - 250);
      g.lineTo(c + 285, c - 205); g.quadraticCurveTo(c + 150, c - 245, c + 60, c - 225);
      g.lineTo(c + 22, c + 320); g.lineTo(c - 22, c + 320); g.lineTo(c - 60, c - 225);
      g.quadraticCurveTo(c - 150, c - 245, c - 285, c - 205);
      g.closePath(); g.fill();
      g.beginPath();
      g.moveTo(c - 250, c - 300); g.quadraticCurveTo(c, c - 370, c + 250, c - 300);
      g.lineTo(c + 240, c - 280); g.quadraticCurveTo(c, c - 340, c - 240, c - 280); g.closePath(); g.fill();
    });
    const fp = new THREE.Mesh(new THREE.PlaneGeometry(FLIP_PAD.r * 2, FLIP_PAD.r * 2), new THREE.MeshStandardMaterial({
      map: tex, transparent: true, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -10, depthWrite: false,
    }));
    fp.rotation.x = -Math.PI / 2; fp.rotation.z = Math.PI / 2; // T points down +x
    fp.position.set(FLIP_PAD.x, 0.025, FLIP_PAD.z);
    fp.receiveShadow = true;
    scene.add(fp);
  }

  // ---- shared materials and collectors ----------------------------------------------------
  const steel = new Boxes(), rails = new Boxes(), grey = new Boxes(), bulbs = [];
  const steelMat = new THREE.MeshStandardMaterial({ color: 0x14161a, metalness: 0.7, roughness: 0.45 });
  const signs = new SignAtlas();
  const glowTex = radialTex([[0, 'rgba(255,255,255,1)'], [0.15, 'rgba(255,255,255,0.6)'], [0.45, 'rgba(255,255,255,0.12)'], [1, 'rgba(255,255,255,0)']]);
  const glowSprite = (pos, size, color, opacity = 1) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true, opacity }));
    s.position.copy(pos); s.scale.set(size, size, 1); scene.add(s); return s;
  };
  const bulb = (x, y, z, color, s = 0.25) => bulbs.push({ x, y, z, color, s });

  // ---- floodlight towers ------------------------------------------------------------------
  {
    const xs = [-110, 40, 190, 340, 490, 640];
    const poles = new Boxes(), heads = new Boxes(), faces = [];
    const cones = [];
    const H = 38;
    for (const zs of [-1, 1]) for (const x of xs) {
      const z = zs * (PAD.z1 + 9);
      poles.beam(V(x, 0, z), V(x, H, z), 0.9);
      const head = V(x, H + 2.2, z);
      const aim = V(x + 30, 0, zs * 25);
      const q = new THREE.Matrix4().lookAt(head, aim, V(0, 1, 0));
      const quat = new THREE.Quaternion().setFromRotationMatrix(q);
      heads.m.push(new THREE.Matrix4().compose(head, quat, V(8, 4.4, 0.7)));
      // the panel's -z face points at the aim point (lookAt convention)
      const face = new THREE.Matrix4().compose(head.clone().add(V(0, 0, -0.38).applyQuaternion(quat)), quat.clone().multiply(new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), Math.PI)), V(7.4, 3.9, 1));
      faces.push(face);
      glowSprite(head.clone().add(V(0, 0, -1.2).applyQuaternion(quat)), 26, 0xdfe9ff, 0.85);
      // beam cone
      const dir = new THREE.Vector3().subVectors(head, aim);
      const len = dir.length() * 0.85;
      const cg = new THREE.ConeGeometry(16, len, 20, 1, true);
      cg.translate(0, -len / 2, 0); // tip at origin, opening toward -y
      cg.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, -1, 0), dir.clone().negate().normalize()));
      cg.translate(head.x, head.y, head.z);
      cones.push(cg);
      // crossbars on pole
      steel.beam(V(x - 3.5, H, z), V(x + 3.5, H, z), 0.35);
    }
    const poleMesh = poles.build(new THREE.MeshStandardMaterial({ color: 0x3a3f46, metalness: 0.6, roughness: 0.5 }), { geo: new THREE.CylinderGeometry(0.5, 0.5, 1, 8) });
    const headMesh = heads.build(steelMat);
    const lampTex = canvasTex(256, 128, (g, w, h) => {
      g.fillStyle = '#1a1c20'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) {
        const cx = 22 + i * 42.5, cy = 22 + j * 42;
        const gr = g.createRadialGradient(cx, cy, 0, cx, cy, 19);
        gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.7, '#e6eeff'); gr.addColorStop(1, '#5b6273');
        g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, 18, 0, TAU); g.fill();
      }
    });
    const faceMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: lampTex, toneMapped: false, color: 0xffffff }), faces.length);
    faces.forEach((m, i) => faceMesh.setMatrixAt(i, m));
    const coneTex = canvasTex(4, 256, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    });
    const coneMat = new THREE.MeshBasicMaterial({ map: coneTex, color: 0x6a7fa8, transparent: true, opacity: 0.11, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide });
    // ConeGeometry v runs 1 at the tip to 0 at the base: gradient top=bright matches
    const coneMesh = new THREE.Mesh(mergeGeometries(cones), coneMat);
    coneMesh.renderOrder = 5;
    poleMesh.castShadow = false; headMesh.castShadow = false;
    scene.add(poleMesh, headMesh, faceMesh, coneMesh);
  }

  // ---- grandstand -------------------------------------------------------------------------
  {
    const N = 14, D = 0.85, Hs = 0.45, base = 1.2;
    const pts = [[0, 0], [0, base]];
    for (let r = 0; r < N; r++) {
      pts.push([(r + 1) * D, base + r * Hs]);
      if (r < N - 1) pts.push([(r + 1) * D, base + (r + 1) * Hs]);
    }
    pts.push([N * D, base + (N - 1) * Hs + 1.4], [N * D + 0.3, base + (N - 1) * Hs + 1.4], [N * D + 0.3, 0]);
    const L = STANDS.x1 - STANDS.x0;
    const shape = new THREE.Shape(pts.map(([u, v]) => new THREE.Vector2(u, v)));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: L, bevelEnabled: false });
    geo.rotateY(Math.PI / 2); // shape u -> -z, extrusion -> +x
    geo.translate(STANDS.x0, 0, STANDS.z);
    const stand = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x3b3e44, roughness: 0.85 }));
    stand.castShadow = true; stand.receiveShadow = true;
    scene.add(stand);
    const backZ = STANDS.z - N * D;
    // front LED strip + back strip
    const strip = new THREE.Mesh(
      mergeGeometries([
        new THREE.BoxGeometry(L, 0.12, 0.06).translate(STANDS.x0 + L / 2, base - 0.15, STANDS.z + 0.04),
        new THREE.BoxGeometry(L, 0.1, 0.06).translate(STANDS.x0 + L / 2, base + (N - 1) * Hs + 1.35, backZ + 0.02),
      ]),
      new THREE.MeshBasicMaterial({ color: 0xff2a3a, toneMapped: false }),
    );
    scene.add(strip);
    // railing in front of the stands
    for (let x = STANDS.x0; x <= STANDS.x1 + 0.1; x += 4) rails.beam(V(x, base, STANDS.z + 0.15), V(x, base + 1.0, STANDS.z + 0.15), 0.06);
    rails.beam(V(STANDS.x0, base + 1.0, STANDS.z + 0.15), V(STANDS.x1, base + 1.0, STANDS.z + 0.15), 0.07);
    // back truss with light rig
    for (let x = STANDS.x0; x <= STANDS.x1 + 0.1; x += 20) {
      steel.beam(V(x, 0, backZ - 0.6), V(x, base + N * Hs + 6, backZ - 0.6), 0.4);
    }
    steel.beam(V(STANDS.x0, base + N * Hs + 6, backZ - 0.6), V(STANDS.x1, base + N * Hs + 6, backZ - 0.6), 0.5);
    for (let x = STANDS.x0 + 10; x < STANDS.x1; x += 20) bulb(x, base + N * Hs + 5.6, backZ - 0.2, 0xffffff, 0.35);
    // aisle step lights
    for (let x = STANDS.x0 + 14; x < STANDS.x1; x += 28) for (let r = 0; r < N; r++) bulb(x, base + r * Hs + 0.05, STANDS.z - r * D - 0.05, 0x5ec8ff, 0.08);

    // crowd
    const person = mergeGeometries([
      new THREE.CylinderGeometry(0.17, 0.22, 1.3, 5, 1).translate(0, 0.65, 0),
      new THREE.OctahedronGeometry(0.13, 0).translate(0, 1.47, 0),
    ]);
    const crowdMats = [], cols = [];
    const palette = [0x1b1d22, 0x22252c, 0x2e3440, 0x463a30, 0x0f1012, 0x5a5f66, 0x7a1f1f, 0x203350, 0xc9c9c9, 0x2b4a2b, 0x30303a];
    const phones = [], phase = [];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
    for (let r = 0; r < N; r++) {
      const y = base + r * Hs, z = STANDS.z - (r + 0.5) * D;
      for (let x = STANDS.x0 + 0.4; x < STANDS.x1 - 0.4; x += 0.62) {
        const lx = (x - STANDS.x0) % 28;
        if (lx > 13 && lx < 15.2) continue; // aisle
        if (R() < 0.07) continue;
        const s = 0.88 + R() * 0.24;
        q.setFromAxisAngle(V(0, 1, 0), (R() - 0.5) * 0.8);
        const px = x + (R() - 0.5) * 0.2, pz = z + (R() - 0.5) * 0.15;
        m.compose(V(px, y, pz), q, V(s, s * (0.92 + R() * 0.16), s));
        crowdMats.push(m.clone());
        c.setHex(palette[Math.floor(R() * palette.length)]).multiplyScalar(0.7 + R() * 0.5);
        cols.push(c.clone());
        if (R() < 0.13) { phones.push(px + 0.12, y + 1.75 * s + R() * 0.25, pz + 0.2); phase.push(R() * 100, 0.4 + R() * 1.6); }
      }
    }
    const crowd = new THREE.InstancedMesh(person, new THREE.MeshLambertMaterial({ color: 0xffffff }), crowdMats.length);
    crowdMats.forEach((mm, i) => { crowd.setMatrixAt(i, mm); crowd.setColorAt(i, cols[i]); });
    crowd.computeBoundingSphere();
    scene.add(crowd);
    world.crowdCount = crowdMats.length;
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.Float32BufferAttribute(phones, 3));
    pg.setAttribute('ph', new THREE.Float32BufferAttribute(phase, 2));
    const pmat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { time: { value: 0 }, pr: { value: Math.min(2, renderer.getPixelRatio()) } },
      vertexShader: `attribute vec2 ph; uniform float time; uniform float pr; varying float vA;
        void main(){ float s = sin(time * ph.y + ph.x); vA = 0.25 + 0.75 * pow(max(s, 0.0), 6.0);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = clamp(pr * (2.0 + 9.0 * vA) * 60.0 / -mv.z, 1.5, 24.0);
          gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying float vA; void main(){ vec2 c = gl_PointCoord - 0.5; float d = dot(c, c);
        float a = smoothstep(0.25, 0.0, d); gl_FragColor = vec4(vec3(0.85, 0.92, 1.0) * a * (0.4 + vA * 1.4), 1.0); }`,
    });
    const phonePts = new THREE.Points(pg, pmat);
    scene.add(phonePts);
    world.phones = pmat;
  }

  // ---- LED screens --------------------------------------------------------------------------
  {
    const can = document.createElement('canvas');
    can.width = 1024; can.height = 576;
    const overlay = document.createElement('canvas');
    overlay.width = 1024; overlay.height = 576;
    const og = overlay.getContext('2d');
    og.fillStyle = 'rgba(0,0,0,0.28)';
    for (let y = 0; y < 576; y += 4) og.fillRect(0, y, 1024, 1);
    for (let x = 0; x < 1024; x += 4) og.fillRect(x, 0, 1, 576);
    const tex = new THREE.CanvasTexture(can);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, fog: false });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x0b0c0e, roughness: 0.6, metalness: 0.4 });
    const place = (x, y, z, w, yaw) => {
      const h = w * 9 / 16;
      const g = new THREE.Group();
      const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 1, h + 1, 0.8), frameMat);
      const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      face.position.z = 0.42;
      g.add(frame, face);
      g.position.set(x, y, z); g.rotation.y = yaw;
      scene.add(g);
      // legs
      const right = V(Math.cos(yaw), 0, -Math.sin(yaw));
      for (const s of [-0.35, 0.35]) {
        const p = V(x, 0, z).addScaledVector(right, s * w).addScaledVector(V(Math.sin(yaw), 0, Math.cos(yaw)), -1);
        steel.beam(p, p.clone().setY(y), 0.7);
      }
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(w * 1.6, h * 1.8), new THREE.MeshBasicMaterial({ map: glowTex, color: 0x3b5dff, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      glow.position.set(0, 0, 0.3); g.add(glow);
    };
    place(612, 15, -10, 40, -Math.PI / 2); // down the course, facing the approach
    place(320, 20.5, STANDS.z - 15, 34, 0); // above the grandstand, facing the pad
    place(150, 13.5, PAD.z1 - 2, 28, Math.PI); // across the pad by the flip pad
    world.screen = { can, g: can.getContext('2d'), tex, overlay };
    drawTelemetry(world.screen.g, 1024, 576, {}, 0, overlay);
  }

  // ---- drag strip: tree, timing tower, distance boards ---------------------------------------
  {
    const zT = S.zc - S.hw - 1.6;
    steel.beam(V(-3, 0, zT), V(-3, 4.2, zT), 0.18);
    grey.box(-3, 3.0, zT, 0.3, 2.6, 0.5);
    const tl = [[0xffffff, 3.9], [0xffffff, 3.65], [0xffa21a, 3.3], [0xffa21a, 3.0], [0xffa21a, 2.7], [0x22ff55, 2.35], [0x441010, 2.0]];
    for (const [col, y] of tl) bulb(-3.18, y, zT, col, 0.2);
    // timing tower
    const tx = 14, tz = S.zc - S.hw - 9;
    for (const dz of [-2.2, 2.2]) steel.beam(V(tx, 0, tz + dz), V(tx, 11, tz + dz), 0.35);
    for (let y = 1; y < 8; y += 2.2) { steel.beam(V(tx, y, tz - 2.2), V(tx, y + 2.2, tz + 2.2), 0.12); steel.beam(V(tx, y + 2.2, tz - 2.2), V(tx, y, tz + 2.2), 0.12); }
    const can = document.createElement('canvas'); can.width = 512; can.height = 256;
    const tex = new THREE.CanvasTexture(can); tex.colorSpace = THREE.SRGBColorSpace;
    const tb = new THREE.Group();
    const tFrame = new THREE.Mesh(new THREE.BoxGeometry(0.5, 4.8, 8.8), new THREE.MeshStandardMaterial({ color: 0x0b0c0e, roughness: 0.6 }));
    const tMat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
    const f1 = new THREE.Mesh(new THREE.PlaneGeometry(8.4, 4.2), tMat); f1.rotation.y = -Math.PI / 2; f1.position.x = -0.26;
    const f2 = new THREE.Mesh(new THREE.PlaneGeometry(8.4, 4.2), tMat); f2.rotation.y = Math.PI / 2; f2.position.x = 0.26;
    tb.add(tFrame, f1, f2); tb.position.set(tx, 12.6, tz); tb.rotation.y = 0.35;
    scene.add(tb);
    world.timing = { can, g: can.getContext('2d'), tex };
    drawTiming(world.timing.g, 512, 256, {}, undefined);
    // distance boards facing the approaching car (-x)
    const labels = [[18.3, '60 FT'], [100, '100 M'], [201.2, '1/8 MILE'], [304.8, '1000 FT'], [402.3, '1/4 MILE']];
    for (const [x, t] of labels) {
      const z = S.zc - S.hw - 3;
      steel.beam(V(x, 0, z - 1.6), V(x, 4.6, z - 1.6), 0.2);
      steel.beam(V(x, 0, z + 1.6), V(x, 4.6, z + 1.6), 0.2);
      grey.box(x + 0.08, 3.9, z, 0.12, 1.25, 4.6);
      signs.add(boardText([{ text: t, size: 78 }]), 4.4, V(x - 0.02, 3.9, z), -Math.PI / 2);
      bulb(x - 0.2, 4.7, z, 0xffffff, 0.15);
    }
    signs.add(boardText([{ text: '0–60 MPH', size: 64 }, { text: 'DRAG STRIP', size: 40, color: '#ffd75e', weight: 700 }]), 6, V(-12, 3.4, S.zc - S.hw - 4.5), -Math.PI / 2 + 0.5);
    steel.beam(V(-12, 0, S.zc - S.hw - 4.5), V(-12, 2.6, S.zc - S.hw - 4.5), 0.25);
  }

  // ---- start arch -------------------------------------------------------------------------
  {
    const ax = -44, hz = 18, top = 9;
    for (const s of [-1, 1]) {
      for (const dx of [-0.8, 0.8]) steel.beam(V(ax + dx, 0, s * hz), V(ax + dx, top + 1, s * hz), 0.3);
      for (let y = 0.5; y < top; y += 1.6) steel.beam(V(ax - 0.8, y, s * hz), V(ax + 0.8, y + 1.6, s * hz), 0.1);
    }
    for (const dx of [-0.8, 0.8]) for (const y of [top, top + 1]) steel.beam(V(ax + dx, y, -hz), V(ax + dx, y, hz), 0.3);
    for (let z = -hz; z < hz; z += 2) steel.beam(V(ax - 0.8, top, z), V(ax + 0.8, top + 1, z + 2), 0.1);
    signs.add((g, w, h) => {
      g.fillStyle = '#05060a'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = '800 82px "Helvetica Neue", Arial, sans-serif';
      g.fillText('R O A D S T E R', w / 2, h * 0.5);
      g.fillStyle = '#e31937'; g.fillRect(40, h - 14, w - 80, 6);
    }, 24, V(ax - 1.0, top - 2.8, 0), -Math.PI / 2);
    grey.box(ax - 0.9, top - 2.8, 0, 0.15, 6.3, 25);
  }

  // ---- lineup -------------------------------------------------------------------------------
  for (const c of LINEUP) {
    const car = c.kind === 'semi' ? buildSemi(c) : buildCar(c.kind, c.w, c.len, c.h, c.color);
    car.position.set(c.xc, 0, c.zc);
    scene.add(car);
  }
  {
    const lx0 = LINEUP[0].x0, lx1 = LINEUP[LINEUP.length - 1].x1;
    signs.add(boardText([{ text: 'THE LINEUP', size: 60 }, { text: 'MODEL 3 · MODEL Y · CYBERTRUCK · CYBERCAB · SEMI', size: 26, color: '#c7d0e0', weight: 600 }]), 8, V((lx0 + lx1) / 2, 1.3, -6.3), Math.PI);
    grey.box((lx0 + lx1) / 2, 0.8, -6.22, 8.2, 2.2, 0.1);
    for (const s of [-1, 1]) {
      world.smoke.push(V(lx0 - 2, 0.3, s * 4), V(lx1 + 2, 0.3, s * 4));
    }
    world.smoke.push(V((lx0 + lx1) / 2, 0.3, -5), V((lx0 + lx1) / 2, 0.3, 5));
  }

  // ---- Lotus Esprit display --------------------------------------------------------------------
  {
    const g = new THREE.Group();
    g.position.set(LOTUS.x, 0, LOTUS.z);
    const plinth = new THREE.Mesh(new THREE.CylinderGeometry(3.3, 3.5, 0.32, 48), new THREE.MeshStandardMaterial({ color: 0x15171b, metalness: 0.5, roughness: 0.25 }));
    plinth.position.y = 0.16; plinth.receiveShadow = true; plinth.castShadow = true;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.42, 0.035, 6, 96), new THREE.MeshBasicMaterial({ color: 0x8fd8ff, toneMapped: false }));
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.3;
    const turn = new THREE.Group();
    turn.position.y = 0.32;
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(3.0, 3.0, 0.04, 48), new THREE.MeshStandardMaterial({ color: 0x2a2d33, metalness: 0.7, roughness: 0.2 }));
    disc.receiveShadow = true;
    const car = buildCar('lotus', 1.86, 4.19, 1.11, 0xf4f4f1);
    car.position.y = 0.02;
    turn.add(disc, car);
    turn.rotation.y = LOTUS.yaw;
    g.add(plinth, ring, turn);
    scene.add(g);
    world.lotus = turn;
    signs.add(boardText([{ text: '1976 LOTUS ESPRIT', size: 50 }, { text: '“WET NELLIE” · THE SPY WHO LOVED ME', size: 26, color: '#c7d0e0', weight: 600 }], { border: '#8fd8ff' }), 3.6, V(LOTUS.x + 4.2, 0.95, LOTUS.z + 1.6), 0.9);
    grey.box(LOTUS.x + 4.25, 0.45, LOTUS.z + 1.55, 3.3, 0.9, 0.12, 0.9);
    const spot = new THREE.SpotLight(0xfff2e0, 900, 40, 0.32, 0.5, 1.6);
    spot.position.set(LOTUS.x + 3, 16, LOTUS.z + 6);
    spot.target.position.set(LOTUS.x, 0.6, LOTUS.z);
    scene.add(spot, spot.target);
    steel.beam(V(LOTUS.x + 3, 0, LOTUS.z + 6.6), V(LOTUS.x + 3, 16.4, LOTUS.z + 6.6), 0.25);
    glowSprite(V(LOTUS.x + 3, 15.8, LOTUS.z + 6), 4, 0xfff2e0, 0.8);
  }

  // ---- C-wall -------------------------------------------------------------------------------
  {
    const { x0, zc, R: Rw, hw, thick, thetaMax } = WALL;
    const z0 = zc - hw, z1 = zc + hw, n = 64;
    const wtex = canvasTex(512, 512, (g, w, h) => {
      g.fillStyle = '#d4d6d9'; g.fillRect(0, 0, w, h);
      const r = rng(5);
      for (let i = 0; i < 2500; i++) { const v = 200 + r() * 30; g.fillStyle = `rgba(${v},${v},${v + 3},0.25)`; g.fillRect(r() * w, r() * h, 2, 2); }
      g.fillStyle = 'rgba(80,84,90,0.35)'; g.fillRect(0, 0, w, 3); // panel seam (along z)
      g.fillStyle = 'rgba(80,84,90,0.18)'; g.fillRect(w / 2 - 1, 0, 2, h);
      // edge stripes: red with white pinstripe
      g.fillStyle = '#d8141f'; g.fillRect(14, 0, 24, h); g.fillRect(w - 38, 0, 24, h);
      g.fillStyle = '#ffffff'; g.fillRect(44, 0, 6, h); g.fillRect(w - 50, 0, 6, h);
      g.fillStyle = '#1a1a1a'; g.fillRect(0, 0, 14, h); g.fillRect(w - 14, 0, 14, h);
    });
    wtex.wrapT = THREE.RepeatWrapping;
    const inner = new THREE.Mesh(arcStrip(Rw, 0, thetaMax, n, z0, z1, 5, 1), new THREE.MeshStandardMaterial({
      map: wtex, roughness: 0.38, metalness: 0.05, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2, envMapIntensity: 1.0,
    }));
    inner.receiveShadow = true; inner.castShadow = true;
    // outer shell, caps and the lip at the end of the ceiling
    const ro = Rw + thick;
    const t0o = Math.acos(Math.min(1, Rw / ro));
    const shellG = mergeGeometries([
      arcStrip(ro, t0o, thetaMax, n, z0, z1, 5, -1),
      arcCap(Rw, ro, 0, thetaMax, n, z0, -1),
      arcCap(Rw, ro, 0, thetaMax, n, z1, 1),
    ].map((gg) => { gg.deleteAttribute('uv'); return gg; }));
    const lip = new THREE.BoxGeometry(0.06, thick, 2 * hw).translate(x0 - 0.03, 2 * Rw + thick / 2, zc);
    const shellMat = new THREE.MeshStandardMaterial({ color: 0x2c2f35, roughness: 0.55, metalness: 0.5 });
    lip.deleteAttribute('uv');
    const shell = new THREE.Mesh(mergeGeometries([shellG, lip]), shellMat);
    shell.castShadow = true; shell.receiveShadow = true;
    scene.add(inner, shell);

    // light strips on both side caps and along the ceiling lip
    const ls = [];
    for (const [z, nz] of [[z0 - 0.01, -1], [z1 + 0.01, 1]]) ls.push(arcCap(Rw + 0.12, Rw + 0.26, 0.02, thetaMax, n, z, nz));
    ls.push(new THREE.BoxGeometry(0.08, 0.12, 2 * hw).translate(x0 - 0.07, 2 * Rw + 0.1, zc));
    ls.push(new THREE.BoxGeometry(0.4, 0.04, 2 * hw).translate(x0 - 0.6, 0.02, zc));
    scene.add(new THREE.Mesh(mergeGeometries(ls), new THREE.MeshBasicMaterial({ color: 0xbfeaff, toneMapped: false })));
    glowSprite(V(x0 - 0.5, 2 * Rw + 0.2, zc), 14, 0x7fcfff, 0.45);

    // arch trusses behind the shell
    const r1 = ro + 0.2, r2 = ro + 1.7;
    const P = (r, t, z) => V(x0 + r * Math.sin(t), Rw - r * Math.cos(t), z);
    const archZ = [z0 - 0.35, zc - hw / 3, zc + hw / 3, z1 + 0.35];
    const segs = 14;
    for (const z of archZ) {
      const ta = Math.acos(Math.min(1, Rw / r1)), tb = Math.acos(Math.min(1, Rw / r2));
      for (let i = 0; i < segs; i++) {
        const u = i / segs, u1 = (i + 1) / segs;
        const a1 = ta + (thetaMax - ta) * u, b1 = ta + (thetaMax - ta) * u1;
        const a2 = tb + (thetaMax - tb) * u, b2 = tb + (thetaMax - tb) * u1;
        steel.beam(P(r1, a1, z), P(r1, b1, z), 0.22);
        steel.beam(P(r2, a2, z), P(r2, b2, z), 0.22);
        steel.beam(P(r1, a1, z), P(r2, b2, z), 0.1);
        steel.beam(P(r1, b1, z), P(r2, b2, z), 0.12);
      }
    }
    // cross ties between arches along the outer chord
    for (let i = 0; i <= segs; i += 2) {
      const tb = Math.acos(Math.min(1, Rw / r2));
      const t = tb + (thetaMax - tb) * i / segs;
      for (let k = 0; k < archZ.length - 1; k++) steel.beam(P(r2, t, archZ[k]), P(r2, t, archZ[k + 1]), 0.14);
      if (i % 4 === 0) for (let k = 0; k < archZ.length - 1; k++) steel.beam(P(r2, t, archZ[k]), P(r1, t + 0.1, archZ[k + 1]), 0.08);
    }
    // scaffold towers on each side, outside the lane
    const xb = x0 + ro + 1.7, top = 2 * Rw + thick + 1.7;
    for (const zs of [z0 - 1.6, z1 + 1.6]) {
      const zIn = zs < zc ? z0 - 0.35 : z1 + 0.35;
      const colsX = [x0 - 1.2, x0 + 3.5, x0 + 7, xb];
      for (const x of colsX) for (const zz of [zs, zIn]) steel.beam(V(x, 0, zz), V(x, top, zz), 0.28);
      for (let y = 0; y <= top + 0.01; y += top / 6) {
        steel.beam(V(colsX[0], y, zs), V(xb, y, zs), 0.16);
        for (const x of colsX) steel.beam(V(x, y, zs), V(x, y, zIn), 0.12);
      }
      for (let k = 0; k < 6; k++) {
        const ya = k * top / 6, yb = (k + 1) * top / 6;
        for (let j = 0; j < colsX.length - 1; j++) steel.beam(V(colsX[j], k % 2 ? ya : yb, zs), V(colsX[j + 1], k % 2 ? yb : ya, zs), 0.09);
      }
      // warning beacons on top of the scaffold
      bulb(colsX[0], top + 0.3, zs, 0xff2a1a, 0.25);
      bulb(xb, top + 0.3, zs, 0xff2a1a, 0.25);
    }
    // top deck and back bracing across z
    for (const x of [x0 - 1.2, x0 + 3.5, x0 + 7, xb]) steel.beam(V(x, top, z0 - 1.6), V(x, top, z1 + 1.6), 0.24);
    for (let y = 0; y < top; y += top / 4) {
      steel.beam(V(xb, y, z0 - 1.6), V(xb, y + top / 4, z1 + 1.6), 0.1);
      steel.beam(V(xb, y + top / 4, z0 - 1.6), V(xb, y, z1 + 1.6), 0.1);
    }
    // fascia sign over the mouth
    signs.add((g, w, h) => {
      g.fillStyle = '#05060a'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = '800 70px "Helvetica Neue", Arial, sans-serif';
      g.fillText('THE  C - WALL', w / 2, h * 0.52);
      g.fillStyle = '#e31937'; g.fillRect(30, 10, w - 60, 6); g.fillRect(30, h - 16, w - 60, 6);
    }, 2 * hw + 3.2, V(x0 - 1.32, top + 1.3, zc), -Math.PI / 2);
    grey.box(x0 - 1.22, top + 1.3, zc, 0.15, 2.9, 2 * hw + 3.4);

    // side railings: posts sticking in toward the axis just outside the lane, two rails
    const railMat = new THREE.MeshStandardMaterial({ color: 0xb8bec6, metalness: 0.8, roughness: 0.35 });
    const PR = (r, t, z) => V(x0 + r * Math.sin(t), Rw - r * Math.cos(t), z);
    for (const z of [z0 - 0.12, z1 + 0.12]) {
      const nr = 24;
      for (let i = 0; i <= nr; i++) {
        const t = 0.25 + (thetaMax - 0.25) * i / nr;
        rails.beam(PR(Rw, t, z), PR(Rw - 1.0, t, z), 0.07);
        if (i < nr) {
          const t2 = 0.25 + (thetaMax - 0.25) * (i + 1) / nr;
          rails.beam(PR(Rw - 1.0, t, z), PR(Rw - 1.0, t2, z), 0.08);
          rails.beam(PR(Rw - 0.55, t, z), PR(Rw - 0.55, t2, z), 0.05);
        }
      }
    }
    world.railMat = railMat;

    // spotlights washing the inside of the C (no shadows)
    const s1 = new THREE.SpotLight(0xdfeaff, 2600, 90, 0.42, 0.6, 1.4);
    s1.position.set(x0 - 34, 7, zc - 10); s1.target.position.set(x0 + 4, 8, zc);
    const s2 = new THREE.SpotLight(0x9fb8ff, 1500, 70, 0.5, 0.7, 1.4);
    s2.position.set(x0 - 20, 1.5, zc + 12); s2.target.position.set(x0 + 3, 13, zc);
    scene.add(s1, s1.target, s2, s2.target);
    // light rigs for those spots
    for (const s of [s1, s2]) {
      steel.beam(V(s.position.x, 0, s.position.z), s.position.clone(), 0.2);
      glowSprite(s.position, 3.5, 0xdfeaff, 0.9);
    }
    const pl = new THREE.PointLight(0x6a3dff, 260, 40, 1.6);
    pl.position.set(x0 + 3, 4, z1 + 5);
    scene.add(pl);

    // smoke emitters along the wall base, either side of the lane and at the mouth
    for (const z of [z0 - 1.2, z1 + 1.2]) for (const x of [x0 - 3, x0 + 2, x0 + 6, x0 + 9]) world.smoke.push(V(x, 0.3, z));
    world.smoke.push(V(x0 - 6, 0.3, z0 - 2.5), V(x0 - 6, 0.3, z1 + 2.5));

    // Optimus standing by the wall, watching the approach
    const opt = buildOptimus();
    opt.position.set(x0 - 12, 0.25, z1 + 4.5);
    opt.rotation.y = 0.35;
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.75, 0.25, 24), new THREE.MeshStandardMaterial({ color: 0x15171b, metalness: 0.5, roughness: 0.3 }));
    ped.position.set(x0 - 12, 0.125, z1 + 4.5); ped.receiveShadow = true;
    scene.add(opt, ped);
    signs.add(boardText([{ text: 'OPTIMUS', size: 70 }], { border: '#ffffff' }), 1.6, V(x0 - 12.9, 0.18, z1 + 4.5), -Math.PI / 2);
  }

  // ---- smoke look (static drifting puffs; the game adds particles at world.smoke) -------------
  {
    const smokeTex = canvasTex(128, 128, (g, w) => {
      const r = rng(3);
      for (let i = 0; i < 14; i++) {
        const x = w / 2 + (r() - 0.5) * 50, y = w / 2 + (r() - 0.5) * 50, rad = 22 + r() * 30;
        const gr = g.createRadialGradient(x, y, 0, x, y, rad);
        gr.addColorStop(0, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr; g.fillRect(0, 0, w, w);
      }
    });
    world.puffs = [];
    const baseMat = new THREE.SpriteMaterial({ map: smokeTex, color: 0xaab6d0, transparent: true, depthWrite: false, opacity: 0.5 });
    const add = (p, s) => {
      const sp = new THREE.Sprite(baseMat.clone());
      sp.position.copy(p); sp.scale.set(s, s, 1);
      sp.material.rotation = R() * TAU;
      scene.add(sp);
      world.puffs.push({ sp, base: p.clone(), s, ph: R() * TAU });
    };
    const { x0, zc, hw } = WALL;
    for (let i = 0; i < 14; i++) {
      const side = i % 2 ? 1 : -1;
      add(V(x0 - 6 + R() * 18, 1.0 + R() * 2.5, zc + side * (hw + 1.5 + R() * 4)), 7 + R() * 7);
    }
    add(V(x0 - 8, 1.5, zc), 9); add(V(x0 - 14, 1.2, zc - 3), 8);
    for (let i = 0; i < 4; i++) add(V(LINEUP_X0() - 3 + R() * 18, 0.8 + R(), (i % 2 ? 1 : -1) * (4 + R() * 2)), 5 + R() * 3);
  }

  // ---- SpaceX McGregor test stands on the horizon ---------------------------------------------
  {
    const far = new Boxes();
    const reds = [], whites = [];
    const tower = (cx, cz, H, b, top = 0.55) => {
      const lev = Math.round(H / 7);
      for (let k = 0; k < lev; k++) {
        const y0 = H * k / lev, y1 = H * (k + 1) / lev;
        const w0 = b * (1 - (1 - top) * k / lev) / 2, w1 = b * (1 - (1 - top) * (k + 1) / lev) / 2;
        const c0 = [[-w0, -w0], [w0, -w0], [w0, w0], [-w0, w0]], c1 = [[-w1, -w1], [w1, -w1], [w1, w1], [-w1, w1]];
        for (let j = 0; j < 4; j++) {
          const a = c0[j], bb = c1[j], a2 = c0[(j + 1) % 4], b2 = c1[(j + 1) % 4];
          far.beam(V(cx + a[0], y0, cz + a[1]), V(cx + bb[0], y1, cz + bb[1]), 0.9);
          far.beam(V(cx + bb[0], y1, cz + bb[1]), V(cx + b2[0], y1, cz + b2[1]), 0.5);
          far.beam(V(cx + a[0], y0, cz + a[1]), V(cx + b2[0], y1, cz + b2[1]), 0.3);
        }
        if (k % 3 === 2) reds.push(cx + w1, y1, cz + w1, cx - w1, y1, cz - w1);
      }
      reds.push(cx, H + 2, cz);
      far.beam(V(cx, H, cz), V(cx, H + 2, cz), 0.6);
      whites.push(cx + b * 0.4, 3, cz + b * 0.4);
    };
    tower(1350, -520, 92, 16, 0.5);
    tower(1420, -470, 70, 12);
    tower(1650, 260, 80, 14);
    tower(1180, 720, 64, 12, 0.6);
    tower(-950, -900, 58, 10);
    tower(1900, -150, 54, 10);
    // gantry / test bay boxes and tanks
    far.box(1380, 18, -560, 34, 36, 18);
    far.box(1620, 12, 300, 26, 24, 22);
    far.box(1250, 6, 680, 40, 12, 14);
    for (let i = 0; i < 4; i++) far.box(1520 + i * 14, 7, -380, 9, 14, 9);
    const farMat = new THREE.MeshBasicMaterial({ color: 0x030407, fog: false });
    const farMesh = far.build(farMat, { cast: false, receive: false });
    scene.add(farMesh);
    const mk = (arr, col, size, blink) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      const ph = new Float32Array(arr.length / 3).map(() => R() * TAU);
      g.setAttribute('ph', new THREE.BufferAttribute(ph, 1));
      const m = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
        uniforms: { time: { value: 0 }, col: { value: new THREE.Color(col) }, size: { value: size * Math.min(2, renderer.getPixelRatio()) }, blink: { value: blink } },
        vertexShader: `attribute float ph; uniform float time; uniform float size; uniform float blink; varying float vA;
          void main(){ vA = mix(1.0, step(0.0, sin(time * 2.6 + ph * blink * 0.25)), blink);
            vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = size; gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `uniform vec3 col; varying float vA; void main(){ vec2 c = gl_PointCoord - 0.5; float d = dot(c, c);
          float a = smoothstep(0.25, 0.0, d); a = a * a + 0.6 * smoothstep(0.02, 0.0, d);
          gl_FragColor = vec4(col * a * (0.15 + 0.85 * vA) * 2.0, 1.0); }`,
      });
      const p = new THREE.Points(g, m); p.frustumCulled = false; scene.add(p);
      return m;
    };
    world.redLights = mk(reds, 0xff1a0a, 9, 1);
    world.siteLights = mk(whites, 0xffc77a, 6, 0);
  }

  // ---- desert scrub ---------------------------------------------------------------------------
  {
    const mats = [];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    while (mats.length < 1400) {
      const x = -900 + R() * 2600, z = -1100 + R() * 2200;
      if (x > PAD.x0 - 8 && x < PAD.x1 + 8 && z > PAD.z0 - 8 && z < PAD.z1 + 8) continue;
      const s = 0.4 + R() * 1.1;
      q.setFromAxisAngle(V(0, 1, 0), R() * TAU);
      m.compose(V(x, s * 0.25, z), q, V(s * (1 + R()), s * 0.6, s * (1 + R())));
      mats.push(m.clone());
    }
    const sm = new THREE.MeshLambertMaterial({ color: 0x3b3a26 });
    padFalloff(sm, 0.12, 110);
    const scrub = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), sm, mats.length);
    mats.forEach((mm, i) => scrub.setMatrixAt(i, mm));
    scrub.computeBoundingSphere();
    scene.add(scrub);
  }

  // stage warm fill near the start / Lotus area
  {
    const p = new THREE.PointLight(0xffb070, 420, 60, 1.5);
    p.position.set(-30, 9, -40);
    scene.add(p);
  }

  // ---- finalise collectors ----------------------------------------------------------------------
  scene.add(steel.build(steelMat));
  scene.add(rails.build(world.railMat || new THREE.MeshStandardMaterial({ color: 0xb8bec6, metalness: 0.8, roughness: 0.35 })));
  scene.add(grey.build(new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.7 })));
  {
    const im = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), bulbs.length);
    const m = new THREE.Matrix4(), c = new THREE.Color();
    bulbs.forEach((b, i) => { m.makeScale(b.s, b.s, b.s).setPosition(b.x, b.y, b.z); im.setMatrixAt(i, m); im.setColorAt(i, c.setHex(b.color)); });
    im.computeBoundingSphere();
    scene.add(im);
  }
  scene.add(signs.mesh());

  world.spawns = SPAWNS;
  world.bounds = BOUNDS;
  return world;
}

function LINEUP_X0() { return LINEUP[0].x0; }

const _v = new THREE.Vector3();

export function updateWorld(world, dt, t, target, info = {}) {
  info = info || {};
  if (target && world.key) {
    // snap to shadow texels to avoid shimmering
    const step = 96 / 2048;
    _v.set(Math.round(target.x / step) * step, 0, Math.round(target.z / step) * step);
    world.key.target.position.copy(_v);
    world.key.position.copy(_v).add(world.keyOffset);
    world.key.target.updateMatrixWorld();
  }
  if (world.stars) world.stars.material.uniforms.time.value = t;
  if (world.phones) world.phones.uniforms.time.value = t;
  if (world.redLights) world.redLights.uniforms.time.value = t;
  if (world.lotus) world.lotus.rotation.y += dt * 0.25;
  if (world.puffs) {
    for (const p of world.puffs) {
      p.sp.position.set(p.base.x + Math.sin(t * 0.13 + p.ph) * 1.5, p.base.y + Math.sin(t * 0.21 + p.ph * 2) * 0.4, p.base.z + Math.cos(t * 0.11 + p.ph) * 1.2);
      p.sp.material.rotation += dt * 0.05 * (p.ph > Math.PI ? 1 : -1);
      p.sp.material.opacity = 0.32 + 0.14 * Math.sin(t * 0.3 + p.ph);
    }
  }
  world._acc += dt;
  if (world._acc >= 0.125) {
    world._acc = 0;
    if (Number.isFinite(info.t60) && !(world._best <= info.t60)) world._best = info.t60;
    if (world.screen) {
      drawTelemetry(world.screen.g, 1024, 576, info, t, world.screen.overlay);
      world.screen.tex.needsUpdate = true;
    }
    if (world.timing) {
      drawTiming(world.timing.g, 512, 256, info, world._best);
      world.timing.tex.needsUpdate = true;
    }
  }
}
