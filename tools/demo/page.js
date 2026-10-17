// Runs inside the game page. Defines scripted segments with closed-loop flip control.
window.JUMP_V = 41; window.WALL_V = 30;
window.demo = (() => {
  const g = window.__game, v = g.vehicle;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const flip = (target, maxW = 4) => {
    const a = v.air; if (!a) return 0;
    const e = target - a.pitch;
    const wDes = clamp(e * 3, -maxW, maxW);
    return clamp((v.w.z - wDes) * 1.5, -1, 1);
  };
  const seg = {
    launch: { setup() { g.select(1); g.beginDrive(); v.respawn(0); }, ctl: () => ({ throttle: 1, thrust: v.t60.state !== 'done' }), done: (f) => f > 100 },
    jump: {
      setup() { g.select(1); v.respawn(440); v.gp.set(500, 0, 0); v.vel.set(30, 0, 0); v.tank = v.p.tank; },
      ctl: () => v.mode === 'air' ? { throttle: 0, pitch: flip(-2 * Math.PI) } : { throttle: v.speed < JUMP_V ? 1 : 0.2 },
    },
    wall: {
      setup() { g.select(2); v.respawn(780); v.gp.set(830, 0, 0); v.vel.set(26, 0, 0); v.tank = v.p.tank; },
      ctl: () => v.mode === 'air' ? { throttle: 0, pitch: flip(2 * Math.PI, 3.6) } : { throttle: v.speed < WALL_V && v.mode === 'ground' ? 1 : v.mode === 'wall' ? 0.5 : 0.2 },
    },
  };
  return { seg, v, g };
})();
