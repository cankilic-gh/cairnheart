import { ABILITIES, ATTACKS, BUFFER_FROM, COMBO, COMBO_WINDOW, COOLDOWNS, type Ability, type AttackId, type AttackSpec } from './attacks';

export interface ActiveAction {
  id: AttackId;
  t: number;
  yaw: number;
}

export interface HitEvent {
  id: AttackId;
  yaw: number;
  hitIndex: number;
}

/** Action state machine: combo chaining, input buffering and cooldowns. Pure, no rendering. */
export class HeroCombat {
  action: ActiveAction | null = null;
  readonly cooldowns: Record<Ability, number> = { attack: 0, beam: 0, spin: 0, quake: 0 };
  /** Attack specs after grafts and runes; timing (duration, hit frames) comes from here. */
  specs: Readonly<Record<AttackId, AttackSpec>> = ATTACKS;
  onStart?: (action: ActiveAction) => void;

  private comboIndex = 0;
  private comboTimer = 0;
  private buffered: { ability: Ability; yaw: number } | null = null;

  get moveScale(): number {
    return this.action ? this.specs[this.action.id].moveScale : 1;
  }

  get progress(): number {
    return this.action ? this.action.t / this.specs[this.action.id].duration : 0;
  }

  ready(ability: Ability): boolean {
    return this.cooldowns[ability] <= 0;
  }

  cooldownFraction(ability: Ability): number {
    const cd = COOLDOWNS[ability];
    return cd > 0 ? Math.min(1, Math.max(0, this.cooldowns[ability] / cd)) : 0;
  }

  request(ability: Ability, yaw: number): boolean {
    if (!this.action) return this.start(ability, yaw);
    if (this.progress >= BUFFER_FROM && this.ready(ability)) {
      this.buffered = { ability, yaw };
      return true;
    }
    return false;
  }

  update(dt: number): HitEvent[] {
    for (const k of ABILITIES) this.cooldowns[k] = Math.max(0, this.cooldowns[k] - dt);
    this.comboTimer = Math.max(0, this.comboTimer - dt);
    const a = this.action;
    if (!a) return [];
    const spec = this.specs[a.id];
    const prev = a.t;
    a.t += dt;
    const events: HitEvent[] = [];
    spec.hits.forEach((h, i) => {
      if (prev < h && a.t >= h) events.push({ id: a.id, yaw: a.yaw, hitIndex: i });
    });
    if (a.t >= spec.duration) {
      this.action = null;
      if (spec.ability === 'attack') this.comboTimer = a.id === 'slam' ? 0 : COMBO_WINDOW;
      if (a.id === 'slam') this.comboIndex = 0;
      const next = this.buffered;
      this.buffered = null;
      if (next) this.start(next.ability, next.yaw);
    }
    return events;
  }

  /** Drops the current action and any buffered one, keeping cooldowns. */
  cancel(): void {
    this.action = null;
    this.buffered = null;
    this.comboIndex = 0;
    this.comboTimer = 0;
  }

  reset(): void {
    this.action = null;
    this.buffered = null;
    this.comboIndex = 0;
    this.comboTimer = 0;
    for (const k of ABILITIES) this.cooldowns[k] = 0;
  }

  private start(ability: Ability, yaw: number): boolean {
    if (!this.ready(ability)) return false;
    let id: AttackId;
    if (ability === 'attack') {
      if (this.comboTimer <= 0) this.comboIndex = 0;
      id = COMBO[this.comboIndex]!;
      this.comboIndex = (this.comboIndex + 1) % COMBO.length;
    } else {
      id = ability;
    }
    this.cooldowns[ability] = COOLDOWNS[ability];
    this.comboTimer = 0;
    this.action = { id, t: 0, yaw };
    this.onStart?.(this.action);
    return true;
  }
}
