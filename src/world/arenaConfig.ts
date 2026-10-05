export const ARENA = {
  /** Radius of the open fighting floor, in blocks. */
  radius: 17,
  wallInner: 17.4,
  wallOuter: 20.6,
  floorHalf: 22,
  /** Max distance of the hero's centre from the arena centre. */
  playRadius: 15.8,
  /** Half-width (blocks) of the four spawn gates cut into the wall ring. */
  gateHalfWidth: 2,
} as const;

export type GateId = 'north' | 'east' | 'south' | 'west';

export const GATES: ReadonlyArray<{ id: GateId; dir: { x: number; z: number } }> = [
  { id: 'north', dir: { x: 0, z: -1 } },
  { id: 'east', dir: { x: 1, z: 0 } },
  { id: 'south', dir: { x: 0, z: 1 } },
  { id: 'west', dir: { x: -1, z: 0 } },
];

/** True when a ring cell centre falls inside one of the four gate openings. */
export const inGateGap = (cx: number, cz: number): boolean =>
  (Math.abs(cx) < ARENA.gateHalfWidth && Math.abs(cz) > 10) || (Math.abs(cz) < ARENA.gateHalfWidth && Math.abs(cx) > 10);
