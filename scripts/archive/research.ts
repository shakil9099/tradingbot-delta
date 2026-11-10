// npm run research -- --pages 13
// Strategy research: grid over signal source × UT params × trend filter × exit scale.
// Picks on the first 70% of history (train) and reports the last 30% (test, never used to choose).
// Uses the same core simulator, fees and slippage as the bot. Per 1 ETH.

import { DEFAULT_PARAMS, type Params } from '../src/config/params.js';
import { hma } from '../src/core/indicators.js';
import { computeAll, type IndicatorOutput } from '../src/core/signals.js';
import { simulate, simulateAdaptive } from '../src/core/simulator.js';
import { simSummary } from '../src/core/stats.js';
import type { Candle, SimTrade, Signal } from '../src/shared/types.js';
import { fetchHistory } from './lib/candles.js';

type Filter = 'none' | 'ema200' | 'htf4h' | 'adx20';
type Source = 'hull' | 'ut' | 'adaptive';

function arg(name: string, def: number): number {
  const i = process.argv.indexOf(name);
  return i >= 0 ? Number(process.argv[i + 1]) : def;
}

function ema(src: number[], n: number): number[] {
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

/** Wilder ADX(n). */
function adx(c: Candle[], n = 14): number[] {
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

/** 4h Hull(55) trend from the last *completed* 4h bar at each 1h bar's close (no lookahead). */
function htfTrend(c: Candle[]): Array<'up' | 'down' | null> {
  const H4 = 4 * 3600;
  const groups = new Map<number, Candle[]>();
  for (const b of c) {
    const k = Math.floor(b.time / H4) * H4;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(b);
  }
  const keys = [...groups.keys()].sort((a, b) => a - b).filter((k) => groups.get(k)!.length === 4);
  const closes = keys.map((k) => groups.get(k)!.at(-1)!.close);
  const h = hma(closes, 55);
  const trend = keys.map((_, i) => (i >= 2 && !Number.isNaN(h[i]) && !Number.isNaN(h[i - 2]) ? (h[i] > h[i - 2] ? 'up' : 'down') : null));
  const out: Array<'up' | 'down' | null> = [];
  let j = -1;
  for (const b of c) {
    const barClose = b.time + 3600;
    while (j + 1 < keys.length && keys[j + 1] + H4 <= barClose) j++;
    out.push(j >= 0 ? (trend[j] as 'up' | 'down' | null) : null);
  }
  return out;
}

function allowFn(filter: Filter, c: Candle[]): (t: number, s: Signal) => boolean {
  if (filter === 'none') return () => true;
  if (filter === 'ema200') {
    const e = ema(c.map((b) => b.close), 200);
    return (t, s) => !Number.isNaN(e[t]) && (s === 'LONG' ? c[t].close > e[t] : c[t].close < e[t]);
  }
  if (filter === 'adx20') {
    const a = adx(c, 14);
    return (t) => a[t] > 20;
  }
  const tr = htfTrend(c);
  return (t, s) => (s === 'LONG' ? tr[t] === 'up' : tr[t] === 'down');
}

/** Masks disallowed signals; direction state becomes the side of the last allowed signal (so a filtered flip is not "missed"). */
function filtered(ind: IndicatorOutput, allow: (t: number, s: Signal) => boolean): IndicatorOutput {
  const mask = (sig: Signal[]) => sig.map((s, t) => (s !== 'NONE' && allow(t, s) ? s : 'NONE')) as Signal[];
  const state = (sig: Signal[]) => {
    let up = false;
    return sig.map((s) => (s === 'LONG' ? (up = true) : s === 'SHORT' ? (up = false) : up));
  };
  const sigHull = mask(ind.sigHull);
  const sigUt = mask(ind.sigUt);
  return { ...ind, sigHull, sigUt, hullUp: state(sigHull), utUp: state(sigUt) };
}

function scaled(p: Params, k: number): Params {
  return { ...p, SL_DIST: 20 * k, TP_DIST: 100 * k, S1_TRIGGER: 12 * k, S1_LOCK: 2.5 * k, S2_TRIGGER: 25 * k, S2_LOCK: 15 * k, TRAIL_GAP: 10 * k };
}

function seg(trades: SimTrade[], from: number, to: number) {
  const s = simSummary(trades.filter((t) => t.entryTime >= from && t.entryTime < to));
  return s;
}

async function main() {
  const pages = arg('--pages', 13);
  const candles = await fetchHistory(pages);
  const t0 = candles[0].time;
  const t1 = candles.at(-1)!.time + 3600;
  const split = t0 + Math.floor((t1 - t0) * 0.7);
  const years = (a: number, b: number) => (b - a) / (365 * 86400);
  const yTrain = years(t0, split), yTest = years(split, t1);
  const iso = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
  console.log(`\nETHUSD 1h: ${candles.length} candles ${iso(t0)} → ${iso(t1)}. Train ${iso(t0)}→${iso(split)} (${yTrain.toFixed(2)}y), test ${iso(split)}→${iso(t1)} (${yTest.toFixed(2)}y).`);

  const utSets: Array<[number, number]> = [[2, 6], [1, 10], [3, 10]];
  const filters: Filter[] = ['none', 'ema200', 'htf4h', 'adx20'];
  const scales = [1, 1.5, 2];
  const sources: Source[] = ['hull', 'ut', 'adaptive'];
  const feeSets: Array<[string, number]> = [['taker', DEFAULT_PARAMS.FEE_RATE]];
  if (process.argv.includes('--maker-entry')) feeSets.push(['makerEntry', (0.0002 * 1.18 + 0.0005 * 1.18) / 2]);

  const allows = new Map(filters.map((f) => [f, allowFn(f, candles)]));
  const rows: Record<string, string | number>[] = [];
  const tradesOf = new Map<Record<string, string | number>, SimTrade[]>();
  for (const [key, atrN] of utSets) {
    const base = computeAll(candles, { ...DEFAULT_PARAMS, UT_KEY: key, UT_ATR: atrN });
    for (const f of filters) {
      const ind = f === 'none' ? base : filtered(base, allows.get(f)!);
      for (const k of scales) {
        for (const [feeName, fee] of feeSets) {
          const p = { ...scaled(DEFAULT_PARAMS, k), FEE_RATE: fee };
          for (const src of sources) {
            if (src === 'hull' && (key !== 2 || atrN !== 6)) continue; // Hull ignores UT params
            const trades =
              src === 'adaptive' ? simulateAdaptive(candles, ind, p).trades : simulate(src, candles, src === 'hull' ? ind.sigHull : ind.sigUt, p);
            const tr = seg(trades, t0, split);
            const te = seg(trades, split, t1);
            const row: Record<string, string | number> = {
              source: src,
              ut: src === 'hull' ? '—' : `${key}/${atrN}`,
              filter: f,
              exits: `×${k} (SL $${20 * k})`,
              fees: feeName,
              trainTrades: tr.count,
              trainNetYr: +(tr.netPnl / yTrain).toFixed(0),
              trainPF: tr.profitFactor === null ? 0 : +tr.profitFactor.toFixed(2),
              trainDD: +tr.maxDrawdown.toFixed(0),
              testTrades: te.count,
              testNetYr: +(te.netPnl / yTest).toFixed(0),
              testPF: te.profitFactor === null ? 0 : +te.profitFactor.toFixed(2),
              testDD: +te.maxDrawdown.toFixed(0),
            };
            rows.push(row);
            tradesOf.set(row, trades);
          }
        }
      }
    }
  }

  const baseline = rows.find((r) => r.source === 'adaptive' && r.ut === '2/6' && r.filter === 'none' && String(r.exits).startsWith('×1 ') && r.fees === 'taker');
  console.log('\nBaseline (current design: adaptive, UT 2/6, no filter, $20 ladder):');
  console.table([baseline]);
  rows.sort((a, b) => Number(b.trainNetYr) - Number(a.trainNetYr));
  console.log(`\nTop 15 of ${rows.length} by TRAIN net $/ETH/year (test columns were not used to rank):`);
  console.table(rows.slice(0, 15));
  const robust = rows.filter((r) => Number(r.trainNetYr) > 0 && Number(r.testNetYr) > 0);
  console.log(`\n${robust.length} of ${rows.length} variants are positive in BOTH train and test. Net $/ETH by calendar year:`);
  const yearOf = (t: number) => new Date(t * 1000).getUTCFullYear();
  const yrs = [...new Set(candles.map((c) => yearOf(c.time)))];
  console.table(
    robust.map((r) => {
      const ts = tradesOf.get(r)!;
      const by: Record<string, string | number> = { source: r.source, ut: r.ut, filter: r.filter, exits: r.exits, fees: r.fees };
      for (const y of yrs) by[String(y)] = +ts.filter((t) => yearOf(t.entryTime) === y).reduce((s, t) => s + t.netPnl, 0).toFixed(0);
      by.fullDD = +simSummary(ts).maxDrawdown.toFixed(0);
      return by;
    }),
  );
  if (process.argv.includes('--json')) console.log(JSON.stringify(rows));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
