import type { Candle, Direction, Signal, StrategyId } from '../shared/types.js';
import { atrPine, hma, utTrailingStop } from './indicators.js';

export interface IndicatorParams {
  HULL_LEN: number;
  UT_KEY: number;
  UT_ATR: number;
  WARMUP: number;
}

export interface IndicatorOutput {
  close: number[];
  hull: number[];
  /** hullUp[t] = HULL[t] > HULL[t−2] (false when either is NaN, as in Pine). */
  hullUp: boolean[];
  atr: number[];
  utStop: number[];
  /** utUp[t] = close[t] > utStop[t]. */
  utUp: boolean[];
  sigHull: Signal[];
  sigUt: Signal[];
}

const valid = (...xs: number[]) => xs.every((x) => !Number.isNaN(x));

/**
 * Hull flip signals. LONG when HULL crosses above HULL[t−2] (hullUp[t] and not hullUp[t−1]),
 * SHORT on the reverse. All four values must be valid, matching Pine's crossover() on na.
 * A flat Hull (HULL[t] == HULL[t−2]) counts as "not up".
 */
export function hullSignals(hull: readonly number[]): Signal[] {
  return hull.map((h, t) => {
    if (t < 3 || !valid(h, hull[t - 1], hull[t - 2], hull[t - 3])) return 'NONE';
    const up = h > hull[t - 2];
    const upPrev = hull[t - 1] > hull[t - 3];
    if (up && !upPrev) return 'LONG';
    if (!up && upPrev) return 'SHORT';
    return 'NONE';
  });
}

/** UT signals: crossover / crossunder of close against the trailing stop. False if any value is NaN. */
export function utSignals(close: readonly number[], stop: readonly number[]): Signal[] {
  return close.map((src, t) => {
    if (t < 1 || !valid(src, close[t - 1], stop[t], stop[t - 1])) return 'NONE';
    if (src > stop[t] && close[t - 1] <= stop[t - 1]) return 'LONG';
    if (src < stop[t] && close[t - 1] >= stop[t - 1]) return 'SHORT';
    return 'NONE';
  });
}

/** Computes every indicator over the window, from scratch. Signals are forced to NONE before WARMUP. */
export function computeAll(candles: readonly Candle[], p: IndicatorParams): IndicatorOutput {
  const close = candles.map((c) => c.close);
  const hull = hma(close, p.HULL_LEN);
  const hullUp = hull.map((h, t) => t >= 2 && h > hull[t - 2]);
  const atr = atrPine(candles, p.UT_ATR);
  const utStop = utTrailingStop(close, atr, p.UT_KEY);
  const utUp = close.map((c, t) => c > utStop[t]);
  const sigHull = hullSignals(hull).map((s, t) => (t < p.WARMUP ? 'NONE' : s));
  const sigUt = utSignals(close, utStop).map((s, t) => (t < p.WARMUP ? 'NONE' : s));
  return { close, hull, hullUp, atr, utStop, utUp, sigHull, sigUt };
}

/** Current direction state of a strategy at bar t; null when any input is NaN. */
export function direction(strategy: StrategyId, out: IndicatorOutput, t: number): Direction {
  if (t < 0 || t >= out.close.length) return null;
  if (strategy === 'hull') {
    if (t < 2 || !valid(out.hull[t], out.hull[t - 2])) return null;
    return out.hullUp[t] ? 'up' : 'down';
  }
  if (!valid(out.close[t], out.utStop[t])) return null;
  return out.utUp[t] ? 'up' : 'down';
}

export function signalsFor(strategy: StrategyId, out: IndicatorOutput): Signal[] {
  return strategy === 'hull' ? out.sigHull : out.sigUt;
}
