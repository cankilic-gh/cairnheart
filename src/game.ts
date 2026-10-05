import * as THREE from 'three';
import { ABILITIES, ATTACKS, type Ability, type AttackSpec } from './combat/attacks';
import { HeroCombat, type ActiveAction, type HitEvent } from './combat/heroCombat';
import { Sfx } from './audio/engine';
import { gameAudioMode } from './audio/mix';
import { CameraRig } from './core/cameraRig';
import { Input, type InputAction } from './core/input';
import { smoothstep } from './core/math';
import { GpuTimer, ResolutionGovernor, RollingStats } from './core/perf';
import { loadBest, saveBest } from './core/storage';
import type { EnemyState } from './entities/enemies/types';
import { HeroAnimator, type FootSide } from './entities/hero/animator';
import { buildHero, type HeroRig } from './entities/hero/model';
import { MOTION, cameraBasis, createMotionState, stepMotion, wrapAngle, type MotionConfig, type MoveIntent, type Vec2 } from './entities/hero/motion';
import { Effects } from './fx/effects';
import { ParticlePool, EmberMotes, pointScale } from './fx/particles';
import { EnemyManager, type HeroDamageSource, type ScreenPoint } from './game/enemyManager';
import { ScoreKeeper } from './game/score';
import { UPGRADES, rollUpgrades, statsFor, type HeroStats, type UpgradeId, type UpgradeLevels } from './game/upgrades';
import { WaveDirector, type WaveEvent } from './game/waves';
import { applyFlash, createFlash } from './render/flash';
import { createPost, type Post } from './render/post';
import { Hud } from './ui/hud';
import { PerfPanel } from './ui/perfPanel';
import { buildArena, type Arena } from './world/arena';
import { ARENA } from './world/arenaConfig';

export const HERO_HP = 300;
const HERO_RADIUS = 1.25;
const WAVE_HEAL = 0.3;
const INVULN = 0.3;
const INTRO_RISE = 1.6;
const INTRO_END = 2.3;
const DEATH_TIME = 2.2;
const RISE_DEPTH = 3.8;
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

export type GameState = 'intro' | 'playing' | 'upgrade' | 'dying' | 'over';

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
  readonly waves = new WaveDirector(Math.random);
  readonly enemies: EnemyManager;
  readonly hud = new Hud();
  readonly score = new ScoreKeeper();

  state: GameState = 'intro';
  /** Player-facing pause menu. */
  menuPaused = false;
  /** Test hook: stops the RAF loop from advancing so manual ticks can be inspected. */
  frozen = false;
  hp = HERO_HP;
  kills = 0;
  best = loadBest();
  levels: UpgradeLevels = {};
  stats: HeroStats = statsFor({}, HERO_HP);

  private readonly post: Post;
  private readonly sfx = new Sfx();
  private readonly effects: Effects;
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
  private motionCfg: MotionConfig = MOTION;
  private offered: UpgradeId[] = [];
  private elapsed = 0;
  private introTime = 0;
  private stateTime = 0;
  private roared = false;
  private hitStop = 0;
  private invuln = 0;
  private lastFrame = 0;
  private readonly frameStats = new RollingStats(180);
  private readonly cpuStats = new RollingStats(180);
  private readonly gpuStats = new RollingStats(180);
  private readonly gpuTimer: GpuTimer;
  private readonly governor: ResolutionGovernor;
  private readonly perf: PerfPanel;

  constructor(
    private readonly container: HTMLElement,
    hudRefs: { joyBase: HTMLElement; joyKnob: HTMLElement; showStats: boolean },
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

    this.combat.onStart = (a) => this.onActionStart(a);
    this.input = new Input(this.renderer.domElement, hudRefs.joyBase, hudRefs.joyKnob);
    this.input.onAction = (a, fromMouse) => this.action(a, fromMouse);
    this.input.onZoom = (dy) => this.cameraRig.zoomBy(dy);
    this.input.onFirstGesture = () => this.sfx.unlock();
    const click = (fn: () => void) => () => {
      this.sfx.unlock();
      this.sfx.play('ui');
      fn();
    };
    this.hud.mute.addEventListener('click', click(() => this.action('mute', false)));
    this.hud.stats.addEventListener('click', click(() => this.action('stats', false)));
    this.hud.pause.addEventListener('click', click(() => this.action('pause', false)));
    this.hud.resume.addEventListener('click', click(() => this.setMenuPaused(false)));
    this.hud.pauseRestart.addEventListener('click', click(() => this.restart()));
    this.hud.restart.addEventListener('click', click(() => this.action('restart', false)));
    for (const [ability, btn] of this.hud.abilityButtons) {
      btn.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.sfx.unlock();
        this.action(ability, false);
      });
    }
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.setMenuPaused(true);
      this.sfx.setHidden(document.hidden);
    });
    window.addEventListener('blur', () => this.setMenuPaused(true));

    this.hud.setHealth(this.hp, this.stats.maxHp);
    this.hud.setWave(0);
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  get introActive(): boolean {
    return this.state === 'intro';
  }

  start(): void {
    const frame = (now: number) => {
      requestAnimationFrame(frame);
      const since = now - this.lastFrame;
      const halted = this.menuPaused || this.state === 'upgrade' || this.state === 'over';
      if (since < (1000 / (halted ? HALTED_FPS : TARGET_FPS)) * 0.82) return;
      this.lastFrame = now;
      if (this.frozen) return;
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

  tick(dt: number): void {
    this.elapsed += dt;
    const halted = this.menuPaused || this.state === 'upgrade';
    const sim = halted ? 0 : this.hitStop > 0 ? dt * 0.06 : dt;
    if (!halted) {
      this.stateTime += dt;
      this.hitStop = Math.max(0, this.hitStop - dt);
      this.invuln = Math.max(0, this.invuln - dt);
    }

    this.updateIntro(sim);
    const events = this.state === 'playing' ? this.combat.update(sim) : [];

    const action = this.combat.action;
    const spec = action ? ATTACKS[action.id] : null;
    let intent = this.state === 'playing' && !halted ? this.input.read() : STILL;
    const scale = spec ? spec.moveScale : this.animator.roaring ? 0.2 : 1;
    if (scale < 1) intent = { x: intent.x * scale, y: intent.y * scale, run: false };
    stepMotion(this.motion, intent, this.cameraRig.azimuth, sim, this.motionCfg, spec?.lockFacing ? action!.yaw : undefined);

    const root = this.rig.root;
    root.position.x = this.motion.pos.x;
    root.position.z = this.motion.pos.z;
    root.rotation.y = this.motion.yaw;
    this.animator.update(sim, {
      speed: this.motion.speed,
      walkSpeed: this.motionCfg.walkSpeed,
      runSpeed: this.motionCfg.runSpeed,
      yawRate: this.motion.yawRate,
      accelForward: this.motion.accelForward,
      action: action ? { id: action.id, p: this.combat.progress } : null,
    });
    if (this.animator.roarEnvelope > 0.6) this.cameraRig.kick(sim * 1.6);
    if (action?.id === 'beam' && this.combat.progress < 0.4) this.chargeBeam();
    for (const ev of events) this.onHit(ev);

    if (this.state === 'playing' && !halted) {
      for (const ev of this.waves.update(sim, this.enemies.alive)) this.onWave(ev);
      this.enemies.update(sim, this.motion.pos, HERO_RADIUS);
      this.score.update(sim);
    }
    if (this.state === 'dying') this.updateDeath();
    this.sfx.setListener(this.motion.pos, cameraBasis(this.cameraRig.azimuth).right);
    this.syncAudio();
    this.sfx.update(dt);
    this.heroFlash.uFlash.value = Math.max(0, this.heroFlash.uFlash.value - sim * 2.5);

    this.moon.position.set(root.position.x + 8, 16, root.position.z + 3);
    this.moon.target.position.set(root.position.x, 0, root.position.z);
    this.tmp.set(root.position.x, 0, root.position.z);
    this.cameraRig.update(halted ? 0 : dt, this.tmp, this.motion.vel.x, this.motion.vel.z);
    this.arena.update(dt, this.elapsed);
    this.effects.update(sim);
    this.dust.update(sim);
    this.embers.update(sim);
    this.motes.update(dt);
    this.renderer.info.reset();
    this.gpuTimer.begin();
    this.post.composer.render(dt);
    this.gpuTimer.end();
    this.updateHud(dt);
  }

  /** Lowers the render scale while frames run over budget, raises it again with headroom. */
  private adaptResolution(dt: number, halted: boolean): void {
    if (halted) return;
    const gpu = this.gpuTimer.lastMs;
    const measured = this.gpuTimer.supported && Number.isFinite(gpu);
    const changed = measured
      ? this.governor.update(Math.max(gpu, this.cpuStats.at(0)), BUDGET_MS, dt)
      : this.governor.update(this.frameStats.at(0), BUDGET_MS * 1.3, dt, false);
    if (!changed) return;
    this.renderer.setPixelRatio(this.governor.scale);
    this.resize();
  }

  // ---------- flow ----------

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
    this.state = 'playing';
    this.stateTime = 0;
    this.waves.start(1.2);
  }

  private updateDeath(): void {
    const p = Math.min(1, this.stateTime / DEATH_TIME);
    this.rig.root.position.y = -RISE_DEPTH * p * p;
    this.rig.root.rotation.z = Math.sin(p * Math.PI * 0.5) * 0.35;
    if (Math.random() < 0.5) this.spawnDust(this.motion.pos.x, this.motion.pos.z, 1.4, 0.6, 1.2);
    if (p < 1) return;
    this.state = 'over';
    const newBest = this.score.score > this.best;
    if (newBest) {
      this.best = this.score.score;
      saveBest(this.best);
    }
    this.hud.showGameOver({ wave: this.waves.wave, kills: this.kills, score: this.score.score, best: this.best, newBest });
  }

  private restart(): void {
    this.enemies.clear();
    this.effects.clear();
    this.combat.reset();
    this.score.reset();
    this.hud.hideGameOver();
    this.hud.hideUpgrades();
    this.setMenuPaused(false);
    this.levels = {};
    this.applyStats();
    this.hp = this.stats.maxHp;
    this.kills = 0;
    this.hud.setWave(0);
    Object.assign(this.motion, createMotionState());
    this.rig.root.rotation.z = 0;
    this.rig.root.position.y = -RISE_DEPTH;
    this.introTime = 0;
    this.roared = false;
    this.state = 'intro';
    this.stateTime = 0;
    this.waves.phase = 'idle';
  }

  private setMenuPaused(paused: boolean): void {
    const allowed = paused ? this.state === 'playing' : true;
    if (!allowed || this.menuPaused === paused) return;
    this.menuPaused = paused;
    this.hud.showPause(paused);
    // Applied immediately: a hidden tab stops the frame loop, so tick() would not get to it.
    this.syncAudio();
  }

  private syncAudio(): void {
    this.sfx.setMode(gameAudioMode(this.state, this.menuPaused));
  }

  private onWave(ev: WaveEvent): void {
    if (ev.kind === 'waveStart') {
      this.hud.setWave(ev.wave);
      if (ev.boss) this.hud.showBanner(`WAVE ${ev.wave}`, 'The Gloom Matriarch rises', 2800, true);
      else this.hud.showBanner(`WAVE ${ev.wave}`, `${ev.total} gloomlings incoming`);
      this.sfx.play('waveStart');
    } else if (ev.kind === 'spawn') {
      const gate = this.arena.gates.find((g) => g.id === ev.order.gate)!;
      this.enemies.spawn(ev.order.kind, gate, ev.order.elite, ev.speedScale, ev.bossLevel);
    } else {
      const bonus = this.score.waveBonus(ev.wave);
      this.sfx.play('waveClear');
      this.hp = Math.min(this.stats.maxHp, this.hp + Math.round(this.stats.maxHp * WAVE_HEAL));
      this.offerUpgrades(`Wave ${ev.wave} cleared · +${bonus}`);
    }
  }

  private offerUpgrades(title: string): void {
    this.offered = rollUpgrades(this.levels, Math.random);
    if (this.offered.length === 0) return;
    this.state = 'upgrade';
    this.combat.reset();
    this.hud.showUpgrades(
      title,
      this.offered.map((id) => ({ name: UPGRADES[id].name, text: UPGRADES[id].text, level: this.levels[id] ?? 0, max: UPGRADES[id].max })),
      (i) => this.pickUpgrade(i),
    );
  }

  private pickUpgrade(index: number): void {
    const id = this.offered[index];
    if (this.state !== 'upgrade' || !id) return;
    this.levels[id] = (this.levels[id] ?? 0) + 1;
    const before = this.stats.maxHp;
    this.applyStats();
    this.hp = Math.min(this.stats.maxHp, this.hp + (this.stats.maxHp - before));
    this.hud.hideUpgrades();
    this.state = 'playing';
    this.burstEmbers(30);
    this.sfx.play('upgrade');
  }

  private applyStats(): void {
    this.stats = statsFor(this.levels, HERO_HP);
    this.combat.cooldownScale = { ...this.stats.cooldownScale };
    this.motionCfg = { ...MOTION, walkSpeed: MOTION.walkSpeed * this.stats.moveSpeed, runSpeed: MOTION.runSpeed * this.stats.moveSpeed };
  }

  // ---------- combat ----------

  private action(a: InputAction, fromMouse: boolean): void {
    if (a === 'mute') {
      const muted = this.sfx.toggleMute();
      this.hud.mute.setAttribute('aria-pressed', String(muted));
      return;
    }
    if (a === 'restart') {
      if (this.state === 'over') this.restart();
      return;
    }
    if (a === 'pause') {
      this.setMenuPaused(!this.menuPaused);
      return;
    }
    if (a === 'stats') {
      this.perf.toggle();
      return;
    }
    if (a === 'pick1' || a === 'pick2' || a === 'pick3') {
      this.pickUpgrade(Number(a.slice(-1)) - 1);
      return;
    }
    if (this.state !== 'playing' || this.menuPaused) return;
    this.combat.request(a, this.aimYaw(a, fromMouse));
  }

  private onActionStart(a: ActiveAction): void {
    switch (a.id) {
      case 'swipeR':
      case 'swipeL':
        this.sfx.play('swing');
        break;
      case 'slam':
        this.sfx.play('swingHeavy');
        break;
      case 'beam':
        this.sfx.play('beamCharge');
        break;
      case 'spin':
        this.sfx.play('spin');
        break;
      case 'quake':
        this.sfx.play('quake');
        break;
    }
  }

  private scaled(spec: AttackSpec): { spec: AttackSpec; damage: number; reach: number } {
    const s = this.stats;
    switch (spec.id) {
      case 'swipeR':
      case 'swipeL':
      case 'slam':
        return { spec, damage: s.meleeDamage, reach: s.reach };
      case 'beam':
        return { spec, damage: s.beamDamage, reach: 1 };
      case 'spin':
        return { spec, damage: s.spinDamage, reach: s.spinRadius };
      case 'quake':
        return { spec: { ...spec, damage: s.quakeDamage }, damage: 1, reach: 1 };
    }
  }

  private onHit(ev: HitEvent): void {
    const { spec, damage, reach } = this.scaled(ATTACKS[ev.id]);
    const { x, z } = this.motion.pos;
    const fx = Math.sin(ev.yaw);
    const fz = Math.cos(ev.yaw);
    const hits = this.enemies.applyAttack(spec, ev.yaw, this.motion.pos, damage, reach);
    switch (ev.id) {
      case 'swipeR':
      case 'swipeL':
        this.effects.swipe(x, z, ev.yaw, ev.id === 'swipeR' ? 1 : -1);
        break;
      case 'slam': {
        const cx = x + fx * 1.8;
        const cz = z + fz * 1.8;
        this.effects.shockwave(cx, cz, 3.2 * reach, 0xffc070, 0.45);
        this.effects.flash(cx, 0.6, cz, 25, 0.25);
        for (let i = 0; i < 30; i++) this.spawnDust(cx, cz, 0.8, 1, 2.2);
        this.cameraRig.kick(spec.shake);
        this.sfx.play('slam', { at: { x: cx, z: cz }, volume: 0.85 });
        break;
      }
      case 'beam': {
        const ox = x + fx * HEART_FORWARD;
        const oz = z + fz * HEART_FORWARD;
        this.effects.beam(ox, HEART_Y, oz, ev.yaw, (spec.shape.kind === 'beam' ? spec.shape.length : 14) - HEART_FORWARD);
        this.effects.flash(ox, HEART_Y, oz, 30, 0.35);
        this.cameraRig.kick(spec.shake);
        this.sfx.play('beamBlast');
        break;
      }
      case 'spin':
        this.effects.shockwave(x, z, 3.1 * reach, 0xffa83a, 0.28, 1.1);
        for (let i = 0; i < 6; i++) this.spawnEmber(x, 1.1, z, 5);
        break;
      case 'quake': {
        const radius = spec.shape.kind === 'circle' ? spec.shape.radius : 6;
        this.effects.shockwave(x, z, radius, 0xffc070, 0.7, 0.3);
        this.effects.shockwave(x, z, radius * 0.66, 0xffffff, 0.5, 1.2);
        for (let i = 0; i < 40; i++) this.spawnDust(x, z, 1.5, 1, 2.5);
        this.enemies.shatterProjectiles(this.motion.pos, radius);
        this.cameraRig.kick(spec.shake);
        break;
      }
    }
    if (hits > 0 && spec.damage > 0) {
      this.hitStop = Math.max(this.hitStop, spec.hitStop);
      this.cameraRig.kick(spec.shake * 0.6);
      this.sfx.play(spec.damage * damage >= 50 ? 'hitHeavy' : 'hit');
    }
  }

  private onKill(e: EnemyState): void {
    this.kills += 1;
    const tier = this.score.multiplier;
    this.score.kill(e.cfg.score);
    if (this.score.multiplier > tier) this.sfx.play('combo', { pitch: 0.9 + this.score.multiplier * 0.15 });
    if (e.cfg.kind === 'matriarch') this.hud.showBanner('MATRIARCH SLAIN', `+${e.cfg.score * this.score.multiplier} pts`, 2600, true);
    const heal = this.stats.siphon;
    if (heal > 0 && this.state === 'playing' && this.hp < this.stats.maxHp) {
      this.hp = Math.min(this.stats.maxHp, this.hp + heal);
      const p = this.project(this.motion.pos.x, 3.2, this.motion.pos.z);
      if (p.visible) this.hud.damageNumber(p.x, p.y, heal, 'heal');
    }
  }

  private damageHero(amount: number, from: Vec2, source: HeroDamageSource): void {
    if (this.state !== 'playing' || this.invuln > 0) return;
    this.invuln = INVULN;
    this.hp = Math.max(0, this.hp - amount);
    this.heroFlash.uFlash.value = 0.55;
    this.hud.hurt(amount / 60);
    this.sfx.play('hurt');
    const p = this.project(this.motion.pos.x, 3.4, this.motion.pos.z);
    if (p.visible) this.hud.damageNumber(p.x, p.y, amount, 'player');
    const dx = this.motion.pos.x - from.x;
    const dz = this.motion.pos.z - from.z;
    const d = Math.hypot(dx, dz) || 1;
    const push = source === 'shot' ? 1.5 : 4;
    this.motion.vel.x += (dx / d) * push;
    this.motion.vel.z += (dz / d) * push;
    if (this.hp <= 0) {
      this.state = 'dying';
      this.stateTime = 0;
      this.combat.reset();
      this.enemies.silenceLoops();
      this.sfx.play('death');
    }
  }

  /** Mouse aim wins when the cursor is in use; otherwise snap to the nearest enemy ahead, else keep facing. */
  private aimYaw(ability: Ability, fromMouse: boolean): number {
    const pos = this.motion.pos;
    if (fromMouse || this.input.mouseAiming) {
      const p = this.groundPoint(this.input.mouse.x, this.input.mouse.y);
      if (p && Math.hypot(p.x - pos.x, p.z - pos.z) > 0.3) return Math.atan2(p.x - pos.x, p.z - pos.z);
    }
    if (ability === 'spin' || ability === 'quake') return this.motion.yaw;
    const range = ability === 'beam' ? 12 : 6.5;
    const target = this.enemies.nearest(pos, range, (c) => {
      const yaw = Math.atan2(c.pos.x - pos.x, c.pos.z - pos.z);
      return Math.abs(wrapAngle(yaw - this.motion.yaw)) < 1.9;
    });
    return target ? Math.atan2(target.pos.x - pos.x, target.pos.z - pos.z) : this.motion.yaw;
  }

  private groundPoint(clientX: number, clientY: number): THREE.Vector3 | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    return this.raycaster.ray.intersectPlane(this.ground, new THREE.Vector3());
  }

  private project(x: number, y: number, z: number): ScreenPoint {
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
    this.hud.setHealth(this.hp, this.stats.maxHp);
    this.hud.setStatus(this.enemies.alive + this.waves.pending, this.score.score);
    this.hud.setCombo(this.score.combo, this.score.multiplier, this.score.comboFraction);
    const boss = this.enemies.boss();
    this.hud.setBoss(boss?.hp ?? 0, boss?.trailHp ?? 0, boss?.cfg.maxHp ?? 0);
    const actionAbility = this.combat.action ? ATTACKS[this.combat.action.id].ability : null;
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
