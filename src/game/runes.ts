import type { AttackId } from '../combat/attacks';
import type { AttackPatch } from './grafts';

export type RuneId = 'echo' | 'undertow' | 'vortex' | 'spite';

export interface RuneDef {
  id: RuneId;
  name: string;
  /** Attack this rune rewires; null for runes that add a new trigger instead. */
  attack: AttackId | null;
  /** Short label for the attack or trigger it changes, shown on the card. */
  changes: string;
  text: string;
  patch: AttackPatch | null;
}

export const RUNES: Readonly<Record<RuneId, RuneDef>> = {
  echo: {
    id: 'echo',
    name: 'Echo Rune',
    attack: 'slam',
    changes: 'Slam',
    text: 'Slam lands twice: a second shockwave hits 2.4 m further ahead, 0.45 s later.',
    patch: { behaviors: [{ kind: 'echo', delay: 0.45, forward: 2.4 }] },
  },
  undertow: {
    id: 'undertow',
    name: 'Undertow Rune',
    attack: 'quake',
    changes: 'Quake',
    text: 'Quake drags everything in its ring to your feet instead of throwing it away.',
    patch: { behaviors: [{ kind: 'pull', to: 2.2 }] },
  },
  vortex: {
    id: 'vortex',
    name: 'Vortex Rune',
    attack: 'spin',
    changes: 'Spin',
    text: 'Spin reels in foes up to 4.6 m away on every turn, then flings them out on the last one.',
    patch: { behaviors: [{ kind: 'vortex', radius: 4.6, to: 1.8, fling: 14 }] },
  },
  spite: {
    id: 'spite',
    name: 'Spite Rune',
    attack: null,
    changes: 'When hit',
    text: 'Taking a hit makes your heart lash out: a 2.8 m burst around you, at most every 2 s.',
    patch: null,
  },
};

export const RUNE_IDS = Object.keys(RUNES) as RuneId[];

/** The Spite rune's retaliation burst. */
export const SPITE = { radius: 2.8, damage: 30, knockback: 10, stun: 0.5, cooldown: 2 } as const;
