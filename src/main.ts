import './style.css';
import type { Ability } from './combat/attacks';
import type { EnemyKind } from './entities/enemies/types';
import { Game } from './game';
import type { Family, GraftId } from './game/grafts';
import { HERO_HP, deserializeRun, serializeRun } from './game/run';
import type { RuneId } from './game/runes';
import type { GateId } from './world/arenaConfig';

const $ = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el;
};

const params = new URLSearchParams(window.location.search);
const seedParam = Number(params.get('seed'));
const game = new Game($('app'), {
  joyBase: $('joy'),
  joyKnob: $('joy-knob'),
  showStats: params.has('debug'),
  seed: Number.isInteger(seedParam) && seedParam > 0 ? seedParam : null,
});
game.start();

if (window.matchMedia('(pointer: coarse)').matches) {
  window.setTimeout(() => document.querySelector('.hud-controls')?.classList.add('is-faded'), 7000);
}

if (params.has('test')) {
  const step = (seconds: number) => {
    for (let t = 0; t < seconds; t += 1 / 60) game.tick(1 / 60);
  };
  Object.assign(window, {
    __cairn: {
      game,
      skipIntro: () => game.skipIntro(),
      freeze: (frozen = true) => {
        game.frozen = frozen;
      },
      step,
      setIntent: (x: number, y: number, run = false) => game.setIntent({ x, y, run }),
      clearIntent: () => game.setIntent(null),
      teleport: (x: number, z: number) => {
        game.motion.pos.x = x;
        game.motion.pos.z = z;
      },
      ability: (a: Ability, yaw = game.motion.yaw) => game.combat.request(a, yaw),
      spawn: (kind: EnemyKind, gate: GateId = 'north', elite = false) =>
        game.enemies.spawn(kind, game.arena.gates.find((g) => g.id === gate)!, elite, 1),
      /** A copy of the run state, round-tripped through its save format. */
      run: () => deserializeRun(serializeRun(game.flow.run)),
      /** Drops an elite relic of `family` at the hero's feet and opens its offer. */
      offerGraft: (family: Family = 'burster') => game.debugOffer(family),
      /** Takes option `choice` (index) of the open offer, or grafts a part by id when no offer is open. */
      takeGraft: (choice: number | GraftId = 0) => {
        if (typeof choice === 'number') return game.takeOffer(choice);
        const i = game.flow.offer?.options.findIndex((o) => o.id === choice) ?? -1;
        if (i >= 0) return game.takeOffer(i);
        game.debugEquip(choice);
        return true;
      },
      takeRune: (id: RuneId) => game.debugRune(id),
      reroll: () => game.rerollOffer(),
      skipOffer: () => game.skipOffer(),
      setHeadless: (on = true) => game.setHeadless(on),
      retry: () => game.retry(),
      newRun: (seed?: number) => game.newRun(seed),
      log: () => game.log.export(navigator.userAgent),
      /** Everything the balance bot needs to see in one call. */
      snapshot: () => ({
        mode: game.state,
        time: game.flow.run.time,
        wave: game.flow.run.wave,
        phase: game.flow.phase,
        hp: game.hp,
        x: game.motion.pos.x,
        z: game.motion.pos.z,
        yaw: game.motion.yaw,
        action: game.combat.action?.id ?? null,
        ready: {
          beam: game.combat.ready('beam'),
          spin: game.combat.ready('spin'),
          quake: game.combat.ready('quake'),
        },
        enemies: game.enemies.snapshot(),
        shots: game.enemies.projectiles.list.map((p) => ({ x: p.pos.x, z: p.pos.z, vx: p.vel.x, vz: p.vel.z })),
        relics: game.flow.relics.map((r) => ({ id: r.id, x: r.at.x, z: r.at.z })),
        offer: game.flow.offer,
        pending: game.flow.pending,
        outcome: game.flow.run.outcome,
        kills: game.flow.run.kills,
        loadout: { ...game.flow.run.loadout },
        runes: [...game.flow.run.runes],
      }),
      state: () => ({
        x: game.motion.pos.x,
        z: game.motion.pos.z,
        yaw: game.motion.yaw,
        hp: game.hp,
        maxHp: HERO_HP,
        kills: game.flow.run.kills,
        score: game.score.score,
        combo: game.score.combo,
        wave: game.flow.run.wave,
        alive: game.enemies.alive,
        shots: game.enemies.projectiles.list.length,
        mode: game.state,
        paused: game.menuPaused,
        seed: game.flow.run.seed,
        loadout: { ...game.flow.run.loadout },
        runes: [...game.flow.run.runes],
        action: game.combat.action?.id ?? null,
      }),
    },
  });
}
