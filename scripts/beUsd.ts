// Break-even at $X per ETH profit (BE_TRIG_USD, on a 1h close; stop → entry ± fees) for Hull, Mix B and reversal.
// npx tsx scripts/beUsd.ts [--offline]  → docs/be-usd.md
import { readFileSync, writeFileSync } from 'node:fs';
import { DEFAULT_PARAMS, withStrategyPreset, type Params } from '../src/config/params.js';
import { entryGate } from '../src/core/entryGate.js';
import { computeAll } from '../src/core/signals.js';
import { simulate } from '../src/core/simulator.js';
import type { Candle, SimTrade } from '../src/shared/types.js';
import { fetchHistory } from './lib/candles.js';

const cached = JSON.parse(readFileSync('data/eth_1h_cache.json', 'utf8')) as Candle[];
const byTime = new Map(cached.map((x) => [x.time, x]));
if (!process.argv.includes('--offline')) for (const x of await fetchHistory(2)) byTime.set(x.time, x);
const c = [...byTime.values()].sort((a, b) => a.time - b.time).filter((x) => x.high > x.low || x.volume > 0);
const yr = c[c.length - 1].time - 365 * 86400;
const m1 = c[c.length - 1].time - 30 * 86400;
const day = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
const live: Params = { ...DEFAULT_PARAMS, STRATEGY: 'hull', MIN_ATR: 15, SKIP_WEEKEND_ENTRIES: true, MAX_CONTRACTS: 100 };

type V = { name: string; strat: 'hull' | 'reversal'; p: (be: number) => Params; mixB?: boolean };
const vs: V[] = [
  { name: 'Hull (BE 1R + trail)', strat: 'hull', p: (be) => ({ ...live, BE_TRIG_USD: be }) },
  { name: 'Mix B (Hull + rev re-entry), deploying', strat: 'hull', p: (be) => ({ ...live, BE_TRIG_USD: be, REV_REENTRY: true }), mixB: true },
  { name: 'Reversal, no TP', strat: 'reversal', p: (be) => ({ ...withStrategyPreset({ ...live, STRATEGY: 'reversal' }, 0), BE_TRIG_USD: be }) },
  { name: 'Reversal, TP 2R (default)', strat: 'reversal', p: (be) => ({ ...withStrategyPreset({ ...live, STRATEGY: 'reversal' }, 2), BE_TRIG_USD: be }) },
];
const run = (v: V, be: number): SimTrade[] => {
  const p = v.p(be);
  const g = entryGate(c, p);
  const ind = computeAll(c, p);
  const sig = v.strat === 'reversal' ? ind.sigRev : v.mixB ? ind.sigHullEntry : ind.sigHull;
  return simulate(v.strat, c, sig, p, { allowEntryAt: (i) => g(i) === null }).filter((t) => t.entryTime >= c[300].time);
};
const st = (xs: SimTrade[]) => {
  let e = 0, pk = 0, dd = 0, w = 0, beN = 0, sw = 0;
  for (const t of xs) {
    e += t.netPnl; pk = Math.max(pk, e); dd = Math.max(dd, pk - e);
    if (t.netPnl > 0) { w++; sw += t.netPnl; }
    if (Math.abs(t.netPnl) < 3) beN++;
  }
  return { n: xs.length, net: e, dd, win: xs.length ? w / xs.length : 0, beN, avgW: sw / Math.max(1, w) };
};
const rows: string[] = [];
for (const v of vs)
  for (const be of [0, 10, 15]) {
    const tr = run(v, be);
    const a = st(tr), o = st(tr.filter((t) => t.entryTime < yr)), l = st(tr.filter((t) => t.entryTime >= yr)), r = st(tr.filter((t) => t.entryTime >= m1));
    rows.push(`| ${v.name} | ${be ? `$${be}` : 'off'} | ${a.n} | ${Math.round(a.win * 100)}% | ${a.beN} | ${a.avgW.toFixed(0)} | ${o.net.toFixed(0)} | ${l.net.toFixed(0)} | ${r.net.toFixed(0)} | **${a.net.toFixed(0)}** | ${o.dd.toFixed(0)} / ${l.dd.toFixed(0)} |`);
  }
const out = [
  '# Break-even at $X profit (BE_TRIG_USD)',
  '',
  `ETHUSD 1h, ${day(c[300].time)} to ${day(c[c.length - 1].time)}. Once a 1h candle closes at least $X per ETH in profit, the stop moves to entry ± fees (Hull keeps its 1R break-even and trail too). Live entry gate, fees and slippage included. $ per 1 ETH. "BE exits" = trades closed within ±$3.`,
  '',
  '| Strategy | BE at | Trades | Win % | BE exits | Avg win | Older $/ETH | Last 12 mo | Last 30 days | Full $/ETH | Worst drop older / last 12 mo |',
  '|---|---|---|---|---|---|---|---|---|---|---|',
  ...rows,
  '',
];
writeFileSync('docs/be-usd.md', out.join('\n'));
console.log(out.join('\n'));
