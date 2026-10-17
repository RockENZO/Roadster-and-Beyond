import * as THREE from 'three';

// A stylised Roadster. Proportions and details follow what was reported from the launch
// (SR-71 / F-35 inspired wedge, white paint, gold-tinted glass, hidden headlights, full-width
// tail light, rear diffuser fans, auto wing, cold-gas thrusters). The exact surfacing is an
// interpretation, not a scan.
const COM_H = 0.5;

function extrudeProfile(points, depth, taper, bevel = 0.05) {
  const shape = new THREE.Shape(points.map((p) => new THREE.Vector2(p[0], p[1])));
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, steps: 1, curveSegments: 1,
  });
  geo.translate(0, 0, -depth / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setZ(i, pos.getZ(i) * taper(pos.getX(i), pos.getY(i)));
  }
  geo.computeVertexNormals();
  return geo;
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));

export class RoadsterModel {
  constructor(variant) {
    this.group = new THREE.Group();
    this.model = new THREE.Group();
    this.model.position.y = -COM_H;
    this.group.add(this.model);
    this.wheels = [];
    this.fans = [];
    this.nozzles = [];
    this.wingT = 0;
    this.lightsT = 0;
    this.build(variant);
  }

  build(variant) {
    const m = this.model;
    const paint = new THREE.MeshPhysicalMaterial({
      color: 0xf2f3f5, metalness: 0.3, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.1,
    });
    const dark = new THREE.MeshStandardMaterial({ color: 0x111317, metalness: 0.7, roughness: 0.4 });
    const gunmetal = new THREE.MeshStandardMaterial({ color: 0x3a3f46, metalness: 0.9, roughness: 0.3 });
    const tyre = new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.85 });
    const gold = new THREE.MeshPhysicalMaterial({
      color: 0xb99342, metalness: 0.6, roughness: 0.08, transparent: true, opacity: 0.55, envMapIntensity: 1.4,
    });
    this.matLight = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff1a1a, emissiveIntensity: 1.2 });
    this.matHead = new THREE.MeshStandardMaterial({ color: 0x050505, emissive: 0xdfeaff, emissiveIntensity: 0 });
    this.matGlow = new THREE.MeshBasicMaterial({ color: 0x66ccff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });

    // Lower body, side profile (x forward, y up), tapered in plan to a thin nose and tail.
    const body = extrudeProfile(
      [[-2.0, 0.16], [2.0, 0.16], [2.17, 0.30], [2.17, 0.41], [1.25, 0.63], [0.7, 0.72], [-0.6, 0.78], [-1.5, 0.85], [-2.17, 0.74], [-2.17, 0.4]],
      1.98,
      (x, y) => {
        const nose = x > 0.7 ? THREE.MathUtils.lerp(1, 0.5, clamp01((x - 0.7) / 1.5)) : 1;
        const tail = x < -1.0 ? THREE.MathUtils.lerp(1, 0.8, clamp01((-1.0 - x) / 1.2)) : 1;
        const shoulder = 1 - 0.16 * clamp01((y - 0.5) / 0.38);
        return nose * tail * shoulder;
      },
    );
    const bodyMesh = new THREE.Mesh(body, paint);
    bodyMesh.castShadow = true;
    m.add(bodyMesh);

    // Gold glass canopy.
    const canopy = extrudeProfile(
      [[-1.3, 0.78], [1.0, 0.68], [0.1, 1.06], [-0.6, 1.08]],
      1.3,
      (x, y) => 1 - 0.34 * clamp01((y - 0.68) / 0.4),
      0.025,
    );
    const canopyMesh = new THREE.Mesh(canopy, gold);
    canopyMesh.castShadow = false;
    m.add(canopyMesh);
    const roofRail = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.03, 0.05), dark);
    roofRail.position.set(-0.25, 1.075, 0);
    m.add(roofRail);

    // Cabin: seats and a squared yoke (the wheel shape is inferred; steering is steer-by-wire).
    const seatMat = new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.7 });
    const seatZ = variant.seats === 2 ? [-0.36, 0.36] : [0];
    for (const z of seatZ) {
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.42), seatMat);
      base.position.set(-0.55, 0.72, z);
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.42, 0.42), seatMat);
      back.position.set(-0.8, 0.9, z);
      back.rotation.z = -0.22;
      m.add(base, back);
    }
    const yoke = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.022, 6, 14), dark);
    yoke.scale.set(1.5, 1, 1);
    yoke.position.set(0.25, 0.92, variant.seats === 2 ? -0.36 : 0);
    yoke.rotation.y = Math.PI / 2;
    yoke.rotation.x = 0.0;
    yoke.rotation.z = 0.5;
    m.add(yoke);
    const dash = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.08, 1.0), dark);
    dash.position.set(0.5, 0.78, 0);
    m.add(dash);

    // Nose: hidden headlight slit and a splitter.
    const slit = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.035, 1.1), this.matHead);
    slit.position.set(2.0, 0.41, 0);
    slit.rotation.z = -0.38;
    m.add(slit);
    this.slit = slit;
    const splitter = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.025, 1.3), dark);
    splitter.position.set(2.02, 0.17, 0);
    m.add(splitter);
    this.headLights = [];
    for (const z of [-0.5, 0.5]) {
      const s = new THREE.SpotLight(0xeaf2ff, 0, 90, 0.5, 0.6, 1.2);
      s.position.set(2.0, 0.45, z);
      s.target.position.set(30, 0.2, z);
      m.add(s, s.target);
      this.headLights.push(s);
    }

    // Full-width tail light.
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.06, 1.34), this.matLight);
    tail.position.set(-2.245, 0.6, 0);
    tail.rotation.z = 0.0;
    m.add(tail);

    // Diffuser with two fans.
    const diffuser = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.12, 1.3), dark);
    diffuser.position.set(-2.0, 0.18, 0);
    m.add(diffuser);
    for (let i = -2; i <= 2; i++) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.012), gunmetal);
      fin.position.set(-2.28, 0.17, i * 0.27);
      m.add(fin);
    }
    for (const z of [-0.42, 0.42]) {
      const fan = new THREE.Group();
      fan.position.set(-2.26, 0.4, z);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.02, 6, 20), gunmetal);
      ring.rotation.y = Math.PI / 2;
      fan.add(ring);
      const hub = new THREE.Group();
      for (let i = 0; i < 7; i++) {
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.13, 0.034), dark);
        blade.position.y = 0.07;
        const arm = new THREE.Group();
        arm.rotation.x = (i / 7) * Math.PI * 2;
        arm.add(blade);
        hub.add(arm);
      }
      fan.add(hub);
      m.add(fan);
      this.fans.push(hub);
    }

    // Auto wing.
    this.wing = new THREE.Group();
    const wingPlane = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.025, 1.55), paint);
    wingPlane.castShadow = true;
    this.wing.add(wingPlane);
    for (const z of [-0.5, 0.5]) {
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.2, 0.025), dark);
      strut.position.set(0.0, -0.1, z);
      this.wing.add(strut);
    }
    this.wing.position.set(-1.85, 0.84, 0);
    m.add(this.wing);

    // Wheels.
    const wheelPos = [[1.32, 0.34, 0.9], [1.32, 0.34, -0.9], [-1.32, 0.34, 0.9], [-1.32, 0.34, -0.9]];
    wheelPos.forEach((wp, i) => {
      const steer = new THREE.Group();
      steer.position.set(...wp);
      const spin = new THREE.Group();
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.3, 28), tyre);
      t.rotation.x = Math.PI / 2;
      t.castShadow = true;
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.235, 0.235, 0.31, 20), gunmetal);
      rim.rotation.x = Math.PI / 2;
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.32, 12), dark);
      cap.rotation.x = Math.PI / 2;
      spin.add(t, rim, cap);
      for (let k = 0; k < 5; k++) {
        const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.24, 0.32), dark);
        spoke.rotation.z = (k / 5) * Math.PI;
        spin.add(spoke);
      }
      steer.add(spin);
      m.add(steer);
      this.wheels.push({ steer, spin, front: i < 2 });
    });
    // Wide haunches over the wheels, with dark wells behind them.
    const fenderGeo = new THREE.CylinderGeometry(0.43, 0.43, 0.46, 24, 1, true, 0, Math.PI);
    fenderGeo.rotateX(Math.PI / 2);
    fenderGeo.rotateZ(Math.PI / 2);
    const fenderMat = paint.clone();
    fenderMat.side = THREE.DoubleSide;
    for (const wp of wheelPos) {
      const f = new THREE.Mesh(fenderGeo, fenderMat);
      f.position.set(wp[0], wp[1], wp[2]);
      f.castShadow = true;
      m.add(f);
      const inner = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.02, 20), dark);
      inner.rotation.x = Math.PI / 2;
      inner.position.set(wp[0], wp[1], wp[2] + (wp[2] > 0 ? -0.2 : 0.2));
      m.add(inner);
    }
    const rocker = new THREE.Mesh(new THREE.BoxGeometry(3.3, 0.08, 1.72), dark);
    rocker.position.set(0, 0.18, 0);
    m.add(rocker);

    // Thruster nozzles.
    const nozMat = new THREE.MeshStandardMaterial({ color: 0x2a2d33, metalness: 0.9, roughness: 0.35 });
    const glowMat = new THREE.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    this.nozGlow = glowMat;
    const addNozzle = (pos, dir, r = 0.075, group) => {
      const cone = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.7, r, 0.16, 12, 1, true), nozMat);
      const d = new THREE.Vector3(...dir).normalize();
      // cone axis +y points out of the nozzle (r small end first)
      cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
      cone.position.set(...pos);
      const g = new THREE.Mesh(new THREE.CircleGeometry(r * 0.65, 10), glowMat);
      g.position.set(...pos).addScaledVector(d, 0.085);
      g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), d);
      m.add(cone, g);
      this.nozzles.push({ pos: new THREE.Vector3(...pos), dir: d, group });
    };
    if (variant.key === 'thrust') {
      addNozzle([-2.3, 0.52, -0.2], [-1, 0, 0], 0.085, 'rear');
      addNozzle([-2.3, 0.52, 0.2], [-1, 0, 0], 0.085, 'rear');
    } else if (variant.key === 'rocket') {
      addNozzle([2.1, 0.42, -0.28], [1, 0, 0], 0.06, 'front');
      addNozzle([2.1, 0.42, 0.28], [1, 0, 0], 0.06, 'front');
      addNozzle([-2.3, 0.52, -0.3], [-1, 0, 0], 0.085, 'rear');
      addNozzle([-2.3, 0.52, 0.3], [-1, 0, 0], 0.085, 'rear');
      addNozzle([1.0, 0.55, -0.82], [0, 0, -1], 0.06, 'side');
      addNozzle([1.0, 0.55, 0.82], [0, 0, 1], 0.06, 'side');
      addNozzle([-1.2, 0.7, -0.84], [0, 0, -1], 0.06, 'side');
      addNozzle([-1.2, 0.7, 0.84], [0, 0, 1], 0.06, 'side');
      addNozzle([0.6, 0.15, -0.5], [0, -1, 0], 0.07, 'down');
      addNozzle([0.6, 0.15, 0.5], [0, -1, 0], 0.07, 'down');
    }

    // Suction glow under the car.
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.5), this.matGlow);
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.1;
    m.add(glow);

    m.traverse((o) => { if (o.isMesh && o.material !== this.matGlow) o.castShadow = o.castShadow || false; });
    bodyMesh.castShadow = true;
  }

  nozzleWorld(n, outPos, outDir) {
    outPos.copy(n.pos).add(this.model.position).applyQuaternion(this.group.quaternion).add(this.group.position);
    outDir.copy(n.dir).applyQuaternion(this.group.quaternion);
  }

  update(dt, v, inp, lights) {
    this.group.position.copy(v.pos);
    this.group.quaternion.copy(v.q);
    const onGround = v.mode === 'ground' || v.mode === 'wall';
    const speed = v.mode === 'wall' ? v.wall.v : v.vel.dot(v.fwd);
    // wheels
    for (const w of this.wheels) {
      w.spin.rotation.z -= (speed / 0.34) * dt;
      if (w.front) w.steer.rotation.y = v.steerVis || 0;
    }
    // Track Mode lowers the car; the wing deploys in Track Mode, under braking, and at speed.
    const wingTarget = v.trackMode || v.braking || Math.abs(speed) > 55 || v.mode === 'wall' ? 1 : 0;
    this.wingT += (wingTarget - this.wingT) * Math.min(1, dt * 6);
    this.wing.position.y = 0.84 + 0.22 * this.wingT;
    this.wing.rotation.z = -0.35 * this.wingT * (v.braking ? 1.4 : 1);
    const lower = v.trackMode ? 0.07 : 0;
    this.model.position.y += (-COM_H - lower - this.model.position.y) * Math.min(1, dt * 8);
    // fans
    const spinRate = 8 + Math.abs(speed) * 0.5 + (v.mode === 'wall' ? 60 : 0);
    for (const f of this.fans) f.rotation.x += spinRate * dt;
    // lights
    const brake = v.braking ? 1 : 0;
    this.matLight.emissiveIntensity += ((0.5 + brake * 3 + (lights ? 0.8 : 0)) - this.matLight.emissiveIntensity) * Math.min(1, dt * 15);
    this.lightsT += ((lights ? 1 : 0) - this.lightsT) * Math.min(1, dt * 8);
    this.matHead.emissiveIntensity = 4 * this.lightsT;
    for (const s of this.headLights) s.intensity = 260 * this.lightsT;
    // suction + nozzle glow
    const suction = v.mode === 'wall' ? 0.7 : v.trackMode ? 0.28 : 0;
    this.matGlow.opacity += (suction - this.matGlow.opacity) * Math.min(1, dt * 6);
    this.nozGlow.opacity += ((v.boosting ? 0.95 : 0) - this.nozGlow.opacity) * Math.min(1, dt * 20);
  }
}
