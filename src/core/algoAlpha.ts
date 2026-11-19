// AlgoAlpha "Zero Lag Liquidity" (docs/algoalpha.pine) on 1h candles with the 3-minute bars inside each hour.
// Moved from scripts/algoAlpha.ts (that port matched TradingView on 9/9 breaks); the script now imports this.
// Levels = POC of the 3m closes inside a big wick (7 bins); a level breaks after two closes beyond it (→ break signal,
// trend); a rejection = the previous bar straddled a level and hl2 is back on the far side.

import type { Candle } from '../shared/types.js';

export type AaDir = 1 | -1;

export interface AaOutput {
  /** +1 bullish break, −1 bearish break, 0 none, at each 1h bar. */
  brk: Array<AaDir | 0>;
  /** Direction of the latest break so far (0 before the first). */
  trend: Array<AaDir | 0>;
  bullRej: boolean[];
  bearRej: boolean[];
}

/** Wilder RMA seeded with the SMA of the first n valid values (Pine ta.rma). */
function rmaSeeded(x: readonly number[], n: number): number[] {
  const out = new Array<number>(x.length).fill(NaN);
  let s = 0;
  let k = 0;
  for (let i = 0; i < x.length; i++) {
    if (Number.isNaN(x[i])) continue;
    if (k < n) {
      s += x[i];
      k++;
      if (k === n) out[i] = s / n;
    } else out[i] = (out[i - 1] * (n - 1) + x[i]) / n;
  }
  return out;
}

/** Volume point of control of `bars` closes between bot and top, 7 bins; NaN without bars or range. */
export function poc(top: number, bot: number, bars: readonly Candle[], bins = 7): number {
  if (!bars.length || top === bot) return NaN;
  const seg = (top - bot) / bins;
  const bounds = Array.from({ length: bins + 1 }, (_, k) => bot + k * seg);
  const v = bounds.slice(0, -1).map((lo, k) => bars.reduce((a, x) => a + (x.close >= lo && x.close <= bounds[k + 1] ? x.volume : 0), 0));
  const k = v.indexOf(Math.max(...v));
  return (bounds[k] + bounds[k + 1]) / 2;
}

/**
 * @param c   1h candles, oldest first.
 * @param ltf ltf[i] = the 3-minute candles inside c[i] (same length as c).
 */
export function algoAlpha(c: readonly Candle[], ltf: ReadonlyArray<readonly Candle[]>): AaOutput {
  const n = c.length;
  const vol = c.map((b) => b.volume);
  const up = vol.map((v, i) => (i ? Math.max(v - vol[i - 1], 0) : NaN));
  const dn = vol.map((v, i) => (i ? Math.max(vol[i - 1] - v, 0) : NaN));
  const ru = rmaSeeded(up, 14);
  const rd = rmaSeeded(dn, 14);
  const volRsi = ru.map((u, i) => (rd[i] === 0 ? 100 : u === 0 ? 0 : 100 - 100 / (1 + u / rd[i])));
  const lw = c.map((b) => Math.min(b.close, b.open) - b.low);
  const uw = c.map((b) => b.high - Math.max(b.close, b.open));
  const aw = c.map((_, i) => (lw[i] + uw[i]) / 2);
  const awSma = aw.map((_, i) => (i < 20 ? NaN : aw.slice(i - 20, i + 1).reduce((a, b) => a + b, 0) / 21));

  const brk = new Array<AaDir | 0>(n).fill(0);
  const trend = new Array<AaDir | 0>(n).fill(0);
  const bullRej = new Array<boolean>(n).fill(false);
  const bearRej = new Array<boolean>(n).fill(false);
  type Lvl = { price: number; typ: AaDir; born: number };
  let lv: Lvl[] = []; // index 0 = newest (array.unshift)
  let tr: AaDir | 0 = 0;
  for (let i = 1; i < n; i++) {
    const b = c[i];
    const hl = aw[i] > awSma[i] * 2 && volRsi[i] > 60 && uw[i] !== lw[i];
    if (hl) {
      const red = lw[i] > uw[i];
      const top = red ? Math.min(b.close, b.open) : b.high;
      const bot = red ? b.low : Math.max(b.close, b.open);
      const p = poc(top, bot, ltf[i] ?? []);
      if (!Number.isNaN(p)) {
        lv.unshift({ price: p, typ: red ? -1 : 1, born: i });
        if (lv.length > 500) lv.pop();
      }
    }
    let br: AaDir | 0 = 0;
    const keep: Lvl[] = [];
    for (let k = lv.length - 1; k >= 0; k--) {
      const l = lv[k];
      const done = l.typ === 1 ? b.close > l.price && c[i - 1].close > l.price : b.close < l.price && c[i - 1].close < l.price;
      if (done) {
        br = l.typ;
        tr = l.typ;
        continue;
      }
      // Pine: x2 − x1 > 0 is true from the second bar after creation.
      if (i - l.born >= 2 && c[i - 1].high > l.price && c[i - 1].low < l.price) {
        const hl2 = (b.high + b.low) / 2;
        if (hl2 > l.price && l.typ === -1) bullRej[i] = true;
        else if (hl2 < l.price && l.typ === 1) bearRej[i] = true;
      }
      keep.unshift(l);
    }
    lv = keep;
    brk[i] = br;
    trend[i] = tr;
  }
  return { brk, trend, bullRej, bearRej };
}

/** Groups 3-minute candles into the 1h bars of `c` by hour (bars outside c are dropped). */
export function groupByHour(c: readonly Candle[], m3: readonly Candle[]): Candle[][] {
  const idx = new Map(c.map((b, i) => [b.time, i]));
  const out: Candle[][] = c.map(() => []);
  for (const x of m3) {
    const i = idx.get(Math.floor(x.time / 3600) * 3600);
    if (i !== undefined) out[i].push(x);
  }
  return out;
}
