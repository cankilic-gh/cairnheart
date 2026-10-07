# Test hooks baseline (v0-prototype, 6b6cd2e)

## URL flags

| Flag | Effect |
| --- | --- |
| `?test=1` | Exposes `window.__cairn` (below). |
| `?debug` | Opens the performance overlay on load (fps, CPU/GPU ms, draws, enemies, voices). |

## `window.__cairn` (src/main.ts)

| Member | Signature | What it does |
| --- | --- | --- |
| `game` | `Game` | The live game instance. |
| `skipIntro` | `() => void` | Skips the rise/roar intro and starts wave 1 after 1.2 s. |
| `freeze` | `(frozen = true) => void` | Stops the RAF loop from advancing the sim. |
| `step` | `(seconds: number) => void` | Advances the sim in 1/60 s ticks (renders every tick). |
| `setIntent` | `(x, y, run = false) => void` | Overrides movement input (screen space, camera-relative). |
| `clearIntent` | `() => void` | Returns movement to real input. |
| `teleport` | `(x, z) => void` | Moves the hero. |
| `ability` | `(a: 'attack' \| 'beam' \| 'spin' \| 'quake', yaw?) => void` | Requests an ability. |
| `spawn` | `(kind, gate = 'north', elite = false) => EnemyState` | Spawns an enemy at a gate. |
| `state` | `() => object` | `{ x, z, yaw, hp, maxHp, kills, score, combo, wave, alive, shots, mode, paused, levels, action }` |

`mode` is one of `intro | playing | upgrade | dying | over`; `levels` is the blessing (percentage upgrade) map.

## Unit tests

65 tests in 5 files (`tests/unit/`), all green; full list in `tests.txt`, full `npm run verify` output in `verify.txt`.
