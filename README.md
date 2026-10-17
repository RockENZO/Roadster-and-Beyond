# Roadster and Beyond

A fan-made 3D driving and stunt game for the browser, inspired by the new Tesla Roadster as shown at its launch event (15 October 2026, US time, at SpaceX's McGregor, Texas test site). Built with three.js and Vite. Playable with a keyboard or a gamepad.

This is an unofficial tribute. It is not affiliated with or endorsed by Tesla or SpaceX, and it uses no Tesla assets. Everything is drawn procedurally in code.

## Play

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static site in dist/
```

Pushing to `main` deploys to GitHub Pages through `.github/workflows/deploy.yml`. In the repository settings, set **Pages > Source** to **GitHub Actions** once.

## What is in the game

- **Three versions of the car**, matching the three trims Tesla listed.
  - **Performance**: multi-mode suction fans and Track Mode (the car drops, the wing deploys, grip and downforce rise). No thrusters.
  - **Thrust**: rear cold-gas thrusters for a launch boost and a push in the air.
  - **Rocket**: single seat, ten perimeter thrusters, boost, hover and attitude control.
- **The course**: a launch strip with a 0-60 mph timer, a small kicker, a big jump over parked cars and a semi truck, and an inverted wall ramp that curves past vertical.
- **Stunts**: flips, barrel rolls, spins and air time score points, with a bonus for a perfect landing.
- Hidden headlights, a full-width tail light, rear diffuser fans, an auto wing, steer-by-wire styling, gold-tinted glass, cold-gas puffs and suction glow.

## Controls

| Action | Keyboard | Gamepad |
| --- | --- | --- |
| Throttle / brake | `W` `S` | `RT` / `LT` |
| Steer | `A` `D` | Left stick |
| Thrusters (boost, hover) | `Space` | `A` or `RB` |
| Handbrake, release from wall | `Shift` | `B` |
| Rocket forward push (air) | `Shift` | `B` |
| Track Mode | `T` | `X` |
| In the air: flip / roll | `W` `S` / `A` `D` | Left stick |
| In the air: spin | `Q` `E` | Right stick |
| Camera (chase, wide, cockpit) | `C` | `Y` |
| Headlights | `L` | D-pad up |
| Respawn at last checkpoint | `R` | Back |
| Menu / pause | `Esc` | Start |
| Hide help | `H` | `LB` |
| Mute | `M` | |

The menu is fully usable with a controller (D-pad or left stick to choose a car, `A` to drive). Rumble is used for landings and crashes where the browser supports it. Press any button once so the browser exposes the controller.

Tips: take the jump at about 65 mph or more. To ride the wall, hit the mouth of the ramp fast and straight. Go slowly and suction will hold the car upside down for a moment before it rolls back down.

## What is sourced and what is invented

I did not watch the event. The car's look and features come from coverage of it:

- [Fox Business](https://www.foxbusiness.com/technology/teslas-new-roadster-makes-flying-debut-hitting-60-mph-under-second): SpaceX test site, sub-second 0-60 demo, cold-gas thrusters, ramp climb and jump, trim names, 2028 production.
- [Engadget live blog](https://www.engadget.com/2287518/tesla-roadster-launch-live-blog/): 0.81 s run, two seats, steer-by-wire, auto-adjusting rear wing, retro 80s feel, stunts.
- [ExplainX recap](https://www.explainx.ai/blog/tesla-roadster-event-recap-everything-announced-not-announced-october-15-2026): SR-71 and F-35 inspiration, white paint, gold-tinted windows, hidden headlights, full-length tail light, diffuser fans, per-trim 0-60 claims, Track Mode.

Inferred or invented, because the coverage did not say:

- Exact body proportions, surfacing and wheel design. The model is a low-poly wedge in the spirit of the description, not a replica.
- Interior layout. The squared yoke and seat shapes are guesses.
- All physics numbers. They are tuned so the three versions land near Tesla's claimed 0-60 times (about 1.6 s, 0.9 s and 0.6 s), not derived from real specs.
- The course, scoring, and the idea that all trims can ride the wall.

Tesla's claims are unverified by independent testing, and outlets disagreed on some details such as deposits and the exact event date.

## Project layout

```
src/track.js    course data shared by physics and rendering
src/physics.js  vehicle model: ground, air, and wall-ride modes
src/car.js      procedural Roadster model and its animation
src/world.js    sky, desert, runway, ramps, traffic, scenery
src/fx.js       particle pool (cold gas, dust, smoke)
src/input.js    keyboard and Gamepad API
src/audio.js    synthesised sound
src/main.js     menu, HUD, scoring, camera, game loop
```
