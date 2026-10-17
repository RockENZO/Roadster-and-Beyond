# Demo recorder

Renders `docs/demo.gif` and `docs/demo.mp4` frame by frame, so the result does not depend on how fast the machine renders.

The game exposes a manual mode for this (`window.__manual`, `window.__demo`, `window.__game.tick`). A small closed-loop script (`page.js`) drives the car through three segments: a 0-60 launch, the jump with a front flip, and the wall ramp with a flip. It is a bot, not a human run.

```bash
npm run build && npx vite preview --port 4173 &
npm i --no-save playwright-core         # plus a Chromium; set executablePath in record.mjs
cd tools/demo
node record.mjs /tmp/frames             # writes numbered JPEGs
cd ../.. && tools/demo/encode.sh /tmp/frames
```
