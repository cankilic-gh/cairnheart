import type { Ability } from '../combat/attacks';
import type { MoveIntent } from '../entities/hero/motion';

/**
 * Device-independent actions. The game decides what an action means in context: `confirm` (pad A)
 * attacks in play and presses the focused button in menus, `back` (pad B) spins in play and leaves
 * an offer or the pause menu, `beam` (pad Y) rerolls inside an offer.
 */
export type InputAction =
  | Ability
  | 'mute'
  | 'pause'
  | 'stats'
  | 'pick1'
  | 'pick2'
  | 'pick3'
  | 'reroll'
  | 'skip'
  | 'confirm'
  | 'back'
  | 'newRun'
  | 'navPrev'
  | 'navNext';

export type InputDevice = 'keyboard' | 'mouse' | 'touch' | 'gamepad';

export interface ActionSource {
  device: InputDevice;
  /** The action came from a mouse button, so it aims at the cursor. */
  cursor: boolean;
}

const UP = ['KeyW', 'ArrowUp'];
const DOWN = ['KeyS', 'ArrowDown'];
const LEFT = ['KeyA', 'ArrowLeft'];
const RIGHT = ['KeyD', 'ArrowRight'];
const RUN = ['ShiftLeft', 'ShiftRight'];
const CAPTURED = new Set([...UP, ...DOWN, ...LEFT, ...RIGHT, 'Space', 'F3']);
const REPEATING = new Set(['Space', 'KeyJ']);

export const KEY_BINDINGS: Readonly<Record<string, InputAction>> = {
  Space: 'attack',
  KeyJ: 'attack',
  KeyK: 'beam',
  KeyL: 'spin',
  KeyE: 'spin',
  KeyR: 'quake',
  KeyM: 'mute',
  Enter: 'confirm',
  Escape: 'pause',
  KeyP: 'pause',
  F3: 'stats',
  Backquote: 'stats',
  Digit1: 'pick1',
  Digit2: 'pick2',
  Digit3: 'pick3',
  KeyF: 'reroll',
  KeyX: 'skip',
  KeyN: 'newRun',
  ArrowLeft: 'navPrev',
  ArrowUp: 'navPrev',
  ArrowRight: 'navNext',
  ArrowDown: 'navNext',
};

/** Button indices of the W3C standard gamepad mapping (Xbox and PlayStation pads alike). */
export const PAD = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, VIEW: 8, MENU: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 } as const;

export const PAD_BINDINGS: ReadonlyArray<readonly [number, InputAction]> = [
  [PAD.A, 'confirm'],
  [PAD.B, 'back'],
  [PAD.X, 'attack'],
  [PAD.Y, 'beam'],
  [PAD.LB, 'spin'],
  [PAD.RB, 'quake'],
  [PAD.RT, 'beam'],
  [PAD.MENU, 'pause'],
  [PAD.VIEW, 'stats'],
  [PAD.UP, 'navPrev'],
  [PAD.LEFT, 'navPrev'],
  [PAD.DOWN, 'navNext'],
  [PAD.RIGHT, 'navNext'],
];

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

export const STICK_DEADZONE = 0.2;
const STICK_RUN = 0.92;
const AIM_THRESHOLD = 0.5;
const NAV_THRESHOLD = 0.6;
const PRESS = 0.5;

/** One gamepad sample: button values 0..1 and stick axes -1..1 (y down). */
export interface PadFrame {
  buttons: readonly number[];
  axes: readonly number[];
}

export interface PadRead {
  /** Left stick as a move intent; null inside the dead zone. */
  move: MoveIntent | null;
  /** Right stick in screen space (y up); null unless pushed past the aim threshold. */
  aim: { x: number; y: number } | null;
  /** Actions whose button went down since `prev`. */
  pressed: InputAction[];
  /** Anything at all is being touched. */
  active: boolean;
}

const stick = (x: number, y: number, deadzone: number): { x: number; y: number; mag: number } | null => {
  const mag = Math.min(1, Math.hypot(x, y));
  if (mag < deadzone) return null;
  const k = (mag - deadzone) / (1 - deadzone) / (Math.hypot(x, y) || 1);
  return { x: x * k, y: -y * k, mag };
};

/** Pure read of a gamepad frame against the previous one. */
export const readPad = (now: PadFrame, prev: PadFrame | null): PadRead => {
  const b = (f: PadFrame | null, i: number) => (f?.buttons[i] ?? 0) >= PRESS;
  const pressed: InputAction[] = [];
  for (const [i, action] of PAD_BINDINGS) if (b(now, i) && !b(prev, i)) pressed.push(action);

  const lx = now.axes[0] ?? 0;
  const ly = now.axes[1] ?? 0;
  const left = stick(lx, ly, STICK_DEADZONE);
  const run = (now.buttons[PAD.LT] ?? 0) > 0.3;
  const move = left ? { x: left.x, y: left.y, run: run || left.mag >= STICK_RUN } : null;

  // The stick also steps through menus, once per push.
  const navNow = Math.abs(lx) >= Math.abs(ly) ? lx : ly;
  const navPrev = prev ? (Math.abs(prev.axes[0] ?? 0) >= Math.abs(prev.axes[1] ?? 0) ? (prev.axes[0] ?? 0) : (prev.axes[1] ?? 0)) : 0;
  if (Math.abs(navNow) >= NAV_THRESHOLD && Math.abs(navPrev) < NAV_THRESHOLD) pressed.push(navNow < 0 ? 'navPrev' : 'navNext');

  const right = stick(now.axes[2] ?? 0, now.axes[3] ?? 0, AIM_THRESHOLD);
  const aim = right ? { x: right.x, y: right.y } : null;
  const active = !!left || !!right || now.buttons.some((v) => v >= PRESS);
  return { move, aim, pressed, active };
};

const snapshot = (gp: Gamepad): PadFrame => ({ buttons: gp.buttons.map((x) => x.value), axes: [...gp.axes] });

/** Keyboard + mouse, touch joystick and gamepads, all turned into the same actions and move intent. */
export class Input {
  override: MoveIntent | null = null;
  onAction?: (action: InputAction, source: ActionSource) => void;
  onZoom?: (deltaY: number) => void;
  onFirstGesture?: () => void;
  onDevice?: (device: InputDevice) => void;
  /** Every raw input, for "first input" bookkeeping. */
  onInput?: (device: InputDevice) => void;

  /** Last mouse position in CSS pixels, for cursor aiming. */
  readonly mouse = { x: 0, y: 0, at: -Infinity };
  device: InputDevice = 'keyboard';

  private readonly keys = new Set<string>();
  private joyId = -1;
  private joyOrigin = { x: 0, y: 0 };
  private joyDelta = { x: 0, y: 0 };
  private gestured = false;
  private padPrev: PadFrame | null = null;
  private padIndex = -1;
  private padMove: MoveIntent | null = null;
  private padAimVec: { x: number; y: number } | null = null;

  constructor(
    surface: HTMLElement,
    private readonly joyBase: HTMLElement,
    private readonly joyKnob: HTMLElement,
  ) {
    window.addEventListener('keydown', (e) => {
      this.gesture();
      this.use('keyboard');
      if (CAPTURED.has(e.code)) e.preventDefault();
      this.keys.add(e.code);
      if (e.repeat && !REPEATING.has(e.code)) return;
      // A focused menu button already answers Enter and Space with a native click.
      if ((e.code === 'Enter' || e.code === 'Space') && document.activeElement instanceof HTMLButtonElement) return;
      const action = KEY_BINDINGS[e.code];
      if (action) this.onAction?.(action, { device: 'keyboard', cursor: false });
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('gamepadconnected', (e) => {
      if (this.padIndex < 0) this.padIndex = e.gamepad.index;
    });
    window.addEventListener('gamepaddisconnected', (e) => {
      if (e.gamepad.index !== this.padIndex) return;
      this.padIndex = -1;
      this.padPrev = null;
      this.padMove = null;
      this.padAimVec = null;
    });

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
        this.use('mouse');
        this.trackMouse(e);
        if (e.button === 0) this.onAction?.('attack', { device: 'mouse', cursor: true });
        if (e.button === 2) this.onAction?.('beam', { device: 'mouse', cursor: true });
        return;
      }
      this.use('touch');
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
    return this.device !== 'gamepad' && this.device !== 'touch' && performance.now() - this.mouse.at < MOUSE_AIM_WINDOW;
  }

  /** Right-stick aim in screen space (y up), while it is pushed. */
  get padAim(): { x: number; y: number } | null {
    return this.padAimVec;
  }

  /** Reports a press from an on-screen button (touch ability buttons, menus). */
  tap(action: InputAction, device: InputDevice): void {
    this.gesture();
    this.use(device);
    this.onAction?.(action, { device, cursor: false });
  }

  /** Samples the gamepad; call once per frame, also while paused so menus can be driven. */
  poll(): void {
    if (typeof navigator.getGamepads !== 'function') return;
    const pads = navigator.getGamepads();
    let gp = this.padIndex >= 0 ? pads[this.padIndex] : null;
    if (!gp) {
      gp = pads.find((p): p is Gamepad => !!p && p.connected) ?? null;
      this.padIndex = gp ? gp.index : -1;
    }
    if (!gp) return;
    const frame = snapshot(gp);
    const read = readPad(frame, this.padPrev);
    this.padPrev = frame;
    this.padMove = read.move;
    this.padAimVec = read.aim;
    if (read.active) {
      this.gesture();
      this.use('gamepad');
    }
    for (const action of read.pressed) this.onAction?.(action, { device: 'gamepad', cursor: false });
  }

  read(): MoveIntent {
    if (this.override) return this.override;
    if (this.joyId !== -1) return joystickToIntent(this.joyDelta.x, this.joyDelta.y);
    if (this.padMove) return this.padMove;
    const v = keysToVector(this.keys);
    return { x: v.x, y: v.y, run: any(this.keys, RUN) };
  }

  /** Short controller rumble for heavy impacts; silently does nothing without a capable pad. */
  rumble(strong: number, weak: number, ms: number): void {
    if (this.device !== 'gamepad' || this.padIndex < 0) return;
    const gp = navigator.getGamepads()[this.padIndex] as (Gamepad & { vibrationActuator?: { playEffect?: (t: string, p: object) => Promise<unknown> } }) | null;
    gp?.vibrationActuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak })?.catch(() => undefined);
  }

  private use(device: InputDevice): void {
    this.onInput?.(device);
    if (this.device === device) return;
    this.device = device;
    this.onDevice?.(device);
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
