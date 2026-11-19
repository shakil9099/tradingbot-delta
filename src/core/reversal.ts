// "Reversal Detection v3.0 Clone" (pine/reversal.pine), signal logic only. Pure.
// Medium preset: threshold = max(ATR(14) × 2.0, close × 0.1%). The script's EMAs only colour candles and are not used.

import type { Candle, Signal } from '../shared/types.js';

export interface ReversalParams {
  REV_ATR_LEN: number;
  REV_ATR_MULT: number;
  /** Minimum move as a fraction of close (0.001 = 0.1%). */
  REV_MIN_PCT: number;
}

export interface ReversalOutput {
  /** max(ATR × mult, close × minPct); NaN while ATR is warming up. */
  threshold: number[];
  /** Zigzag state after each bar: 1 up, −1 down, 0 not yet started. */
  trendDir: Array<1 | -1 | 0>;
  /** BUY = LONG, SELL = SHORT, on the bar whose close confirms the reversal. */
  signals: Signal[];
}

/**
 * Runs the Pine zigzag over the candles from bar 0. Order per bar, as in Pine: extend the leg extremes,
 * then branch on trend_dir; a flip resets the opposite extreme to this bar. The first leg (0 → ±1) gives
 * no signal. A NaN threshold compares false, so no state changes while ATR is warming up.
 */
export function reversalSignals(candles: readonly Candle[], atr: readonly number[], p: ReversalParams): ReversalOutput {
  const n = candles.length;
  const threshold = new Array<number>(n).fill(NaN);
  const trendDir = new Array<1 | -1 | 0>(n).fill(0);
  const signals = new Array<Signal>(n).fill('NONE');
  if (n === 0) return { threshold, trendDir, signals };

  let dir: 1 | -1 | 0 = 0;
  let lastPivot = candles[0].close;
  let legHigh = candles[0].high;
  let legLow = candles[0].low;

  for (let t = 0; t < n; t++) {
    const { high, low, close } = candles[t];
    const a = atr[t];
    const th = Number.isFinite(a) ? Math.max(a * p.REV_ATR_MULT, close * p.REV_MIN_PCT) : NaN;
    threshold[t] = th;

    if (high > legHigh) legHigh = high;
    if (low < legLow) legLow = low;

    if (Number.isFinite(th)) {
      if (dir === 0) {
        if (close > lastPivot + th) {
          dir = 1;
          lastPivot = legLow;
        } else if (close < lastPivot - th) {
          dir = -1;
          lastPivot = legHigh;
        }
      } else if (dir === 1) {
        if (close < legHigh - th) {
          dir = -1;
          signals[t] = 'SHORT';
          lastPivot = legHigh;
          legLow = low;
        }
      } else if (close > legLow + th) {
        dir = 1;
        signals[t] = 'LONG';
        lastPivot = legLow;
        legHigh = high;
      }
    }
    trendDir[t] = dir;
  }
  return { threshold, trendDir, signals };
}
