import type { Candle, Direction, Signal, StrategyId } from '../shared/types.js';
import { atrPine, hma, utTrailingStop } from './indicators.js';
import { reversalSignals, type ReversalParams } from './reversal.js';

export interface IndicatorParams extends ReversalParams {
  HULL_LEN: number;
  UT_KEY: number;
  UT_ATR: number;
  WARMUP: number;
  /** Mix B: sigHullEntry adds agreeing reversal signals. Omitted/false = sigHullEntry is sigHull. */
  REV_REENTRY?: boolean;
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
  /** Reversal threshold, zigzag state and signals (src/core/reversal.ts). */
  revThreshold: number[];
  revDir: Array<1 | -1 | 0>;
  sigRev: Signal[];
  /** Hull's entry signals: sigHull, plus (when REV_REENTRY) reversal signals that agree with Hull's direction. */
  sigHullEntry: Signal[];
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

/**
 * Mix B (design_draft.md): a Hull flip when there is one (it wins a same-bar tie); otherwise a reversal signal only
 * if its side matches Hull's direction (hullUp, valid as in direction('hull')); otherwise NONE.
 */
export function hullWithRevReentry(sigHull: readonly Signal[], sigRev: readonly Signal[], hull: readonly number[], hullUp: readonly boolean[]): Signal[] {
  return sigHull.map((s, t) => {
    if (s !== 'NONE') return s;
    const r = sigRev[t];
    if (r === 'NONE' || t < 2 || !valid(hull[t], hull[t - 2])) return 'NONE';
    return (r === 'LONG') === hullUp[t] ? r : 'NONE';
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
  const rev = reversalSignals(candles, atrPine(candles, p.REV_ATR_LEN), p);
  const sigRev = rev.signals.map((s, t) => (t < p.WARMUP ? 'NONE' : s));
  const sigHullEntry = p.REV_REENTRY ? hullWithRevReentry(sigHull, sigRev, hull, hullUp) : sigHull;
  return { close, hull, hullUp, atr, utStop, utUp, sigHull, sigUt, revThreshold: rev.threshold, revDir: rev.trendDir, sigRev, sigHullEntry };
}

/** Current direction state of a strategy at bar t; null when any input is NaN (or reversal has not started). */
export function direction(strategy: StrategyId, out: IndicatorOutput, t: number): Direction {
  if (t < 0 || t >= out.close.length) return null;
  switch (strategy) {
    case 'hull':
      if (t < 2 || !valid(out.hull[t], out.hull[t - 2])) return null;
      return out.hullUp[t] ? 'up' : 'down';
    case 'ut':
      if (!valid(out.close[t], out.utStop[t])) return null;
      return out.utUp[t] ? 'up' : 'down';
    case 'reversal':
      return out.revDir[t] === 1 ? 'up' : out.revDir[t] === -1 ? 'down' : null;
    case 'revaa':
      // No direction state: revaa exits only on an opposite AlgoAlpha break (decideRevAA), never on a missed flip.
      return null;
    default:
      return assertNever(strategy);
  }
}

export function signalsFor(strategy: StrategyId, out: IndicatorOutput): Signal[] {
  switch (strategy) {
    case 'hull':
      return out.sigHullEntry;
    case 'ut':
      return out.sigUt;
    case 'reversal':
    case 'revaa':
      return out.sigRev;
    default:
      return assertNever(strategy);
  }
}

function assertNever(x: never): never {
  throw new Error(`unknown strategy ${String(x)}`);
}
