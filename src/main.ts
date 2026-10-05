import './style.css';
import type { Ability } from './combat/attacks';
import type { EnemyKind } from './entities/enemies/types';
import { Game } from './game';
import type { GateId } from './world/arenaConfig';

const $ = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el;
};

const params = new URLSearchParams(window.location.search);
const game = new Game($('app'), { joyBase: $('joy'), joyKnob: $('joy-knob'), showStats: params.has('debug') });
game.start();

if (window.matchMedia('(pointer: coarse)').matches) {
  window.setTimeout(() => document.querySelector('.hud-controls')?.classList.add('is-faded'), 7000);
}

if (params.has('test')) {
  Object.assign(window, {
    __cairn: {
      game,
      skipIntro: () => game.skipIntro(),
      freeze: (frozen = true) => {
        game.frozen = frozen;
      },
      step: (seconds: number) => {
        for (let t = 0; t < seconds; t += 1 / 60) game.tick(1 / 60);
      },
      setIntent: (x: number, y: number, run = false) => game.setIntent({ x, y, run }),
      clearIntent: () => game.setIntent(null),
      teleport: (x: number, z: number) => {
        game.motion.pos.x = x;
        game.motion.pos.z = z;
      },
      ability: (a: Ability, yaw = game.motion.yaw) => game.combat.request(a, yaw),
      spawn: (kind: EnemyKind, gate: GateId = 'north', elite = false) =>
        game.enemies.spawn(kind, game.arena.gates.find((g) => g.id === gate)!, elite, 1),
      state: () => ({
        x: game.motion.pos.x,
        z: game.motion.pos.z,
        yaw: game.motion.yaw,
        hp: game.hp,
        maxHp: game.stats.maxHp,
        kills: game.kills,
        score: game.score.score,
        combo: game.score.combo,
        wave: game.waves.wave,
        alive: game.enemies.alive,
        shots: game.enemies.projectiles.list.length,
        mode: game.state,
        paused: game.menuPaused,
        levels: game.levels,
        action: game.combat.action?.id ?? null,
      }),
    },
  });
}
