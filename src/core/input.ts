import type { Ability } from '../combat/attacks';
import type { MoveIntent } from '../entities/hero/motion';

export type InputAction = Ability | 'mute' | 'restart' | 'pause' | 'stats' | 'pick1' | 'pick2' | 'pick3';

const UP = ['KeyW', 'ArrowUp'];
const DOWN = ['KeyS', 'ArrowDown'];
const LEFT = ['KeyA', 'ArrowLeft'];
const RIGHT = ['KeyD', 'ArrowRight'];
const RUN = ['ShiftLeft', 'ShiftRight'];
const CAPTURED = new Set([...UP, ...DOWN, ...LEFT, ...RIGHT, 'Space', 'F3']);

const KEY_ACTIONS: Record<string, InputAction> = {
  Space: 'attack',
  KeyJ: 'attack',
  KeyK: 'beam',
  KeyL: 'spin',
  KeyE: 'spin',
  KeyR: 'quake',
  KeyM: 'mute',
  Enter: 'restart',
  Escape: 'pause',
  KeyP: 'pause',
  F3: 'stats',
  Backquote: 'stats',
  Digit1: 'pick1',
  Digit2: 'pick2',
  Digit3: 'pick3',
};

const any = (keys: ReadonlySet<string>, codes: readonly string[]): boolean => codes.some((c) => keys.has(c));

/** Digital keys to a unit-length screen vector, so diagonals are not faster. */
export const keysToVector = (keys: ReadonlySet<string>): { x: number; y: number } => {
  const x = (any(keys, RIGHT) ? 1 : 0) - (any(keys, LEFT) ? 1 : 0);
  const y = (any(keys, UP) ? 1 : 0) - (any(keys, DOWN) ? 1 : 0);
  const len = Math.hypot(x, y);
  return len > 0 ? { x: x / len, y: y / len } : { x: 0, y: 0 };
};

export const JOY_RADIUS = 56;
const JOY_DEADZONE = 0.12;
const JOY_RUN = 0.9;
/** Mouse aim stays authoritative this long after the cursor last moved. */
const MOUSE_AIM_WINDOW = 2500;

/** Joystick drag in CSS pixels to an intent; pushing to the rim runs. */
export const joystickToIntent = (dx: number, dy: number): MoveIntent => {
  const len = Math.hypot(dx, dy);
  const mag = Math.min(1, len / JOY_RADIUS);
  if (mag < JOY_DEADZONE || len === 0) return { x: 0, y: 0, run: false };
  const scaled = (mag - JOY_DEADZONE) / (1 - JOY_DEADZONE);
  return { x: (dx / len) * scaled, y: (-dy / len) * scaled, run: mag >= JOY_RUN };
};

export class Input {
  override: MoveIntent | null = null;
  onAction?: (action: InputAction, fromMouse: boolean) => void;
  onZoom?: (deltaY: number) => void;
  onFirstGesture?: () => void;

  /** Last mouse position in CSS pixels, for cursor aiming. */
  readonly mouse = { x: 0, y: 0, at: -Infinity };

  private readonly keys = new Set<string>();
  private joyId = -1;
  private joyOrigin = { x: 0, y: 0 };
  private joyDelta = { x: 0, y: 0 };
  private gestured = false;

  constructor(
    surface: HTMLElement,
    private readonly joyBase: HTMLElement,
    private readonly joyKnob: HTMLElement,
  ) {
    window.addEventListener('keydown', (e) => {
      this.gesture();
      if (CAPTURED.has(e.code)) e.preventDefault();
      this.keys.add(e.code);
      if (e.repeat && e.code !== 'Space' && e.code !== 'KeyJ') return;
      const action = KEY_ACTIONS[e.code];
      if (action) this.onAction?.(action, false);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    surface.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.onZoom?.(e.deltaY);
      },
      { passive: false },
    );
    surface.addEventListener('contextmenu', (e) => e.preventDefault());

    surface.addEventListener('pointerdown', (e) => {
      this.gesture();
      if (e.pointerType === 'mouse') {
        this.trackMouse(e);
        if (e.button === 0) this.onAction?.('attack', true);
        if (e.button === 2) this.onAction?.('beam', true);
        return;
      }
      if (this.joyId !== -1) return;
      this.joyId = e.pointerId;
      this.joyOrigin = { x: e.clientX, y: e.clientY };
      this.joyDelta = { x: 0, y: 0 };
      this.joyBase.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
      this.joyBase.classList.add('is-active');
      this.placeKnob();
    });
    surface.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse') {
        this.trackMouse(e);
        return;
      }
      if (e.pointerId !== this.joyId) return;
      const dx = e.clientX - this.joyOrigin.x;
      const dy = e.clientY - this.joyOrigin.y;
      const len = Math.hypot(dx, dy);
      const k = len > JOY_RADIUS ? JOY_RADIUS / len : 1;
      this.joyDelta = { x: dx * k, y: dy * k };
      this.placeKnob();
    });
    const release = (e: PointerEvent) => {
      if (e.pointerId !== this.joyId) return;
      this.joyId = -1;
      this.joyDelta = { x: 0, y: 0 };
      this.joyBase.classList.remove('is-active');
    };
    surface.addEventListener('pointerup', release);
    surface.addEventListener('pointercancel', release);
  }

  get mouseAiming(): boolean {
    return performance.now() - this.mouse.at < MOUSE_AIM_WINDOW;
  }

  read(): MoveIntent {
    if (this.override) return this.override;
    if (this.joyId !== -1) return joystickToIntent(this.joyDelta.x, this.joyDelta.y);
    const v = keysToVector(this.keys);
    return { x: v.x, y: v.y, run: any(this.keys, RUN) };
  }

  private trackMouse(e: PointerEvent): void {
    this.mouse.x = e.clientX;
    this.mouse.y = e.clientY;
    this.mouse.at = performance.now();
  }

  private placeKnob(): void {
    this.joyKnob.style.transform = `translate(${this.joyDelta.x}px, ${this.joyDelta.y}px)`;
  }

  private gesture(): void {
    if (this.gestured) return;
    this.gestured = true;
    this.onFirstGesture?.();
  }
}
