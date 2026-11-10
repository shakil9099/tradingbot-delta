// Ports of the Hull and UT Bot logic from bot.pine (lines 919-1032), per the design's
// "Indicator parity specification". Pine `na` maps to NaN; any arithmetic with NaN gives NaN.
// Every output array is aligned to its input, NaN during warm-up.

import type { Candle } from '../shared/types.js';

/** WMA(src, n) = Σ src[t−i]·(n−i) / Σ (n−i), i = 0..n−1. NaN until n values exist, or if any value in the window is NaN. */
export function wma(src: readonly number[], n: number): number[] {
  const out = new Array<number>(src.length).fill(NaN);
  if (n < 1) return out;
  const denom = (n * (n + 1)) / 2;
  for (let t = n - 1; t < src.length; t++) {
    let num = 0;
    let bad = false;
    for (let i = 0; i < n; i++) {
      const v = src[t - i];
      if (Number.isNaN(v)) {
        bad = true;
        break;
      }
      num += v * (n - i);
    }
    out[t] = bad ? NaN : num / denom;
  }
  return out;
}

/** HMA(len) = WMA(2·WMA(src, floor(len/2)) − WMA(src, len), round(sqrt(len))). */
export function hma(src: readonly number[], len: number): number[] {
  const half = Math.floor(len / 2);
  const sq = Math.round(Math.sqrt(len));
  const a = wma(src, half);
  const b = wma(src, len);
  const raw = a.map((v, i) => 2 * v - b[i]);
  return wma(raw, sq);
}

/** Pine ta.tr(true): first bar is high − low; later max(h−l, |h−c[t−1]|, |l−c[t−1]|). */
export function trueRange(c: readonly Candle[]): number[] {
  return c.map((bar, t) => {
    if (t === 0) return bar.high - bar.low;
    const pc = c[t - 1].close;
    return Math.max(bar.high - bar.low, Math.abs(bar.high - pc), Math.abs(bar.low - pc));
  });
}

/** Pine ta.atr(n) = RMA(TR, n), seeded with SMA(TR[0..n−1]) at bar n−1. */
export function atrPine(c: readonly Candle[], n: number): number[] {
  const tr = trueRange(c);
  const out = new Array<number>(c.length).fill(NaN);
  if (c.length < n) return out;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += tr[i];
  out[n - 1] = sum / n;
  for (let t = n; t < c.length; t++) {
    out[t] = (out[t - 1] * (n - 1) + tr[t]) / n;
  }
  return out;
}

/**
 * UT Bot ATR trailing stop (bot.pine:927-935), src = close, nLoss = key·ATR, prev = nz(stop[t−1], 0).
 * Comparisons are strict, as in Pine. JS comparisons with NaN are false and Math.max/min with NaN
 * give NaN, which matches Pine's behaviour with na.
 */
export function utTrailingStop(close: readonly number[], atr: readonly number[], key: number): number[] {
  const out = new Array<number>(close.length).fill(NaN);
  for (let t = 0; t < close.length; t++) {
    const src = close[t];
    const src1 = t > 0 ? close[t - 1] : NaN;
    const prevRaw = t > 0 ? out[t - 1] : NaN;
    const prev = Number.isNaN(prevRaw) ? 0 : prevRaw;
    const nLoss = key * atr[t];
    let stop: number;
    if (src > prev && src1 > prev) stop = Math.max(prev, src - nLoss);
    else if (src < prev && src1 < prev) stop = Math.min(prev, src + nLoss);
    else if (src > prev) stop = src - nLoss;
    else stop = src + nLoss;
    out[t] = stop;
  }
  return out;
}
