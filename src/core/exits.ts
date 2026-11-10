// Strategy v2 stop rules (design Amendment A.2). Pure. R = the initial stop distance in $.
// Stages: 0 = initial stop (loss side of entry), 1 = break-even, 2 = trailing.

import type { Side, Stage } from '../shared/types.js';
import { roundTick } from './ratchet.js';

export interface ExitParams {
  SL_ATR_MULT: number;
  SL_MIN: number;
  SL_MAX: number;
  BE_TRIG_R: number;
  TRAIL_TRIG_R: number;
  TRAIL_ATR_MULT: number;
  TP_R: number;
  FEE_RATE: number;
  SLIPPAGE_TICKS: number;
  TICK: number;
}

/** R = max(SL_MIN, SL_ATR_MULT × atr); null when above SL_MAX or atr is not finite (entry is skipped). */
export function riskDistance(atr: number, p: ExitParams): number | null {
  if (!Number.isFinite(atr)) return null;
  const d = Math.max(p.SL_MIN, p.SL_ATR_MULT * atr);
  return d <= p.SL_MAX ? d : null;
}

/** Initial stop entry ∓ R (rounded toward profit); TP entry ± TP_R × R (nearest tick), or null when TP_R = 0. */
export function initialStops(side: Side, entry: number, R: number, p: ExitParams): { sl: number; tp: number | null } {
  const long = side === 'buy';
  const sl = long ? roundTick(entry - R, 'up', p.TICK) : roundTick(entry + R, 'down', p.TICK);
  const tp = p.TP_R > 0 ? roundTick(long ? entry + p.TP_R * R : entry - p.TP_R * R, 'nearest', p.TICK) : null;
  return { sl, tp };
}

/** Round-trip cost per ETH: both fees plus one tick of slippage each way. The break-even stop locks this. */
export function feeLock(entry: number, p: ExitParams): number {
  return entry * 2 * p.FEE_RATE + 2 * p.SLIPPAGE_TICKS * p.TICK;
}

/** Stage from the stop alone (used when adopting a position): 0 on the loss side of entry, else 1. */
export function stageOf(side: Side, entry: number, sl: number): Stage {
  return (side === 'buy' ? sl < entry : sl > entry) ? 0 : 1;
}

export interface BarState {
  close: number;
  /** ATR(ATR_LEN) at this close. */
  atr: number;
  /** Highest high / lowest low since entry, including the entry bar and this bar. */
  hh: number;
  ll: number;
}

/**
 * Next stop on a candle close. Candidate = the tighter of break-even (profit ≥ BE_TRIG_R × R) and the
 * trailing stop (profit ≥ TRAIL_TRIG_R × R: hh − TRAIL_ATR_MULT × atr, or ll + … for shorts). Rounded toward
 * profit; applied only if it is at least one tick tighter than the current stop and still on the right side
 * of the close. Never loosens.
 */
export function nextStop(
  side: Side,
  entry: number,
  R: number,
  currentSl: number,
  stage: Stage,
  m: BarState,
  p: ExitParams,
): { sl: number; stage: Stage; changed: boolean } {
  const long = side === 'buy';
  const profit = long ? m.close - entry : entry - m.close;
  const round = (x: number) => roundTick(x, long ? 'up' : 'down', p.TICK);
  // A candidate is usable only if, after rounding, it is still strictly on the protective side of the close.
  const usable = (x: number) => Number.isFinite(x) && (long ? round(x) < m.close : round(x) > m.close);
  const cands: Array<{ price: number; stage: Stage }> = [];
  if (p.BE_TRIG_R > 0 && profit >= p.BE_TRIG_R * R) {
    const lock = feeLock(entry, p);
    cands.push({ price: long ? entry + lock : entry - lock, stage: 1 });
  }
  if (p.TRAIL_ATR_MULT > 0 && profit >= p.TRAIL_TRIG_R * R && Number.isFinite(m.atr)) {
    cands.push({ price: long ? m.hh - p.TRAIL_ATR_MULT * m.atr : m.ll + p.TRAIL_ATR_MULT * m.atr, stage: 2 });
  }
  // The tightest usable candidate; a trailing level beyond the close falls back to break-even.
  let best: { price: number; stage: Stage } | null = null;
  for (const c of cands) {
    if (!usable(c.price)) continue;
    if (!best || (long ? round(c.price) >= round(best.price) : round(c.price) <= round(best.price))) best = c; // ties → trail
  }
  if (!best) return { sl: currentSl, stage, changed: false };
  const r = round(best.price);
  const tighter = long ? r > currentSl + 1e-9 : r < currentSl - 1e-9;
  if (!tighter) return { sl: currentSl, stage, changed: false };
  const nextStage = Math.max(stage, best.stage) as Stage;
  return { sl: r, stage: nextStage, changed: true };
}
