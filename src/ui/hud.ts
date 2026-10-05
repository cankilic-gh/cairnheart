import type { Ability } from '../combat/attacks';

export interface EnemyBar {
  id: number;
  x: number;
  y: number;
  hp: number;
  trail: number;
  max: number;
  elite: boolean;
}

export interface UpgradeOption {
  name: string;
  text: string;
  level: number;
  max: number;
}

export interface RunSummary {
  wave: number;
  kills: number;
  score: number;
  best: number;
  newBest: boolean;
}

export type DamageKind = 'normal' | 'heavy' | 'player' | 'heal';

const byId = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
};

const fmt = new Intl.NumberFormat('en-US');

/** DOM HUD: hero health, wave and score, ability cooldowns, boss bar, menus, per-enemy bars and damage numbers. */
export class Hud {
  readonly abilityButtons: Map<Ability, HTMLButtonElement>;
  readonly mute = byId<HTMLButtonElement>('mute');
  readonly pause = byId<HTMLButtonElement>('pause');
  readonly resume = byId<HTMLButtonElement>('resume');
  readonly pauseRestart = byId<HTMLButtonElement>('pause-restart');
  readonly restart = byId<HTMLButtonElement>('restart');

  private readonly hpFill = byId('hp-fill');
  private readonly hpTrail = byId('hp-trail');
  private readonly hpText = byId('hp-text');
  private readonly wave = byId('wave');
  private readonly remaining = byId('remaining');
  private readonly score = byId('score');
  private readonly boss = byId('boss');
  private readonly bossFill = byId('boss-fill');
  private readonly bossTrail = byId('boss-trail');
  private readonly combo = byId('combo');
  private readonly comboMult = byId('combo-mult');
  private readonly comboCount = byId('combo-count');
  private readonly comboFill = byId('combo-fill');
  private readonly banner = byId('banner');
  private readonly bannerTitle = byId('banner-title');
  private readonly bannerSub = byId('banner-sub');
  private readonly hurtEl = byId('hurt');
  private readonly overlay = byId('overlay');
  private readonly upgrade = byId('upgrade');
  private readonly upgradeTitle = byId('upgrade-title');
  private readonly upgradeOptions = byId('upgrade-options');
  private readonly paused = byId('paused');
  private readonly gameOverEl = byId('gameover');
  private readonly gameOverStats = byId('gameover-stats');
  private readonly gameOverBest = byId('gameover-best');
  private readonly bars = new Map<number, { el: HTMLElement; fill: HTMLElement; trail: HTMLElement }>();
  private readonly cache = new Map<string, string>();
  private bannerTimer = 0;

  constructor() {
    this.abilityButtons = new Map(
      [...document.querySelectorAll<HTMLButtonElement>('.ability')].map((b) => [b.dataset.ability as Ability, b]),
    );
  }

  setHealth(hp: number, max: number): void {
    if (!this.changed('hp', `${hp.toFixed(1)}/${max}`)) return;
    const pct = `${Math.max(0, (hp / max) * 100).toFixed(1)}%`;
    this.hpFill.style.width = pct;
    this.hpTrail.style.width = pct;
    this.hpText.textContent = `${Math.ceil(hp)} / ${max}`;
    this.hpFill.parentElement?.classList.toggle('is-low', hp / max < 0.3);
  }

  setWave(wave: number): void {
    this.wave.textContent = wave > 0 ? `WAVE ${wave}` : 'GET READY';
  }

  setStatus(remaining: number, score: number): void {
    if (this.changed('remaining', String(remaining))) this.remaining.textContent = String(remaining);
    if (this.changed('score', String(score))) this.score.textContent = fmt.format(score);
  }

  setCombo(combo: number, multiplier: number, fraction: number): void {
    const visible = combo >= 3;
    this.combo.classList.toggle('is-visible', visible);
    if (!visible) return;
    if (this.changed('combo', `${combo}/${multiplier}`)) {
      this.comboMult.textContent = `x${multiplier}`;
      this.comboCount.textContent = `${combo} chain`;
    }
    this.comboFill.style.width = `${(fraction * 100).toFixed(1)}%`;
  }

  setBoss(hp: number, trail: number, max: number): void {
    const visible = max > 0;
    if (this.boss.hidden === visible) this.boss.hidden = !visible;
    if (!visible) return;
    this.bossFill.style.width = `${((hp / max) * 100).toFixed(2)}%`;
    this.bossTrail.style.width = `${((trail / max) * 100).toFixed(2)}%`;
  }

  setCooldown(ability: Ability, fraction: number, active: boolean): void {
    const btn = this.abilityButtons.get(ability);
    if (!btn) return;
    const key = `cd-${ability}`;
    const prev = this.cache.get(key) ?? '0.000';
    const value = fraction.toFixed(3);
    if (this.changed(key, value)) {
      btn.style.setProperty('--cd', value);
      if (prev !== '0.000' && fraction === 0) {
        btn.classList.remove('is-ready');
        void btn.offsetWidth;
        btn.classList.add('is-ready');
      }
    }
    btn.classList.toggle('is-active', active);
  }

  showBanner(title: string, sub: string, ms = 2200, boss = false): void {
    this.bannerTitle.textContent = title;
    this.bannerSub.textContent = sub;
    this.banner.classList.toggle('is-boss', boss);
    this.banner.classList.add('is-visible');
    window.clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => this.banner.classList.remove('is-visible'), ms);
  }

  hurt(strength: number): void {
    const el = this.hurtEl;
    el.style.transition = 'none';
    el.style.opacity = String(Math.min(1, 0.35 + strength * 0.65));
    void el.offsetWidth;
    el.style.transition = 'opacity 650ms ease-out';
    el.style.opacity = '0';
  }

  showUpgrades(title: string, options: readonly UpgradeOption[], onPick: (index: number) => void): void {
    this.upgradeTitle.textContent = title;
    this.upgradeOptions.replaceChildren(
      ...options.map((o, i) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'upgrade-option';
        const pips = Array.from({ length: o.max }, (_, p) => `<i class="${p < o.level ? 'is-on' : p === o.level ? 'is-next' : ''}"></i>`).join('');
        btn.innerHTML = `<kbd>${i + 1}</kbd><span class="upgrade-name"></span><span class="upgrade-pips">${pips}</span><span class="upgrade-text"></span>`;
        btn.querySelector('.upgrade-name')!.textContent = o.name;
        btn.querySelector('.upgrade-text')!.textContent = o.text;
        btn.addEventListener('click', () => onPick(i));
        return btn;
      }),
    );
    this.upgrade.hidden = false;
    this.upgradeOptions.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
  }

  hideUpgrades(): void {
    this.upgrade.hidden = true;
  }

  showPause(visible: boolean): void {
    this.paused.hidden = !visible;
    if (visible) this.resume.focus({ preventScroll: true });
  }

  showGameOver(s: RunSummary): void {
    this.gameOverStats.textContent = `Wave ${s.wave} · ${s.kills} kills · ${fmt.format(s.score)} pts`;
    this.gameOverBest.textContent = s.newBest ? 'NEW BEST' : `Best ${fmt.format(s.best)}`;
    this.gameOverEl.hidden = false;
    this.restart.focus({ preventScroll: true });
  }

  hideGameOver(): void {
    this.gameOverEl.hidden = true;
  }

  updateBars(list: readonly EnemyBar[]): void {
    const seen = new Set<number>();
    for (const b of list) {
      seen.add(b.id);
      let view = this.bars.get(b.id);
      if (!view) {
        const el = document.createElement('div');
        el.className = b.elite ? 'ebar is-elite' : 'ebar';
        const trail = document.createElement('div');
        trail.className = 'ebar-trail';
        const fill = document.createElement('div');
        fill.className = 'ebar-fill';
        el.append(trail, fill);
        this.overlay.append(el);
        view = { el, fill, trail };
        this.bars.set(b.id, view);
      }
      view.el.style.transform = `translate(${b.x.toFixed(1)}px, ${b.y.toFixed(1)}px)`;
      view.fill.style.width = `${((b.hp / b.max) * 100).toFixed(1)}%`;
      view.trail.style.width = `${((b.trail / b.max) * 100).toFixed(1)}%`;
    }
    for (const [id, view] of this.bars) {
      if (seen.has(id)) continue;
      view.el.remove();
      this.bars.delete(id);
    }
  }

  damageNumber(x: number, y: number, amount: number, kind: DamageKind): void {
    const el = document.createElement('span');
    el.className = `dmg is-${kind}`;
    const n = Math.round(amount);
    el.textContent = kind === 'player' ? `-${n}` : kind === 'heal' ? `+${n}` : String(n);
    this.overlay.append(el);
    const drift = (Math.random() - 0.5) * 30;
    const anim = el.animate(
      [
        { transform: `translate(${x}px, ${y}px) translate(-50%, -50%) scale(0.5)`, opacity: 0 },
        { transform: `translate(${x}px, ${y - 16}px) translate(-50%, -50%) scale(1.2)`, opacity: 1, offset: 0.15 },
        { transform: `translate(${x + drift}px, ${y - 48}px) translate(-50%, -50%) scale(1)`, opacity: 0 },
      ],
      { duration: kind === 'heavy' ? 900 : 720, easing: 'cubic-bezier(.2,.7,.3,1)' },
    );
    anim.onfinish = () => el.remove();
  }

  private changed(key: string, value: string): boolean {
    if (this.cache.get(key) === value) return false;
    this.cache.set(key, value);
    return true;
  }
}
