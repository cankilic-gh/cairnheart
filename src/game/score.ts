export const COMBO_WINDOW = 3;

/** Score with a kill-chain multiplier: +0.5x every 5 kills in a row, up to 3x. */
export class ScoreKeeper {
  score = 0;
  combo = 0;
  private comboTimer = 0;

  get multiplier(): number {
    return 1 + Math.min(2, Math.floor(this.combo / 5) * 0.5);
  }

  /** Time left before the combo breaks, 0..1. */
  get comboFraction(): number {
    return this.combo > 0 ? this.comboTimer / COMBO_WINDOW : 0;
  }

  kill(points: number): number {
    this.combo += 1;
    this.comboTimer = COMBO_WINDOW;
    const gained = Math.round(points * this.multiplier);
    this.score += gained;
    return gained;
  }

  waveBonus(wave: number): number {
    const gained = wave * 100;
    this.score += gained;
    return gained;
  }

  update(dt: number): void {
    if (this.comboTimer <= 0) return;
    this.comboTimer -= dt;
    if (this.comboTimer <= 0) {
      this.comboTimer = 0;
      this.combo = 0;
    }
  }

  reset(): void {
    this.score = 0;
    this.combo = 0;
    this.comboTimer = 0;
  }
}
