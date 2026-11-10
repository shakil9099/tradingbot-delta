// npm run research3 -- --pages 13
// Round 3, author's ladder kept exactly ($20 SL, +12→+2.5, +25→+15, trail 10, TP 100), adaptive Hull(55)/UT.
// Explores: volatility gates (skip entries when ATR(14) makes a $20 stop pointless), selector N/margin,
// UT settings, and running the same system on 2h / 4h candles. Train first 70%, test last 30%. Per 1 ETH.

import { DEFAULT_PARAMS } from '../src/config/params.js';
import { atrPine } from '../src/core/indicators.js';
import { computeAll } from '../src/core/signals.js';
import { simulateAdaptive, type SimOptions } from '../src/core/simulator.js';
import { simSummary } from '../src/core/stats.js';
import type { Candle, SimTrade } from '../src/shared/types.js';
import { fetchHistory } from './lib/candles.js';
import { adx } from './lib/ta.js';

const P = DEFAULT_PARAMS;
const arg = (n: string, d: number) => (process.argv.indexOf(n) >= 0 ? Number(process.argv[process.argv.indexOf(n) + 1]) : d);
type Row = Record<string, string | number>;

function aggregate(c: Candle[], hours: number): Candle[] {
  const S = hours * 3600;
  const out: Candle[] = [];
  let cur: Candle | null = null;
  let n = 0;
  for (const b of c) {
    const k = Math.floor(b.time / S) * S;
    if (!cur || cur.time !== k) {
      if (cur && n === hours) out.push(cur);
      cur = { time: k, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume };
      n = 1;
    } else {
      cur.high = Math.max(cur.high, b.high);
      cur.low = Math.min(cur.low, b.low);
      cur.close = b.close;
      cur.volume += b.volume;
      n++;
    }
  }
  if (cur && n === hours) out.push(cur);
  return out;
}

async function main() {
  const h1 = await fetchHistory(arg('--pages', 13));
  const t0 = h1[0].time, t1 = h1.at(-1)!.time + 3600;
  const split = t0 + Math.floor((t1 - t0) * 0.7);
  const yr = (a: number, b: number) => (b - a) / (365 * 86400);
  const yTr = yr(t0, split), yTe = yr(split, t1);
  const years = [...new Set(h1.map((c) => new Date(c.time * 1000).getUTCFullYear()))];

  const describe = (base: Row, trades: SimTrade[]): Row => {
    const tr = simSummary(trades.filter((x) => x.entryTime < split));
    const te = simSummary(trades.filter((x) => x.entryTime >= split));
    const all = simSummary(trades);
    const row: Row = {
      ...base,
      trades: all.count,
      trainYr: +(tr.netPnl / yTr).toFixed(0),
      testYr: +(te.netPnl / yTe).toFixed(0),
      PF: all.profitFactor === null ? 0 : +all.profitFactor.toFixed(2),
      maxDD: +all.maxDrawdown.toFixed(0),
      feesYr: +(all.fees / (yTr + yTe)).toFixed(0),
    };
    for (const y of years) row[y] = +trades.filter((x) => new Date(x.entryTime * 1000).getUTCFullYear() === y).reduce((s, x) => s + x.netPnl, 0).toFixed(0);
    return row;
  };

  const rows: Row[] = [];
  for (const tf of [1, 2, 4]) {
    const c = tf === 1 ? h1 : aggregate(h1, tf);
    const warm = Math.ceil(P.WARMUP / tf) + 60;
    const atr14 = atrPine(c, 14);
    const adx14 = adx(c, 14);
    const gates: Record<string, SimOptions['allowEntryAt'] | undefined> = {
      none: undefined,
      'ATR≤12': (t) => atr14[t] <= 12,
      'ATR≤16': (t) => atr14[t] <= 16,
      'ATR≤20': (t) => atr14[t] <= 20,
      'ATR≥8': (t) => atr14[t] >= 8,
      '8≤ATR≤20': (t) => atr14[t] >= 8 && atr14[t] <= 20,
      'ADX≥20 & ATR≤20': (t) => adx14[t] >= 20 && atr14[t] <= 20,
    };
    const utSets: Array<[number, number]> = tf === 1 ? [[2, 6], [2, 10], [3, 10]] : [[2, 6]];
    const selSets: Array<[number, number]> = tf === 1 ? [[10, 20], [5, 10], [20, 40]] : [[10, 20]];
    for (const [key, atrN] of utSets) {
      const ind = computeAll(c, { ...P, UT_KEY: key, UT_ATR: atrN, WARMUP: warm });
      for (const [selN, selM] of selSets) {
        for (const [g, fn] of Object.entries(gates)) {
          if (tf !== 1 && g !== 'none' && g !== 'ATR≤20') continue;
          const p = { ...P, WARMUP: warm, SEL_N: selN, SEL_MARGIN: selM };
          const { trades, switches } = simulateAdaptive(c, ind, p, { allowEntryAt: fn });
          rows.push(describe({ tf: `${tf}h`, ut: `${key}/${atrN}`, sel: `${selN}/${selM}`, gate: g, switches }, trades));
        }
      }
    }
  }

  rows.sort((a, b) => Number(b.trainYr) - Number(a.trainYr));
  console.log(`\nRound 3 — author's ladder unchanged. Top 20 of ${rows.length} by TRAIN $/ETH/yr (taker fees + GST, 1-tick slippage):`);
  console.table(rows.slice(0, 20));
  const robust = rows.filter((r) => Number(r.trainYr) > 0 && Number(r.testYr) > 0);
  console.log(`Positive in both train and test: ${robust.length}; also positive every calendar year: ${robust.filter((r) => years.every((y) => Number(r[y]) > 0)).length}`);
  if (robust.length) console.table(robust);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
