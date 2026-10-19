import * as THREE from 'three';

// Circuit de Spa-Francorchamps, 7.004 km, run clockwise. Physics and the Spa scene both read the
// track from here. Centreline: bacinger/f1-circuits (MIT licence, (c) 2019-2025 Tomislav Bacinger),
// projected to metres with the start/finish line at the origin: x east, y up, z south.
const RAW = [0.0,-0.0,-113.5,-197.0,-114.7,-205.8,-109.7,-213.7,-99.2,-217.3,-87.5,-214.1,-50.1,-195.4,40.6,-152.2,84.1,-125.6,129.5,-92.2,170.2,-58.4,202.5,-23.4,375.8,181.8,388.0,193.3,408.9,206.3,446.3,230.3,462.6,246.4,476.5,268.3,485.3,288.2,491.2,310.5,496.2,351.7,499.1,366.3,504.2,379.8,513.8,397.5,599.5,533.6,654.0,620.0,669.1,652.3,678.7,676.3,690.1,714.9,758.5,952.0,863.4,1312.0,887.7,1398.6,889.0,1412.6,886.4,1428.2,878.1,1440.7,865.9,1451.2,850.3,1459.5,841.1,1468.3,834.8,1478.7,829.8,1494.4,830.6,1510.0,851.6,1603.3,851.2,1619.4,847.9,1634.0,836.5,1650.1,823.1,1661.1,583.9,1825.2,568.8,1831.5,553.7,1832.0,537.8,1827.3,524.7,1817.9,515.5,1804.5,511.8,1790.9,510.9,1776.3,515.5,1762.7,523.9,1748.6,536.1,1738.8,640.6,1674.7,651.9,1663.2,658.2,1651.7,660.7,1638.2,659.4,1621.5,616.2,1495.4,602.8,1443.9,572.2,1284.9,557.1,1193.7,553.7,1178.1,546.2,1161.4,536.1,1147.8,521.0,1133.3,504.2,1122.3,485.8,1115.0,466.4,1111.9,403.9,1107.7,380.0,1110.4,358.1,1116.6,336.0,1126.0,317.9,1138.0,296.9,1157.2,283.5,1176.5,268.8,1204.1,209.6,1351.1,156.7,1481.9,145.4,1502.2,132.0,1516.3,113.6,1526.7,95.1,1531.9,77.9,1532.4,60.7,1528.8,46.0,1522.0,21.6,1506.3,5.7,1499.6,-13.6,1496.5,-32.9,1498.6,-50.5,1504.2,-65.6,1514.7,-75.3,1526.7,-87.1,1542.8,-184.0,1693.9,-193.6,1702.8,-205.4,1709.1,-219.6,1712.2,-235.6,1711.2,-249.4,1704.9,-314.9,1657.4,-353.5,1629.4,-363.1,1616.9,-373.2,1601.7,-379.1,1587.1,-383.2,1569.9,-384.1,1552.2,-381.2,1530.9,-374.5,1512.6,-365.7,1489.2,-352.6,1453.7,-330.0,1413.6,-305.2,1378.7,-267.5,1336.5,-204.5,1275.5,-167.6,1246.9,-136.1,1228.7,25.9,1144.8,49.3,1130.2,71.6,1112.9,92.2,1093.7,109.7,1072.8,126.1,1050.9,148.0,1010.9,165.6,972.3,205.9,883.2,213.0,863.9,217.2,843.1,218.0,817.0,213.8,793.6,189.9,732.5,163.9,665.3,132.4,581.4,124.4,550.3,116.9,513.2,112.3,478.9,109.3,449.7,100.1,314.7,101.8,305.9,107.3,299.6,115.6,297.5,129.9,299.6,144.6,299.6,154.7,297.5,161.3,290.2,163.1,281.9,158.9,270.9,107.3,187.0];

// Height above the start line (m) against distance round the lap (m, along the source polyline).
// Estimated from published elevation profiles: down from La Source to the bottom of Eau Rouge, up
// the Raidillon and the Kemmel straight to the high point at Les Combes, down through Rivage and
// Pouhon to the low point after Stavelot, and back up Blanchimont to the Bus Stop. About 100 m in all.
const SRC_LEN = 6954;
const ELEV = [
  [0, 0], [268, -2], [571, -12], [900, -27], [1150, 7], [1421, 17], [2144, 40], [2295, 42], [2533, 31],
  [2963, 15], [3145, 11], [3602, -2], [3843, -10], [4336, -25], [4528, -35], [4769, -49], [5029, -55],
  [5449, -45], [5976, -25], [6409, -12], [6640, -4], [SRC_LEN, 0],
];

export const SPA = {
  hw: 6.2, // half the track width
  kerb: 1.3,
  run: 13, // grass run-off to the barrier, past the kerb line
  // pit lane along the main straight on the right (the paddock side): from `before` metres before the
  // line to `after` metres past it, with the pit wall over the middle part of that
  pit: { before: 250, after: 225, taper: 70, lane: 17.5, laneHw: 4.2, wall: 11.2, garage: 23 },
};

function monotone(xs, ys) {
  const n = xs.length, d = [], m = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  return (x) => {
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = Math.min(1, Math.max(0, (x - xs[i]) / h));
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

// Samples every ~2 m round the lap: position, flat tangent and right vectors, distance s, the
// surface normal (from the grade) and the barrier distances either side.
function build() {
  const pts = [];
  for (let i = 0; i < RAW.length; i += 2) pts.push(new THREE.Vector3(RAW[i], 0, RAW[i + 1]));
  const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
  curve.arcLengthDivisions = 20000; // even 2 m spacing (the default 200 divisions are 35 m apart)
  const L = curve.getLength();
  const N = Math.round(L / 2);
  const P = curve.getSpacedPoints(N).slice(0, N);
  const elev = monotone(ELEV.map((e) => (e[0] / SRC_LEN) * L), ELEV.map((e) => e[1]));
  const T = { N, L, ds: L / N, x: new Float32Array(N), y: new Float32Array(N), z: new Float32Array(N),
    tx: new Float32Array(N), tz: new Float32Array(N), slope: new Float32Array(N), k: new Float32Array(N),
    bL: new Float32Array(N), bR: new Float32Array(N) };
  for (let i = 0; i < N; i++) {
    const s = i * T.ds;
    T.x[i] = P[i].x; T.z[i] = P[i].z; T.y[i] = elev(s);
  }
  // round off the crests and dips (Raidillon, Les Combes) over ~60 m so a car stays on the road
  {
    const R = 15, y0 = Float32Array.from(T.y);
    for (let i = 0; i < N; i++) {
      let sum = 0, wsum = 0;
      for (let k = -R; k <= R; k++) { const w = Math.exp(-(k * k) / (2 * (R / 2) ** 2)); sum += w * y0[(i + k + N) % N]; wsum += w; }
      T.y[i] = sum / wsum;
    }
  }
  for (let i = 0; i < N; i++) {
    const a = (i - 1 + N) % N, b = (i + 1) % N;
    const dx = T.x[b] - T.x[a], dz = T.z[b] - T.z[a], l = Math.hypot(dx, dz);
    T.tx[i] = dx / l; T.tz[i] = dz / l;
    T.slope[i] = (T.y[b] - T.y[a]) / (2 * T.ds);
  }
  // signed curvature (+ = turning right), smoothed over ~20 m
  const W = 5;
  for (let i = 0; i < N; i++) {
    const a = (i - W + N) % N, b = (i + W) % N;
    const ha = Math.atan2(T.tz[a], T.tx[a]), hb = Math.atan2(T.tz[b], T.tx[b]);
    let d = hb - ha; d = Math.atan2(Math.sin(d), Math.cos(d));
    T.k[i] = d / (2 * W * T.ds);
  }
  const edge = SPA.hw + SPA.kerb + SPA.run;
  for (let i = 0; i < N; i++) {
    const s = i * T.ds;
    let bl = edge, br = edge;
    if (s >= L - SPA.pit.before || s <= SPA.pit.after) br = SPA.pit.garage;
    // on the inside of a tight bend keep the barrier short of the bend's centre
    const r = 1 / Math.max(Math.abs(T.k[i]), 1e-4);
    if (T.k[i] > 0) br = Math.min(br, Math.max(SPA.hw + 2, 0.8 * r)); else bl = Math.min(bl, Math.max(SPA.hw + 2, 0.8 * r));
    T.bL[i] = bl; T.bR[i] = br;
  }
  // spatial hash of samples, 16 m cells
  T.cell = 16;
  T.grid = new Map();
  for (let i = 0; i < N; i++) {
    const key = cellKey(Math.floor(T.x[i] / T.cell), Math.floor(T.z[i] / T.cell));
    let a = T.grid.get(key);
    if (!a) T.grid.set(key, (a = []));
    a.push(i);
  }
  return T;
}
const cellKey = (cx, cz) => cx * 100003 + cz;

export function inPit(s, L = TRACK.L) {
  return s >= L - SPA.pit.before || s <= SPA.pit.after;
}
// The pit wall runs between the two tapers.
export function onPitWall(s, L = TRACK.L) {
  const p = SPA.pit;
  return s >= L - p.before + p.taper || s <= p.after - p.taper;
}

export const TRACK = build();

// Nearest point on the centreline to (x, z), searching within ~48 m. Writes into out:
// i (segment start), u (0..1 along it), s (distance round the lap), lat (+ = right of the
// centreline), h (track height there), d (distance from the centreline). Returns false if none.
export function locate(x, z, out) {
  const T = TRACK;
  const cx = Math.floor(x / T.cell), cz = Math.floor(z / T.cell);
  let best = Infinity, bi = -1;
  for (let a = -3; a <= 3; a++) {
    for (let b = -3; b <= 3; b++) {
      const list = T.grid.get(cellKey(cx + a, cz + b));
      if (!list) continue;
      for (const i of list) {
        const dx = x - T.x[i], dz = z - T.z[i];
        const d2 = dx * dx + dz * dz;
        if (d2 < best) { best = d2; bi = i; }
      }
    }
  }
  if (bi < 0) return false;
  // refine onto the segment before or after the nearest sample
  const N = T.N;
  let i0 = bi, u = 0;
  const proj = (i) => {
    const j = (i + 1) % N;
    const ex = T.x[j] - T.x[i], ez = T.z[j] - T.z[i];
    const t = ((x - T.x[i]) * ex + (z - T.z[i]) * ez) / (ex * ex + ez * ez);
    return t;
  };
  let t = proj(bi);
  if (t < 0) { i0 = (bi - 1 + N) % N; t = proj(i0); }
  u = Math.min(1, Math.max(0, t));
  const j = (i0 + 1) % N;
  const px = T.x[i0] + (T.x[j] - T.x[i0]) * u, pz = T.z[i0] + (T.z[j] - T.z[i0]) * u;
  const tx = T.tx[i0] + (T.tx[j] - T.tx[i0]) * u, tz = T.tz[i0] + (T.tz[j] - T.tz[i0]) * u;
  const tl = Math.hypot(tx, tz);
  out.i = i0; out.u = u; out.s = (i0 + u) * T.ds;
  out.lat = ((x - px) * -tz + (z - pz) * tx) / tl;
  out.h = T.y[i0] + (T.y[j] - T.y[i0]) * u;
  out.slope = T.slope[i0] + (T.slope[j] - T.slope[i0]) * u;
  out.tx = tx / tl; out.tz = tz / tl;
  out.bL = T.bL[i0] + (T.bL[j] - T.bL[i0]) * u;
  out.bR = T.bR[i0] + (T.bR[j] - T.bR[i0]) * u;
  out.d = Math.hypot(x - px, z - pz);
  return true;
}

// Surface normal of the track (no camber): tilted along the tangent by the grade.
function normalOf(L, out) {
  out.set(-L.slope * L.tx, 1, -L.slope * L.tz).normalize();
  return out;
}

const _L = {}, _L2 = {};
// The physics map interface (see physics.js setMap).
export const SPA_MAP = {
  key: 'spa',
  get spawns() { return [pitSpawn()]; },
  // Ray against the track surface (the only thing a wheel can stand on here).
  raycast(o, d, maxT, outN, info) {
    if (d.y > -1e-4) return null;
    if (!locate(o.x, o.z, _L)) return null;
    let t = (o.y - _L.h) / -d.y;
    for (let k = 0; k < 2; k++) {
      if (!locate(o.x + d.x * t, o.z + d.z * t, _L2)) break;
      t = (o.y - _L2.h) / -d.y;
    }
    if (t < 0 || t > maxT) return null;
    const Lh = _L2.i !== undefined ? _L2 : _L;
    normalOf(Lh, outN);
    info.t = t;
    info.grip = Math.abs(Lh.lat) <= SPA.hw + SPA.kerb + 0.3 || (inPit(Lh.s) && Lh.lat > 0) ? 1 : 0.6;
    return 'ground';
  },
  // Depth of a body point into the ground, the barriers or the pit wall.
  penetrate(p, outN, info) {
    if (!locate(p.x, p.z, _L)) return 0;
    let depth = 0;
    if (p.y < _L.h) { depth = _L.h - p.y; normalOf(_L, outN); info.tag = 'ground'; }
    const rx = -_L.tz, rz = _L.tx;
    if (_L.lat > _L.bR && _L.lat - _L.bR > depth) { depth = _L.lat - _L.bR; outN.set(-rx, 0, -rz); info.tag = 'barrier'; }
    if (_L.lat < -_L.bL && -_L.bL - _L.lat > depth) { depth = -_L.bL - _L.lat; outN.set(rx, 0, rz); info.tag = 'barrier'; }
    const pw = SPA.pit.wall;
    if (onPitWall(_L.s) && p.y < _L.h + 1.1 && Math.abs(_L.lat - pw) < 0.35) {
      const dd = 0.35 - Math.abs(_L.lat - pw);
      if (dd > depth) { depth = dd; const sg = _L.lat > pw ? 1 : -1; outN.set(rx * sg, 0, rz * sg); info.tag = 'barrier'; }
    }
    return depth;
  },
  // Back on the racing line nearest to pos, pointing the way the lap runs.
  respawnNear(pos) {
    if (!locate(pos.x, pos.z, _L)) return pitSpawn();
    const lat = Math.max(-SPA.hw + 2, Math.min(SPA.hw - 2, _L.lat));
    return { key: 'track', label: 'Back on track', x: pos.x - (-_L.tz) * (_L.lat - lat), z: pos.z - _L.tx * (_L.lat - lat), y: _L.h, yaw: Math.atan2(-_L.tz, _L.tx) };
  },
  heightAt(x, z) { return locate(x, z, _L) ? _L.h : 0; },
};

// Pit box: in the pit lane just past the start/finish line, facing up the straight.
export function pitSpawn() {
  const T = TRACK;
  const i = Math.round(40 / T.ds);
  const rx = -T.tz[i], rz = T.tx[i];
  return { key: 'pit', label: 'Pit lane', x: T.x[i] + rx * SPA.pit.lane, z: T.z[i] + rz * SPA.pit.lane, y: T.y[i], yaw: Math.atan2(-T.tz[i], T.tx[i]) };
}
