import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { RAMPS, OBSTACLES, WALL, RUNWAY, BOUNDS, SPAWNS } from './track.js';

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  return t;
}

function textTex(lines, w = 512, h = 256, bg = '#101419', fg = '#ffffff', size = 80) {
  return canvasTex(w, h, (g) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    lines.forEach((l, i) => {
      g.font = `700 ${l.size || size}px system-ui, sans-serif`;
      g.fillStyle = l.color || fg;
      g.fillText(l.text, w / 2, h * ((i + 1) / (lines.length + 1)));
    });
  });
}

export function buildWorld(scene, renderer) {
  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 38), THREE.MathUtils.degToRad(215));

  // Sky + image based lighting
  const sky = new Sky();
  sky.scale.setScalar(20000);
  const su = sky.material.uniforms;
  su.turbidity.value = 4; su.rayleigh.value = 1.6; su.mieCoefficient.value = 0.004; su.mieDirectionalG.value = 0.82;
  su.sunPosition.value.copy(sunDir);
  scene.add(sky);
  const pm = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const envSky = new Sky();
  envSky.scale.setScalar(1000);
  Object.keys(su).forEach((k) => { envSky.material.uniforms[k].value = su[k].value; });
  envScene.add(envSky);
  scene.environment = pm.fromScene(envScene, 0.02).texture;
  scene.environmentIntensity = 0.9;
  scene.fog = new THREE.Fog(0xd9c9b0, 250, 2600);

  const hemi = new THREE.HemisphereLight(0xcfe3ff, 0xc9a56b, 0.55);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff1d8, 3.1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45; sc.near = 1; sc.far = 400;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.05;
  scene.add(sun, sun.target);

  // Desert floor
  const sand = canvasTex(512, 512, (g, w, h) => {
    const r = rng(7);
    g.fillStyle = '#c9a66e'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) {
      const v = 150 + r() * 70;
      g.fillStyle = `rgba(${v + 30},${v},${v - 55},${0.12 + r() * 0.2})`;
      g.fillRect(r() * w, r() * h, 1 + r() * 3, 1 + r() * 3);
    }
    for (let i = 0; i < 30; i++) {
      g.strokeStyle = `rgba(120,85,45,${0.05 + r() * 0.06})`;
      g.lineWidth = 2 + r() * 6;
      g.beginPath(); g.moveTo(r() * w, r() * h); g.bezierCurveTo(r() * w, r() * h, r() * w, r() * h, r() * w, r() * h); g.stroke();
    }
  }, [260, 260]);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), new THREE.MeshStandardMaterial({ map: sand, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(600, -0.08, 0);
  ground.receiveShadow = true;
  scene.add(ground);

  // Runway
  const rwLen = RUNWAY.x1 - RUNWAY.x0;
  const asphalt = canvasTex(256, 512, (g, w, h) => {
    const r = rng(3);
    g.fillStyle = '#34363a'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 6000; i++) {
      const v = 40 + r() * 40;
      g.fillStyle = `rgba(${v},${v},${v + 3},0.35)`;
      g.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2);
    }
    // centre dashes run along the length (v axis is the length direction after rotation)
    g.fillStyle = '#e9e7df';
    g.fillRect(w / 2 - 5, 0, 10, h * 0.5);
    g.fillRect(4, 0, 6, h); g.fillRect(w - 10, 0, 6, h);
  }, [1, rwLen / 90]);
  const runway = new THREE.Mesh(new THREE.PlaneGeometry(RUNWAY.hw * 2, rwLen), new THREE.MeshStandardMaterial({ map: asphalt, roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
  runway.rotation.x = -Math.PI / 2;
  runway.rotation.z = Math.PI / 2;
  runway.position.set((RUNWAY.x0 + RUNWAY.x1) / 2, 0.02, 0);
  runway.receiveShadow = true;
  scene.add(runway);

  // Start line + gantry
  const line = new THREE.Mesh(new THREE.PlaneGeometry(1.2, RUNWAY.hw * 2 - 2), new THREE.MeshBasicMaterial({ color: 0xffffff, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 }));
  line.rotation.x = -Math.PI / 2;
  line.position.set(2.4, 0.04, 0);
  scene.add(line);
  const steel = new THREE.MeshStandardMaterial({ color: 0x8a9099, metalness: 0.8, roughness: 0.4 });
  const gantry = new THREE.Group();
  for (const z of [-RUNWAY.hw + 1, RUNWAY.hw - 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.8, 11, 0.8), steel);
    leg.position.set(0, 5.5, z); leg.castShadow = true; gantry.add(leg);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.1, RUNWAY.hw * 2), steel);
  beam.position.set(0, 11, 0); beam.castShadow = true; gantry.add(beam);
  const banner = new THREE.Mesh(
    new THREE.PlaneGeometry(RUNWAY.hw * 1.4, 4.2),
    new THREE.MeshBasicMaterial({ map: textTex([{ text: 'ROADSTER', size: 120, color: '#ffffff' }, { text: 'LAUNCH  0 - 60', size: 56, color: '#9fd8ff' }], 1024, 256, '#0b0d10') }),
  );
  banner.position.set(-0.5, 8.5, 0);
  banner.rotation.y = -Math.PI / 2;
  gantry.add(banner);
  const banner2 = banner.clone();
  banner2.position.x = 0.5; banner2.rotation.y = Math.PI / 2;
  gantry.add(banner2);
  gantry.position.x = 0;
  scene.add(gantry);

  // Distance boards every 100 m
  for (let x = 100; x <= 1500; x += 100) {
    const t = textTex([{ text: `${x}`, size: 110 }, { text: 'METRES', size: 40, color: '#9aa4b2' }], 256, 192);
    for (const z of [-RUNWAY.hw - 3, RUNWAY.hw + 3]) {
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(4, 3), new THREE.MeshBasicMaterial({ map: t, side: THREE.DoubleSide }));
      sign.position.set(x, 3.2, z);
      sign.rotation.y = -Math.PI / 2;
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.2, 3.2, 0.2), steel);
      post.position.set(x, 1.6, z);
      scene.add(sign, post);
    }
  }

  // Ramps
  const concrete = new THREE.MeshStandardMaterial({ color: 0xa5a8ac, roughness: 0.9 });
  const stripe = new THREE.MeshStandardMaterial({ color: 0xf3b81f, roughness: 0.8 });
  for (const r of RAMPS) {
    const shape = new THREE.Shape();
    if (r.type === 'up') { shape.moveTo(0, 0); shape.lineTo(r.len, r.h); shape.lineTo(r.len, 0); }
    else { shape.moveTo(0, 0); shape.lineTo(0, r.h); shape.lineTo(r.len, 0); }
    const geo = new THREE.ExtrudeGeometry(shape, { depth: r.hw * 2, bevelEnabled: false });
    geo.translate(0, 0, -r.hw);
    const mesh = new THREE.Mesh(geo, concrete);
    mesh.position.set(r.x, 0, r.zc);
    mesh.castShadow = true; mesh.receiveShadow = true;
    scene.add(mesh);
    // hazard stripe on the lip / face
    const lipH = r.h;
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, r.hw * 2), stripe);
    if (r.type === 'up') { s.position.set(r.x + r.len - 0.2, lipH + 0.03, r.zc); s.rotation.z = Math.atan2(r.h, r.len); }
    else { s.position.set(r.x + 0.2, lipH + 0.03, r.zc); s.rotation.z = -Math.atan2(r.h, r.len); }
    scene.add(s);
  }
  // Ramp edge markers
  const arrowTex = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#f3b81f'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#111'; for (let i = -2; i < 6; i++) { g.beginPath(); g.moveTo(i * 32, 0); g.lineTo(i * 32 + 16, 0); g.lineTo(i * 32 + 16 + 64, h); g.lineTo(i * 32 + 64, h); g.fill(); }
  });
  for (const r of RAMPS.filter((q) => q.type === 'up' && q.label)) {
    const t = textTex([{ text: r.label, size: 120 }], 512, 160, '#0b0d10', '#f3b81f');
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(9, 2.8), new THREE.MeshBasicMaterial({ map: t, side: THREE.DoubleSide }));
    sign.position.set(r.x - 30, 3.2, r.zc + r.hw + 4);
    sign.rotation.y = -Math.PI / 2;
    scene.add(sign);
    for (const z of [-r.hw - 0.4, r.hw + 0.4]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(r.len, 0.5, 0.5), new THREE.MeshStandardMaterial({ map: arrowTex }));
      m.position.set(r.x + r.len / 2, 0.25, r.zc + z);
      scene.add(m);
    }
  }

  // Parked traffic
  const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.25, 12);
  wheelGeo.rotateX(Math.PI / 2);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x0c0c0c, roughness: 0.9 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x1b2230, metalness: 0.6, roughness: 0.15 });
  for (const o of OBSTACLES) {
    const g = new THREE.Group();
    if (o.kind === 'car') {
      const paint = new THREE.MeshStandardMaterial({ color: o.color, metalness: 0.5, roughness: 0.35 });
      const b = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.75, 1.9), paint); b.position.y = 0.7;
      const c = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.62, 1.7), glassMat); c.position.set(-0.2, 1.37, 0);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.08, 1.62), paint); roof.position.set(-0.2, 1.7, 0);
      b.castShadow = c.castShadow = true;
      g.add(b, c, roof);
      for (const [x, z] of [[1.4, 0.9], [1.4, -0.9], [-1.4, 0.9], [-1.4, -0.9]]) {
        const w = new THREE.Mesh(wheelGeo, wheelMat); w.position.set(x, 0.34, z); g.add(w);
      }
      g.position.set((o.x0 + o.x1) / 2, 0, (o.z0 + o.z1) / 2);
    } else {
      const white = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.6, metalness: 0.2 });
      const cab = new THREE.Mesh(new THREE.BoxGeometry(3, 3.0, 2.6), new THREE.MeshStandardMaterial({ color: 0xc8102e, metalness: 0.4, roughness: 0.4 }));
      cab.position.set(6.6, 1.9, 0);
      const win = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.0, 2.2), glassMat); win.position.set(8.1, 2.8, 0);
      const trailer = new THREE.Mesh(new THREE.BoxGeometry(12.6, 3.6, 2.7), white);
      trailer.position.set(-1.4, 2.5, 0);
      cab.castShadow = trailer.castShadow = true;
      g.add(cab, win, trailer);
      for (const x of [-6, -4.6, 6.2, 3.6]) for (const z of [1.3, -1.3]) {
        const w = new THREE.Mesh(wheelGeo, wheelMat); w.scale.set(1.5, 1.5, 1.2); w.position.set(x, 0.5, z); g.add(w);
      }
      g.position.set((o.x0 + o.x1) / 2, 0, 0);
    }
    scene.add(g);
  }

  // The wall ramp
  {
    const R = WALL.R, T = WALL.thick, N = 72;
    const outer = [], inner = [];
    for (let i = 0; i <= N; i++) {
      const th = (i / N) * WALL.thetaMax;
      const s = Math.sin(th), c = Math.cos(th);
      inner.push(new THREE.Vector2(WALL.x0 + R * s, R * (1 - c)));
      outer.push(new THREE.Vector2(WALL.x0 + (R + T) * s, R - (R + T) * c));
    }
    const shape = new THREE.Shape([...inner, ...outer.reverse()]);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: WALL.hw * 2, bevelEnabled: false, curveSegments: 1 });
    geo.translate(0, 0, -WALL.hw);
    const mat = new THREE.MeshStandardMaterial({ color: 0x2b2f36, metalness: 0.75, roughness: 0.4 });
    const wall = new THREE.Mesh(geo, mat);
    wall.position.z = WALL.zc;
    wall.castShadow = true; wall.receiveShadow = true;
    scene.add(wall);
    // glowing lane edges on the driving surface
    const glow = new THREE.MeshBasicMaterial({ color: 0x66ccff });
    for (const z of [-WALL.hw + 0.5, WALL.hw - 0.5, 0]) {
      const pts = [];
      for (let i = 0; i <= N; i++) {
        const th = (i / N) * WALL.thetaMax;
        pts.push(new THREE.Vector3(WALL.x0 + (R - 0.03) * Math.sin(th), (R - (R - 0.03) * Math.cos(th)), WALL.zc + z));
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      scene.add(new THREE.Mesh(new THREE.TubeGeometry(curve, N * 2, z === 0 ? 0.05 : 0.09, 4, false), glow));
    }
    // Support ribs
    for (let i = 0; i < 9; i++) {
      const th = (i / 8) * WALL.thetaMax * 0.97 + 0.02;
      for (const z of [-WALL.hw, WALL.hw]) {
        const rib = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), steel);
        rib.position.set(WALL.x0 + (R + T + 0.3) * Math.sin(th), R - (R + T + 0.3) * Math.cos(th), WALL.zc + z);
        scene.add(rib);
      }
    }
    // backstop legs
    for (const z of [-WALL.hw + 0.6, WALL.hw - 0.6]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(1, R, 1), steel);
      leg.position.set(WALL.x0 + R + T + 1, R / 2, WALL.zc + z);
      leg.castShadow = true;
      scene.add(leg);
    }
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(14, 4),
      new THREE.MeshBasicMaterial({ map: textTex([{ text: 'FLIP WALL', size: 110, color: '#9fd8ff' }, { text: 'FAST AND STRAIGHT', size: 48, color: '#ffffff' }], 1024, 290, '#0b0d10'), side: THREE.DoubleSide }),
    );
    sign.position.set(WALL.x0 - 40, 4.5, WALL.zc - WALL.hw - 6);
    sign.rotation.y = -Math.PI / 2;
    scene.add(sign);
  }

  // Checkpoint pads
  for (const s of SPAWNS) {
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(6, 3.6), new THREE.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.1, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 }));
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(s.x, 0.05, 0);
    scene.add(pad);
  }

  // Scenery: mesas, rocks, scrub, a test-stand tower and tanks
  const r = rng(11);
  const mesaMat = new THREE.MeshStandardMaterial({ color: 0xa4673c, roughness: 1, flatShading: true });
  for (let i = 0; i < 38; i++) {
    const ang = r() * Math.PI * 2;
    const dist = 1400 + r() * 1100;
    const cx = 600 + Math.cos(ang) * dist * 1.25;
    const cz = Math.sin(ang) * dist;
    const h = 40 + r() * 120;
    const rad = 60 + r() * 150;
    const mesa = new THREE.Mesh(new THREE.CylinderGeometry(rad * 0.7, rad, h, 9 + (r() * 4 | 0), 3), mesaMat);
    mesa.position.set(cx, h / 2 - 2, cz);
    mesa.rotation.y = r() * 3;
    scene.add(mesa);
    if (r() > 0.5) {
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(rad * 0.45, rad * 0.7, h * 0.3, 9, 1), new THREE.MeshStandardMaterial({ color: 0xc58a55, roughness: 1, flatShading: true }));
      cap.position.set(cx, h + h * 0.13, cz);
      scene.add(cap);
    }
  }
  const rockGeo = new THREE.IcosahedronGeometry(1, 0);
  const rocks = new THREE.InstancedMesh(rockGeo, new THREE.MeshStandardMaterial({ color: 0x8a6c4a, roughness: 1, flatShading: true }), 420);
  const scrub = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ color: 0x6b7a3c, roughness: 1, flatShading: true }), 520);
  const dummy = new THREE.Object3D();
  const placeAway = () => {
    for (;;) {
      const x = BOUNDS.x0 + r() * (BOUNDS.x1 - BOUNDS.x0);
      const z = BOUNDS.z0 + r() * (BOUNDS.z1 - BOUNDS.z0) * 1.6 - 120;
      if (Math.abs(z) < RUNWAY.hw + 8 && x > RUNWAY.x0 - 20 && x < RUNWAY.x1 + 20) continue;
      if (x > WALL.x0 - 20 && x < WALL.x0 + 60 && Math.abs(z) < 30) continue;
      return [x, z];
    }
  };
  for (let i = 0; i < 420; i++) {
    const [x, z] = placeAway();
    const s = 0.5 + r() * r() * 5;
    dummy.position.set(x, s * 0.3, z);
    dummy.scale.set(s * (0.8 + r() * 0.6), s * 0.7, s * (0.8 + r() * 0.6));
    dummy.rotation.set(r() * 3, r() * 3, r() * 3);
    dummy.updateMatrix();
    rocks.setMatrixAt(i, dummy.matrix);
  }
  for (let i = 0; i < 520; i++) {
    const [x, z] = placeAway();
    const s = 0.6 + r() * 1.4;
    dummy.position.set(x, s * 0.4, z);
    dummy.scale.set(s * 1.4, s * 0.8, s * 1.4);
    dummy.rotation.set(0, r() * 3, 0);
    dummy.updateMatrix();
    scrub.setMatrixAt(i, dummy.matrix);
  }
  rocks.castShadow = scrub.castShadow = true;
  scene.add(rocks, scrub);

  // Test stands, tanks, grandstand
  const tower = new THREE.Group();
  for (const [x, z] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.7, 70, 0.7), steel); leg.position.set(x, 35, z); tower.add(leg);
  }
  for (let y = 5; y < 70; y += 7) {
    const ring = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.4, 6.4), steel); ring.position.y = y; tower.add(ring);
  }
  const rocket = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 38, 16), new THREE.MeshStandardMaterial({ color: 0xdfe3e8, metalness: 0.7, roughness: 0.3 }));
  rocket.position.y = 22; tower.add(rocket);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(1.4, 6, 16), rocket.material); nose.position.y = 44; tower.add(nose);
  tower.position.set(-120, 0, -130);
  tower.traverse((o) => { o.castShadow = true; });
  scene.add(tower);
  for (let i = 0; i < 3; i++) {
    const tank = new THREE.Mesh(new THREE.SphereGeometry(7, 20, 14), new THREE.MeshStandardMaterial({ color: 0xf1f3f5, metalness: 0.6, roughness: 0.3 }));
    tank.position.set(-60 + i * 20, 7, -160); tank.castShadow = true; scene.add(tank);
  }
  const stand = new THREE.Group();
  const crowdTex = canvasTex(256, 64, (g, w, h) => {
    const rr = rng(5); g.fillStyle = '#2a2d33'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 400; i++) { g.fillStyle = `hsl(${rr() * 360},50%,${40 + rr() * 30}%)`; g.fillRect(rr() * w, rr() * h, 3, 4); }
  });
  for (let i = 0; i < 5; i++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(5, 1.2, 60), new THREE.MeshStandardMaterial({ map: crowdTex }));
    step.position.set(-i * 2.2, 0.6 + i * 1.2, 0);
    step.castShadow = true;
    stand.add(step);
  }
  stand.position.set(40, 0, -RUNWAY.hw - 18);
  stand.rotation.y = -Math.PI / 2;
  scene.add(stand);

  return { sun, sunDir, ground };
}

export function followSun(world, target) {
  const { sun, sunDir } = world;
  sun.target.position.copy(target);
  sun.position.copy(target).addScaledVector(sunDir, 160);
}
