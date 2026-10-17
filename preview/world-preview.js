// Standalone preview of the venue. URL params:
//   cam=x,y,z  look=x,y,z  fov=60  spawn=start|strip|lineup|flip|wall  mph=  t60=  stunt=  variant=
//   orbit=1 (drag to look around)
import * as THREE from 'three';
import { buildWorld, updateWorld } from '../src/world.js';
import { SPAWNS } from '../src/track.js';

const q = new URLSearchParams(location.search);
const vec = (s, d) => (s ? new THREE.Vector3(...s.split(',').map(Number)) : d);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(Number(q.get('fov') || 60), innerWidth / innerHeight, 0.4, 9000);
const t0 = performance.now();
const world = buildWorld(scene, renderer);
const buildMs = performance.now() - t0;
renderer.toneMappingExposure = Number(q.get('exp') || world.exposure);

const sp = SPAWNS.find((s) => s.key === (q.get('spawn') || 'start')) || SPAWNS[0];
const car = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.1, 2.0), new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.25, clearcoat: 1 }));
car.position.set(sp.x, 0.75, sp.z);
car.rotation.y = -sp.yaw;
car.castShadow = true; car.receiveShadow = true;
scene.add(car);

const cam = vec(q.get('cam'), new THREE.Vector3(sp.x - 12, 4, sp.z + 3));
const look = vec(q.get('look'), car.position.clone());
camera.position.copy(cam);
camera.lookAt(look);

const info = {
  mph: q.has('mph') ? Number(q.get('mph')) : 0,
  variant: q.get('variant') || 'Rocket',
  stunt: q.get('stunt') || undefined,
  gas: q.has('gas') ? Number(q.get('gas')) : 0.8,
  suction: q.has('suction') ? Number(q.get('suction')) : 0.35,
  t60: q.has('t60') ? Number(q.get('t60')) : undefined,
};

// simple mouse look
let yaw = 0, pitch = 0, drag = false;
{
  const d = new THREE.Vector3().subVectors(look, cam).normalize();
  yaw = Math.atan2(d.x, -d.z); pitch = Math.asin(d.y);
}
addEventListener('pointerdown', () => { drag = true; });
addEventListener('pointerup', () => { drag = false; });
addEventListener('pointermove', (e) => {
  if (!drag) return;
  yaw += e.movementX * 0.004; pitch = Math.max(-1.5, Math.min(1.5, pitch - e.movementY * 0.004));
  camera.lookAt(camera.position.clone().add(new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch))));
});
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });

const hud = document.getElementById('hud');
let last = performance.now(), t = Number(q.get('t') || 3), frames = 0, acc = 0;
const times = [];
function frame() {
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  t += dt;
  if (!q.has('mph')) info.mph = (Math.sin(t * 0.5) * 0.5 + 0.5) * 160;
  updateWorld(world, dt, t, car.position, info);
  const r0 = performance.now();
  renderer.render(scene, camera);
  times.push(performance.now() - r0);
  frames++; acc += dt;
  if (frames % 3 === 0) {
    const ri = renderer.info.render;
    const avg = times.slice(-3).reduce((a, b) => a + b, 0) / 3;
    hud.textContent = `calls ${ri.calls}  tris ${(ri.triangles / 1000).toFixed(0)}k  render ${avg.toFixed(1)} ms  build ${buildMs.toFixed(0)} ms`;
    window.__stats = { calls: ri.calls, triangles: ri.triangles, renderMs: avg, buildMs, frames, crowd: world.crowdCount, smoke: world.smoke.length, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, programs: renderer.info.programs.length };
  }
  requestAnimationFrame(frame);
}
frame();
