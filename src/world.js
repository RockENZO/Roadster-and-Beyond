import * as THREE from 'three';
import { mergeGeometries as mergeRaw } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BOUNDS, PAD, STRIP, LINEUP, LINEUP_X, LINEUP_LANE, WALL, FLIP_PAD, LOTUS, STANDS, SPAWNS } from './track.js';

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

// The night launch venue at McGregor, matched to the broadcast: near-black surroundings, the stunt
// areas as pools of light on a dark pad, red light lines at ground level, a few tall floodlight towers,
// the tall wall ramp, the lineup lane, the red-pillar flip stage, the drag strip, the Lotus display,
// a dark grandstand with phone lights, two LED screens, power lines and the test stands on the horizon.
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

// Pools of light on the pad: the stunt areas are lit, the rest of the concrete falls off toward dark.
const POOLS = [
  // [ax, az, bx, bz, radius]
  [-75, 0, -35, 0, 30], // start box
  [-10, STRIP.zc, STRIP.x1, STRIP.zc, 17], // drag strip
  [LINEUP_LANE.x0 - 40, LINEUP_LANE.zc, LINEUP_X + 25, LINEUP_LANE.zc, 19], // lineup lane and landing
  [LINEUP_X, 0, LINEUP_X, 0, 26],
  [FLIP_PAD.pillarX, FLIP_PAD.z, FLIP_PAD.x + 12, FLIP_PAD.z, 24], // flip stage
  [FLIP_PAD.x, FLIP_PAD.z, 330, FLIP_PAD.z, 12],
  [WALL.x0 - 150, WALL.zc, WALL.x0 + 12, WALL.zc, 15], // wall approach
  [LOTUS.x, LOTUS.z, LOTUS.x, LOTUS.z, 13],
  [STANDS.x0, STANDS.z + 6, STANDS.x1, STANDS.z + 6, 9], // apron in front of the crowd
];
function poolShade(mat, base = 0.24, gain = 0.9) {
  const f = (v) => v.toFixed(2);
  const calls = POOLS.map(([ax, az, bx, bz, r]) => `m = max(m, pseg(p, vec2(${f(ax)}, ${f(az)}), vec2(${f(bx)}, ${f(bz)}), ${f(r)}));`).join('\n');
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWP;
        float pseg(vec2 p, vec2 a, vec2 b, float r) {
          vec2 ab = b - a; float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-4), 0.0, 1.0);
          float d = length(p - a - ab * t); return exp(-d * d / (r * r));
        }`)
      .replace('#include <opaque_fragment>', `{
        vec2 p = vWP.xz; float m = 0.0;
        ${calls}
        outgoingLight *= ${f(base)} + ${f(gain)} * m;
      }
      #include <opaque_fragment>`);
  };
  return mat;
}

export function buildWorld(scene, renderer) {
  const world = { smoke: [], exposure: 0.95, _acc: 1, _best: undefined };
  const R = rng(20261017);

  // ---- sky, fog, environment ------------------------------------------------------------
  const FOG = 0x06080d;
  scene.background = new THREE.Color(FOG);
  scene.fog = new THREE.FogExp2(FOG, 0.0024);

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(1, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { hor: { value: new THREE.Color(0x0b0f18) }, zen: { value: new THREE.Color(0x010103) }, glow: { value: new THREE.Color(0x1c1410) } },
      vertexShader: 'varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform vec3 hor; uniform vec3 zen; uniform vec3 glow; varying vec3 vD;
        void main(){ vec3 d = normalize(vD); float h = max(d.y, 0.0);
          vec3 c = mix(hor, zen, pow(h, 0.35));
          float az = max(dot(normalize(d.xz + 1e-5), normalize(vec2(0.8, 0.6))), 0.0);
          c += glow * pow(az, 6.0) * exp(-h * 16.0);
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }),
  );
  dome.renderOrder = -1000; dome.frustumCulled = false;
  {
    const n = 2200, p = new Float32Array(n * 3), a = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const y = 0.05 + Math.pow(R(), 0.8) * 0.95, ang = R() * TAU, r = Math.sqrt(1 - y * y);
      p.set([Math.cos(ang) * r * 0.97, y * 0.97, Math.sin(ang) * r * 0.97], i * 3);
      a.set([0.6 + Math.pow(R(), 6) * 3.0, R() * 100], i * 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.setAttribute('sz', new THREE.BufferAttribute(a, 2));
    const stars = new THREE.Points(g, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
      uniforms: { time: { value: 0 }, pr: { value: Math.min(2, renderer.getPixelRatio()) } },
      vertexShader: `attribute vec2 sz; uniform float time; uniform float pr; varying float vA;
        void main(){ vA = (0.55 + 0.45 * sin(time * 1.7 + sz.y)) * smoothstep(0.03, 0.25, position.y) * (0.25 + 0.2 * sz.x);
          gl_PointSize = sz.x * pr * 1.3; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
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

  // Environment: a dark studio with a few hard floodlight panels and a red strip, for paint and glass.
  {
    const env = new THREE.Scene();
    env.background = new THREE.Color(0x020306);
    const panel = (w, h, pos, color, k) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide }));
      m.position.copy(pos); m.lookAt(0, 0, 0); env.add(m);
    };
    panel(30, 12, V(0, 45, 0), 0xffffff, 1.6);
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * TAU + 0.3;
      panel(10, 3.5, V(Math.cos(a) * 45, 18 + (i % 2) * 8, Math.sin(a) * 45), 0xeaf3ff, 7);
    }
    panel(60, 1.5, V(-30, 1.5, 35), 0xff1a1a, 1.5);
    panel(60, 1.5, V(30, 1.5, -35), 0xff1a1a, 1.5);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshBasicMaterial({ color: 0x15161a }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -4; env.add(floor);
    const pm = new THREE.PMREMGenerator(renderer);
    scene.environment = pm.fromScene(env, 0.02, 0.1, 300).texture;
    scene.environmentIntensity = 0.5;
    pm.dispose();
  }

  // ---- lights ---------------------------------------------------------------------------------
  const hemi = new THREE.HemisphereLight(0x7f95c4, 0x1a1612, 0.45);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xe6eeff, 1.75);
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

  // ---- ground: desert ring around the pad (no overlap, so no z-fighting at range) -------------
  const sand = canvasTex(512, 512, (g, w, h) => {
    const r = rng(7);
    g.fillStyle = '#4a3e31'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) {
      const v = 50 + r() * 45;
      g.fillStyle = `rgba(${v + 22},${v + 8},${v - 12},${0.15 + r() * 0.25})`;
      g.fillRect(r() * w, r() * h, 1 + r() * 3, 1 + r() * 3);
    }
    for (let i = 0; i < 30; i++) {
      g.strokeStyle = `rgba(20,15,10,${0.08 + r() * 0.08})`; g.lineWidth = 2 + r() * 8;
      g.beginPath(); g.moveTo(r() * w, r() * h); g.bezierCurveTo(r() * w, r() * h, r() * w, r() * h, r() * w, r() * h); g.stroke();
    }
  });
  sand.wrapS = sand.wrapT = THREE.RepeatWrapping;
  {
    const E = 4000, X0 = 300 - E, X1 = 300 + E, Z0 = -E, Z1 = E;
    const rects = [[X0, X1, Z0, PAD.z0], [X0, X1, PAD.z1, Z1], [X0, PAD.x0, PAD.z0, PAD.z1], [PAD.x1, X1, PAD.z0, PAD.z1]];
    const geos = rects.map(([a, b, c, d]) => {
      const g = new THREE.PlaneGeometry(b - a, d - c);
      g.rotateX(-Math.PI / 2); g.translate((a + b) / 2, 0, (c + d) / 2);
      const p = g.attributes.position, uv = g.attributes.uv;
      for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / 40, p.getZ(i) / 40);
      return g;
    });
    const desertMat = new THREE.MeshLambertMaterial({ map: sand });
    padFalloff(desertMat, 0.1, 90);
    const desert = new THREE.Mesh(mergeGeometries(geos), desertMat);
    desert.receiveShadow = true;
    scene.add(desert);
  }

  // concrete pad: dark, 6 m slabs with joints, stains; lit in pools
  const TILE = 24;
  const conc = canvasTex(1024, 1024, (g, w, h) => {
    const r = rng(11);
    g.fillStyle = '#6b6c6c'; g.fillRect(0, 0, w, h);
    for (let sx = 0; sx < 4; sx++) for (let sy = 0; sy < 4; sy++) {
      const v = 100 + r() * 16;
      g.fillStyle = `rgba(${v},${v},${v},0.3)`; g.fillRect(sx * 256, sy * 256, 256, 256);
    }
    const img = g.getImageData(0, 0, w, h), d = img.data;
    for (let i = 0; i < d.length; i += 4) { const n = (r() - 0.5) * 16; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
    g.putImageData(img, 0, 0);
    for (let i = 0; i < 80; i++) {
      const x = r() * w, y = r() * h, rad = 10 + r() * 80;
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, `rgba(20,20,20,${0.06 + r() * 0.12})`); gr.addColorStop(1, 'rgba(20,20,20,0)');
      g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    g.strokeStyle = 'rgba(15,15,15,0.6)'; g.lineWidth = 3;
    for (let k = 0; k <= 4; k++) {
      g.beginPath(); g.moveTo(k * 256, 0); g.lineTo(k * 256, h); g.stroke();
      g.beginPath(); g.moveTo(0, k * 256); g.lineTo(w, k * 256); g.stroke();
    }
    g.strokeStyle = 'rgba(10,10,10,0.25)'; g.lineWidth = 1.5;
    for (let i = 0; i < 25; i++) {
      g.beginPath(); let x = r() * w, y = r() * h; g.moveTo(x, y);
      for (let k = 0; k < 6; k++) { x += (r() - 0.5) * 40; y += (r() - 0.5) * 40; g.lineTo(x, y); }
      g.stroke();
    }
  });
  conc.wrapS = conc.wrapT = THREE.RepeatWrapping;
  const padW = PAD.x1 - PAD.x0, padD = PAD.z1 - PAD.z0;
  conc.repeat.set(padW / TILE, padD / TILE);
  const pad = new THREE.Mesh(new THREE.PlaneGeometry(padW, padD), poolShade(new THREE.MeshStandardMaterial({ map: conc, roughness: 0.85, metalness: 0, envMapIntensity: 0.5 })));
  pad.rotation.x = -Math.PI / 2;
  pad.position.set((PAD.x0 + PAD.x1) / 2, 0, (PAD.z0 + PAD.z1) / 2);
  pad.receiveShadow = true;
  scene.add(pad);

  // ---- paint and asphalt lanes ------------------------------------------------------------------
  const asphalt = new Paint(0.008), white = new Paint(0.02), yellow = new Paint(0.021), red = new Paint(0.022);
  const LL = LINEUP_LANE;
  asphalt.span(LL.x0, LL.x1, LL.zc - LL.hw, LL.zc + LL.hw);
  asphalt.span(FLIP_PAD.pillarX + 3, 330, FLIP_PAD.z - 7, FLIP_PAD.z + 7);
  asphalt.span(STRIP.x0 - 25, STRIP.x1, STRIP.zc - STRIP.hw, STRIP.zc + STRIP.hw);
  asphalt.span(WALL.x0 - 150, WALL.x0, WALL.zc - WALL.hw - 2, WALL.zc + WALL.hw + 2);
  // drag strip
  const S = STRIP;
  for (const zz of [S.zc - S.hw, S.zc + S.hw]) white.span(S.x0 - 25, S.x1, zz - 0.12, zz + 0.12);
  white.span(S.x0 - 0.25, S.x0 + 0.25, S.zc - S.hw, S.zc + S.hw);
  for (let k = 0; k < 14; k++) {
    const zz = S.zc - S.hw + k;
    (k % 2 ? white : red).span(S.x0 - 1.6, S.x0 - 0.8, zz, zz + 1);
    (k % 2 ? red : white).span(S.x0 - 2.4, S.x0 - 1.6, zz, zz + 1);
  }
  white.span(S.x0 - 6.2, S.x0 - 5.9, S.zc - S.hw, S.zc + S.hw);
  for (const x of [18.3, 100, 201.2, 304.8, 402.3]) white.span(x - 0.15, x + 0.15, S.zc - S.hw, S.zc + S.hw);
  white.span(S.x1 - 0.6, S.x1, S.zc - S.hw, S.zc + S.hw);
  // start box and route to the lineup lane
  for (const zz of [-6, 6]) white.span(-70, -50, zz - 0.15, zz + 0.15);
  white.span(-50.2, -49.8, -6, 6);
  for (let x = -40; x < LL.x0; x += 10) white.span(x, x + 4, -0.1, 0.1);
  // lineup lane: solid white centre line, cross tick, landing line
  white.span(LL.x0, LL.x1, LL.zc - 0.13, LL.zc + 0.13);
  for (let x = LL.x0 + 20; x < LL.x1; x += 40) white.span(x - 0.08, x + 0.08, LL.zc - 1.2, LL.zc + 1.2);
  for (let x = LL.x0 + 6; x < LL.x1 - 6; x += 9) { white.span(x, x + 3, LL.zc - LL.hw + 2.2, LL.zc - LL.hw + 2.5); white.span(x, x + 3, LL.zc + LL.hw - 2.5, LL.zc + LL.hw - 2.2); }
  // flip lane: centre line toward +x
  white.span(FLIP_PAD.x - FLIP_PAD.r, 330, FLIP_PAD.z - 0.13, FLIP_PAD.z + 0.13);
  white.span(FLIP_PAD.x - 0.1, FLIP_PAD.x + 0.1, FLIP_PAD.z - 2, FLIP_PAD.z + 2);
  // wall approach
  white.span(WALL.x0 - 150, WALL.x0, WALL.zc - 0.1, WALL.zc + 0.1);
  for (const zz of [WALL.zc - WALL.hw, WALL.zc + WALL.hw]) white.span(WALL.x0 - 150, WALL.x0, zz - 0.08, zz + 0.08);
  const markMat = (c, o, rough = 0.6) => poolShade(new THREE.MeshStandardMaterial({ color: c, roughness: rough, polygonOffset: true, polygonOffsetFactor: -1 - o, polygonOffsetUnits: -2 - o, envMapIntensity: 0.4 }), 0.45, 0.7);
  scene.add(asphalt.mesh(markMat(0x232427, 0, 0.9)), white.mesh(markMat(0xe8e8e2, 2)), yellow.mesh(markMat(0xd9a404, 3)), red.mesh(markMat(0xb3101a, 4)));

  // ---- shared collectors -----------------------------------------------------------------------
  const steel = new Boxes(), rails = new Boxes(), grey = new Boxes(), bulbs = [];
  const steelMat = new THREE.MeshStandardMaterial({ color: 0x15171b, metalness: 0.7, roughness: 0.45 });
  const signs = new SignAtlas();
  const redGeos = [], whiteGlowGeos = [];
  const glowTex = radialTex([[0, 'rgba(255,255,255,1)'], [0.15, 'rgba(255,255,255,0.6)'], [0.45, 'rgba(255,255,255,0.12)'], [1, 'rgba(255,255,255,0)']]);
  const glowSprite = (pos, size, color, opacity = 1) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true, opacity }));
    s.position.copy(pos); s.scale.set(size, size, 1); scene.add(s); return s;
  };
  const bulb = (x, y, z, color, s = 0.25) => bulbs.push({ x, y, z, color, s });
  // light beams (thin additive shafts) — one instanced mesh, coloured per instance
  const beams = [];
  const beam = (base, dir, len, width, color) => { beams.push({ base: base.clone(), dir: dir.clone().normalize(), len, width, color: new THREE.Color(color) }); return beams.length - 1; };
  // low barrier with a red light bar on top, along x at z
  const redBarrier = (x0, x1, z, { gaps = 0, lamps = 0, tubes = 0 } = {}) => {
    const len = x1 - x0;
    grey.box((x0 + x1) / 2, 0.3, z, len, 0.6, 0.35);
    const segs = gaps ? Math.floor(len / gaps) : 1;
    for (let i = 0; i < segs; i++) {
      const a = x0 + i * len / segs + (gaps ? 0.6 : 0), b = x0 + (i + 1) * len / segs - (gaps ? 0.6 : 0);
      redGeos.push(new THREE.BoxGeometry(b - a, 0.07, 0.08).translate((a + b) / 2, 0.64, z));
    }
    if (lamps) for (let x = x0 + lamps / 2; x < x1; x += lamps) { grey.box(x, 0.8, z, 0.35, 0.4, 0.35); whiteGlowGeos.push(new THREE.BoxGeometry(0.28, 0.18, 0.37).translate(x, 0.82, z)); }
    if (tubes) for (let x = x0 + tubes / 2; x < x1; x += tubes) redGeos.push(new THREE.CylinderGeometry(0.05, 0.05, 3.6, 6).translate(x, 2.4, z + Math.sign(z || 1) * 1.2));
    if (tubes) for (let x = x0 + tubes / 2; x < x1; x += tubes) steel.beam(V(x, 0, z + Math.sign(z || 1) * 1.2), V(x, 0.6, z + Math.sign(z || 1) * 1.2), 0.12);
  };

  // ---- floodlight towers: few, tall, bright white heads ------------------------------------------
  {
    const towers = [
      [-95, PAD.z1 + 8, -40, 0], [LINEUP_X + 28, 14, LINEUP_X - 10, 0], [FLIP_PAD.x + 20, PAD.z1 + 8, FLIP_PAD.x, FLIP_PAD.z],
      [390, PAD.z1 + 8, 380, 40], [WALL.x0 - 40, -30, WALL.x0 - 60, WALL.zc], [120, PAD.z0 - 22, 120, STRIP.zc], [420, PAD.z0 - 22, 420, STRIP.zc],
    ];
    const poles = new Boxes(), heads = new Boxes(), faces = [];
    for (const [x, z, ax, az] of towers) {
      const H = 34 + (x % 7);
      poles.beam(V(x, 0, z), V(x, H, z), 0.7);
      const head = V(x, H + 1.8, z);
      const aim = V(ax, 0, az);
      const quat = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(head, aim, V(0, 1, 0)));
      heads.m.push(new THREE.Matrix4().compose(head, quat, V(5.4, 3.4, 0.6)));
      faces.push(new THREE.Matrix4().compose(head.clone().add(V(0, 0, -0.32).applyQuaternion(quat)), quat.clone().multiply(new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), Math.PI)), V(5.0, 3.0, 1)));
      glowSprite(head.clone().add(V(0, 0, -1.0).applyQuaternion(quat)), 22, 0xd8f0ff, 0.75);
      for (let k = 0; k < H - 2; k += 4) steel.beam(V(x + 0.5, k, z), V(x + 0.5, k + 4, z), 0.08);
    }
    scene.add(poles.build(new THREE.MeshStandardMaterial({ color: 0x2a2e34, metalness: 0.6, roughness: 0.5 }), { geo: new THREE.CylinderGeometry(0.5, 0.5, 1, 8), cast: false }));
    scene.add(heads.build(steelMat, { cast: false }));
    const lampTex = canvasTex(256, 160, (g, w, h) => {
      g.fillStyle = '#0d0e10'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 5; i++) for (let j = 0; j < 3; j++) {
        const cx = 28 + i * 50, cy = 30 + j * 50;
        const gr = g.createRadialGradient(cx, cy, 0, cx, cy, 20);
        gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.7, '#e2f4ff'); gr.addColorStop(1, '#3a4250');
        g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, 19, 0, TAU); g.fill();
      }
    });
    const faceMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: lampTex, toneMapped: false, fog: false }), faces.length);
    faces.forEach((m, i) => faceMesh.setMatrixAt(i, m));
    scene.add(faceMesh);
  }

  // ---- power poles and wires ---------------------------------------------------------------------
  {
    const wood = new Boxes(), wires = [];
    const line = (pts) => {
      for (let i = 0; i < pts.length; i++) {
        const [x, z] = pts[i];
        wood.beam(V(x, 0, z), V(x, 12.5, z), 0.32);
        const nx = pts[Math.min(i + 1, pts.length - 1)][0] - pts[Math.max(i - 1, 0)][0], nz = pts[Math.min(i + 1, pts.length - 1)][1] - pts[Math.max(i - 1, 0)][1];
        const L = Math.hypot(nx, nz) || 1, px = -nz / L, pz = nx / L;
        wood.beam(V(x - px * 1.4, 11.6, z - pz * 1.4), V(x + px * 1.4, 11.6, z + pz * 1.4), 0.18);
        wood.beam(V(x, 10.6, z), V(x + px * 1.0, 11.6, z + pz * 1.0), 0.07);
        wood.beam(V(x, 10.6, z), V(x - px * 1.0, 11.6, z - pz * 1.0), 0.07);
        if (i < pts.length - 1) {
          const [x2, z2] = pts[i + 1];
          for (const o of [-1.25, 0, 1.25]) {
            const a = V(x + px * o, o === 0 ? 12.5 : 11.75, z + pz * o), b = V(x2 + px * o, o === 0 ? 12.5 : 11.75, z2 + pz * o);
            const N = 8;
            for (let k = 0; k < N; k++) {
              const u0 = k / N, u1 = (k + 1) / N;
              const p0 = a.clone().lerp(b, u0), p1 = a.clone().lerp(b, u1);
              p0.y -= 4 * 1.6 * u0 * (1 - u0); p1.y -= 4 * 1.6 * u1 * (1 - u1);
              wires.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z);
            }
          }
        }
      }
    };
    const a = [];
    for (let x = -360; x <= 960; x += 55) a.push([x, PAD.z1 + 24 + Math.sin(x * 0.01) * 3]);
    line(a);
    const b = [];
    for (let k = 0; k <= 9; k++) b.push([PAD.x1 + 40 + k * 8, -380 + k * 60]);
    line(b);
    line([[LINEUP_X + 12, -150], [LINEUP_X + 30, -60], [LINEUP_X + 40, 30]]);
    scene.add(wood.build(new THREE.MeshStandardMaterial({ color: 0x241c15, roughness: 0.9 }), { geo: new THREE.CylinderGeometry(0.5, 0.5, 1, 6), cast: false }));
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(wires, 3));
    scene.add(new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0x3a3f48 })));
  }

  // ---- grandstand (kept dark: silhouettes, phone lights, a red strip) ---------------------------
  {
    const N = 14, D = 0.85, Hs = 0.45, base = 1.2;
    const pts = [[0, 0], [0, base]];
    for (let r = 0; r < N; r++) {
      pts.push([(r + 1) * D, base + r * Hs]);
      if (r < N - 1) pts.push([(r + 1) * D, base + (r + 1) * Hs]);
    }
    pts.push([N * D, base + (N - 1) * Hs + 1.4], [N * D + 0.3, base + (N - 1) * Hs + 1.4], [N * D + 0.3, 0]);
    const L = STANDS.x1 - STANDS.x0;
    const geo = new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(([u, v]) => new THREE.Vector2(u, v))), { depth: L, bevelEnabled: false });
    geo.rotateY(Math.PI / 2);
    geo.translate(STANDS.x0, 0, STANDS.z);
    const stand = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x2a2c31, roughness: 0.85 }));
    stand.castShadow = true; stand.receiveShadow = true;
    scene.add(stand);
    const backZ = STANDS.z - N * D;
    redGeos.push(new THREE.BoxGeometry(L, 0.08, 0.06).translate(STANDS.x0 + L / 2, base - 0.2, STANDS.z + 0.04));
    for (let x = STANDS.x0; x <= STANDS.x1 + 0.1; x += 4) rails.beam(V(x, base, STANDS.z + 0.15), V(x, base + 1.0, STANDS.z + 0.15), 0.06);
    rails.beam(V(STANDS.x0, base + 1.0, STANDS.z + 0.15), V(STANDS.x1, base + 1.0, STANDS.z + 0.15), 0.07);
    for (let x = STANDS.x0; x <= STANDS.x1 + 0.1; x += 20) steel.beam(V(x, 0, backZ - 0.6), V(x, base + N * Hs + 6, backZ - 0.6), 0.4);
    steel.beam(V(STANDS.x0, base + N * Hs + 6, backZ - 0.6), V(STANDS.x1, base + N * Hs + 6, backZ - 0.6), 0.5);
    for (let x = STANDS.x0 + 14; x < STANDS.x1; x += 28) for (let r = 0; r < N; r += 2) bulb(x, base + r * Hs + 0.05, STANDS.z - r * D - 0.05, 0xff2a2a, 0.07);

    const person = mergeGeometries([
      new THREE.CylinderGeometry(0.17, 0.22, 1.3, 5, 1).translate(0, 0.65, 0),
      new THREE.OctahedronGeometry(0.13, 0).translate(0, 1.47, 0),
    ]);
    const crowdMats = [], cols = [];
    const palette = [0x1b1d22, 0x22252c, 0x2e3440, 0x463a30, 0x0f1012, 0x5a5f66, 0x6a1f1f, 0x203350, 0xa9a9a9, 0x2b4a2b, 0x30303a];
    const phones = [], phase = [];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
    for (let r = 0; r < N; r++) {
      const y = base + r * Hs, z = STANDS.z - (r + 0.5) * D;
      for (let x = STANDS.x0 + 0.4; x < STANDS.x1 - 0.4; x += 0.62) {
        const lx = (x - STANDS.x0) % 28;
        if (lx > 13 && lx < 15.2) continue;
        if (R() < 0.07) continue;
        const s = 0.88 + R() * 0.24;
        q.setFromAxisAngle(V(0, 1, 0), (R() - 0.5) * 0.8);
        const px = x + (R() - 0.5) * 0.2, pz = z + (R() - 0.5) * 0.15;
        m.compose(V(px, y, pz), q, V(s, s * (0.92 + R() * 0.16), s));
        crowdMats.push(m.clone());
        c.setHex(palette[Math.floor(R() * palette.length)]).multiplyScalar(0.5 + R() * 0.4);
        cols.push(c.clone());
        if (R() < 0.06) { phones.push(px + 0.12, y + 1.75 * s + R() * 0.25, pz + 0.2); phase.push(R() * 100, 0.4 + R() * 1.6); }
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
        void main(){ float s = sin(time * ph.y + ph.x); vA = 0.2 + 0.8 * pow(max(s, 0.0), 6.0);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = clamp(pr * (2.0 + 7.0 * vA) * 50.0 / -mv.z, 1.2, 18.0);
          gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying float vA; void main(){ vec2 c = gl_PointCoord - 0.5; float d = dot(c, c);
        float a = smoothstep(0.25, 0.0, d); gl_FragColor = vec4(vec3(0.85, 0.92, 1.0) * a * (0.25 + vA * 1.1), 1.0); }`,
    });
    scene.add(new THREE.Points(pg, pmat));
    world.phones = pmat;
  }

  // ---- LED screens (two, dimmed so they don't flood the night) -------------------------------
  {
    const can = document.createElement('canvas');
    can.width = 1024; can.height = 576;
    const overlay = document.createElement('canvas');
    overlay.width = 1024; overlay.height = 576;
    const og = overlay.getContext('2d');
    og.fillStyle = 'rgba(0,0,0,0.3)';
    for (let y = 0; y < 576; y += 4) og.fillRect(0, y, 1024, 1);
    for (let x = 0; x < 1024; x += 4) og.fillRect(x, 0, 1, 576);
    const tex = new THREE.CanvasTexture(can);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, fog: false, color: new THREE.Color(0.62, 0.62, 0.62) });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x0b0c0e, roughness: 0.6, metalness: 0.4 });
    const place = (x, y, z, w, yaw) => {
      const h = w * 9 / 16;
      const g = new THREE.Group();
      const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      face.position.z = 0.42;
      g.add(new THREE.Mesh(new THREE.BoxGeometry(w + 0.8, h + 0.8, 0.8), frameMat), face);
      g.position.set(x, y, z); g.rotation.y = yaw;
      scene.add(g);
      const right = V(Math.cos(yaw), 0, -Math.sin(yaw)), back = V(Math.sin(yaw), 0, Math.cos(yaw));
      for (const s of [-0.35, 0.35]) {
        const p = V(x, 0, z).addScaledVector(right, s * w).addScaledVector(back, -1);
        steel.beam(p, p.clone().setY(y), 0.6);
      }
    };
    place(640, 14, -20, 34, -Math.PI / 2);
    place(320, 19, STANDS.z - 15, 30, 0);
    world.screen = { can, g: can.getContext('2d'), tex, overlay };
    drawTelemetry(world.screen.g, 1024, 576, {}, 0, overlay);
  }

  // ---- drag strip: tree, timing tower, distance boards, red barriers ---------------------------
  {
    const zT = S.zc - S.hw - 1.6;
    steel.beam(V(-3, 0, zT), V(-3, 4.2, zT), 0.18);
    grey.box(-3, 3.0, zT, 0.3, 2.6, 0.5);
    const tl = [[0xffffff, 3.9], [0xffffff, 3.65], [0xffa21a, 3.3], [0xffa21a, 3.0], [0xffa21a, 2.7], [0x22ff55, 2.35], [0x441010, 2.0]];
    for (const [col, y] of tl) bulb(-3.18, y, zT, col, 0.2);
    const tx = 14, tz = S.zc - S.hw - 9;
    for (const dz of [-2.2, 2.2]) steel.beam(V(tx, 0, tz + dz), V(tx, 11, tz + dz), 0.35);
    for (let y = 1; y < 8; y += 2.2) { steel.beam(V(tx, y, tz - 2.2), V(tx, y + 2.2, tz + 2.2), 0.12); steel.beam(V(tx, y + 2.2, tz - 2.2), V(tx, y, tz + 2.2), 0.12); }
    const can = document.createElement('canvas'); can.width = 512; can.height = 256;
    const tex = new THREE.CanvasTexture(can); tex.colorSpace = THREE.SRGBColorSpace;
    const tb = new THREE.Group();
    const tMat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
    const f1 = new THREE.Mesh(new THREE.PlaneGeometry(8.4, 4.2), tMat); f1.rotation.y = -Math.PI / 2; f1.position.x = -0.26;
    const f2 = new THREE.Mesh(new THREE.PlaneGeometry(8.4, 4.2), tMat); f2.rotation.y = Math.PI / 2; f2.position.x = 0.26;
    tb.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 4.8, 8.8), new THREE.MeshStandardMaterial({ color: 0x0b0c0e, roughness: 0.6 })), f1, f2);
    tb.position.set(tx, 12.6, tz); tb.rotation.y = 0.35;
    scene.add(tb);
    world.timing = { can, g: can.getContext('2d'), tex };
    drawTiming(world.timing.g, 512, 256, {}, undefined);
    const labels = [[18.3, '60 FT'], [100, '100 M'], [201.2, '1/8 MILE'], [304.8, '1000 FT'], [402.3, '1/4 MILE']];
    for (const [x, t] of labels) {
      const z = S.zc - S.hw - 3.2;
      steel.beam(V(x, 0, z - 1.6), V(x, 4.6, z - 1.6), 0.2);
      steel.beam(V(x, 0, z + 1.6), V(x, 4.6, z + 1.6), 0.2);
      grey.box(x + 0.08, 3.9, z, 0.12, 1.25, 4.6);
      signs.add(boardText([{ text: t, size: 78 }]), 4.4, V(x - 0.02, 3.9, z), -Math.PI / 2);
    }
    signs.add(boardText([{ text: '0–60 MPH', size: 64 }, { text: 'DRAG STRIP', size: 40, color: '#ffd75e', weight: 700 }]), 6, V(-12, 3.4, S.zc - S.hw - 4.5), -Math.PI / 2 + 0.5);
    steel.beam(V(-12, 0, S.zc - S.hw - 4.5), V(-12, 2.6, S.zc - S.hw - 4.5), 0.25);
    redBarrier(S.x0 + 6, S.x1, S.zc - S.hw - 1.4, { gaps: 12 });
    redBarrier(S.x0 - 20, S.x1, S.zc + S.hw + 1.4, { gaps: 12 });
  }

  // ---- stage rig by the start: truss towers, a lamp bar and a row of fixtures --------------------
  {
    const ax = -44, hz = 18, top = 11;
    for (const s of [-1, 1]) {
      for (const dx of [-0.8, 0.8]) for (const dz of [-0.8, 0.8]) steel.beam(V(ax + dx, 0, s * hz + dz), V(ax + dx, top + 1, s * hz + dz), 0.18);
      for (let y = 0.5; y < top; y += 1.6) { steel.beam(V(ax - 0.8, y, s * hz - 0.8), V(ax + 0.8, y + 1.6, s * hz - 0.8), 0.07); steel.beam(V(ax - 0.8, y, s * hz + 0.8), V(ax + 0.8, y + 1.6, s * hz + 0.8), 0.07); }
    }
    for (const dx of [-0.8, 0.8]) for (const y of [top, top + 1]) steel.beam(V(ax + dx, y, -hz), V(ax + dx, y, hz), 0.18);
    for (let z = -hz; z < hz; z += 2) { steel.beam(V(ax - 0.8, top, z), V(ax + 0.8, top + 1, z + 2), 0.07); }
    for (let z = -hz + 3; z <= hz - 3; z += 3) {
      grey.box(ax - 1.1, top - 0.4, z, 0.5, 0.6, 0.6);
      bulb(ax - 1.38, top - 0.4, z, 0xf2f7ff, 0.22);
    }
    glowSprite(V(ax - 1.6, top - 0.4, -6), 10, 0xe8f2ff, 0.5);
    glowSprite(V(ax - 1.6, top - 0.4, 6), 10, 0xe8f2ff, 0.5);
    redGeos.push(new THREE.BoxGeometry(0.06, 0.1, 2 * hz).translate(ax - 0.9, top + 1.2, 0));
    const p = new THREE.PointLight(0xfff0e0, 220, 45, 1.6);
    p.position.set(ax - 6, 9, 0);
    scene.add(p);
  }

  // ---- lineup lane: barriers with red light bars and lamps, the lineup, its flood --------------------
  {
    redBarrier(LL.x0, LL.x1, LL.zc - LL.hw, { gaps: 6, lamps: 9, tubes: 18 });
    redBarrier(LL.x0, LL.x1, LL.zc + LL.hw, { gaps: 6, lamps: 9, tubes: 18 });
    for (const c of LINEUP) {
      const car = c.kind === 'semi' ? buildSemi(c) : buildCar(c.kind, c.w, c.len, c.h, c.color);
      car.position.set(c.xc, 0, c.zc);
      scene.add(car);
    }
    const lx0 = LINEUP[0].x0, lx1 = LINEUP[LINEUP.length - 1].x1;
    // red light strips on the ground in front of and behind the lineup
    for (const z of [-4.2, 4.2]) redGeos.push(new THREE.BoxGeometry(lx1 - lx0 + 6, 0.05, 0.12).translate((lx0 + lx1) / 2, 0.03, z));
    redGeos.push(new THREE.BoxGeometry(0.12, 0.05, 8.4).translate(lx0 - 3, 0.03, 0), new THREE.BoxGeometry(0.12, 0.05, 8.4).translate(lx1 + 3, 0.03, 0));
    const spot = new THREE.SpotLight(0xe6f4ff, 2400, 120, 0.42, 0.5, 1.5);
    spot.position.set(LINEUP_X + 28, 36, 14);
    spot.target.position.set(LINEUP_X - 8, 0, 0);
    scene.add(spot, spot.target);
    for (const s of [-1, 1]) world.smoke.push(V(lx0 - 2, 0.3, s * 5), V(lx1 + 2, 0.3, s * 5));
  }

  // ---- Lotus Esprit display --------------------------------------------------------------------
  {
    const g = new THREE.Group();
    g.position.set(LOTUS.x, 0, LOTUS.z);
    const plinth = new THREE.Mesh(new THREE.CylinderGeometry(3.3, 3.5, 0.32, 48), new THREE.MeshStandardMaterial({ color: 0x111316, metalness: 0.5, roughness: 0.25 }));
    plinth.position.y = 0.16; plinth.receiveShadow = true; plinth.castShadow = true;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.42, 0.035, 6, 96), new THREE.MeshBasicMaterial({ color: 0xff2a2a, toneMapped: false }));
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.3;
    const turn = new THREE.Group();
    turn.position.y = 0.32;
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(3.0, 3.0, 0.04, 48), new THREE.MeshStandardMaterial({ color: 0x24272c, metalness: 0.7, roughness: 0.2 }));
    disc.receiveShadow = true;
    const car = buildCar('lotus', 1.86, 4.19, 1.11, 0xf4f4f1);
    car.position.y = 0.02;
    turn.add(disc, car);
    turn.rotation.y = LOTUS.yaw;
    g.add(plinth, ring, turn);
    scene.add(g);
    world.lotus = turn;
    signs.add(boardText([{ text: '1976 LOTUS ESPRIT', size: 50 }, { text: '“WET NELLIE” · THE SPY WHO LOVED ME', size: 26, color: '#c7d0e0', weight: 600 }], { border: '#ff2a2a' }), 3.6, V(LOTUS.x + 4.2, 0.95, LOTUS.z + 1.6), 0.9);
    grey.box(LOTUS.x + 4.2 - Math.sin(0.9) * 0.1, 0.72, LOTUS.z + 1.6 - Math.cos(0.9) * 0.1, 3.7, 1.44, 0.12, 0.9);
    const spot = new THREE.SpotLight(0xfff2e0, 1100, 40, 0.3, 0.5, 1.6);
    spot.position.set(LOTUS.x + 3, 16, LOTUS.z + 6);
    spot.target.position.set(LOTUS.x, 0.6, LOTUS.z);
    scene.add(spot, spot.target);
    steel.beam(V(LOTUS.x + 3, 0, LOTUS.z + 6.6), V(LOTUS.x + 3, 16.4, LOTUS.z + 6.6), 0.25);
    glowSprite(V(LOTUS.x + 3, 15.8, LOTUS.z + 6), 4, 0xfff2e0, 0.8);
  }

  // ---- the wall ramp ------------------------------------------------------------------------------
  {
    const { x0, zc, R: Rw, hw, thick, thetaMax } = WALL;
    const z0 = zc - hw, z1 = zc + hw, n = 72;
    // concrete drive surface with white centre line; u runs across z
    const wtex = canvasTex(512, 1024, (g, w, h) => {
      const r = rng(5);
      g.fillStyle = '#8e9092'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 160; i++) {
        const x = r() * w, y = r() * h, rad = 20 + r() * 90;
        const gr = g.createRadialGradient(x, y, 0, x, y, rad);
        const v = r() < 0.5 ? 90 : 230;
        gr.addColorStop(0, `rgba(${v},${v},${v},${0.06 + r() * 0.08})`); gr.addColorStop(1, `rgba(${v},${v},${v},0)`);
        g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
      }
      const img = g.getImageData(0, 0, w, h), d = img.data;
      for (let i = 0; i < d.length; i += 4) { const nn = (r() - 0.5) * 14; d[i] += nn; d[i + 1] += nn; d[i + 2] += nn; }
      g.putImageData(img, 0, 0);
      g.fillStyle = 'rgba(70,72,75,0.35)'; g.fillRect(0, 0, w, 3); g.fillRect(0, h / 2, w, 2); // form joints
      g.fillStyle = '#f2f2ee'; g.fillRect(w / 2 - 7, 0, 14, h); // centre line
      g.fillStyle = '#3a3b3d'; g.fillRect(0, 0, 8, h); g.fillRect(w - 8, 0, 8, h);
    });
    wtex.wrapT = THREE.RepeatWrapping;
    const inner = new THREE.Mesh(arcStrip(Rw, 0, thetaMax, n, z0, z1, 12, 1), new THREE.MeshStandardMaterial({
      map: wtex, roughness: 0.8, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2, envMapIntensity: 0.6,
    }));
    inner.receiveShadow = true; inner.castShadow = true;
    const ro = Rw + thick;
    const t0o = Math.acos(Math.min(1, Rw / ro));
    const P = (r, t, z) => V(x0 + r * Math.sin(t), Rw - r * Math.cos(t), z);
    const lipPts = [P(Rw, thetaMax, z0), P(ro, thetaMax, z0), P(ro, thetaMax, z1), P(Rw, thetaMax, z1)];
    const lip = new THREE.BufferGeometry().setFromPoints([lipPts[0], lipPts[1], lipPts[2], lipPts[0], lipPts[2], lipPts[3]]);
    lip.computeVertexNormals();
    const shellParts = [arcStrip(ro, t0o, thetaMax, n, z0, z1, 5, -1), arcCap(Rw, ro, 0, thetaMax, n, z0, -1), arcCap(Rw, ro, 0, thetaMax, n, z1, 1)].map((gg) => gg.toNonIndexed());
    shellParts.push(lip);
    const shell = new THREE.Mesh(mergeGeometries(shellParts), new THREE.MeshStandardMaterial({ color: 0x8a8c8e, roughness: 0.85, side: THREE.DoubleSide }));
    shell.castShadow = true; shell.receiveShadow = true;
    scene.add(inner, shell);
    // thin bright red light strips along both edges of the drive surface
    for (const z of [z0 + 0.07, z1 - 0.07]) redGeos.push(arcStrip(Rw - 0.05, 0, thetaMax, n, z - 0.045, z + 0.045, 5, 1).toNonIndexed());
    for (let i = 1; i < 12; i++) { const t = thetaMax * i / 12; for (const z of [z0 - 0.02, z1 + 0.02]) { const p = P(Rw + 0.25, t, z); bulb(p.x, p.y, p.z, 0xff2a2a, 0.07); } }

    // black steel truss tower behind the vertical, with an overhang frame carrying the curl
    const xa = x0 + ro + 0.35, xb = xa + 2.6, za = z0 - 0.7, zb = z1 + 0.7, top = 2 * Rw + 1.0;
    const lev = 9;
    for (const x of [xa, xb]) for (const z of [za, zb]) steel.beam(V(x, 0, z), V(x, top, z), 0.26);
    for (let k = 0; k <= lev; k++) {
      const y = top * k / lev;
      steel.beam(V(xa, y, za), V(xb, y, za), 0.12); steel.beam(V(xa, y, zb), V(xb, y, zb), 0.12);
      steel.beam(V(xa, y, za), V(xa, y, zb), 0.12); steel.beam(V(xb, y, za), V(xb, y, zb), 0.12);
      if (k < lev) {
        const y2 = top * (k + 1) / lev;
        const f = k % 2 ? 1 : 0;
        steel.beam(V(xa, f ? y : y2, za), V(xb, f ? y2 : y, za), 0.07); steel.beam(V(xa, f ? y : y2, zb), V(xb, f ? y2 : y, zb), 0.07);
        steel.beam(V(xa, y, f ? za : zb), V(xa, y2, f ? zb : za), 0.07); steel.beam(V(xb, y, f ? za : zb), V(xb, y2, f ? zb : za), 0.07);
      }
    }
    // overhang over the curl, out to the lip
    const xl = x0 + ro * Math.sin(thetaMax) - 0.4;
    for (const z of [za, zb]) {
      steel.beam(V(xl, top, z), V(xb, top, z), 0.22);
      steel.beam(V(xl, top - 1.6, z), V(xa, top - 1.6, z), 0.16);
      for (let x = xl; x < xa; x += 1.6) steel.beam(V(x, top - 1.6, z), V(Math.min(x + 1.6, xa), top, z), 0.07);
      steel.beam(V(xl, top - 1.6, z), V(xl, top, z), 0.12);
    }
    for (let x = xl; x <= xb + 0.01; x += (xb - xl) / 5) steel.beam(V(x, top, za), V(x, top, zb), 0.12);
    // struts from the shell back to the tower and hangers from the overhang
    for (let i = 0; i <= 10; i++) {
      const t = 0.5 + (thetaMax - 0.5) * i / 10;
      for (const z of [z0 + 0.4, z1 - 0.4]) {
        const p = P(ro + 0.05, t, z);
        if (t < Math.PI / 2 + 0.4) steel.beam(p, V(xa, p.y, z), 0.12);
        else steel.beam(p, V(p.x, top - 1.6, z), 0.1);
      }
    }
    // base work light: the wall is lit from its foot
    const spot = new THREE.SpotLight(0xf0f4ff, 1400, 110, 0.36, 0.6, 1.4);
    spot.position.set(x0 - 26, 0.6, zc);
    spot.target.position.set(x0 + 6, 12, zc);
    scene.add(spot, spot.target);
    grey.box(x0 - 26.3, 0.35, zc, 0.8, 0.7, 1.2);
    glowSprite(V(x0 - 25.8, 0.6, zc), 3, 0xf0f4ff, 0.9);
    // teal beams behind the base
    for (let i = 0; i < 6; i++) {
      const z = zc - 16 + i * 6.4 + (R() - 0.5);
      beam(V(x0 + 30 + R() * 8, 0.3, z), V(-0.5 - R() * 0.5, 1.3, (z - zc) * 0.04), 20 + R() * 8, 0.3, 0x1d5868);
    }
    // red barriers on the approach
    redBarrier(x0 - 150, x0 - 6, z0 - 3.5, { gaps: 8 });
    redBarrier(x0 - 150, x0 - 6, z1 + 3.5, { gaps: 8 });

    for (const z of [z0 - 1.5, z1 + 1.5]) for (const x of [x0 - 3, x0 + 4]) world.smoke.push(V(x, 0.3, z));

    const opt = buildOptimus();
    opt.position.set(x0 - 12, 0.25, z1 + 7);
    opt.rotation.y = 0.35;
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.75, 0.25, 24), new THREE.MeshStandardMaterial({ color: 0x111316, metalness: 0.5, roughness: 0.3 }));
    ped.position.set(x0 - 12, 0.125, z1 + 7); ped.receiveShadow = true;
    scene.add(opt, ped);
  }

  // ---- flip stage: red-lit pillar, fans of white beams, red ground lights ------------------------
  {
    const { pillarX: px, z: pz } = FLIP_PAD;
    const H = 34, W = 3.2;
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(W, H, W), new THREE.MeshStandardMaterial({ color: 0x1a0606, emissive: 0x2a0303, roughness: 0.7 }));
    pillar.position.set(px, H / 2, pz); pillar.castShadow = true;
    scene.add(pillar);
    for (const dx of [-W / 2 - 0.03, W / 2 + 0.03]) for (const dz of [-W / 2 - 0.03, W / 2 + 0.03]) redGeos.push(new THREE.BoxGeometry(0.1, H, 0.1).translate(px + dx, H / 2, pz + dz));
    glowSprite(V(px + 3, 6, pz), 26, 0xff1a10, 0.5);
    glowSprite(V(px + 2, 18, pz), 30, 0xff1a10, 0.25);
    const red = new THREE.PointLight(0xff2010, 900, 45, 1.6);
    red.position.set(px + 5, 4, pz);
    scene.add(red);
    // ground fixtures either side with fanned beams (animated in updateWorld)
    world.fans = [];
    for (const side of [-1, 1]) {
      for (let i = 0; i < 9; i++) {
        const fz = pz + side * (4 + i * 2.4), fx = px + 2 + (i % 3) * 0.8;
        grey.box(fx, 0.25, fz, 0.6, 0.5, 0.6);
        bulb(fx + 0.32, 0.35, fz, 0xffffff, 0.12);
        const a = 0.15 + (i / 8) * 1.1; // lean outward from vertical
        const idx = beam(V(fx, 0.5, fz), V(0.25, Math.cos(a), side * Math.sin(a)), 10 + R() * 9, 0.2, 0xb8c2d0);
        world.fans.push({ idx, a, side, ph: R() * TAU });
      }
      for (let k = 0; k < 12; k++) bulb(px + 3.6, 0.3, pz + side * (2.5 + k * 2.2), 0xff1a10, 0.16);
      redGeos.push(new THREE.BoxGeometry(0.1, 0.06, 26).translate(px + 4.2, 0.04, pz + side * 15));
    }
    for (const dz of [-6, -2, 2, 6]) world.smoke.push(V(px + 6, 0.3, pz + dz));
    world.smoke.push(V(FLIP_PAD.x, 0.3, pz - 6), V(FLIP_PAD.x, 0.3, pz + 6));
    // low barriers with red bars along the flip lane
    redBarrier(px + 8, 330, pz - 9, { gaps: 8 });
    redBarrier(px + 8, 330, pz + 9, { gaps: 8 });
  }

  // ---- smoke look: a few big drifting clouds at the landings, some tinted red -------------------
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
    const add = (p, s, color, op) => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, color, transparent: true, depthWrite: false, opacity: op }));
      sp.position.copy(p); sp.scale.set(s, s, 1);
      sp.material.rotation = R() * TAU;
      scene.add(sp);
      world.puffs.push({ sp, base: p.clone(), s, ph: R() * TAU, op });
    };
    const { x0, zc, hw } = WALL;
    for (let i = 0; i < 5; i++) add(V(x0 - 4 + R() * 12, 1.2 + R() * 2, zc + (i % 2 ? 1 : -1) * (hw + 2 + R() * 3)), 7 + R() * 5, 0x9aa3b4, 0.35);
    for (let i = 0; i < 6; i++) add(V(FLIP_PAD.pillarX + 6 + R() * 10, 1.5 + R() * 2.5, FLIP_PAD.z + (R() - 0.5) * 22), 8 + R() * 6, i % 2 ? 0xd06060 : 0xb9bcc4, 0.38);
    for (let i = 0; i < 4; i++) add(V(LINEUP_X + 8 + R() * 14, 1.2 + R() * 2, (R() - 0.5) * 14), 7 + R() * 5, i % 2 ? 0xc05a5a : 0xa9adb6, 0.3);
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
          const a = c0[j], bb = c1[j], b2 = c1[(j + 1) % 4];
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
    far.box(1380, 18, -560, 34, 36, 18);
    far.box(1620, 12, 300, 26, 24, 22);
    far.box(1250, 6, 680, 40, 12, 14);
    for (let i = 0; i < 4; i++) far.box(1520 + i * 14, 7, -380, 9, 14, 9);
    scene.add(far.build(new THREE.MeshBasicMaterial({ color: 0x020203, fog: false }), { cast: false, receive: false }));
    const mk = (arr, col, size, blink) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      g.setAttribute('ph', new THREE.BufferAttribute(new Float32Array(arr.length / 3).map(() => R() * TAU), 1));
      const m = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
        uniforms: { time: { value: 0 }, col: { value: new THREE.Color(col) }, size: { value: size * Math.min(2, renderer.getPixelRatio()) }, blink: { value: blink } },
        vertexShader: `attribute float ph; uniform float time; uniform float size; uniform float blink; varying float vA;
          void main(){ vA = mix(1.0, step(0.0, sin(time * 2.6 + ph * blink * 0.25)), blink);
            vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = size; gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `uniform vec3 col; varying float vA; void main(){ vec2 c = gl_PointCoord - 0.5; float d = dot(c, c);
          float a = smoothstep(0.25, 0.0, d); a = a * a + 0.6 * smoothstep(0.02, 0.0, d);
          gl_FragColor = vec4(col * a * (0.12 + 0.88 * vA) * 1.6, 1.0); }`,
      });
      const p = new THREE.Points(g, m); p.frustumCulled = false; scene.add(p);
      return m;
    };
    world.redLights = mk(reds, 0xff1a0a, 6, 1);
    world.siteLights = mk(whites, 0xffc77a, 4, 0);
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
    const sm = new THREE.MeshLambertMaterial({ color: 0x33321f });
    padFalloff(sm, 0.1, 90);
    const scrub = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), sm, mats.length);
    mats.forEach((mm, i) => scrub.setMatrixAt(i, mm));
    scrub.computeBoundingSphere();
    scene.add(scrub);
  }

  // ---- finalise collectors ----------------------------------------------------------------------
  scene.add(steel.build(steelMat));
  scene.add(rails.build(new THREE.MeshStandardMaterial({ color: 0x8a9098, metalness: 0.8, roughness: 0.4 })));
  scene.add(grey.build(new THREE.MeshStandardMaterial({ color: 0x141518, roughness: 0.7 })));
  {
    const im = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), bulbs.length);
    const m = new THREE.Matrix4(), c = new THREE.Color();
    bulbs.forEach((b, i) => { m.makeScale(b.s, b.s, b.s).setPosition(b.x, b.y, b.z); im.setMatrixAt(i, m); im.setColorAt(i, c.setHex(b.color)); });
    im.computeBoundingSphere();
    scene.add(im);
  }
  const redMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.06, 0.05), toneMapped: false, side: THREE.DoubleSide });
  scene.add(new THREE.Mesh(mergeGeometries(redGeos.map((g) => (g.index ? g.toNonIndexed() : g))), redMat));
  if (whiteGlowGeos.length) scene.add(new THREE.Mesh(mergeGeometries(whiteGlowGeos), new THREE.MeshBasicMaterial({ color: 0xf4f8ff, toneMapped: false })));
  {
    const geo = new THREE.CylinderGeometry(0.35, 1, 1, 10, 1, true);
    geo.translate(0, 0.5, 0);
    const tex = canvasTex(4, 256, (g, w, h) => {
      const gr = g.createLinearGradient(0, h, 0, 0);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    });
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide, toneMapped: false });
    const im = new THREE.InstancedMesh(geo, mat, beams.length);
    world.beams = { im, list: beams };
    beams.forEach((b, i) => { setBeam(im, i, b); im.setColorAt(i, b.color); });
    im.frustumCulled = false; im.renderOrder = 6;
    scene.add(im);
  }
  scene.add(signs.mesh());

  world.spawns = SPAWNS;
  world.bounds = BOUNDS;
  return world;
}

const _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _s = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
function setBeam(im, i, b, dir = b.dir) {
  _q.setFromUnitVectors(_up, dir);
  _s.set(b.width, b.len, b.width);
  im.setMatrixAt(i, _m.compose(b.base, _q, _s));
}

const _v = new THREE.Vector3(), _d = new THREE.Vector3();

export function updateWorld(world, dt, t, target, info = {}) {
  info = info || {};
  if (target && world.key) {
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
  if (world.fans && world.beams) {
    const { im, list } = world.beams;
    for (const f of world.fans) {
      const a = f.a + 0.18 * Math.sin(t * 0.7 + f.ph);
      _d.set(0.25, Math.cos(a), f.side * Math.sin(a)).normalize();
      setBeam(im, f.idx, list[f.idx], _d);
    }
    im.instanceMatrix.needsUpdate = true;
  }
  if (world.puffs) {
    for (const p of world.puffs) {
      p.sp.position.set(p.base.x + Math.sin(t * 0.13 + p.ph) * 1.5, p.base.y + Math.sin(t * 0.21 + p.ph * 2) * 0.4, p.base.z + Math.cos(t * 0.11 + p.ph) * 1.2);
      p.sp.material.rotation += dt * 0.05 * (p.ph > Math.PI ? 1 : -1);
      p.sp.material.opacity = p.op * (0.75 + 0.25 * Math.sin(t * 0.3 + p.ph));
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
