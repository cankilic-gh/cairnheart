# Cairnheart

Wake the stone guardian of the Sunken Vault and hold it against waves of gloom. A blocky arena brawler for the browser, built with Three.js r186, Vite and TypeScript. Every model, texture and sound is generated in code; there are no art or audio files.

Play: https://cairnheart.thegridbase.com

## Run

```bash
npm install
npm run dev        # http://localhost:5181
npm run verify     # lint, typecheck, unit tests, build
```

`?test=1` exposes `window.__cairn` (skipIntro, freeze/step, setIntent, teleport, ability, spawn, state). `?debug` shows fps, speed and enemy counts.

## Controls

| Action | Keyboard / mouse | Touch |
| --- | --- | --- |
| Move | WASD / arrows (camera-relative), Shift runs | Drag anywhere, push to the rim to run |
| Swipe combo (right, left, slam) | J / Space / left click | SWIPE |
| Core Beam (6 s) | K / right click | BEAM |
| Spin (8 s) | L / E | SPIN |
| Quake: knockback, interrupts wind-ups, shatters shards (12 s) | R | QUAKE |
| Pause | Esc / P | II |
| Pick a blessing | 1 / 2 / 3 or click | tap |

Mouse attacks aim at the cursor; otherwise attacks snap to the nearest enemy ahead.

## Enemies

- **Burster**: waddles in and lights its crystal fuse when close. Back off or quake it to snuff the fuse. Elites from wave 4.
- **Spitter**: keeps its distance and spits crystal shards after a short wind-up.
- **Skitter**: fast; crouches, then lunges for a bite. Sidestep the lunge.
- **Gloom Matriarch**: boss every fifth wave. Telegraphed slams, shard novas, summons bursters.

Clearing a wave heals 30% and offers three blessings (upgrades). Kills chain into a combo multiplier up to 3x; the best score is kept in the browser.

## Layout

- `src/entities/hero/`: the Cairnheart rig (voxel boxes with per-face pixel textures), procedural animator (gait, springs, heartbeat glow, attack poses) and pure motion.
- `src/combat/`: attack specs, hit geometry and `HeroCombat` (combo chaining, input buffering, cooldowns). Pure and unit-tested.
- `src/entities/enemies/`: pure enemy brains for all four kinds plus views built from one pixel atlas per kind.
- `src/game/`: wave planning, enemy manager, projectiles, upgrades and scoring.
- `src/world/arena.ts`: the Sunken Vault (flagstones, rune ring, braziers, four gloom rifts that act as spawn gates).
