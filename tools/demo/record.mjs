import { chromium } from 'playwright-core';
import fs from 'fs';
const FPS = 20, DT = 1 / FPS;
const OUT = process.argv[2];
const MAX = +(process.argv[3] || 100000);
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
p.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await p.goto('http://localhost:4173/');
await p.waitForTimeout(1500);
await p.evaluate(() => { window.__manual = true; window.__events = []; });
await p.addScriptTag({ content: fs.readFileSync('page.js', 'utf8') });
await p.evaluate(() => {
  document.getElementById('hints').classList.add('off');
  const c = document.createElement('div');
  c.id = 'cap';
  c.style.cssText = 'position:fixed;top:18px;left:50%;transform:translateX(-50%);font:800 15px/1 system-ui,sans-serif;letter-spacing:.22em;text-transform:uppercase;color:#fff;background:rgba(10,12,16,.62);border:1px solid rgba(255,255,255,.18);padding:9px 18px;border-radius:99px;z-index:9;opacity:0;transition:none;white-space:nowrap';
  document.body.appendChild(c);
});
let n = 0;
const t0 = Date.now();
const grab = async () => { if (n >= MAX) return; await p.screenshot({ path: `${OUT}/${String(n++).padStart(5, '0')}.jpg`, type: 'jpeg', quality: 92 }); };
const caption = (t) => p.evaluate((t) => { const c = document.getElementById('cap'); c.textContent = t; c.style.opacity = t ? 1 : 0; }, t);
const frame = async (ctl, pressed) => { await p.evaluate(([ctl, pressed]) => { window.__demo = window.__demo || {}; window.__demo.ctrl = ctl || {}; if (pressed) window.__demo.pressed = pressed; window.__game.tick(1 / 20); }, [ctl || null, pressed || null]); await grab(); };
const ctlFrame = async (segName) => {
  await p.evaluate((segName) => { window.__demo = window.__demo || {}; window.__demo.ctrl = window.demo.seg[segName].ctl(); window.__game.tick(1 / 20); }, segName);
  await grab();
};

// 1. menu
await p.evaluate(() => { window.__game.select(1); window.__demo = { ctrl: {}, pressed: {} }; });
await caption('Roadster and Beyond');
for (let i = 0; i < 30; i++) await frame({});
await frame({}, { confirm: true });

// 2. launch
const setup = async (name) => { await p.evaluate((name) => { window.demo.seg[name].setup(); window.__game.snapCamera(); window.__events.length = 0; }, name); };
await setup('launch');
await caption('0 - 60 mph');
for (let i = 0; i < 70; i++) await ctlFrame('launch');
console.log('launch done', n, ((Date.now() - t0) / 1000).toFixed(0) + 's');

// 3 + 4 stunts
for (const [name, cap] of [['jump', 'Jump the traffic, front flip'], ['wall', 'Inverted wall ramp, flip']]) {
  await setup(name);
  await caption(cap);
  let after = -1;
  for (let i = 0; i < 20 * 12; i++) {
    await ctlFrame(name);
    const landed = await p.evaluate(() => window.__events.some((e) => e.type === 'land' || e.type === 'crash'));
    if (landed && after < 0) after = 0;
    if (after >= 0 && ++after > 26) break;
  }
  console.log(name, 'done', n, ((Date.now() - t0) / 1000).toFixed(0) + 's', await p.evaluate(() => window.__events.filter((e) => e.type === 'land' || e.type === 'crash').map((e) => e.type + (e.reason || ''))));
}
console.log('frames', n);
await b.close();
