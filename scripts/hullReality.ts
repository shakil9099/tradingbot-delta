// Where Hull's backtest profit comes from: by period, by sizing, and by trading-cost assumptions.
// npx tsx scripts/hullReality.ts
import { readFileSync } from 'node:fs';
import { DEFAULT_PARAMS, type Params } from '../src/config/params.js';
import { entryGate } from '../src/core/entryGate.js';
import { computeAll } from '../src/core/signals.js';
import { simulate } from '../src/core/simulator.js';
import { contractsFor, riskFor } from '../src/core/sizing.js';
import type { Candle, SimTrade } from '../src/shared/types.js';
import { fetchHistory } from './lib/candles.js';

const byTime = new Map((JSON.parse(readFileSync('data/eth_1h_cache.json', 'utf8')) as Candle[]).map((x) => [x.time, x]));
for (const x of await fetchHistory(2)) byTime.set(x.time, x);
const c = [...byTime.values()].sort((a, b) => a.time - b.time).filter((x) => x.high > x.low || x.volume > 0);
const live: Params = { ...DEFAULT_PARAMS, STRATEGY: 'hull', MIN_ATR: 15, SKIP_WEEKEND_ENTRIES: true, MAX_CONTRACTS: 100 };
const run = (p: Params) => {
  const g = entryGate(c, p);
  return simulate('hull', c, computeAll(c, p).sigHull, p, { allowEntryAt: (i) => g(i) === null }).filter((t) => t.entryTime >= c[300].time);
};
const sum = (xs: SimTrade[]) => xs.reduce((s, t) => s + t.netPnl, 0);
const tr = run(live);
const end = c[c.length - 1].time;

console.log('## Per-ETH net by quarter (Hull live settings)');
const q = new Map<string, SimTrade[]>();
for (const t of tr) {
  const d = new Date(t.entryTime * 1000);
  const k = `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
  q.set(k, [...(q.get(k) ?? []), t]);
}
for (const [k, xs] of q) console.log(k, xs.length, 'trades', sum(xs).toFixed(0).padStart(5), 'win', `${Math.round((xs.filter((t) => t.netPnl > 0).length / xs.length) * 100)}%`);

console.log('\n## Last 3 months by month');
const m = new Map<string, SimTrade[]>();
for (const t of tr.filter((x) => x.entryTime > end - 92 * 86400)) {
  const k = new Date(t.entryTime * 1000).toISOString().slice(0, 7);
  m.set(k, [...(m.get(k) ?? []), t]);
}
for (const [k, xs] of m) console.log(k, xs.length, 'trades', sum(xs).toFixed(0));

const liveStart = Date.UTC(2026, 10, 10) / 1000;
const since = tr.filter((t) => t.entryTime >= liveStart);
console.log(`\n## Since live start (10 Nov): ${since.length} closed sim trades, ${sum(since).toFixed(1)} $/ETH, wins ${since.filter((t) => t.netPnl > 0).length}`);

console.log('\n## Cost sensitivity (per-ETH: full period / last year)');
const ly = end - 365 * 86400;
const costs: Array<[string, Params]> = [
  ['as tested (1 tick slip)', live],
  ['3 ticks slip', { ...live, SLIPPAGE_TICKS: 3 }],
  ['10 ticks slip ($0.50)', { ...live, SLIPPAGE_TICKS: 10 }],
  ['40 ticks slip ($2)', { ...live, SLIPPAGE_TICKS: 40 }],
];
for (const [name, p] of costs) {
  const x = run(p);
  console.log(name.padEnd(26), sum(x).toFixed(0).padStart(6), sum(x.filter((t) => t.entryTime >= ly)).toFixed(0).padStart(6));
}

console.log('\n## Account at live sizing (20% risk), $195 start, by start date');
for (const days of [365, 180, 90, 30]) {
  const from = end - days * 86400;
  let bal = 195, peak = 195, mdd = 0, minBal = 195;
  for (const t of tr.filter((x) => x.entryTime >= from)) {
    const th = riskFor(bal, peak, live);
    const s = contractsFor({ balanceUsd: bal, price: t.entry, riskDist: t.riskDist!, risk: th.risk, leverage: live.LEVERAGE, maxContracts: live.MAX_CONTRACTS, feeRate: live.FEE_RATE, tick: live.TICK, slippageTicks: live.SLIPPAGE_TICKS });
    bal += s.contracts * live.CONTRACT_VALUE * t.netPnl;
    peak = Math.max(th.peak, bal);
    mdd = Math.max(mdd, (peak - bal) / peak);
    minBal = Math.min(minBal, bal);
  }
  console.log(`last ${days}d: $195 -> $${bal.toFixed(0)}, lowest $${minBal.toFixed(0)}, worst fall ${(mdd * 100).toFixed(0)}%`);
}
