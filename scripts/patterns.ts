// npm run patterns — statistical pattern study of ETHUSD 1h (cached candles). Discovery on TRAIN (first 70%),
// confirmation on TEST (last 30%). Reports average forward moves in $ per ETH, and t-stats.
import { loadCandles, makeCtx, period } from './research5.js';

const fmt = (v: number) => (Number.isFinite(v) ? +v.toFixed(2) : NaN);
function stats(a: number[]) {
  const n = a.length;
  if (n < 2) return { n, mean: NaN, t: NaN, hit: NaN };
  const m = a.reduce((s, v) => s + v, 0) / n;
  const sd = Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (n - 1));
  return { n, mean: fmt(m), t: fmt(m / (sd / Math.sqrt(n))), hit: fmt((a.filter((v) => v > 0).length / n) * 100) };
}

async function main() {
  const c = await loadCandles();
  const x = makeCtx(c);
  const pd = period(c);
  const close = c.map((b) => b.close);
  const isTrain = (i: number) => c[i].time < pd.split;
  const fwd = (i: number, h: number) => (i + h < c.length ? close[i + h] - close[i] : NaN);
  const both = (name: string, pick: (i: number) => number | null, h: number) => {
    const tr: number[] = [], te: number[] = [];
    for (let i = 200; i < c.length - h; i++) {
      const s = pick(i);
      if (s === null || !Number.isFinite(s)) continue;
      const v = s * fwd(i, h);
      (isTrain(i) ? tr : te).push(v);
    }
    const a = stats(tr), b = stats(te);
    return { pattern: name, h, trainN: a.n, trainMean: a.mean, trainT: a.t, trainHit: a.hit, testN: b.n, testMean: b.mean, testT: b.t, testHit: b.hit };
  };

  // 1. Momentum vs mean reversion: sign of past L-hour move → next H-hour move (non-overlapping-ish sampling every bar).
  const r1 = [];
  for (const L of [1, 4, 12, 24, 72, 168]) for (const H of [1, 4, 24])
    r1.push(both(`momentum L${L}`, (i) => Math.sign(close[i] - close[i - L]) || null, H));
  console.log('\n1) Momentum (+) vs mean reversion (−): follow the sign of the past L hours, forward H hours. $/ETH');
  console.table(r1);

  // 2. Breakouts of the N-bar high/low (close beyond the prior N bars' extreme), with ATR regime split.
  const r2 = [];
  for (const N of [24, 48, 96, 168]) {
    const brk = (i: number) => {
      let hi = -Infinity, lo = Infinity;
      for (let k = i - N; k < i; k++) (hi = Math.max(hi, c[k].high)), (lo = Math.min(lo, c[k].low));
      return close[i] > hi ? 1 : close[i] < lo ? -1 : null;
    };
    const cache = c.map((_, i) => (i >= 200 ? brk(i) : null));
    for (const H of [24, 72]) {
      r2.push(both(`breakout ${N}h`, (i) => cache[i], H));
      r2.push(both(`breakout ${N}h, ATR<20`, (i) => (x.atr[i] < 20 ? cache[i] : null), H));
      r2.push(both(`breakout ${N}h, ATR≥20`, (i) => (x.atr[i] >= 20 ? cache[i] : null), H));
    }
  }
  console.log('\n2) Breakouts: close above the prior N-bar high (long) / below the low (short), forward H hours. $/ETH');
  console.table(r2);

  // 3. Fade extremes: z-score of close vs 24h mean beyond ±2 → bet on reversion, forward H.
  const r3 = [];
  for (const W of [24, 72]) for (const Z of [2, 3]) for (const H of [4, 24]) {
    r3.push(both(`fade z>${Z} (${W}h)`, (i) => {
      const s = close.slice(i - W + 1, i + 1);
      const m = s.reduce((a, b) => a + b, 0) / W;
      const sd = Math.sqrt(s.reduce((a, b) => a + (b - m) ** 2, 0) / W);
      const z = (close[i] - m) / sd;
      return z > Z ? -1 : z < -Z ? 1 : null;
    }, H));
  }
  console.log('\n3) Fade stretched moves (mean reversion), forward H hours. $/ETH');
  console.table(r3);

  // 4. Hour of day (IST) and weekday: mean 1h move and mean ATR.
  const byHour: Record<string, { tr: number[]; te: number[]; rng: number[] }> = {};
  for (let i = 200; i < c.length - 1; i++) {
    const d = new Date((c[i].time + 19800) * 1000);
    const k = String(d.getUTCHours()).padStart(2, '0');
    byHour[k] ??= { tr: [], te: [], rng: [] };
    (isTrain(i) ? byHour[k].tr : byHour[k].te).push(c[i].close - c[i].open);
    byHour[k].rng.push(c[i].high - c[i].low);
  }
  console.log('\n4) Hour of day (IST, candle open): mean 1h move train/test, mean range. $');
  console.table(Object.fromEntries(Object.entries(byHour).sort().map(([k, v]) => [k, { trainMean: stats(v.tr).mean, trainT: stats(v.tr).t, testMean: stats(v.te).mean, testT: stats(v.te).t, range: fmt(v.rng.reduce((a, b) => a + b, 0) / v.rng.length) }])));

  // 5. Volatility clustering: does today's ATR regime predict the size of the next 24h move?
  const r5: Record<string, { n: number; absMove24: number }> = {};
  for (let i = 200; i < c.length - 24; i++) {
    const a = x.atr[i];
    const k = a < 10 ? 'ATR <10' : a < 15 ? 'ATR 10-15' : a < 20 ? 'ATR 15-20' : a < 30 ? 'ATR 20-30' : 'ATR ≥30';
    r5[k] ??= { n: 0, absMove24: 0 };
    r5[k].n++;
    r5[k].absMove24 += Math.abs(fwd(i, 24));
  }
  console.log('\n5) ATR regime → average absolute 24h move ($):');
  console.table(Object.fromEntries(Object.entries(r5).map(([k, v]) => [k, { n: v.n, absMove24: fmt(v.absMove24 / v.n), perAtr: fmt(v.absMove24 / v.n / (k === 'ATR <10' ? 8 : k === 'ATR 10-15' ? 12.5 : k === 'ATR 15-20' ? 17.5 : k === 'ATR 20-30' ? 25 : 35)) }])));
}
main().catch((e) => (console.error(e), process.exit(1)));
