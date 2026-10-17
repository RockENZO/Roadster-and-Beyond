import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoadsterModel } from '../src/car.js';
import { VARIANTS, WHEELS, COM_H, SUSP } from '../src/spec.js';

// Preview: ?view=side|front|rear|top|threeq|rear3q|interior|frontlow&variant=rocket&doors=1&wing=1&airbrake=1
//          &lights=1&brake=1&fans=1&noz=1&steer=0.4&bg=light
const q = new URLSearchParams(location.search);
const num = (k, d = 0) => (q.has(k) ? parseFloat(q.get(k)) : d);

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = num('exp', 1.0);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const light = q.get('bg') === 'light';
scene.background = new THREE.Color(light ? 0xe8e8ea : 0x0c0d10);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = num('env', 0.9);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ color: light ? 0xd8d8da : 0x17181b, roughness: 0.9 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
if (!q.has('noground') && q.get('view') !== 'under') scene.add(ground);
scene.add(new THREE.HemisphereLight(0xcfd8ff, 0x202020, 0.6));
const sun = new THREE.DirectionalLight(0xffffff, num("sun", 1.5));
sun.position.set(4, 8, 5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5 });
scene.add(sun);
const fill = new THREE.DirectionalLight(0xaabbff, 0.8);
fill.position.set(-5, 3, -4);
scene.add(fill);

const variant = VARIANTS[q.get('variant') || 'thrust'];
const car = new RoadsterModel(variant);
car.group.position.set(0, COM_H, 0);
scene.add(car.group);

const cam = new THREE.PerspectiveCamera(num('fov', 30), innerWidth / innerHeight, 0.05, 200);
const views = {
  side: [[0, 0.45, 9], [0, 0.45, 0]],
  sidel: [[0, 0.55, -11.5], [0, 0.55, 0]],
  front: [[12, 0.75, 0], [0, 0.5, 0]],
  rear: [[-12, 0.9, 0], [0, 0.5, 0]],
  top: [[0.01, 13, 0], [0, 0, 0]],
  topfront: [[5.5, 7.5, 0], [0.2, 0.3, 0]],
  threeq: [[6.0, 1.4, 5.2], [0, 0.45, 0]],
  rear3q: [[-6.2, 1.3, 5.2], [-0.1, 0.5, 0]],
  frontlow: [[7.5, 0.9, 3.3], [0, 0.45, 0]],
  interior: [[-0.35, 0.95, 0.8], [0.7, 0.62, -0.45]],
  cockpit: [[0, 0, 0], [1, 0, 0]],
  under: [[1.5, -3.2, 3.2], [-0.2, 0.3, 0]],
};
let v = views[q.get('view') || 'threeq'] || views.threeq;
if (q.has('cam')) v = [q.get('cam').split(',').map(Number), (q.get('look') || '0,0.3,0').split(',').map(Number)];
if (q.get('view') === 'cockpit') {
  cam.position.copy(car.cockpit).add(car.group.position);
  cam.lookAt(cam.position.x + 5, cam.position.y - 0.4, cam.position.z);
  cam.fov = 70;
  cam.updateProjectionMatrix();
} else {
  cam.position.set(...v[0]);
  cam.lookAt(...v[1]);
  if (q.get('view') === 'interior') { cam.fov = 70; cam.updateProjectionMatrix(); }
}
const controls = new OrbitControls(cam, renderer.domElement);
controls.target.set(...v[1]);
if (q.get('view') === 'cockpit') controls.enabled = false;

const st = {
  wheels: WHEELS.map((w) => ({ steer: w.front ? num('steer') : 0, spin: 0, y: -COM_H + SUSP.radius })),
  doors: num('doors'), wing: num('wing'), airbrake: num('airbrake'), lights: num('lights'), brake: num('brake'),
  fans: num('fans'), nozzles: variant.nozzles.map(() => num('noz')), speed: 0,
};
const clock = new THREE.Clock();
let frames = 0;
function frame() {
  const dt = Math.min(0.05, clock.getDelta());
  car.update(frames < 5 ? 2 : dt, st);
  controls.update();
  renderer.render(scene, cam);
  frames++;
  if (frames === 8) {
    window.__tris = renderer.info.render.triangles;
    document.getElementById('info').textContent = `${variant.name} · tris ${window.__tris}`;
    window.__ready = true;
  }
  requestAnimationFrame(frame);
}
frame();
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  cam.aspect = innerWidth / innerHeight;
  cam.updateProjectionMatrix();
});
