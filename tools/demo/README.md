# Demo recorder

Renders `docs/demo.gif` and `docs/demo.mp4` frame by frame, so the result does not depend on how fast the machine renders.

`record.mjs` opens the built game, switches on manual stepping (`window.__manual`), starts Event mode and captures one screenshot per 1/20 s of game time until the show ends, then adds a few seconds of free driving with the HUD. It writes numbered JPEGs and `marks.json` (the first frame of each segment).

```bash
npm run build && npx vite preview --port 4173 &
npm i --no-save playwright-core         # plus a Chromium; set CHROME=/path/to/chrome if needed
cd tools/demo
node record.mjs /tmp/frames
cd ../.. && tools/demo/encode.sh /tmp/frames
```
