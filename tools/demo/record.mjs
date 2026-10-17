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
const p = await b.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
p.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await p.goto(process.env.URL || 'http://localhost:4173/');
await p.waitForTimeout(1500);
await p.evaluate(() => { window.__manual = true; window.__events = []; });
let n = 0;
const marks = [];
const t0 = Date.now();
const grab = async () => { if (n >= MAX) return; await p.screenshot({ path: `${OUT}/${String(n++).padStart(5, '0')}.jpg`, type: 'jpeg', quality: 92 }); };
const tick = async (ctl, pressed) => { await p.evaluate(([ctl, pressed]) => { if (ctl) { window.__demo = window.__demo || {}; window.__demo.ctrl = ctl; if (pressed) window.__demo.pressed = pressed; } window.__game.tick(1 / 20); }, [ctl || null, pressed || null]); await grab(); };

// The show, start to finish.
await p.evaluate(() => window.__game.beginShow());
let seg = -1;
for (let i = 0; i < FPS * 150; i++) {
  const s = await p.evaluate(() => ({ active: window.__game.show.active, i: window.__game.show.i, ph: window.__game.show.state && window.__game.show.state.ph }));
  if (!s.active) break;
  if (s.i !== seg) { seg = s.i; marks.push({ seg, frame: n }); console.log('segment', seg, 'frame', n, ((Date.now() - t0) / 1000).toFixed(0) + 's'); }
  await tick();
}
// A few seconds of driving with the HUD: the Rocket launching down the strip.
await p.evaluate(() => { window.__game.select(2); window.__game.beginDrive(); window.__game.vehicle.respawn('strip'); window.__demo = { ctrl: {}, pressed: {} }; });
marks.push({ seg: 'drive', frame: n });
for (let i = 0; i < FPS * 1; i++) await tick({});
for (let i = 0; i < FPS * 3; i++) await tick({ throttle: 1, boost: true, steer: 0 });
for (let i = 0; i < FPS * 1.5; i++) await tick({ brake: 1 });
marks.push({ seg: 'end', frame: n });
fs.writeFileSync(`${OUT}/marks.json`, JSON.stringify(marks));
console.log('frames', n, 'events', await p.evaluate(() => window.__events.filter((e) => ['land', 'crash', 'hang', 't60'].includes(e.type)).map((e) => e.type + (e.reason ? ':' + e.reason : '') + (e.time ? ' ' + e.time : ''))));
await b.close();
