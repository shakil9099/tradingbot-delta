// LEGACY (research only): the original $20 / +12→+2.5 / +25→+15 / trail 10 / TP 100 ladder, kept so research
// scripts can still show it as a baseline. The live bot uses src/core/exits.ts (design Amendment A).

import { roundTick } from '../../src/core/ratchet.js';
import type { Side, Stage } from '../../src/shared/types.js';

export interface RatchetParams {
  SL_DIST: number;
  TP_DIST: number;
  S1_TRIGGER: number;
  S1_LOCK: number;
  S2_TRIGGER: number;
  S2_LOCK: number;
  TRAIL_GAP: number;
  TICK: number;
}

const EPS = 1e-9;

/** Initial bracket: SL = entry ∓ SL_DIST (rounded toward profit), TP = entry ± TP_DIST (nearest tick). */
export function initialBracket(side: Side, entry: number, p: RatchetParams): { sl: number; tp: number } {
  if (side === 'buy') {
    return { sl: roundTick(entry - p.SL_DIST, 'up', p.TICK), tp: roundTick(entry + p.TP_DIST, 'nearest', p.TICK) };
  }
  return { sl: roundTick(entry + p.SL_DIST, 'down', p.TICK), tp: roundTick(entry - p.TP_DIST, 'nearest', p.TICK) };
}

/** Stage derived from where the SL sits relative to entry, so it survives restarts. */
export function stageOf(side: Side, entry: number, sl: number, p: RatchetParams): Stage {
  if (side === 'buy') {
    if (sl < entry + p.S1_LOCK - EPS) return 0;
    if (sl < entry + p.S2_LOCK - EPS) return 1;
    return 2;
  }
  if (sl > entry - p.S1_LOCK + EPS) return 0;
  if (sl > entry - p.S2_LOCK + EPS) return 1;
  return 2;
}

/**
 * Next stop on a candle close. `changed` is true only when the stop moves by at least one tick.
 * The stop never loosens, and the check is repeated after rounding.
 */
export function nextStop(
  side: Side,
  entry: number,
  currentSl: number,
  close: number,
  p: RatchetParams,
): { sl: number; stage: Stage; changed: boolean } {
  const profit = side === 'buy' ? close - entry : entry - close;
  let candidate: number | null = null;
  if (profit >= p.S2_TRIGGER - EPS) {
    candidate = side === 'buy' ? Math.max(entry + p.S2_LOCK, close - p.TRAIL_GAP) : Math.min(entry - p.S2_LOCK, close + p.TRAIL_GAP);
  } else if (profit >= p.S1_TRIGGER - EPS) {
    candidate = side === 'buy' ? entry + p.S1_LOCK : entry - p.S1_LOCK;
  }

  let sl = currentSl;
  if (candidate !== null) {
    const rounded = roundTick(candidate, side === 'buy' ? 'up' : 'down', p.TICK);
    sl = side === 'buy' ? Math.max(currentSl, rounded) : Math.min(currentSl, rounded);
  }
  const changed = Math.abs(sl - currentSl) >= p.TICK - EPS;
  if (!changed) sl = currentSl;
  return { sl, stage: stageOf(side, entry, sl, p), changed };
}

/** The author's original ladder values. */
export const LEGACY: RatchetParams = { SL_DIST: 20, TP_DIST: 100, S1_TRIGGER: 12, S1_LOCK: 2.5, S2_TRIGGER: 25, S2_LOCK: 15, TRAIL_GAP: 10, TICK: 0.05 };
