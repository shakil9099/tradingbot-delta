// The per-candle action table ("What happens on each candle close", step 7).

import type { Action, Direction, HaltKind, Side, Signal } from '../shared/types.js';

export interface DecideInput {
  halted: boolean;
  haltKind: HaltKind | null;
  position: { side: Side } | null;
  /** Signal of the active strategy on the newest closed bar. */
  activeSignal: Signal;
  /** Direction state of the active strategy on the newest closed bar (null = unknown). */
  activeDirection: Direction;
}

export interface Decision {
  action: Action;
  /** Side to open for ENTER and REVERSE. */
  side?: Side;
  reason: string;
}

const signalSide = (s: Signal): Side | null => (s === 'LONG' ? 'buy' : s === 'SHORT' ? 'sell' : null);
const opposite = (s: Side): Side => (s === 'buy' ? 'sell' : 'buy');

/** Halt kinds that keep protecting an open position (trail, and close on an opposite signal). */
const PROTECTING_KINDS: ReadonlySet<HaltKind> = new Set<HaltKind>(['breaker', 'manual', 'crash_loop']);

export function decide(input: DecideInput): Decision {
  const { halted, haltKind, position, activeSignal, activeDirection } = input;
  const sigSide = signalSide(activeSignal);

  if (!position) {
    if (halted) return { action: 'NONE', reason: 'halted' };
    if (sigSide) return { action: 'ENTER', side: sigSide, reason: 'signal' };
    return { action: 'NONE', reason: 'no signal' };
  }

  // "Opposite" = an opposite signal on this bar, or a missed flip (direction state disagrees).
  const oppSignal = sigSide !== null && sigSide !== position.side;
  const dirSide: Side | null = activeDirection === 'up' ? 'buy' : activeDirection === 'down' ? 'sell' : null;
  const missedFlip = !oppSignal && dirSide !== null && dirSide !== position.side;
  const isOpposite = oppSignal || missedFlip;
  const why = oppSignal ? 'signal' : 'missed_flip';

  if (!halted) {
    if (isOpposite) return { action: 'REVERSE', side: opposite(position.side), reason: why };
    return { action: 'TRAIL', reason: 'in position' };
  }

  if (haltKind && PROTECTING_KINDS.has(haltKind)) {
    if (isOpposite) return { action: 'CLOSE', reason: `halted (${haltKind}); ${why}` };
    return { action: 'TRAIL', reason: `halted (${haltKind})` };
  }
  // mismatch, fatal_error (and liquidation, which should only occur flat): leave the bracket alone.
  return { action: 'NONE', reason: `halted (${haltKind ?? 'unknown'}); author decides` };
}
