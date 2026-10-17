// Shared course data. Physics and rendering both read from here so they never disagree.
export const G = 9.81;

export const BOUNDS = { x0: -350, x1: 1750, z0: -420, z1: 420 };
export const RUNWAY = { x0: -200, x1: 1550, hw: 22 };

// Wedge ramps along +x. 'up' rises from its start to a lip; 'down' is a landing ramp that
// starts at its full height (a vertical face) and descends to the ground.
export const RAMPS = [
  { type: 'up', x: 250, len: 16, h: 2.2, zc: 0, hw: 10, label: 'KICKER' },
  { type: 'down', x: 284, len: 26, h: 2.0, zc: 0, hw: 10 },
  { type: 'up', x: 560, len: 22, h: 6, zc: 0, hw: 12, label: 'THE JUMP' },
  { type: 'down', x: 632, len: 28, h: 4.5, zc: 0, hw: 12 },
];

// Vehicles parked under the big jump. top is the roof height.
export const OBSTACLES = [];
{
  const colors = [0xc8102e, 0x1b3a6b, 0xdadada, 0x111111, 0x6d7278, 0xb88a2e];
  for (const zc of [-6.5, 0, 6.5]) {
    for (let i = 0; i < 6; i++) {
      const x0 = 586 + i * 5;
      OBSTACLES.push({
        kind: 'car', x0, x1: x0 + 4.6, z0: zc - 1.1, z1: zc + 1.1, top: 1.45, color: colors[(i + (zc > 0 ? 2 : zc < 0 ? 4 : 0)) % colors.length],
      });
    }
  }
  OBSTACLES.push({ kind: 'semi', x0: 616, x1: 632, z0: -1.4, z1: 1.4, top: 4.0, color: 0xe8e8e8 });
}

// The inverted "wall" ramp: a quarter-pipe that keeps curving past vertical.
// The car drives on the inside of a circle of radius R whose centre is at (x0, R).
export const WALL = { x0: 900, zc: 0, R: 15, hw: 7, thetaMax: 3.4, thick: 1.2 };

// Where the car respawns after a crash: the last entry at or behind the crash point.
export const SPAWNS = [
  { x: 0, label: 'Start line' },
  { x: 150, label: 'Before the kicker' },
  { x: 440, label: 'Before the jump' },
  { x: 780, label: 'Before the wall' },
];

export function groundH(x, z) {
  let h = 0;
  for (const r of RAMPS) {
    if (Math.abs(z - r.zc) > r.hw || x < r.x || x > r.x + r.len) continue;
    const t = (x - r.x) / r.len;
    h = Math.max(h, r.type === 'up' ? t * r.h : (1 - t) * r.h);
  }
  return h;
}

export function groundN(x, z, out, e = 0.6) {
  const dx = (groundH(x + e, z) - groundH(x - e, z)) / (2 * e);
  const dz = (groundH(x, z + e) - groundH(x, z - e)) / (2 * e);
  const l = Math.hypot(dx, 1, dz);
  out.set(-dx / l, 1 / l, -dz / l);
  return out;
}

export function wallSurfaceY(x) {
  const u = x - WALL.x0;
  if (u < 0) return 0;
  if (u > WALL.R) return Infinity;
  return WALL.R - Math.sqrt(WALL.R * WALL.R - u * u);
}

export function inWallFootprint(x, z, pad = 0) {
  return x > WALL.x0 - pad && x < WALL.x0 + WALL.R + WALL.thick + pad && Math.abs(z - WALL.zc) < WALL.hw + pad;
}
