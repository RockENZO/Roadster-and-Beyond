// The launch venue, laid out from coverage of the night event at SpaceX McGregor.
// Physics and rendering both read from here so they never disagree.
// World axes: x runs down the course, y is up, z is to the right when facing +x. The ground is flat (y = 0).
export const G = 9.81;

export const BOUNDS = { x0: -400, x1: 1000, z0: -400, z1: 400 };
// Floodlit concrete pad; outside it is dark desert.
export const PAD = { x0: -130, x1: 700, z0: -115, z1: 115 };

// Drag strip for the 0-60 run (the event run was timed at 0.81 s).
export const STRIP = { x0: 0, x1: 460, zc: -55, hw: 7 };

// The lineup the Rocket kickflipped over, parked side by side across the path with their
// noses toward the crowd (-z). w is the width along the course, len along z, h the roof height.
export const LINEUP_X = 250;
export const LINEUP = [];
{
  const cars = [
    { kind: 'model3', name: 'Model 3', w: 1.85, len: 4.72, h: 1.44, color: 0xb3131b },
    { kind: 'modely', name: 'Model Y', w: 1.92, len: 4.75, h: 1.62, color: 0x1d2b44 },
    { kind: 'cybertruck', name: 'Cybertruck', w: 2.03, len: 5.68, h: 1.79, color: 0xb8bcc2 },
    { kind: 'cybercab', name: 'Cybercab', w: 1.95, len: 4.3, h: 1.2, color: 0xd9b45a },
    { kind: 'semi', name: 'Semi', w: 2.6, len: 6.4, h: 4.11, color: 0xe9eaec },
  ];
  const gap = 0.9;
  let x = LINEUP_X - (cars.reduce((s, c) => s + c.w, 0) + gap * (cars.length - 1)) / 2;
  for (const c of cars) {
    LINEUP.push({ ...c, x0: x, x1: x + c.w, xc: x + c.w / 2, zc: 0 });
    x += c.w + gap;
  }
}
// Collision boxes for the lineup (the Semi is a tall cab plus a low chassis).
export const BOXES = [];
for (const c of LINEUP) {
  if (c.kind === 'semi') {
    BOXES.push({ x0: c.x0, x1: c.x1, z0: -c.len / 2, z1: -c.len / 2 + 2.7, y0: 0, y1: c.h, car: c });
    BOXES.push({ x0: c.x0, x1: c.x1, z0: -c.len / 2 + 2.7, z1: c.len / 2, y0: 0, y1: 1.25, car: c });
  } else {
    BOXES.push({ x0: c.x0, x1: c.x1, z0: -c.len / 2, z1: c.len / 2, y0: 0, y1: c.h, car: c });
  }
}

// The C-shaped wall. The car drives on the inside of a circle of radius R whose axis runs
// along z through (x0, R): up the curve, onto the vertical, and out along the ceiling, upside down.
// theta is the angle travelled round the curve: 0 at the bottom, pi/2 vertical, pi inverted.
export const WALL = { x0: 520, zc: 45, R: 8, hw: 4.5, thetaMax: Math.PI, thick: 0.6 };

// Painted pad for the standing flip.
export const FLIP_PAD = { x: 150, z: 80, r: 9 };

// Display of Musk's Lotus Esprit, by the start.
export const LOTUS = { x: -40, z: -78, yaw: 0.6 };

// Grandstand along the -z side of the pad, facing the stunts.
export const STANDS = { x0: 40, x1: 600, z: -98 };

export const SPAWNS = [
  { key: 'start', label: 'Start line', x: -60, z: 0, yaw: 0 },
  { key: 'strip', label: '0-60 strip', x: 0, z: STRIP.zc, yaw: 0 },
  { key: 'lineup', label: 'Lineup jump', x: LINEUP_X - 150, z: 0, yaw: 0 },
  { key: 'flip', label: 'Flip pad', x: FLIP_PAD.x, z: FLIP_PAD.z, yaw: 0 },
  { key: 'wall', label: 'C-wall', x: WALL.x0 - 130, z: WALL.zc, yaw: 0 },
];

// Point on the C-wall surface at angle theta (z ignored).
export function wallPoint(theta, out) {
  out.x = WALL.x0 + WALL.R * Math.sin(theta);
  out.y = WALL.R - WALL.R * Math.cos(theta);
  return out;
}
