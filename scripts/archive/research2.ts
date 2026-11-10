// npm run research2 -- --pages 13
// Constraints from the author: keep the exit ladder (SL $20 min, +12→+2.5, +25→+15, trail 10, TP 100),
// adaptive Hull-or-UT, no 4h filter. Allowed: UT settings, ADX / volatility for the stop-loss.
// Part A: adaptive Hull(55) / UT(key, ATR) with stop and ADX-gate variants.
// Part B: reversal strategies (bot.pine 3-bar reversal and 9-count, RSI, Bollinger) on the same ladder.
// Choose on the first 70% (train); the last 30% (test) is reported, never used to rank. Per 1 ETH.

import { DEFAULT_PARAMS } from '../src/config/params.js';
import { atrPine } from '../src/core/indicators.js';
import { computeAll } from '../src/core/signals.js';
import { simulate, simulateAdaptive, type SimOptions } from '../src/core/simulator.js';
import { simSummary } from '../src/core/stats.js';
import type { Candle, SimTrade, Signal, StrategyId } from '../src/shared/types.js';
import { fetchHistory } from './lib/candles.js';
import { adx, bollingerReversal, nineCount, rsiReversal, threeBarReversal } from './lib/ta.js';

const P = DEFAULT_PARAMS;
const arg = (n: string, d: number) => (process.argv.indexOf(n) >= 0 ? Number(process.argv[process.argv.indexOf(n) + 1]) : d);

type Row = Record<string, string | number>;

/** Average distance (per ETH) between entry and the best price within ±w bars of the entry bar. Lower = closer to the turn. */
function entryGap(trades: SimTrade[], candles: Candle[], w = 6): number {
  const idx = new Map(candles.map((c, i) => [c.time, i]));
  let sum = 0;
  let n = 0;
  for (const t of trades) {
    const i = idx.get(t.entryTime);
    if (i === undefined) continue;
    const win = candles.slice(Math.max(0, i - w), Math.min(candles.length, i + w + 1));
    const best = t.side === 'buy' ? Math.min(...win.map((c) => c.low)) : Math.max(...win.map((c) => c.high));
    sum += Math.abs(t.entry - best);
    n++;
  }
  return n ? sum / n : NaN;
}

async function main() {
  const candles = await fetchHistory(arg('--pages', 13));
  const t0 = candles[0].time, t1 = candles.at(-1)!.time + 3600;
  const split = t0 + Math.floor((t1 - t0) * 0.7);
  const yr = (a: number, b: number) => (b - a) / (365 * 86400);
  const yTr = yr(t0, split), yTe = yr(split, t1);
  const iso = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
  const years = [...new Set(candles.map((c) => new Date(c.time * 1000).getUTCFullYear()))];
  console.log(`\nETHUSD 1h ${candles.length} candles ${iso(t0)}→${iso(t1)}; train to ${iso(split)}, test after. Per 1 ETH, after taker fees + GST and 1-tick slippage.`);

  const atr14 = atrPine(candles, 14);
  const adx14 = adx(candles, 14);
  const slModes: Record<string, (t: number) => number> = {
    'fixed $20': () => 20,
    'max(20, 1.0×ATR)': (t) => Math.max(20, 1.0 * (atr14[t] || 0)),
    'max(20, 1.5×ATR)': (t) => Math.max(20, 1.5 * (atr14[t] || 0)),
    'max(20, 2.0×ATR)': (t) => Math.max(20, 2.0 * (atr14[t] || 0)),
    'ADX≥25 ? $30 : $20': (t) => (adx14[t] >= 25 ? 30 : 20),
  };
  const trendGates: Record<string, SimOptions['allowEntryAt']> = {
    none: undefined,
    'ADX≥20': (t) => adx14[t] >= 20,
    'ADX≥25': (t) => adx14[t] >= 25,
  };
  const rangeGates: Record<string, SimOptions['allowEntryAt']> = { none: undefined, 'ADX<25': (t) => adx14[t] < 25 };

  const describe = (base: Row, trades: SimTrade[]): Row => {
    const tr = simSummary(trades.filter((x) => x.entryTime < split));
    const te = simSummary(trades.filter((x) => x.entryTime >= split));
    const all = simSummary(trades);
    const row: Row = {
      ...base,
      trades: all.count,
      initStop: `${((trades.filter((x) => x.reason === 'sl_stage_0').length / Math.max(1, trades.length)) * 100).toFixed(0)}%`,
      entryGap: +entryGap(trades, candles).toFixed(1),
      trainYr: +(tr.netPnl / yTr).toFixed(0),
      testYr: +(te.netPnl / yTe).toFixed(0),
      PF: all.profitFactor === null ? 0 : +all.profitFactor.toFixed(2),
      maxDD: +all.maxDrawdown.toFixed(0),
    };
    for (const y of years) row[y] = +trades.filter((x) => new Date(x.entryTime * 1000).getUTCFullYear() === y).reduce((s, x) => s + x.netPnl, 0).toFixed(0);
    return row;
  };

  // ---------- Part A: adaptive Hull / UT ----------
  const utSets: Array<[number, number]> = [[2, 6], [1, 10], [2, 10], [3, 10], [1, 6], [1.5, 8]];
  const A: Row[] = [];
  for (const [key, atrN] of utSets) {
    const ind = computeAll(candles, { ...P, UT_KEY: key, UT_ATR: atrN });
    for (const [slName, slFn] of Object.entries(slModes)) {
      for (const [gName, gFn] of Object.entries(trendGates)) {
        const { trades, switches } = simulateAdaptive(candles, ind, P, { slDistAt: slFn, allowEntryAt: gFn });
        A.push(describe({ ut: `${key}/${atrN}`, stop: slName, gate: gName, switches }, trades));
      }
    }
  }
  const baseline = A.find((r) => r.ut === '2/6' && r.stop === 'fixed $20' && r.gate === 'none');
  console.log('\nPart A baseline (current design):');
  console.table([baseline]);
  A.sort((a, b) => Number(b.trainYr) - Number(a.trainYr));
  console.log(`Part A: top 12 of ${A.length} adaptive variants by TRAIN $/ETH/yr:`);
  console.table(A.slice(0, 12));
  console.log('Part A: UT setting entry accuracy (fixed $20 stop, no gate) — lower entryGap = entries nearer the turn:');
  console.table(A.filter((r) => r.stop === 'fixed $20' && r.gate === 'none').map((r) => ({ ut: r.ut, trades: r.trades, entryGap: r.entryGap, initStop: r.initStop, trainYr: r.trainYr, testYr: r.testYr })));

  // ---------- Part B: reversal strategies ----------
  const w = P.WARMUP;
  const gens: Record<string, Signal[]> = {
    '3-bar reversal (bot.pine)': threeBarReversal(candles, w),
    '9-count exhaustion (bot.pine)': nineCount(candles, w),
    'RSI 30/70 re-cross': rsiReversal(candles, w),
    'Bollinger re-entry': bollingerReversal(candles, w),
  };
  const B: Row[] = [];
  for (const [gName, sig] of Object.entries(gens)) {
    for (const [slName, slFn] of Object.entries(slModes)) {
      for (const [rgName, rgFn] of Object.entries(rangeGates)) {
        const trades = simulate('ut' as StrategyId, candles, sig, P, { slDistAt: slFn, allowEntryAt: rgFn });
        B.push(describe({ strategy: gName, stop: slName, gate: rgName }, trades));
      }
    }
  }
  B.sort((a, b) => Number(b.trainYr) - Number(a.trainYr));
  console.log(`\nPart B: top 12 of ${B.length} reversal variants by TRAIN $/ETH/yr:`);
  console.table(B.slice(0, 12));

  const robust = [...A, ...B].filter((r) => Number(r.trainYr) > 0 && Number(r.testYr) > 0 && years.every((y) => Number(r[y]) > 0));
  console.log(`\nPositive in train, test AND every calendar year: ${robust.length} of ${A.length + B.length}`);
  if (robust.length) console.table(robust);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
