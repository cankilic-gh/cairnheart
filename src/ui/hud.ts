import type { Ability } from '../combat/attacks';
import { FAMILY_COLOR, FAMILY_LABEL, GRAFTS, SLOTS, SLOT_LABEL, type Family, type Loadout } from '../game/grafts';
import type { Offer } from '../game/runFlow';
import { RUNES, type RuneId } from '../game/runes';
import { golemSvg, hex, loadoutFills, offerCard } from './graftCard';

export interface EnemyBar {
  id: number;
  x: number;
  y: number;
  hp: number;
  trail: number;
  max: number;
  elite: boolean;
}

export interface RunSummary {
  seed: number;
  wave: number;
  waves: number;
  kills: number;
  score: number;
  best: number;
  newBest: boolean;
  time: number;
  cause?: string;
  loadout: Loadout;
  runes: readonly RuneId[];
}

export interface OfferHandlers {
  pick(index: number): void;
  reroll(): void;
  skip(): void;
}

const byId = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
};

const fmt = new Intl.NumberFormat('en-US');

export const formatTime = (seconds: number): string => {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const familyChip = (family: Family): string =>
  `<span class="family-chip" style="--family:${hex(FAMILY_COLOR[family])}">Elite ${FAMILY_LABEL[family]}</span>`;

const buildList = (loadout: Loadout, runes: readonly RuneId[]): string[] => [
  ...SLOTS.flatMap((slot) => {
    const id = loadout[slot];
    return id ? [`${SLOT_LABEL[slot]}: ${GRAFTS[id].name}`] : [];
  }),
  ...runes.map((r) => RUNES[r].name),
];

/** DOM HUD: health, wave and score, preview of the next wave's elites, grafts, cooldowns, boss bar, menus. */
export class Hud {
  /** Off in headless runs: nothing touches the DOM. */
  enabled = true;
  readonly abilityButtons: Map<Ability, HTMLButtonElement>;
  readonly mute = byId<HTMLButtonElement>('mute');
  readonly stats = byId<HTMLButtonElement>('stats');
  readonly pause = byId<HTMLButtonElement>('pause');
  readonly resume = byId<HTMLButtonElement>('resume');
  readonly pauseRestart = byId<HTMLButtonElement>('pause-restart');
  readonly pauseExport = byId<HTMLButtonElement>('pause-export');
  readonly retry = byId<HTMLButtonElement>('retry');
  readonly newRun = byId<HTMLButtonElement>('new-run');
  readonly gameOverExport = byId<HTMLButtonElement>('gameover-export');
  readonly victoryNew = byId<HTMLButtonElement>('victory-new');
  readonly victoryRetry = byId<HTMLButtonElement>('victory-retry');
  readonly victoryExport = byId<HTMLButtonElement>('victory-export');

  private readonly hpFill = byId('hp-fill');
  private readonly hpTrail = byId('hp-trail');
  private readonly hpText = byId('hp-text');
  private readonly wave = byId('wave');
  private readonly remaining = byId('remaining');
  private readonly score = byId('score');
  private readonly preview = byId('preview');
  private readonly previewLabel = byId('preview-label');
  private readonly previewElites = byId('preview-elites');
  private readonly loadout = byId('loadout');
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
  private readonly offer = byId('offer');
  private readonly offerTitle = byId('offer-title');
  private readonly offerSub = byId('offer-sub');
  private readonly offerOptions = byId('offer-options');
  private readonly offerReroll = byId<HTMLButtonElement>('offer-reroll');
  private readonly offerRerolls = byId('offer-rerolls');
  private readonly offerSkip = byId<HTMLButtonElement>('offer-skip');
  private readonly paused = byId('paused');
  private readonly pausedSeed = byId('paused-seed');
  private readonly gameOverEl = byId('gameover');
  private readonly gameOverCause = byId('gameover-cause');
  private readonly gameOverStats = byId('gameover-stats');
  private readonly gameOverBest = byId('gameover-best');
  private readonly victoryEl = byId('victory');
  private readonly victoryStats = byId('victory-stats');
  private readonly victoryBuild = byId('victory-build');
  private readonly victoryBest = byId('victory-best');
  private readonly bars = new Map<number, { el: HTMLElement; fill: HTMLElement; trail: HTMLElement }>();
  private readonly cache = new Map<string, string>();
  private bannerTimer = 0;
  private handlers: OfferHandlers | null = null;

  constructor() {
    this.abilityButtons = new Map(
      [...document.querySelectorAll<HTMLButtonElement>('.ability')].map((b) => [b.dataset.ability as Ability, b]),
    );
    this.offerReroll.addEventListener('click', () => this.handlers?.reroll());
    this.offerSkip.addEventListener('click', () => this.handlers?.skip());
  }

  setHealth(hp: number, max: number): void {
    if (!this.enabled || !this.changed('hp', `${hp.toFixed(1)}/${max}`)) return;
    const pct = `${Math.max(0, (hp / max) * 100).toFixed(1)}%`;
    this.hpFill.style.width = pct;
    this.hpTrail.style.width = pct;
    this.hpText.textContent = `${Math.ceil(hp)} / ${max}`;
    this.hpFill.parentElement?.classList.toggle('is-low', hp / max < 0.3);
  }

  setWave(wave: number, total: number): void {
    if (!this.enabled) return;
    this.wave.textContent = wave > 0 ? `WAVE ${wave} / ${total}` : 'GET READY';
  }

  setStatus(remaining: number, score: number): void {
    if (!this.enabled) return;
    if (this.changed('remaining', String(remaining))) this.remaining.textContent = String(remaining);
    if (this.changed('score', String(score))) this.score.textContent = fmt.format(score);
  }

  /** What the next (or current) wave brings: its elites and the graft families they drop. */
  setPreview(p: { label: string; boss: boolean; elites: readonly Family[] } | null): void {
    if (!this.enabled) return;
    const key = p ? `${p.label}|${p.boss}|${p.elites.join(',')}` : '';
    if (!this.changed('preview', key)) return;
    this.preview.hidden = !p;
    if (!p) return;
    this.previewLabel.textContent = p.label;
    this.previewElites.innerHTML = p.boss
      ? '<span class="family-chip is-boss">Gloom Matriarch</span>'
      : p.elites.map((f) => `${familyChip(f)}`).join('') + '<span class="preview-note">drops a graft</span>';
  }

  setLoadout(loadout: Loadout, runes: readonly RuneId[]): void {
    if (!this.enabled) return;
    const key = `${JSON.stringify(loadout)}|${runes.join(',')}`;
    if (!this.changed('loadout', key)) return;
    const runeChips = runes.map((r) => `<span class="rune-chip" title="${RUNES[r].name}">◆ ${RUNES[r].changes}</span>`).join('');
    this.loadout.innerHTML = `<span class="loadout-golem">${golemSvg(loadoutFills(loadout))}</span>${runeChips}`;
    this.loadout.title = buildList(loadout, runes).join(' · ') || 'No grafts yet';
  }

  setCombo(combo: number, multiplier: number, fraction: number): void {
    if (!this.enabled) return;
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
    if (!this.enabled) return;
    const visible = max > 0;
    if (this.boss.hidden === visible) this.boss.hidden = !visible;
    if (!visible) return;
    this.bossFill.style.width = `${((hp / max) * 100).toFixed(2)}%`;
    this.bossTrail.style.width = `${((trail / max) * 100).toFixed(2)}%`;
  }

  setCooldown(ability: Ability, fraction: number, active: boolean): void {
    const btn = this.abilityButtons.get(ability);
    if (!btn || !this.enabled) return;
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
    if (!this.enabled) return;
    this.bannerTitle.textContent = title;
    this.bannerSub.textContent = sub;
    this.banner.classList.toggle('is-boss', boss);
    this.banner.classList.add('is-visible');
    window.clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => this.banner.classList.remove('is-visible'), ms);
  }

  hurt(strength: number): void {
    if (!this.enabled) return;
    const el = this.hurtEl;
    el.style.transition = 'none';
    el.style.opacity = String(Math.min(1, 0.35 + strength * 0.65));
    void el.offsetWidth;
    el.style.transition = 'opacity 650ms ease-out';
    el.style.opacity = '0';
  }

  showOffer(offer: Offer, loadout: Loadout, rerolls: number, handlers: OfferHandlers): void {
    this.handlers = handlers;
    if (!this.enabled) return;
    this.offerTitle.textContent = `Elite ${FAMILY_LABEL[offer.family]} relic`;
    this.offerTitle.style.setProperty('--family', hex(FAMILY_COLOR[offer.family]));
    this.offerSub.textContent = offer.rerolled ? 'Rerolled. Graft a part, or take a rune' : 'Graft a part, or take a rune';
    this.offerOptions.replaceChildren(
      ...offer.options.map((o, i) => {
        const card = offerCard(o, i, loadout);
        card.addEventListener('click', () => this.handlers?.pick(i));
        return card;
      }),
    );
    this.offerReroll.disabled = rerolls <= 0;
    this.offerRerolls.textContent = `(${rerolls})`;
    this.offer.hidden = false;
    this.offerOptions.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
  }

  hideOffer(): void {
    this.handlers = null;
    this.offer.hidden = true;
  }

  showPause(visible: boolean, seed: number): void {
    this.paused.hidden = !visible;
    this.pausedSeed.textContent = `Seed ${seed}`;
    if (visible) this.resume.focus({ preventScroll: true });
  }

  showGameOver(s: RunSummary): void {
    if (!this.enabled) return;
    this.gameOverCause.textContent = s.cause ?? '';
    this.gameOverStats.textContent = `Wave ${s.wave} / ${s.waves} · ${s.kills} kills · ${fmt.format(s.score)} pts · ${formatTime(s.time)} · seed ${s.seed}`;
    this.gameOverBest.textContent = s.newBest ? 'NEW BEST' : `Best ${fmt.format(s.best)}`;
    this.gameOverEl.hidden = false;
    this.retry.focus({ preventScroll: true });
  }

  showVictory(s: RunSummary): void {
    if (!this.enabled) return;
    this.victoryStats.textContent = `${s.kills} kills · ${fmt.format(s.score)} pts · ${formatTime(s.time)} · seed ${s.seed}`;
    const build = buildList(s.loadout, s.runes);
    this.victoryBuild.innerHTML = `<span class="loadout-golem">${golemSvg(loadoutFills(s.loadout))}</span>`;
    const list = document.createElement('p');
    list.textContent = build.length > 0 ? build.join(' · ') : 'Won bare: no grafts, no runes';
    this.victoryBuild.append(list);
    this.victoryBest.textContent = s.newBest ? 'NEW BEST' : `Best ${fmt.format(s.best)}`;
    this.victoryEl.hidden = false;
    this.victoryNew.focus({ preventScroll: true });
  }

  hideEndScreens(): void {
    this.gameOverEl.hidden = true;
    this.victoryEl.hidden = true;
  }

  /** The open menu, if any (gamepad and arrow-key navigation act on its buttons). */
  openModal(): HTMLElement | null {
    return document.querySelector<HTMLElement>('.modal:not([hidden])');
  }

  /** Moves focus to the next or previous enabled button of the open menu. */
  moveFocus(step: 1 | -1): void {
    const modal = this.openModal();
    if (!modal) return;
    const buttons = [...modal.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    if (buttons.length === 0) return;
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = at < 0 ? 0 : (at + step + buttons.length) % buttons.length;
    buttons[next]!.focus({ preventScroll: true });
  }

  /** Clicks the focused button of the open menu. */
  activateFocused(): boolean {
    const modal = this.openModal();
    const active = document.activeElement;
    if (!modal || !(active instanceof HTMLButtonElement) || !modal.contains(active) || active.disabled) return false;
    active.click();
    return true;
  }

  updateBars(list: readonly EnemyBar[]): void {
    if (!this.enabled) return;
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

  /** Counter-hit damage; the only damage numbers in the game. */
  critNumber(x: number, y: number, amount: number): void {
    if (!this.enabled) return;
    const el = document.createElement('span');
    el.className = 'dmg is-crit';
    el.textContent = `${Math.round(amount)}!`;
    this.overlay.append(el);
    const drift = (Math.random() - 0.5) * 30;
    const anim = el.animate(
      [
        { transform: `translate(${x}px, ${y}px) translate(-50%, -50%) scale(0.5)`, opacity: 0 },
        { transform: `translate(${x}px, ${y - 16}px) translate(-50%, -50%) scale(1.3)`, opacity: 1, offset: 0.15 },
        { transform: `translate(${x + drift}px, ${y - 52}px) translate(-50%, -50%) scale(1)`, opacity: 0 },
      ],
      { duration: 900, easing: 'cubic-bezier(.2,.7,.3,1)' },
    );
    anim.onfinish = () => el.remove();
  }

  private changed(key: string, value: string): boolean {
    if (this.cache.get(key) === value) return false;
    this.cache.set(key, value);
    return true;
  }
}
