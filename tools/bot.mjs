#!/usr/bin/env node
/**
 * Balance bot: plays N seeded runs with rendering, audio and HUD off (window.__cairn.setHeadless)
 * and reports how often it reaches the boss and how long runs last.
 *
 *   node tools/bot.mjs                  # 20 runs, seeds 1..20, own Vite server
 *   node tools/bot.mjs --runs 40 --seed 100
 *   node tools/bot.mjs --url http://localhost:5181   # reuse a running dev server
 *
 * The bot is a deliberately ordinary player: it reacts late, misses some dodges, aims a little
 * off and spends cooldowns greedily. Targets: boss reached in 40-80% of runs, median run 6-12 min.
 */
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TARGET_REACH = [0.4, 0.8];
const TARGET_MEDIAN_MIN = [6, 12];

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const RUNS = Number(opt('runs', 20));
const SEED0 = Number(opt('seed', 1));
const CAP_MIN = Number(opt('cap', 20));
const OUT = opt('out', resolve(ROOT, 'docs/bot/latest.json'));

/** Playwright is not a project dependency: use a local install if present, else a global one. */
const loadPlaywright = () => {
  const require = createRequire(import.meta.url);
  const npmRoot = () => {
    try {
      return execSync('npm root -g', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch {
      return '';
    }
  };
  const roots = [
    '',
    ...(process.env.NODE_PATH ?? '').split(':'),
    npmRoot(),
    '/opt/homebrew/lib/node_modules',
    '/usr/local/lib/node_modules',
  ];
  for (const root of roots) {
    try {
      return require(root ? resolve(root, 'playwright') : 'playwright');
    } catch {
      // try the next location
    }
  }
  throw new Error('Playwright not found. Install it (npm i -g playwright) or set NODE_PATH to its node_modules.');
};

/** Runs inside the page. Must be self-contained: it is serialised by Playwright. */
const playRun = async ({ seed, capMinutes }) => {
  const c = window.__cairn;
  c.freeze(true);
  c.setHeadless(true);
  c.newRun(seed);
  c.skipIntro();
  // Tally damage taken by source for the report.
  const taken = {};
  const g = c.game;
  const hurt = g.damageHero.bind(g);
  g.damageHero = (amount, from, source) => {
    const before = g.hp;
    hurt(amount, from, source);
    const key = `${source.elite ? 'elite ' : ''}${source.enemy} ${source.attack}`;
    if (g.hp < before) taken[key] = Math.round((taken[key] ?? 0) + before - g.hp);
  };

  let state = (seed * 2654435761) >>> 0;
  const rnd = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // An ordinary player: notices telegraphs late, sometimes not at all, aims roughly.
  const SKILL = { dodge: 0.7, notice: 0.35, dodgeShot: 0.65, aimNoise: 0.22, quakeForFuse: 0.55, reach: 2.4 };
  const AZ = Math.PI / 4;
  const RIGHT = { x: Math.cos(AZ), z: -Math.sin(AZ) };
  const FWD = { x: -Math.sin(AZ), z: -Math.cos(AZ) };
  const move = (dx, dz, run) => {
    const l = Math.hypot(dx, dz);
    if (l < 1e-3) {
      c.setIntent(0, 0, false);
      return;
    }
    c.setIntent((dx * RIGHT.x + dz * RIGHT.z) / l, (dx * FWD.x + dz * FWD.z) / l, run);
  };
  const decided = new Map();
  const willDodge = (key, chance) => {
    if (!decided.has(key)) decided.set(key, rnd() < chance);
    return decided.get(key);
  };

  const DT = 0.1;
  let reachedBoss = false;
  let bossAt = null;
  const waveAt = [];
  let side = 1;
  let wall = 0;
  for (let guard = 0; guard < capMinutes * 60 * 20; guard++) {
    const s = c.snapshot();
    if (s.wave > waveAt.length) waveAt.push(Math.round(s.time));
    if (s.wave >= 8 && !reachedBoss) {
      reachedBoss = true;
      bossAt = s.time;
    }
    if (s.mode === 'victory' || s.mode === 'over' || s.time >= capMinutes * 60) break;
    if (s.mode === 'dying') {
      c.step(0.5);
      continue;
    }
    if (s.mode === 'offer') {
      const opts = s.offer.options;
      if (c.game.flow.run.rerolls > 0 && rnd() < 0.15) {
        c.reroll();
        continue;
      }
      const pick = rnd() < 0.6 ? 0 : Math.floor(rnd() * opts.length);
      c.takeGraft(pick);
      continue;
    }

    const me = { x: s.x, z: s.z };
    const foes = s.enemies.filter((e) => e.phase !== 'dead');
    const dist = (e) => Math.hypot(e.x - me.x, e.z - me.z);
    const yawTo = (e) => Math.atan2(e.x - me.x, e.z - me.z);

    // Threats: lit fuses and boss slams (blast circles), skitter crouches, incoming shards.
    let ax = 0;
    let az = 0;
    for (const e of foes) {
      if (e.threat && e.charge > SKILL.notice && willDodge(`t${e.id}:${e.mode}`, SKILL.dodge)) {
        const dx = me.x - e.threat.x;
        const dz = me.z - e.threat.z;
        const d = Math.hypot(dx, dz) || 1;
        if (d < e.threat.r + 1.3) {
          ax += dx / d;
          az += dz / d;
        }
      }
      if (e.kind === 'skitter' && e.mode === 'crouch' && dist(e) < 5.5 && willDodge(`k${e.id}:${Math.round(s.time)}`, SKILL.dodge)) {
        const d = dist(e) || 1;
        ax += (-(me.z - e.z) / d) * side;
        az += ((me.x - e.x) / d) * side;
      }
    }
    for (const p of s.shots) {
      const rx = me.x - p.x;
      const rz = me.z - p.z;
      const vv = p.vx * p.vx + p.vz * p.vz || 1;
      const tca = (rx * p.vx + rz * p.vz) / vv;
      if (tca < 0 || tca > 0.6) continue;
      const cx = p.x + p.vx * tca - me.x;
      const cz = p.z + p.vz * tca - me.z;
      if (Math.hypot(cx, cz) > 1.25 || !willDodge(`s${Math.round(p.x * 7)}:${Math.round(p.z * 7)}:${Math.round(s.time)}`, SKILL.dodgeShot)) continue;
      const n = Math.sqrt(vv);
      let px = -p.vz / n;
      let pz = p.vx / n;
      if (px * -cx + pz * -cz < 0) {
        px = -px;
        pz = -pz;
      }
      ax += px;
      az += pz;
    }
    // Keep off the wall when fleeing.
    const r = Math.hypot(me.x, me.z);
    if (r > 13) {
      ax -= (me.x / r) * 0.8;
      az -= (me.z / r) * 0.8;
    }
    if (++wall % 40 === 0) side = rnd() < 0.5 ? -1 : 1;

    const near = (rad) => foes.filter((e) => e.phase === 'active' && dist(e) - e.radius < rad).length;
    const active = foes.filter((e) => e.phase === 'active');
    // Nearest foe, but hunt down shooters once nothing is in your face; elites count as a little closer.
    const pressing = near(3) > 0;
    const score = (e) => dist(e) - (e.elite ? 1.5 : 0) - (!pressing && e.kind === 'spitter' ? 6 : 0);
    let target = null;
    for (const e of active) if (!target || score(e) < score(target)) target = e;

    if (Math.hypot(ax, az) > 0.1) {
      move(ax, az, true);
    } else if (s.relics.length > 0 && near(5) === 0) {
      move(s.relics[0].x - me.x, s.relics[0].z - me.z, true);
    } else if (target) {
      const d = dist(target) - target.radius;
      if (d > SKILL.reach) move(target.x - me.x, target.z - me.z, d > 6);
      else move(0, 0, false);
    } else {
      move(-me.x, -me.z, false);
    }

    if (!s.action) {
      const fusing = active.some((e) => e.kind === 'burster' && e.mode === 'fuse' && dist(e) < 5.5);
      if (s.ready.quake && ((fusing && willDodge(`q${Math.round(s.time)}`, SKILL.quakeForFuse)) || near(4.5) >= 5)) c.ability('quake', s.yaw);
      else if (s.ready.spin && near(3.5) >= 3) c.ability('spin', s.yaw);
      else if (s.ready.beam && target && (target.kind === 'matriarch' || target.kind === 'spitter' || target.elite || near(5) >= 3) && dist(target) < 11)
        c.ability('beam', yawTo(target));
    }
    if (target && dist(target) - target.radius <= SKILL.reach + 0.3 && Math.hypot(ax, az) <= 0.1) {
      c.ability('attack', yawTo(target) + (rnd() - 0.5) * 2 * SKILL.aimNoise);
    }
    c.step(DT);
  }
  c.clearIntent();
  const s = c.snapshot();
  const log = c.log();
  const death = log.entries.filter((e) => e.run === log.runs && e.type === 'death').at(-1);
  return {
    seed,
    outcome: s.outcome === 'running' ? 'timeout' : s.outcome,
    reachedBoss,
    bossAt,
    wave: s.wave,
    time: s.time,
    kills: s.kills,
    loadout: s.loadout,
    runes: s.runes,
    cause: death?.data.cause ?? null,
    waveAt,
    taken,
  };
};

const fmtTime = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
const median = (xs) => {
  const v = [...xs].sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

const main = async () => {
  let server = null;
  let url = opt('url', null);
  if (!url) {
    const { createServer } = await import('vite');
    server = await createServer({ root: ROOT, logLevel: 'error', server: { port: 5199, strictPort: false } });
    await server.listen();
    url = server.resolvedUrls.local[0];
  }
  const { chromium } = loadPlaywright();
  // Headless Chromium has no GPU; SwiftShader gives the renderer a context (it only draws a few frames).
  const browser = await chromium.launch({
    headless: !args.includes('--headed'),
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await page.goto(`${url.replace(/\/$/, '')}/?test=1`);
  await page.waitForFunction(() => !!window.__cairn);

  const results = [];
  const started = Date.now();
  for (let i = 0; i < RUNS; i++) {
    const r = await page.evaluate(playRun, { seed: SEED0 + i, capMinutes: CAP_MIN });
    results.push(r);
    const build = [
      ...Object.entries(r.loadout).map(([slot, id]) => `${slot}:${id}`),
      ...r.runes.map((x) => `rune:${x}`),
    ].join(' ');
    console.info(
      `seed ${String(r.seed).padStart(3)}  ${r.outcome.padEnd(7)}  wave ${r.wave}  ${fmtTime(r.time).padStart(5)}  ${String(r.kills).padStart(3)} kills  ${r.reachedBoss ? 'BOSS' : '    '}  ${build}${r.cause ? `  (${r.cause})` : ''}`,
    );
  }
  await browser.close();
  await server?.close();

  const reach = results.filter((r) => r.reachedBoss).length / results.length;
  const wins = results.filter((r) => r.outcome === 'victory').length;
  const med = median(results.map((r) => r.time)) / 60;
  const okReach = reach >= TARGET_REACH[0] && reach <= TARGET_REACH[1];
  const okMed = med >= TARGET_MEDIAN_MIN[0] && med <= TARGET_MEDIAN_MIN[1];
  const summary = {
    runs: results.length,
    seeds: [SEED0, SEED0 + RUNS - 1],
    bossReachRate: Math.round(reach * 1000) / 1000,
    wins,
    medianMinutes: Math.round(med * 100) / 100,
    targets: { bossReachRate: TARGET_REACH, medianMinutes: TARGET_MEDIAN_MIN },
    pass: okReach && okMed,
    wallSeconds: Math.round((Date.now() - started) / 1000),
  };
  console.info('');
  console.info(`Boss reached  ${Math.round(reach * 100)}% (${results.filter((r) => r.reachedBoss).length}/${results.length})  target 40-80%  ${okReach ? 'PASS' : 'FAIL'}`);
  console.info(`Median run    ${med.toFixed(1)} min  target 6-12 min  ${okMed ? 'PASS' : 'FAIL'}`);
  console.info(`Wins          ${wins}/${results.length}`);
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify({ summary, results }, null, 2)}\n`);
  console.info(`Saved ${OUT}`);
  process.exitCode = summary.pass ? 0 : 1;
};

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
