# Cairnheart: Grafted

Wake the stone guardian of the Sunken Vault and hold it for eight waves. Elites drop the stone limbs of their kind; graft them onto the golem and each one changes both its silhouette and how one of its attacks works. A blocky arena brawler for the browser, built with Three.js r186, Vite and TypeScript. Every model, texture and sound is generated in code; there are no art or audio files.

This is the Phase 1 greybox: graft parts are coloured blocks. The pre-graft prototype is tagged `v0-prototype`.

## Run

```bash
npm install
npm run dev        # http://localhost:5181
npm run verify     # lint, typecheck, unit tests, build
node tools/bot.mjs # balance bot: 20 headless runs (needs Playwright, local or global)
```

`?seed=1234` starts a specific run. `?debug` opens the performance overlay. `?test=1` exposes `window.__cairn` (below).

## Controls

| Action | Keyboard / mouse | Gamepad (Xbox / PlayStation) | Touch |
| --- | --- | --- | --- |
| Move | WASD / arrows (camera-relative), Shift runs | Left stick, push fully or hold LT to run | Drag anywhere, push to the rim to run |
| Aim | Mouse cursor | Right stick | Auto-aim at the nearest foe ahead |
| Swipe combo (1, 2, slam) | J / Space / left click | X / Square (A / Cross too) | SWIPE |
| Core Beam (6 s) | K / right click | Y / Triangle or RT | BEAM |
| Spin (8 s) | L / E | B / Circle or LB | SPIN |
| Quake (12 s) | R | RB / R1 | QUAKE |
| Pause | Esc / P | Menu / Options | II |
| Offer: pick, reroll, leave | 1 2 3, F, X | D-pad + A, Y, B | tap |
| Death card: retry same seed, new run | Enter, N | A | tap |

Without a cursor or right stick, attacks snap to the nearest enemy ahead. Menus are fully navigable with the d-pad or arrows.

## The run

- Eight waves in the Sunken Vault, then the Gloom Matriarch on wave 8. Killing her wins the run.
- Waves get harder by what arrives and how (kinds mixed in, pincers through opposite gates, packs from one gate), never by enemy health.
- Each wave's elite (Burster, Spitter or Skitter) is announced before the wave starts, wears its family colour and drops a graft relic. Walk over it to open an offer, or it opens when the wave clears.
- An offer has three cards with at least one graft, led by the elite's own family. One reroll per arena; you can also leave it.
- Dying shows the cause and a retry card within 1.5 s: Enter replays the same seed (same waves, same elites).

### Grafts (greybox: 6 of the planned set)

| Graft | Family | Slot | Changes |
| --- | --- | --- | --- |
| Fuse Knuckle | Burster | Left arm | Swipe 2 marks what it hits; each mark bursts 0.9 s later (2.4 m). |
| Hook Claw | Skitter | Left arm | Swipe 2 dashes 2.6 m and rakes a long, narrow line (4.6 m). |
| Shard Sling | Spitter | Right arm | Swipe 1 also throws a shard that pierces everything for 10 m. |
| Mantis Scythe | Skitter | Right arm | Swipe 1 reaps a band 1.6-4.8 m out and drags foes to you. |
| Quill Mantle | Spitter | Back | Spin stops cutting and sprays 6 quills per turn out to 7 m. |
| Burster Heart | Burster | Core | Core Beam becomes a 4.2 m nova around you, in half the time. |

The crown slot exists (it will rewire the quake) but has no greybox graft yet. A new graft in an occupied slot replaces the old one completely.

### Runes

Echo (slam lands twice, further ahead), Undertow (quake pulls in instead of pushing out), Vortex (spin reels foes in, then flings them), Spite (taking a hit bursts back around you, every 2 s at most).

### Design rules

1. No graft or rune gives a flat percentage; each changes an attack's shape, range, trigger or source (enforced by `tests/unit/grafts.test.ts`).
2. The golem's hurtbox is fixed at 0.95 m; grafts grow the silhouette, never the hurtbox. Attack visuals are drawn from the real hit shapes.
3. Weight comes from hit-stop, shake, sound and rumble. The first swipe lands at 0.14 s and late presses are buffered.
4. Enemy telegraphs (blast rings, aim and lunge lanes, slam discs) draw over hero effects. The only damage numbers are counter-hits: hitting an enemy while it winds up does double damage.
5. Difficulty comes from patterns. No single enemy hit can take more than 40% of the heart.

## Event log

Every run records first input (device, delay), first damage and its source, graft offers, picks and rejections, rerolls, rune picks, death cause, run length (fight clock and wall clock) and retries. EXPORT LOG on the pause, death and victory cards saves it as JSON; `__cairn.log()` returns it.

## Test hooks (`?test=1`)

`window.__cairn` keeps the prototype hooks (`skipIntro`, `freeze`, `step`, `setIntent`, `clearIntent`, `teleport`, `ability`, `spawn`, `state`) and adds:

| Hook | What it does |
| --- | --- |
| `run()` | Copy of the `RunState`, round-tripped through its save format. |
| `offerGraft(family)` | Drops an elite relic of `family` at the hero and opens its offer. |
| `takeGraft(index \| graftId)` | Takes an offer card, or grafts a part directly when no offer is open. |
| `takeRune(id)`, `reroll()`, `skipOffer()` | Rune and offer helpers. |
| `setHeadless(on)` | Simulate without rendering, audio or HUD (the bot uses this with `freeze` + `step`). |
| `retry()`, `newRun(seed?)` | Same seed again, or a new run. |
| `snapshot()` | Hero, enemies (with live threat circles), shots, relics, offer, cooldowns. |
| `log()` | The event log export. |

## Balance bot

`node tools/bot.mjs [--runs 20] [--seed 1] [--url http://localhost:5181]` serves the game with Vite, opens it in headless Chromium and plays seeded runs like an ordinary player (late reactions, some missed dodges, rough aim). It prints each run, the boss reach rate and the median run length against the targets (40-80%, 6-12 min), and writes `docs/bot/latest.json`.

## Layout

- `src/game/run.ts`, `runFlow.ts`: run state and serialisation; the run's rules (waves, relics, offers, rerolls, victory, defeat) without rendering.
- `src/game/grafts.ts`, `runes.ts`: graft and rune definitions, slot rules, attack resolution, part recipes.
- `src/game/waves.ts`: seeded eight-wave plans and the wave director.
- `src/combat/`: attack specs and behaviours, hit geometry, `HeroCombat` (combo chaining, buffering, cooldowns).
- `src/entities/hero/`: the golem rig with graft mounts (`setPart`), procedural animator, motion.
- `src/entities/enemies/`: pure enemy brains (with elite patterns) and views (with floor telegraphs).
- `src/ui/hud.ts`, `graftCard.ts`: HUD, wave preview, offer cards, end cards.
- `src/core/input.ts`: action-based input over keyboard/mouse, gamepads and touch.
- `src/debug/eventLog.ts`: the playtest log.
- `docs/baseline/`: verify output, bundle size and test hooks of `v0-prototype`.
