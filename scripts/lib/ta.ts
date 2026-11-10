// Research-only indicators and reversal signal generators. Not used by the live bot.
import type { Candle, Signal } from '../../src/shared/types.js';

export function ema(src: number[], n: number): number[] {
  const out = new Array<number>(src.length).fill(NaN);
  const k = 2 / (n + 1);
  let prev = NaN;
  for (let t = 0; t < src.length; t++) {
    if (t === n - 1) prev = src.slice(0, n).reduce((s, v) => s + v, 0) / n;
    else if (t >= n) prev = src[t] * k + prev * (1 - k);
    out[t] = t >= n - 1 ? prev : NaN;
  }
  return out;
}

export function sma(src: number[], n: number): number[] {
  return src.map((_, t) => (t < n - 1 ? NaN : src.slice(t - n + 1, t + 1).reduce((s, v) => s + v, 0) / n));
}

export function stdev(src: number[], n: number): number[] {
  const m = sma(src, n);
  return src.map((_, t) => (t < n - 1 ? NaN : Math.sqrt(src.slice(t - n + 1, t + 1).reduce((s, v) => s + (v - m[t]) ** 2, 0) / n)));
}

/** Wilder ADX(n). */
export function adx(c: readonly Candle[], n = 14): number[] {
  const len = c.length;
  const out = new Array<number>(len).fill(NaN);
  let trS = 0, pS = 0, mS = 0, adxV = NaN;
  const dxs: number[] = [];
  for (let t = 1; t < len; t++) {
    const up = c[t].high - c[t - 1].high;
    const dn = c[t - 1].low - c[t].low;
    const pdm = up > dn && up > 0 ? up : 0;
    const mdm = dn > up && dn > 0 ? dn : 0;
    const tr = Math.max(c[t].high - c[t].low, Math.abs(c[t].high - c[t - 1].close), Math.abs(c[t].low - c[t - 1].close));
    if (t <= n) {
      trS += tr; pS += pdm; mS += mdm;
      if (t < n) continue;
    } else {
      trS = trS - trS / n + tr; pS = pS - pS / n + pdm; mS = mS - mS / n + mdm;
    }
    const pdi = (100 * pS) / trS, mdi = (100 * mS) / trS;
    const dx = pdi + mdi === 0 ? 0 : (100 * Math.abs(pdi - mdi)) / (pdi + mdi);
    if (Number.isNaN(adxV)) {
      dxs.push(dx);
      if (dxs.length === n) adxV = dxs.reduce((s, v) => s + v, 0) / n;
    } else adxV = (adxV * (n - 1) + dx) / n;
    out[t] = adxV;
  }
  return out;
}

/** Wilder RSI(n). */
export function rsi(close: number[], n = 14): number[] {
  const out = new Array<number>(close.length).fill(NaN);
  let ag = 0, al = 0;
  for (let t = 1; t < close.length; t++) {
    const ch = close[t] - close[t - 1];
    const g = Math.max(ch, 0), l = Math.max(-ch, 0);
    if (t <= n) {
      ag += g / n; al += l / n;
      if (t < n) continue;
    } else {
      ag = (ag * (n - 1) + g) / n; al = (al * (n - 1) + l) / n;
    }
    out[t] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }
  return out;
}

const warm = (sig: Signal[], w: number) => sig.map((s, t) => (t < w ? 'NONE' : s)) as Signal[];

/** Three-Bar Reversal (bot.pine isBullishReversal3BR / isBearishReversal3BR), no trend filter. */
export function threeBarReversal(c: readonly Candle[], w: number): Signal[] {
  return warm(
    c.map((b, t) => {
      if (t < 2) return 'NONE';
      const b2 = c[t - 2], b1 = c[t - 1];
      const bull = b2.close < b2.open && b1.low < b2.low && b1.high < b2.high && b1.close < b1.open && b.close > b.open && b.high > b2.high;
      const bear = b2.close > b2.open && b1.high > b2.high && b1.low > b2.low && b1.close > b1.open && b.close < b.open && b.low < b2.low;
      return bull ? 'LONG' : bear ? 'SHORT' : 'NONE';
    }),
    w,
  );
}

/** bot.pine "Reversal Signals": 9 consecutive closes below close[4] → LONG (exhaustion); 9 above → SHORT. */
export function nineCount(c: readonly Candle[], w: number): Signal[] {
  let down = 0, up = 0;
  return warm(
    c.map((b, t) => {
      if (t < 4) return 'NONE';
      if (b.close < c[t - 4].close) {
        down = down === 9 ? 1 : down + 1;
        up = 0;
      } else {
        up = up === 9 ? 1 : up + 1;
        down = 0;
      }
      return down === 9 ? 'LONG' : up === 9 ? 'SHORT' : 'NONE';
    }),
    w,
  );
}

/** RSI(14) crosses back above 30 → LONG; back below 70 → SHORT. */
export function rsiReversal(c: readonly Candle[], w: number): Signal[] {
  const r = rsi(c.map((b) => b.close), 14);
  return warm(r.map((v, t) => (t < 1 ? 'NONE' : r[t - 1] < 30 && v >= 30 ? 'LONG' : r[t - 1] > 70 && v <= 70 ? 'SHORT' : 'NONE')), w);
}

/** Close re-enters the Bollinger(20, 2) band from outside → reversal entry. */
export function bollingerReversal(c: readonly Candle[], w: number): Signal[] {
  const cl = c.map((b) => b.close);
  const m = sma(cl, 20), sd = stdev(cl, 20);
  return warm(
    cl.map((v, t) => {
      if (t < 20) return 'NONE';
      const lo = m[t] - 2 * sd[t], hi = m[t] + 2 * sd[t];
      const lo1 = m[t - 1] - 2 * sd[t - 1], hi1 = m[t - 1] + 2 * sd[t - 1];
      if (cl[t - 1] < lo1 && v >= lo) return 'LONG';
      if (cl[t - 1] > hi1 && v <= hi) return 'SHORT';
      return 'NONE';
    }),
    w,
  );
}
