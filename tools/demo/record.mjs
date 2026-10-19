// Records the Event mode show frame by frame (plus a short drive with the HUD), so the result
// does not depend on how fast the machine renders. Writes numbered JPEGs and marks.json.
// usage: node record.mjs <out-dir> [maxFrames]
import { chromium } from 'playwright-core';
import fs from 'fs';
const FPS = 20, DT = 1 / FPS;
const OUT = process.argv[2];
const MAX = +(process.argv[3] || 100000);
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 854, height: 480 }, deviceScaleFactor: 1 });
p.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await p.goto(process.env.URL || 'http://localhost:4173/');
await p.waitForTimeout(1500);
await p.evaluate(() => { window.__manual = true; window.__events = []; });
let n = 0;
const marks = [];
const t0 = Date.now();
const grab = async () => { if (n >= MAX) return; await p.screenshot({ path: `${OUT}/${String(n++).padStart(5, '0')}.jpg`, type: 'jpeg', quality: 92 }); };
const tick = async (ctl, pressed) => { await p.evaluate(([ctl, pressed]) => { if (ctl) { window.__demo = window.__demo || {}; window.__demo.ctrl = ctl; if (pressed) window.__demo.pressed = pressed; } window.__game.tick(1 / 20); }, [ctl || null, pressed || null]); await grab(); };

// The show, start to finish. (SPA_ONLY=1 records just the Spa segments, for checking.)
const SPA_ONLY = !!process.env.SPA_ONLY;
if (!SPA_ONLY) await p.evaluate(() => window.__game.beginShow());
let seg = -1;
for (let i = 0; i < (SPA_ONLY ? 0 : FPS * 150); i++) {
  const s = await p.evaluate(() => ({ active: window.__game.show.active, i: window.__game.show.i, ph: window.__game.show.state && window.__game.show.state.ph }));
  if (!s.active) break;
  if (s.i !== seg) { seg = s.i; marks.push({ seg, frame: n }); console.log('segment', seg, 'frame', n, ((Date.now() - t0) / 1000).toFixed(0) + 's'); }
  await tick();
}
// A few seconds of driving with the HUD: the Rocket launching down the strip.
if (!SPA_ONLY) await p.evaluate(() => { window.__game.select(2); window.__game.beginDrive(); window.__game.vehicle.respawn('strip'); window.__demo = { ctrl: {}, pressed: {} }; });
marks.push({ seg: 'drive', frame: n });
for (let i = 0; i < (SPA_ONLY ? 0 : FPS * 1); i++) await tick({});
for (let i = 0; i < (SPA_ONLY ? 0 : FPS * 3); i++) await tick({ throttle: 1, boost: true, steer: 0 });
for (let i = 0; i < (SPA_ONLY ? 0 : FPS * 1.5); i++) await tick({ brake: 1 });
// Spa-Francorchamps track day: a day run down through Eau Rouge and up Raidillon, then the night
// session leaving the pit box. A simple line-following driver stands in for the player.
await p.evaluate(async () => {
  const m = await import('/src/spa-track.js');
  const T = m.TRACK, L = {};
  window.__spaAt = (s) => { const i = Math.round(s / T.ds) % T.N; return { key: 'demo', label: '', x: T.x[i], z: T.z[i], y: T.y[i], yaw: Math.atan2(-T.tz[i], T.tx[i]) }; };
  window.__spaDrive = () => {
    const v = window.__game.vehicle;
    if (!m.locate(v.pos.x, v.pos.z, L)) return {};
    const look = 12 + v.vel.length() * 0.9;
    const i = (L.i + Math.round(look / T.ds)) % T.N;
    const want = Math.atan2(-(T.z[i] - v.pos.z), T.x[i] - v.pos.x), hd = Math.atan2(-v.fwd.z, v.fwd.x);
    let e = want - hd; e = Math.atan2(Math.sin(e), Math.cos(e));
    let kmax = 0; for (let j = 0; j < 60; j++) kmax = Math.max(kmax, Math.abs(T.k[(L.i + j) % T.N]));
    const pit = window.__game.lap.inPit;
    const vT = pit ? 22 : Math.min(80, Math.sqrt(1.1 * 9.81 / Math.max(kmax, 1e-3)));
    const sp = v.vFwd;
    return { throttle: sp < vT ? 1 : 0, brake: sp > vT + 3 ? 1 : 0, steer: Math.max(-1, Math.min(1, -e * 2.2 - (pit ? 0 : L.lat * 0.02))) };
  };
});
await p.evaluate(() => { window.__game.enterSpa(false); window.__game.vehicle.respawn(window.__spaAt(420)); window.__game.snapCamera(); });
marks.push({ seg: 'spa-day', frame: n });
for (let i = 0; i < FPS * 12; i++) await tick(await p.evaluate(() => window.__spaDrive()));
await p.evaluate(() => { window.__game.enterSpa(true); window.__game.snapCamera(); });
marks.push({ seg: 'spa-night', frame: n });
for (let i = 0; i < FPS * 8; i++) await tick(await p.evaluate(() => window.__spaDrive()));
marks.push({ seg: 'end', frame: n });
fs.writeFileSync(`${OUT}/marks.json`, JSON.stringify(marks));
console.log('frames', n, 'events', await p.evaluate(() => window.__events.filter((e) => ['land', 'crash', 'hang', 't60'].includes(e.type)).map((e) => e.type + (e.reason ? ':' + e.reason : '') + (e.time ? ' ' + e.time : ''))));
await b.close();
