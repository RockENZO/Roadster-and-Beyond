import * as THREE from 'three';

// Shared vehicle geometry. Physics and the 3D model both read from here.
// Body frame: origin at the centre of mass, x forward, y up, z to the driver's right.
// Proportions are measured off the official side-profile photo (wheelbase 2.72 m as the scale):
// 4.20 m long, about 2.0 m wide, about 1.07 m tall, 0.78 m front and 0.70 m rear overhang.

export const DIM = { length: 4.2, width: 2.0, height: 1.07, wheelbase: 2.72, track: 1.7, nose: 2.14, tail: -2.06 };

// Ground sits this far below the centre of mass at the static ride height.
export const COM_H = 0.48;

export const SUSP = { anchorY: 0.05, rest: 0.25, radius: 0.34, k: 80000, c: 4100 };

// FR, FL, RR, RL
export const WHEELS = [
  { x: 1.36, z: 0.85, front: true },
  { x: 1.36, z: -0.85, front: true },
  { x: -1.36, z: 0.85, front: false },
  { x: -1.36, z: -0.85, front: false },
];

// Four suction fans behind the round openings in the rear diffuser.
export const FANS = [-0.58, -0.22, 0.22, 0.58].map((z) => ({ x: -1.98, y: -0.3, z }));

// Cold-gas nozzles. dir is the exhaust direction; thrust pushes the car the opposite way.
// Thrust: four rear nozzles. Rocket: all ten (4 rear, 4 lift nozzles behind the wheels, 2 nose).
const REAR = [-0.58, -0.22, 0.22, 0.58].map((z) => ({ group: 'rear', x: -2.04, y: -0.12, z, dir: [-1, 0, 0] }));
const LIFT = [
  { x: 0.8, z: 0.72 }, { x: 0.8, z: -0.72 }, { x: -1.92, z: 0.72 }, { x: -1.92, z: -0.72 },
].map((p) => ({ group: 'lift', x: p.x, y: -0.4, z: p.z, dir: [0, -1, 0] }));
const NOSE = [
  // the nose pair fires diagonally forward and out of the front corners, as in the kickflip footage
  { group: 'nose', x: 1.92, y: -0.18, z: 0.8, dir: [0.45, 0, 0.893] },
  { group: 'nose', x: 1.92, y: -0.18, z: -0.8, dir: [0.45, 0, -0.893] },
];

// Points on the body shell used for collisions. roof marks points that mean a rollover if they touch.
export const HULL = [
  [2.1, -0.32, 0.8], [2.1, -0.32, -0.8], [-2.02, -0.3, 0.85], [-2.02, -0.3, -0.85],
  [0.0, -0.36, 0.95], [0.0, -0.36, -0.95], [2.14, -0.08, 0.7], [2.14, -0.08, -0.7],
  [-2.06, 0.18, 0.85], [-2.06, 0.18, -0.85], [1.36, 0.1, 1.0], [1.36, 0.1, -1.0], [-1.36, 0.18, 1.0], [-1.36, 0.18, -1.0],
  [0.95, 0.32, 0.62, 1], [0.95, 0.32, -0.62, 1], [0.0, 0.58, 0.45, 1], [0.0, 0.58, -0.45, 1],
  [-1.0, 0.5, 0.5, 1], [-1.0, 0.5, -0.5, 1], [-1.95, 0.36, 0.7, 1], [-1.95, 0.36, -0.7, 1],
].map((p) => ({ p: new THREE.Vector3(p[0], p[1], p[2]), roof: !!p[3] }));

const nozzles = (list) => list.map((n, i) => ({ ...n, id: i, pos: new THREE.Vector3(n.x, n.y, n.z), dir: new THREE.Vector3(...n.dir) }));

// Launch claims: 0-60 mph in under 1.6 s (Performance), under 0.9 s (Thrust), under 0.6 s (Rocket).
// Gas loads follow the stated 600 L / 250 kg of air for the full ten-nozzle car.
export const VARIANTS = {
  performance: {
    key: 'performance', name: 'Performance', seats: 2, claim: '0-60 under 1.6 s',
    tag: 'Four suction fans, up to 2 g of grip. Track Mode wing and airbrake.',
    mass: 1850, inertia: [820, 3600, 3190], nozzles: nozzles([]), gas: 0, isp: 160, fRear: 0, fLift: 0, fNose: 0,
  },
  thrust: {
    key: 'thrust', name: 'Thrust', seats: 2, claim: '0-60 under 0.9 s',
    tag: 'Adds four rear cold-gas thrusters from SpaceX for launch and air.',
    mass: 1900, inertia: [840, 3700, 3280], nozzles: nozzles(REAR), gas: 83, isp: 160, fRear: 7000, fLift: 0, fNose: 0,
  },
  rocket: {
    key: 'rocket', name: 'Rocket', seats: 1, claim: '0-60 under 0.6 s',
    tag: 'All ten thrusters and a flight computer. Hops, flips and hovers. One seat.',
    mass: 2000, inertia: [880, 3900, 3450], nozzles: nozzles([...REAR, ...LIFT, ...NOSE]), gas: 250, isp: 160, fRear: 15000, fLift: 15000, fNose: 3000,
  },
};
