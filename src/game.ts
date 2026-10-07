import * as THREE from 'three';
import { ABILITIES, ATTACKS, type Ability, type AttackId, type AttackSpec, type Behavior, type Strike } from './combat/attacks';
import { HeroCombat, type ActiveAction, type HitEvent } from './combat/heroCombat';
import type { StrikeResult } from './game/enemyManager';
import { Sfx } from './audio/engine';
import { gameAudioMode } from './audio/mix';
import { CameraRig } from './core/cameraRig';
import { Input, type ActionSource, type InputAction } from './core/input';
import { smoothstep } from './core/math';
import { GpuTimer, ResolutionGovernor, RollingStats } from './core/perf';
import { loadBest, saveBest } from './core/storage';
import { EventLog } from './debug/eventLog';
import type { EnemyState } from './entities/enemies/types';
import { HeroAnimator, type FootSide } from './entities/hero/animator';
import { buildHero, type HeroRig } from './entities/hero/model';
import { MOTION, cameraBasis, clampToArena, createMotionState, intentToWorld, stepMotion, wrapAngle, type MoveIntent, type Vec2 } from './entities/hero/motion';
import { Effects } from './fx/effects';
import { ParticlePool, EmberMotes, pointScale } from './fx/particles';
import { Relics } from './fx/relics';
import { EnemyManager, type HeroDamageSource, type ScreenPoint } from './game/enemyManager';
import {
  ATTACK_LABEL,
  FAMILY_COLOR,
  FAMILY_LABEL,
  GRAFTS,
  SLOTS,
  SLOT_ATTACK,
  equip,
  heroHurtRadius,
  resolveAttacks,
  type Family,
  type GraftId,
  type GraftSlot,
} from './game/grafts';
import { HERO_HP, MAX_HIT_FRACTION, RUN_WAVES, newSeed } from './game/run';
import { RunFlow, type FlowEvent, type Offer } from './game/runFlow';
import { RUNES, SPITE, type RuneId } from './game/runes';
import { ScoreKeeper } from './game/score';
import { applyFlash, createFlash } from './render/flash';
import { createPost, type Post } from './render/post';
import { Hud, type RunSummary } from './ui/hud';
import { PerfPanel } from './ui/perfPanel';
import { buildArena, type Arena } from './world/arena';
import { ARENA } from './world/arenaConfig';

/** Keeps enemies off the golem's model; its hurtbox is the smaller `heroHurtRadius`. */
const HERO_BODY_RADIUS = 1.25;
const WAVE_HEAL = 0.3;
const INVULN = 0.3;
const INTRO_RISE = 1.6;
const INTRO_END = 2.3;
/** The fall is short so the retry card is up well inside three seconds of dying. */
const DEATH_TIME = 1.5;
const VICTORY_CARD = 2.6;
const VICTORY_BONUS = 1000;
const RISE_DEPTH = 3.8;
const RELIC_PICKUP = 1.7;
const STILL: MoveIntent = { x: 0, y: 0, run: false };
/** Frame cap: high-refresh displays render every other vsync instead of doubling GPU load. */
const TARGET_FPS = 60;
const BUDGET_MS = 1000 / TARGET_FPS;
const HALTED_FPS = 20;
/** Height and forward offset of the heart crystal, where the core beam leaves the body. */
const HEART_Y = 1.35;
const HEART_FORWARD = 1.05;

const DUST_COLORS = [0x2d313b, 0x3a3f4a, 0x23262d, 0x4a4f5b].map((c) => new THREE.Color(c));
const EMBER_COLORS = [0xffb347, 0xffe2a0, 0xe08a2a].map((c) => new THREE.Color(c));

const ATTACK_NOUN: Record<HeroDamageSource['attack'], string> = { blast: 'blast', shot: 'shard', bite: 'bite', slam: 'slam' };
const ENEMY_NAME: Record<HeroDamageSource['enemy'], string> = { burster: 'Burster', spitter: 'Spitter', skitter: 'Skitter', matriarch: 'Gloom Matriarch' };

export type GameState = 'intro' | 'playing' | 'offer' | 'dying' | 'over' | 'victory';

const isAbility = (a: string): a is Ability => (ABILITIES as readonly string[]).includes(a);

const circle = (radius: number, damage: number, knockback: number, stun: number, behaviors: readonly Behavior[] = []): Strike => ({
  damage,
  shape: { kind: 'circle', radius, forward: 0 },
  knockback,
  stun,
  interrupts: false,
  behaviors,
});

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(34, 1, 0.1, 200);
  readonly motion = createMotionState();
  readonly rig: HeroRig;
  readonly animator: HeroAnimator;
  readonly cameraRig: CameraRig;
  readonly input: Input;
  readonly arena: Arena;
  readonly combat = new HeroCombat();
  readonly enemies: EnemyManager;
  readonly hud = new Hud();
  readonly score = new ScoreKeeper();
  readonly log: EventLog;

  flow!: RunFlow;
  attacks: Record<AttackId, AttackSpec> = { ...ATTACKS };
  /** Player-facing pause menu. */
  menuPaused = false;
  /** Test hook: stops the RAF loop from advancing so manual ticks can be inspected. */
  frozen = false;
  /** Test hook: simulate without rendering, audio or HUD (the balance bot). */
  headless = false;
  hp = HERO_HP;
  best = loadBest();
  deathCause = '';

  private readonly post: Post;
  private readonly sfx = new Sfx();
  private readonly effects: Effects;
  private readonly relics: Relics;
  private readonly moon: THREE.DirectionalLight;
  private readonly dust = new ParticlePool(1600, THREE.NormalBlending);
  private readonly embers = new ParticlePool(1400, THREE.AdditiveBlending);
  private readonly motes = new EmberMotes(240, ARENA.radius + 1, 7);
  private readonly heroFlash = createFlash(0xff2b3a);
  private readonly raycaster = new THREE.Raycaster();
  private readonly ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly tmp = new THREE.Vector3();
  private readonly ndc = new THREE.Vector2();
  private readonly tmp2 = new THREE.Vector2();
  private readonly parts = new Map<GraftSlot, string | null>();
  private scheduled: Array<{ t: number; run: () => void }> = [];
  private elapsed = 0;
  private introTime = 0;
  private stateTime = 0;
  private roared = false;
  private hitStop = 0;
  private invuln = 0;
  private spiteCooldown = 0;
  private endShown = false;
  private lastOfferId = 0;
  private lastFrame = 0;
  private readonly frameStats = new RollingStats(180);
  private readonly cpuStats = new RollingStats(180);
  private readonly gpuStats = new RollingStats(180);
  private readonly gpuTimer: GpuTimer;
  private readonly governor: ResolutionGovernor;
  private readonly perf: PerfPanel;

  constructor(
    private readonly container: HTMLElement,
    hudRefs: { joyBase: HTMLElement; joyKnob: HTMLElement; showStats: boolean; seed: number | null },
  ) {
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    // The composer renders into its own targets, so canvas MSAA would only cost bandwidth.
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.governor = new ResolutionGovernor(Math.min(window.devicePixelRatio, coarse ? 1.25 : 1.5), 0.75, 0.25);
    this.renderer.setPixelRatio(this.governor.scale);
    this.gpuTimer = new GpuTimer(this.renderer.getContext() as WebGL2RenderingContext);
    this.perf = new PerfPanel(hudRefs.showStats);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.3;
    this.renderer.info.autoReset = false;
    container.appendChild(this.renderer.domElement);

    const bg = new THREE.Color(0x07060c);
    this.scene.background = bg;
    this.scene.fog = new THREE.FogExp2(bg, 0.024);

    this.scene.add(new THREE.HemisphereLight(0x76809a, 0x0d0b12, 1.45));
    this.moon = new THREE.DirectionalLight(0xdfe6ff, 2.2);
    this.moon.castShadow = true;
    this.moon.shadow.mapSize.set(1024, 1024);
    const sc = this.moon.shadow.camera;
    sc.left = -12;
    sc.right = 12;
    sc.top = 12;
    sc.bottom = -12;
    sc.near = 1;
    sc.far = 45;
    this.moon.shadow.bias = -0.0004;
    this.moon.shadow.normalBias = 0.03;
    this.scene.add(this.moon, this.moon.target);

    this.arena = buildArena(this.renderer.capabilities.getMaxAnisotropy());
    this.scene.add(this.arena.group);

    this.rig = buildHero();
    this.rig.root.position.y = -RISE_DEPTH;
    this.rig.root.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) applyFlash(m as THREE.Material, this.heroFlash);
    });
    this.scene.add(this.rig.root);
    this.animator = new HeroAnimator(this.rig);
    this.animator.onFootstep = (side, strength) => this.footstep(side, strength);

    this.scene.add(this.dust.points, this.embers.points, this.motes.points);
    this.effects = new Effects(this.scene);
    this.relics = new Relics(this.scene);

    this.cameraRig = new CameraRig(this.camera);
    this.cameraRig.snap(new THREE.Vector3());
    this.post = createPost(this.renderer, this.scene, this.camera);

    this.enemies = new EnemyManager({
      scene: this.scene,
      effects: this.effects,
      dust: this.dust,
      embers: this.embers,
      sfx: this.sfx,
      cameraRig: this.cameraRig,
      hud: this.hud,
      project: (x, y, z) => this.project(x, y, z),
      onHeroDamaged: (amount, from, source) => this.damageHero(amount, from, source),
      onKill: (e) => this.onKill(e),
    });

    this.log = new EventLog(() => this.flow?.run.time ?? 0);
    this.combat.onStart = (a) => this.onActionStart(a);
    this.input = new Input(this.renderer.domElement, hudRefs.joyBase, hudRefs.joyKnob);
    this.input.onAction = (a, src) => this.action(a, src);
    this.input.onZoom = (dy) => this.cameraRig.zoomBy(dy);
    this.input.onFirstGesture = () => this.sfx.unlock();
    this.input.onInput = (device) => this.log.input(device);
    this.input.onDevice = (device) => {
      document.documentElement.dataset.input = device;
    };
    const click = (fn: () => void) => () => {
      this.sfx.unlock();
      this.sfx.play('ui');
      fn();
    };
    const exportLog = click(() => this.log.download());
    this.hud.mute.addEventListener('click', click(() => this.action('mute', { device: 'mouse', cursor: false })));
    this.hud.stats.addEventListener('click', click(() => this.action('stats', { device: 'mouse', cursor: false })));
    this.hud.pause.addEventListener('click', click(() => this.action('pause', { device: 'mouse', cursor: false })));
    this.hud.resume.addEventListener('click', click(() => this.setMenuPaused(false)));
    this.hud.pauseRestart.addEventListener('click', click(() => this.newRun()));
    this.hud.pauseExport.addEventListener('click', exportLog);
    this.hud.retry.addEventListener('click', click(() => this.retry()));
    this.hud.newRun.addEventListener('click', click(() => this.newRun()));
    this.hud.gameOverExport.addEventListener('click', exportLog);
    this.hud.victoryNew.addEventListener('click', click(() => this.newRun()));
    this.hud.victoryRetry.addEventListener('click', click(() => this.retry()));
    this.hud.victoryExport.addEventListener('click', exportLog);
    for (const [ability, btn] of this.hud.abilityButtons) {
      btn.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.sfx.unlock();
        this.input.tap(ability, e.pointerType === 'mouse' ? 'mouse' : 'touch');
      });
    }
    document.addEventListener('visibilitychange', () => {
      if (this.headless) return;
      if (document.hidden) this.setMenuPaused(true);
      this.sfx.setHidden(document.hidden);
    });
    window.addEventListener('blur', () => {
      if (!this.headless) this.setMenuPaused(true);
    });

    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.startRun(hudRefs.seed ?? newSeed(), false);
  }

  get state(): GameState {
    switch (this.flow.phase) {
      case 'intro':
        return 'intro';
      case 'intermission':
      case 'wave':
        return 'playing';
      case 'offer':
        return 'offer';
      case 'dying':
        return 'dying';
      case 'defeat':
        return 'over';
      case 'victory':
        return 'victory';
    }
  }

  get introActive(): boolean {
    return this.state === 'intro';
  }

  start(): void {
    const frame = (now: number) => {
      requestAnimationFrame(frame);
      const since = now - this.lastFrame;
      const st = this.state;
      const halted = this.menuPaused || st === 'offer' || st === 'over' || (st === 'victory' && this.endShown);
      if (since < (1000 / (halted ? HALTED_FPS : TARGET_FPS)) * 0.82) return;
      this.lastFrame = now;
      if (this.frozen) return;
      this.input.poll();
      const dt = Math.min(since / 1000, 1 / 20);
      const t0 = performance.now();
      this.tick(dt);
      if (since < 250) this.frameStats.push(since);
      this.cpuStats.push(performance.now() - t0);
      this.gpuStats.push(this.gpuTimer.poll());
      this.adaptResolution(dt, halted);
    };
    requestAnimationFrame(frame);
  }

  skipIntro(): void {
    if (this.state !== 'intro') return;
    this.introTime = INTRO_END;
    this.roared = true;
    this.rig.root.position.y = 0;
    this.beginPlay();
  }

  setIntent(intent: MoveIntent | null): void {
    this.input.override = intent;
  }

  setHeadless(on: boolean): void {
    this.headless = on;
    this.hud.enabled = !on;
    if (on) {
      this.setMenuPaused(false);
      return;
    }
    // The HUD skipped every update while headless; bring it back in line.
    this.hud.setWave(this.flow.run.wave, RUN_WAVES);
    this.hud.setLoadout(this.flow.run.loadout, this.flow.run.runes);
    const plan = this.flow.plans[this.flow.run.wave - 1];
    this.hud.setPreview(plan && this.state === 'playing' ? { label: `Wave ${plan.wave}`, boss: plan.boss, elites: plan.elites } : null);
  }

  newRun(seed = newSeed()): void {
    this.startRun(seed, false);
  }

  /** Same seed, same waves and elites, straight from the death card. */
  retry(): void {
    this.startRun(this.flow.run.seed, true);
  }

  tick(dt: number): void {
    this.elapsed += dt;
    const st = this.state;
    const halted = this.menuPaused || st === 'offer';
    const sim = halted ? 0 : this.hitStop > 0 ? dt * 0.06 : dt;
    if (!halted) {
      this.stateTime += dt;
      this.hitStop = Math.max(0, this.hitStop - dt);
      this.invuln = Math.max(0, this.invuln - dt);
      this.spiteCooldown = Math.max(0, this.spiteCooldown - sim);
    }

    this.updateIntro(sim);
    const live = st === 'playing';
    const events = live ? this.combat.update(sim) : [];

    const action = this.combat.action;
    const spec = action ? this.attacks[action.id] : null;
    let intent = live && !halted ? this.input.read() : STILL;
    const scale = spec ? spec.moveScale : this.animator.roaring ? 0.2 : 1;
    if (scale < 1) intent = { x: intent.x * scale, y: intent.y * scale, run: false };
    stepMotion(this.motion, intent, this.cameraRig.azimuth, sim, MOTION, spec?.lockFacing ? action!.yaw : undefined);
    if (action && spec) this.lunge(spec, action, sim);

    const root = this.rig.root;
    root.position.x = this.motion.pos.x;
    root.position.z = this.motion.pos.z;
    root.rotation.y = this.motion.yaw;
    this.animator.update(sim, {
      speed: this.motion.speed,
      walkSpeed: MOTION.walkSpeed,
      runSpeed: MOTION.runSpeed,
      yawRate: this.motion.yawRate,
      accelForward: this.motion.accelForward,
      action: action && spec ? { pose: spec.pose, p: this.combat.progress } : null,
    });
    if (this.animator.roarEnvelope > 0.6) this.cameraRig.kick(sim * 1.6);
    if (action?.id === 'beam' && this.combat.progress < 0.4 && !this.headless) this.chargeBeam();
    for (const ev of events) this.onHit(ev);

    if (live && !halted) {
      this.runScheduled(sim);
      for (const ev of this.flow.update(sim, this.enemies.alive)) this.onFlow(ev);
      this.enemies.update(sim, this.motion.pos, HERO_BODY_RADIUS, heroHurtRadius(this.flow.run.loadout));
      this.score.update(sim);
      this.collectRelics();
    }
    if (this.state === 'dying') this.updateDeath();
    if (this.state === 'victory') this.updateVictory();
    this.flow.run.hp = this.hp;
    this.flow.run.score = this.score.score;

    this.heroFlash.uFlash.value = Math.max(0, this.heroFlash.uFlash.value - sim * 2.5);
    this.effects.update(sim);
    this.dust.update(sim);
    this.embers.update(sim);
    if (this.headless) return;

    this.sfx.setListener(this.motion.pos, cameraBasis(this.cameraRig.azimuth).right);
    this.syncAudio();
    this.sfx.update(dt);
    this.moon.position.set(root.position.x + 8, 16, root.position.z + 3);
    this.moon.target.position.set(root.position.x, 0, root.position.z);
    this.tmp.set(root.position.x, 0, root.position.z);
    this.cameraRig.update(halted ? 0 : dt, this.tmp, this.motion.vel.x, this.motion.vel.z);
    this.arena.update(dt, this.elapsed);
    this.relics.update(this.elapsed);
    this.motes.update(dt);
    this.renderer.info.reset();
    this.gpuTimer.begin();
    this.post.composer.render(dt);
    this.gpuTimer.end();
    this.updateHud(dt);
  }

  /** Lowers the render scale while frames run over budget, raises it again with headroom. */
  private adaptResolution(dt: number, halted: boolean): void {
    if (halted || this.headless) return;
    const gpu = this.gpuTimer.lastMs;
    const measured = this.gpuTimer.supported && Number.isFinite(gpu);
    const changed = measured
      ? this.governor.update(Math.max(gpu, this.cpuStats.at(0)), BUDGET_MS, dt)
      : this.governor.update(this.frameStats.at(0), BUDGET_MS * 1.3, dt, false);
    if (!changed) return;
    this.renderer.setPixelRatio(this.governor.scale);
    this.resize();
  }

  // ---------- run flow ----------

  private startRun(seed: number, retry: boolean): void {
    const prev = this.flow;
    if (prev && prev.run.outcome === 'running' && prev.phase !== 'intro') this.logRunEnd('abandoned');
    if (retry) this.log.push('retry', { seed, afterOutcome: prev?.run.outcome ?? 'none', afterWave: prev?.run.wave ?? 0 });
    this.flow = new RunFlow(seed, HERO_HP);
    this.enemies.clear();
    this.effects.clear();
    this.relics.clear();
    this.combat.reset();
    this.score.reset();
    this.scheduled = [];
    this.hud.hideEndScreens();
    this.hud.hideOffer();
    this.setMenuPaused(false);
    this.hp = HERO_HP;
    this.deathCause = '';
    this.endShown = false;
    this.spiteCooldown = 0;
    this.hitStop = 0;
    this.invuln = 0;
    this.applyLoadout();
    this.hud.setWave(0, RUN_WAVES);
    this.hud.setPreview(null);
    Object.assign(this.motion, createMotionState());
    this.rig.root.rotation.z = 0;
    this.rig.root.position.y = -RISE_DEPTH;
    this.introTime = 0;
    this.roared = false;
    this.stateTime = 0;
    this.log.startRun({ seed: this.flow.run.seed, retry });
  }

  private updateIntro(dt: number): void {
    if (this.state !== 'intro') return;
    this.introTime += dt;
    const t = this.introTime;
    const rise = smoothstep(0, INTRO_RISE, t);
    this.rig.root.position.y = -RISE_DEPTH * (1 - rise) ** 3;
    if (t < INTRO_RISE) {
      this.cameraRig.kick(dt * 0.9);
      const bursts = Math.floor(dt * 90);
      for (let i = 0; i < bursts; i++) this.spawnDust(this.motion.pos.x, this.motion.pos.z, 1.3, 0.9, 1.8);
      if (Math.random() < dt * 30) this.spawnEmber(this.motion.pos.x, 0.2, this.motion.pos.z, 1.4);
    }
    if (!this.roared && t >= INTRO_RISE) {
      this.roared = true;
      this.animator.triggerRoar();
      this.sfx.play('roar');
      this.burstEmbers(40);
    }
    if (t >= INTRO_END) this.beginPlay();
  }

  private beginPlay(): void {
    this.stateTime = 0;
    this.flow.begin(1.2);
  }

  private updateDeath(): void {
    const p = Math.min(1, this.stateTime / DEATH_TIME);
    this.rig.root.position.y = -RISE_DEPTH * p * p;
    this.rig.root.rotation.z = Math.sin(p * Math.PI * 0.5) * 0.35;
    if (Math.random() < 0.5 && !this.headless) this.spawnDust(this.motion.pos.x, this.motion.pos.z, 1.4, 0.6, 1.2);
    if (p < 1) return;
    for (const ev of this.flow.finishDeath()) this.onFlow(ev);
  }

  private updateVictory(): void {
    if (this.endShown || this.stateTime < VICTORY_CARD) return;
    this.endShown = true;
    this.hud.showVictory(this.summary());
  }

  private summary(): RunSummary {
    const run = this.flow.run;
    const newBest = this.score.score > this.best;
    if (newBest) {
      this.best = this.score.score;
      saveBest(this.best);
    }
    return {
      seed: run.seed,
      wave: run.wave,
      waves: RUN_WAVES,
      kills: run.kills,
      score: this.score.score,
      best: this.best,
      newBest,
      time: run.time,
      cause: this.deathCause,
      loadout: run.loadout,
      runes: run.runes,
    };
  }

  private logRunEnd(outcome: string): void {
    const run = this.flow.run;
    this.log.push('runEnd', {
      outcome,
      seed: run.seed,
      wave: run.wave,
      kills: run.kills,
      score: this.score.score,
      runSeconds: Math.round(run.time * 10) / 10,
      wallSeconds: this.log.wallSeconds,
      loadout: { ...run.loadout },
      runes: [...run.runes],
    });
  }

  private onFlow(ev: FlowEvent): void {
    switch (ev.kind) {
      case 'preview':
        this.hud.setPreview({ label: `Next · wave ${ev.wave}`, boss: ev.boss, elites: ev.elites });
        break;
      case 'waveStart': {
        this.hud.setWave(ev.wave, RUN_WAVES);
        this.hud.setPreview({ label: `Wave ${ev.wave}`, boss: ev.boss, elites: ev.elites });
        const elites = ev.elites.map((f) => `Elite ${FAMILY_LABEL[f]}`).join(' + ');
        if (ev.boss) this.hud.showBanner(`WAVE ${ev.wave}`, 'The Gloom Matriarch rises', 2800, true);
        else this.hud.showBanner(`WAVE ${ev.wave}`, `${ev.total} gloomlings · ${elites}`);
        this.sfx.play('waveStart');
        break;
      }
      case 'spawn': {
        const gate = this.arena.gates.find((g) => g.id === ev.order.gate)!;
        this.enemies.spawn(ev.order.kind, gate, ev.order.elite, ev.speedScale);
        break;
      }
      case 'waveCleared': {
        const bonus = this.score.waveBonus(ev.wave);
        this.sfx.play('waveClear');
        this.hp = Math.min(HERO_HP, this.hp + Math.round(HERO_HP * WAVE_HEAL));
        this.hud.setPreview(null);
        this.hud.showBanner(`WAVE ${ev.wave} CLEARED`, `+${bonus} · the heart mends`);
        break;
      }
      case 'relic':
        this.relics.add(ev.id, ev.at, FAMILY_COLOR[ev.family]);
        this.sfx.play('combo', { pitch: 0.8 });
        this.hud.showBanner('GRAFT RELIC', `The elite ${FAMILY_LABEL[ev.family]} left a part behind`, 1800);
        break;
      case 'offer':
        this.showOffer(ev.offer.id);
        break;
      case 'equip': {
        const g = GRAFTS[ev.graft];
        this.log.push('graftAccept', { offer: this.lastOfferId, graft: ev.graft, slot: ev.slot, replaced: ev.replaced });
        this.applyLoadout();
        this.burstEmbers(36);
        this.sfx.play('upgrade');
        this.hud.showBanner(g.name.toUpperCase(), `${ATTACK_LABEL[SLOT_ATTACK[g.slot]]} rewired`, 1800);
        break;
      }
      case 'rune':
        this.log.push('runePick', { offer: this.lastOfferId, rune: ev.rune });
        this.applyLoadout();
        this.burstEmbers(24);
        this.sfx.play('upgrade');
        this.hud.showBanner(RUNES[ev.rune].name.toUpperCase(), `${RUNES[ev.rune].changes} rewired`, 1800);
        break;
      case 'reject':
        this.log.push('graftReject', { offer: ev.offer, grafts: ev.grafts, reason: ev.reason });
        break;
      case 'victory':
        this.onVictory();
        break;
      case 'defeat': {
        this.logRunEnd('defeat');
        this.hud.showGameOver(this.summary());
        break;
      }
    }
  }

  private showOffer(relicId: number): void {
    const offer = this.flow.offer;
    if (!offer) return;
    this.relics.remove(relicId);
    this.combat.cancel();
    this.lastOfferId = offer.id;
    this.log.push('graftOffer', {
      offer: offer.id,
      family: offer.family,
      wave: offer.wave,
      rerolled: offer.rerolled,
      options: offer.options.map((o) => `${o.type}:${o.id}`),
    });
    this.sfx.play('ui');
    this.hud.showOffer(offer, this.flow.run.loadout, this.flow.run.rerolls, {
      pick: (i) => this.takeOffer(i),
      reroll: () => this.rerollOffer(),
      skip: () => this.skipOffer(),
    });
  }

  takeOffer(index: number): boolean {
    const events = this.flow.take(index);
    this.afterOffer(events);
    return events.length > 0;
  }

  rerollOffer(): boolean {
    if (this.state !== 'offer' || this.flow.run.rerolls <= 0) return false;
    this.log.push('reroll', { offer: this.flow.offer?.id ?? 0 });
    const events = this.flow.reroll();
    for (const ev of events) this.onFlow(ev);
    return events.length > 0;
  }

  skipOffer(): boolean {
    const events = this.flow.skip();
    this.afterOffer(events);
    return events.length > 0;
  }

  private afterOffer(events: FlowEvent[]): void {
    if (events.length === 0) return;
    if (this.flow.phase !== 'offer') this.hud.hideOffer();
    for (const ev of events) this.onFlow(ev);
  }

  private collectRelics(): void {
    const id = this.relics.touching(this.motion.pos, RELIC_PICKUP);
    if (id === null) return;
    for (const ev of this.flow.collectRelic(id)) this.onFlow(ev);
  }

  /** Re-hangs graft parts that changed and re-resolves every attack from the loadout and runes. */
  private applyLoadout(): void {
    const { loadout, runes } = this.flow.run;
    for (const slot of SLOTS) {
      const id = loadout[slot] ?? null;
      if ((this.parts.get(slot) ?? null) === id) continue;
      this.parts.set(slot, id);
      for (const mesh of this.rig.setPart(slot, id ? GRAFTS[id].recipe : null)) applyFlash(mesh.material as THREE.Material, this.heroFlash);
    }
    this.attacks = resolveAttacks(loadout, runes);
    this.combat.specs = this.attacks;
    this.hud.setLoadout(loadout, runes);
  }

  private onVictory(): void {
    this.enemies.shatterAll();
    this.relics.clear();
    this.combat.cancel();
    this.scheduled = [];
    const bonus = this.score.waveBonus(RUN_WAVES) + VICTORY_BONUS;
    this.score.score += VICTORY_BONUS;
    this.stateTime = 0;
    this.hud.setPreview(null);
    this.hud.showBanner('MATRIARCH SLAIN', `The vault holds · +${bonus}`, 2600, true);
    this.sfx.play('waveClear');
    this.logRunEnd('victory');
  }

  private setMenuPaused(paused: boolean): void {
    const allowed = paused ? this.state === 'playing' : true;
    if (!allowed || this.menuPaused === paused) return;
    this.menuPaused = paused;
    this.hud.showPause(paused, this.flow.run.seed);
    // Applied immediately: a hidden tab stops the frame loop, so tick() would not get to it.
    this.syncAudio();
  }

  private syncAudio(): void {
    const st = this.state;
    this.sfx.setMode(gameAudioMode(st === 'victory' && this.endShown ? 'over' : st, this.menuPaused));
  }

  private later(delay: number, run: () => void): void {
    this.scheduled.push({ t: delay, run });
  }

  private runScheduled(dt: number): void {
    if (this.scheduled.length === 0) return;
    const due: Array<() => void> = [];
    this.scheduled = this.scheduled.filter((s) => {
      s.t -= dt;
      if (s.t > 0) return true;
      due.push(s.run);
      return false;
    });
    for (const run of due) if (this.state === 'playing') run();
  }

  // ---------- test hooks ----------

  /** Drops an elite relic of `family` at the hero's feet and opens it. */
  debugOffer(family: Family): Offer | null {
    if (this.state !== 'playing') return null;
    for (const ev of this.flow.enemyKilled({ kind: family, elite: true, pos: { ...this.motion.pos } })) this.onFlow(ev);
    const relic = this.flow.relics[this.flow.relics.length - 1];
    if (relic) for (const ev of this.flow.collectRelic(relic.id)) this.onFlow(ev);
    return this.flow.offer;
  }

  /** Grafts a part straight onto the golem, no offer needed (screenshots, balance checks). */
  debugEquip(id: GraftId): void {
    this.flow.run.loadout = equip(this.flow.run.loadout, id).loadout;
    this.applyLoadout();
  }

  debugRune(id: RuneId): void {
    if (!this.flow.run.runes.includes(id)) this.flow.run.runes = [...this.flow.run.runes, id];
    this.applyLoadout();
  }

  // ---------- input ----------

  private action(a: InputAction, src: ActionSource): void {
    if (a === 'mute') {
      const muted = this.sfx.toggleMute();
      this.hud.mute.setAttribute('aria-pressed', String(muted));
      return;
    }
    if (a === 'stats') {
      this.perf.toggle();
      return;
    }
    const st = this.state;
    if (a === 'pause') {
      if (st === 'playing') this.setMenuPaused(!this.menuPaused);
      return;
    }
    const nav = a === 'navPrev' ? -1 : a === 'navNext' ? 1 : 0;
    if (this.menuPaused) {
      if (nav) this.hud.moveFocus(nav);
      else if (a === 'confirm') this.hud.activateFocused();
      else if (a === 'back') this.setMenuPaused(false);
      return;
    }
    if (st === 'offer') {
      if (a === 'pick1' || a === 'pick2' || a === 'pick3') this.takeOffer(Number(a.slice(-1)) - 1);
      else if (a === 'reroll' || (a === 'beam' && src.device === 'gamepad')) this.rerollOffer();
      else if (a === 'skip' || a === 'back') this.skipOffer();
      else if (a === 'confirm') this.hud.activateFocused();
      else if (nav) this.hud.moveFocus(nav);
      return;
    }
    if (st === 'dying' || st === 'over') {
      if (a === 'newRun') this.newRun();
      else if (a === 'confirm' && !this.hud.activateFocused()) this.retry();
      else if (nav) this.hud.moveFocus(nav);
      return;
    }
    if (st === 'victory') {
      if (!this.endShown) return;
      if (a === 'newRun') this.newRun();
      else if (a === 'confirm') this.hud.activateFocused();
      else if (nav) this.hud.moveFocus(nav);
      return;
    }
    if (st !== 'playing') return;
    const ability = a === 'confirm' ? 'attack' : a === 'back' ? 'spin' : a;
    if (isAbility(ability)) this.combat.request(ability, this.aimYaw(ability, src));
  }

  /** Cursor aim when the mouse is in use, right stick on a pad, else snap to the nearest enemy ahead. */
  private aimYaw(ability: Ability, src: ActionSource): number {
    const pos = this.motion.pos;
    if (src.cursor || (src.device !== 'gamepad' && this.input.mouseAiming)) {
      const p = this.groundPoint(this.input.mouse.x, this.input.mouse.y);
      if (p && Math.hypot(p.x - pos.x, p.z - pos.z) > 0.3) return Math.atan2(p.x - pos.x, p.z - pos.z);
    }
    const stick = src.device === 'gamepad' ? this.input.padAim : null;
    if (stick) {
      const w = intentToWorld({ x: stick.x, y: stick.y, run: false }, this.cameraRig.azimuth);
      return Math.atan2(w.x, w.z);
    }
    if (ability === 'spin' || ability === 'quake') return this.motion.yaw;
    const range = ability === 'beam' ? 12 : 6.5;
    const target = this.enemies.nearest(pos, range, (c) => {
      const yaw = Math.atan2(c.pos.x - pos.x, c.pos.z - pos.z);
      return Math.abs(wrapAngle(yaw - this.motion.yaw)) < 1.9;
    });
    return target ? Math.atan2(target.pos.x - pos.x, target.pos.z - pos.z) : this.motion.yaw;
  }

  // ---------- combat ----------

  private onActionStart(a: ActiveAction): void {
    const spec = this.attacks[a.id];
    switch (a.id) {
      case 'swipeR':
      case 'swipeL':
        this.sfx.play('swing', { pitch: spec.pose === 'claw' ? 1.15 : 1 });
        break;
      case 'slam':
        this.sfx.play('swingHeavy');
        break;
      case 'beam':
        this.sfx.play('beamCharge', { pitch: spec.shape.kind === 'circle' ? 1.35 : 1 });
        break;
      case 'spin':
        this.sfx.play('spin');
        break;
      case 'quake':
        this.sfx.play('quake');
        break;
    }
  }

  /** Hook Claw: carries the golem forward along the aim over the start of the swing. */
  private lunge(spec: AttackSpec, action: ActiveAction, dt: number): void {
    const b = spec.behaviors.find((x) => x.kind === 'lunge');
    if (!b || dt <= 0 || this.combat.progress > b.until) return;
    const step = (b.distance * dt) / (b.until * spec.duration);
    this.motion.pos.x += Math.sin(action.yaw) * step;
    this.motion.pos.z += Math.cos(action.yaw) * step;
    clampToArena(this.motion.pos, this.motion.vel, MOTION.radius);
    if (!this.headless && Math.random() < 0.6) this.spawnDust(this.motion.pos.x, this.motion.pos.z, 0.6, 0.8, 1.2);
  }

  private onHit(ev: HitEvent): void {
    const spec = this.attacks[ev.id];
    const pos = { ...this.motion.pos };
    const result = this.enemies.applyAttack(spec, ev.yaw, pos);
    this.strikeFx(spec, ev, pos);
    for (const b of spec.behaviors) this.behave(b, spec, ev, pos, result);
    if (ev.id === 'quake') {
      const radius = spec.shape.kind === 'circle' ? spec.shape.radius : 6;
      this.enemies.shatterProjectiles(pos, radius);
    }
    if (result.hit.length > 0 && spec.damage > 0) {
      this.hitStop = Math.max(this.hitStop, spec.hitStop * (result.counters > 0 ? 1.6 : 1));
      this.cameraRig.kick(spec.shake * 0.6);
      this.sfx.play(result.counters > 0 || spec.damage >= 50 ? 'hitHeavy' : 'hit');
      this.input.rumble(spec.damage >= 50 || result.counters > 0 ? 0.7 : 0.25, 0.4, 90);
    }
  }

  /** Visuals sized from the attack's real hit shape, so what you see is what hits. */
  private strikeFx(spec: AttackSpec, ev: HitEvent, pos: Vec2): void {
    if (this.headless) return;
    const fx = Math.sin(ev.yaw);
    const fz = Math.cos(ev.yaw);
    const shape = spec.shape;
    const slot = (Object.keys(SLOT_ATTACK) as GraftSlot[]).find((s) => SLOT_ATTACK[s] === ev.id);
    const graft = slot ? this.flow.run.loadout[slot] : undefined;
    const tint = graft ? FAMILY_COLOR[GRAFTS[graft].family] : 0xffa83a;
    switch (shape.kind) {
      case 'arc':
        this.effects.swipe(pos.x, pos.z, ev.yaw, ev.id === 'swipeL' ? -1 : 1, {
          inner: shape.inner ?? 1.3,
          outer: shape.range,
          halfAngle: shape.halfAngle,
        }, tint);
        break;
      case 'beam': {
        const ox = pos.x + fx * HEART_FORWARD;
        const oz = pos.z + fz * HEART_FORWARD;
        this.effects.beam(ox, HEART_Y, oz, ev.yaw, shape.length - HEART_FORWARD);
        this.effects.flash(ox, HEART_Y, oz, 30, 0.35);
        this.cameraRig.kick(spec.shake);
        this.sfx.play('beamBlast');
        break;
      }
      case 'circle': {
        const cx = pos.x + fx * shape.forward;
        const cz = pos.z + fz * shape.forward;
        const r = shape.radius + 0.45;
        if (ev.id === 'slam') {
          this.slamFx(cx, cz, r, spec.shake);
        } else if (ev.id === 'spin') {
          this.effects.shockwave(pos.x, pos.z, r, 0xffa83a, 0.28, 1.1);
          for (let i = 0; i < 6; i++) this.spawnEmber(pos.x, 1.1, pos.z, 5);
        } else if (ev.id === 'quake') {
          this.effects.shockwave(pos.x, pos.z, shape.radius, 0xffc070, 0.7, 0.3);
          this.effects.shockwave(pos.x, pos.z, shape.radius * 0.66, 0xffffff, 0.5, 1.2);
          for (let i = 0; i < 40; i++) this.spawnDust(pos.x, pos.z, 1.5, 1, 2.5);
          this.cameraRig.kick(spec.shake);
          this.input.rumble(0.8, 0.5, 220);
        } else {
          // Burster Heart nova.
          this.effects.shockwave(pos.x, pos.z, r, tint, 0.5, 1.2);
          this.effects.shockwave(pos.x, pos.z, r * 0.6, 0xffffff, 0.35, 1.3);
          this.effects.flash(pos.x, HEART_Y, pos.z, 50, 0.4, tint);
          this.burstEmbers(30);
          this.cameraRig.kick(spec.shake);
          this.sfx.play('beamBlast', { pitch: 1.3 });
        }
        break;
      }
      case 'none':
        break;
    }
  }

  private slamFx(cx: number, cz: number, r: number, shake: number): void {
    this.effects.shockwave(cx, cz, r, 0xffc070, 0.45);
    this.effects.flash(cx, 0.6, cz, 25, 0.25);
    for (let i = 0; i < 30; i++) this.spawnDust(cx, cz, 0.8, 1, 2.2);
    this.cameraRig.kick(shake);
    this.sfx.play('slam', { at: { x: cx, z: cz }, volume: 0.85 });
    this.input.rumble(0.6, 0.4, 140);
  }

  /** Graft and rune mechanics that hang off a landed hit. */
  private behave(b: Behavior, spec: AttackSpec, ev: HitEvent, pos: Vec2, result: StrikeResult): void {
    const fx = Math.sin(ev.yaw);
    const fz = Math.cos(ev.yaw);
    switch (b.kind) {
      case 'shot': {
        for (let i = 0; i < b.count; i++) {
          const a = b.radial
            ? (i / b.count) * Math.PI * 2 + ev.hitIndex * (Math.PI / b.count) * 0.5 + this.motion.yaw
            : ev.yaw + (b.count > 1 ? (i / (b.count - 1) - 0.5) * b.spread : 0);
          const dir = { x: Math.sin(a), z: Math.cos(a) };
          this.enemies.heroShots.spawn({ x: pos.x + dir.x * 0.8, z: pos.z + dir.z * 0.8 }, dir, b.speed, b.range, b.damage, b.pierce, b.radial ? 1.5 : 1.25);
        }
        this.sfx.play('spit', { pitch: b.radial ? 1.6 : 1.3, volume: 0.7 });
        break;
      }
      case 'fuse':
        for (const c of result.hit) {
          c.marked = b.delay;
          this.later(b.delay, () => this.fuseBurst(c, b.radius, b.damage));
        }
        break;
      case 'echo': {
        const origin = { x: pos.x + fx * b.forward, z: pos.z + fz * b.forward };
        this.later(b.delay, () => {
          this.enemies.applyAttack({ ...spec, behaviors: [] }, ev.yaw, origin);
          if (spec.shape.kind !== 'circle' || this.headless) return;
          this.slamFx(origin.x + fx * spec.shape.forward, origin.z + fz * spec.shape.forward, spec.shape.radius + 0.45, spec.shake * 0.7);
        });
        break;
      }
      case 'vortex': {
        const last = ev.hitIndex === spec.hits.length - 1;
        this.enemies.applyAttack(
          last ? circle(b.radius, 0, b.fling, 0.3) : circle(b.radius, 0, 0, 0.12, [{ kind: 'pull', to: b.to }]),
          ev.yaw,
          pos,
        );
        if (!this.headless) this.effects.shockwave(pos.x, pos.z, b.radius, last ? 0xffc070 : 0xb46bff, last ? 0.4 : 0.22, 0.4);
        break;
      }
      case 'lunge':
      case 'pull':
        break;
    }
  }

  private fuseBurst(c: EnemyState, radius: number, damage: number): void {
    const at = { ...c.pos };
    this.enemies.applyAttack(circle(radius, damage, 7, 0.3), 0, at);
    if (this.headless) return;
    const color = FAMILY_COLOR.burster;
    this.effects.shockwave(at.x, at.z, radius + 0.4, color, 0.4, 0.6);
    this.effects.flash(at.x, 1, at.z, 30, 0.25, color);
    for (let i = 0; i < 10; i++) this.spawnEmber(at.x, 0.8, at.z, 2);
    this.sfx.play('explode', { at, volume: 0.5, pitch: 1.35 });
    this.cameraRig.kick(0.12);
  }

  private onKill(e: EnemyState): void {
    const tier = this.score.multiplier;
    this.score.kill(e.cfg.score);
    if (this.score.multiplier > tier) this.sfx.play('combo', { pitch: 0.9 + this.score.multiplier * 0.15 });
    for (const ev of this.flow.enemyKilled({ kind: e.cfg.kind, elite: e.cfg.elite, pos: e.pos })) this.onFlow(ev);
  }

  private damageHero(raw: number, from: Vec2, source: HeroDamageSource): void {
    if (this.state !== 'playing' || this.invuln > 0) return;
    const amount = Math.min(raw, HERO_HP * MAX_HIT_FRACTION);
    this.invuln = INVULN;
    this.hp = Math.max(0, this.hp - amount);
    this.log.damage({ amount, attack: source.attack, enemy: source.enemy, elite: source.elite, wave: this.flow.run.wave });
    this.heroFlash.uFlash.value = 0.55;
    this.hud.hurt(amount / 60);
    this.sfx.play('hurt');
    this.input.rumble(0.9, 0.6, 160);
    const dx = this.motion.pos.x - from.x;
    const dz = this.motion.pos.z - from.z;
    const d = Math.hypot(dx, dz) || 1;
    const push = source.attack === 'shot' ? 1.5 : 4;
    this.motion.vel.x += (dx / d) * push;
    this.motion.vel.z += (dz / d) * push;
    if (this.hp <= 0) {
      const who = `${source.elite && source.enemy !== 'matriarch' ? 'an elite ' : source.enemy === 'matriarch' ? 'the ' : 'a '}${ENEMY_NAME[source.enemy]}`;
      this.deathCause = `Felled by ${who}'s ${ATTACK_NOUN[source.attack]} on wave ${this.flow.run.wave}`;
      this.log.push('death', { attack: source.attack, enemy: source.enemy, elite: source.elite, amount: Math.round(amount), wave: this.flow.run.wave, cause: this.deathCause });
      this.flow.heroDied();
      this.stateTime = 0;
      this.combat.reset();
      this.scheduled = [];
      this.hud.hideOffer();
      this.enemies.silenceLoops();
      this.sfx.play('death');
      return;
    }
    if (this.flow.run.runes.includes('spite') && this.spiteCooldown <= 0) {
      this.spiteCooldown = SPITE.cooldown;
      // Deferred a tick: this runs inside the enemy update loop.
      this.later(0, () => this.spite());
    }
  }

  /** Spite rune: the heart lashes out when struck. */
  private spite(): void {
    const pos = { ...this.motion.pos };
    this.enemies.applyAttack(circle(SPITE.radius, SPITE.damage, SPITE.knockback, SPITE.stun), this.motion.yaw, pos);
    if (this.headless) return;
    this.effects.shockwave(pos.x, pos.z, SPITE.radius + 0.4, 0xffc070, 0.35, 1.1);
    this.effects.flash(pos.x, HEART_Y, pos.z, 35, 0.25);
    this.burstEmbers(16);
    this.sfx.play('hitHeavy', { pitch: 0.8 });
  }

  private groundPoint(clientX: number, clientY: number): THREE.Vector3 | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    return this.raycaster.ray.intersectPlane(this.ground, new THREE.Vector3());
  }

  private project(x: number, y: number, z: number): ScreenPoint {
    if (this.headless) return { x: 0, y: 0, visible: false };
    const v = this.tmp.set(x, y, z).project(this.camera);
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h, visible: v.z < 1 && Math.abs(v.x) < 1.2 && Math.abs(v.y) < 1.2 };
  }

  // ---------- particles ----------

  private chargeBeam(): void {
    const fx = Math.sin(this.motion.yaw);
    const fz = Math.cos(this.motion.yaw);
    const ox = this.motion.pos.x + fx * HEART_FORWARD;
    const oz = this.motion.pos.z + fz * HEART_FORWARD;
    for (let i = 0; i < 2; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 2 + Math.random() * 1.5;
      const sx = ox + Math.cos(a) * r;
      const sy = HEART_Y + (Math.random() - 0.3) * 2;
      const sz = oz + Math.sin(a) * r;
      const life = 0.3;
      this.embers.spawn({
        x: sx,
        y: sy,
        z: sz,
        vx: (ox - sx) / life,
        vy: (HEART_Y - sy) / life,
        vz: (oz - sz) / life,
        life,
        size: 0.06 + Math.random() * 0.05,
        color: EMBER_COLORS[i % EMBER_COLORS.length]!,
      });
    }
  }

  private burstEmbers(count: number): void {
    if (this.headless) return;
    const fx = Math.sin(this.motion.yaw);
    const fz = Math.cos(this.motion.yaw);
    for (let i = 0; i < count; i++) {
      const spread = (Math.random() - 0.5) * 1.6;
      const speed = 2 + Math.random() * 4;
      this.embers.spawn({
        x: this.motion.pos.x + fx * 1.1,
        y: 1.0 + Math.random() * 0.4,
        z: this.motion.pos.z + fz * 1.1,
        vx: (fx + fz * spread) * speed,
        vy: 0.5 + Math.random() * 1.5,
        vz: (fz - fx * spread) * speed,
        life: 0.7 + Math.random() * 0.6,
        size: 0.07 + Math.random() * 0.08,
        color: EMBER_COLORS[i % EMBER_COLORS.length]!,
        drag: 1.8,
        gravity: -0.4,
      });
    }
  }

  private footstep(side: FootSide, strength: number): void {
    if (this.headless) return;
    const foot = side === 'left' ? this.rig.footL : this.rig.footR;
    foot.getWorldPosition(this.tmp);
    const count = Math.round(6 + strength * 8);
    for (let i = 0; i < count; i++) this.spawnDust(this.tmp.x, this.tmp.z, 0.25, strength, 1);
    if (Math.random() < 0.6) this.spawnEmber(this.tmp.x, 0.1, this.tmp.z, 0.6);
    this.cameraRig.kick(0.05 + strength * 0.07);
    this.sfx.play('step', { at: { x: this.tmp.x, z: this.tmp.z }, volume: 0.6 + strength * 0.4 });
  }

  private spawnDust(x: number, z: number, radius: number, strength: number, speedScale: number): void {
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * radius;
    const speed = (0.8 + Math.random() * 1.6) * speedScale * (0.6 + strength * 0.4);
    this.dust.spawn({
      x: x + Math.cos(a) * r,
      y: 0.05,
      z: z + Math.sin(a) * r,
      vx: Math.cos(a) * speed,
      vy: 0.5 + Math.random() * 1.1 * speedScale,
      vz: Math.sin(a) * speed,
      life: 0.45 + Math.random() * 0.5,
      size: 0.08 + Math.random() * 0.1,
      color: DUST_COLORS[Math.floor(Math.random() * DUST_COLORS.length)]!,
      alpha: 0.85,
      gravity: 3.2,
      drag: 2.6,
    });
  }

  private spawnEmber(x: number, y: number, z: number, spread: number): void {
    this.embers.spawn({
      x: x + (Math.random() - 0.5) * spread,
      y,
      z: z + (Math.random() - 0.5) * spread,
      vx: (Math.random() - 0.5) * 0.4,
      vy: 0.6 + Math.random() * 1.1,
      vz: (Math.random() - 0.5) * 0.4,
      life: 0.8 + Math.random() * 0.8,
      size: 0.05 + Math.random() * 0.05,
      color: EMBER_COLORS[Math.floor(Math.random() * EMBER_COLORS.length)]!,
      drag: 0.6,
    });
  }

  // ---------- hud ----------

  private updateHud(dt: number): void {
    this.hud.setHealth(this.hp, HERO_HP);
    this.hud.setStatus(this.enemies.alive + this.flow.pending, this.score.score);
    this.hud.setCombo(this.score.combo, this.score.multiplier, this.score.comboFraction);
    const boss = this.enemies.boss();
    this.hud.setBoss(boss?.hp ?? 0, boss?.trailHp ?? 0, boss?.cfg.maxHp ?? 0);
    const actionAbility = this.combat.action ? this.attacks[this.combat.action.id].ability : null;
    for (const a of ABILITIES) this.hud.setCooldown(a, this.combat.cooldownFraction(a), actionAbility === a);
    this.hud.updateBars(this.state === 'over' ? [] : this.enemies.bars());
    const info = this.renderer.info.render;
    const size = this.renderer.getDrawingBufferSize(this.tmp2);
    this.perf.update(dt, {
      frame: this.frameStats,
      cpu: this.cpuStats,
      gpu: this.gpuStats,
      gpuSupported: this.gpuTimer.supported,
      budgetMs: BUDGET_MS,
      draws: info.calls,
      triangles: info.triangles,
      width: size.x,
      height: size.y,
      scale: this.governor.scale,
      enemies: this.enemies.alive,
      shots: this.enemies.projectiles.list.length,
      voices: this.sfx.ready ? String(this.sfx.voiceCount) : 'off',
    });
  }

  private resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.cameraRig.setAspect(w / h);
    this.renderer.setSize(w, h);
    this.post.setSize(w, h);
    const scale = pointScale(this.camera, h * this.renderer.getPixelRatio());
    for (const field of [this.dust, this.embers, this.motes]) field.setScale(scale);
  }
}
