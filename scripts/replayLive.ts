// Replays the live period (first trade 2026-11-10) from a $176 start under different rule sets.
// npx tsx scripts/replayLive.ts
import { readFileSync } from 'node:fs';
import { DEFAULT_PARAMS, type Params } from '../src/config/params.js';
import { entryGate } from '../src/core/entryGate.js';
import { computeAll } from '../src/core/signals.js';
import { simulate } from '../src/core/simulator.js';
import { contractsFor, riskFor } from '../src/core/sizing.js';
import type { Candle, SimTrade } from '../src/shared/types.js';
import { fetchHistory } from './lib/candles.js';

const START = Date.UTC(2026, 10, 10) / 1000;
const BAL0 = 176;

const byTime = new Map((JSON.parse(readFileSync('data/eth_1h_cache.json', 'utf8')) as Candle[]).map((x) => [x.time, x]));
for (const x of await fetchHistory(2)) byTime.set(x.time, x);
const c = [...byTime.values()].sort((a, b) => a.time - b.time).filter((x) => x.high > x.low || x.volume > 0);
const ist = (t: number) => new Date((t + 19800) * 1000).toISOString().slice(5, 16).replace('T', ' ');

const base: Params = { ...DEFAULT_PARAMS, STRATEGY: 'hull', MIN_ATR: 15, SKIP_WEEKEND_ENTRIES: true, MAX_CONTRACTS: 100 };
const sets: Array<[string, Params]> = [
  ['NEW: 1 ETH fixed + $15 break-even', { ...base, FIXED_CONTRACTS: 100, BE_TRIG_USD: 15 }],
  ['1 ETH fixed, break-even at 1R only', { ...base, FIXED_CONTRACTS: 100, BE_TRIG_USD: 0 }],
  ['risk sizing (20%/5%) + $15 break-even', { ...base, BE_TRIG_USD: 15 }],
  ['OLD live: risk sizing, break-even 1R', { ...base, BE_TRIG_USD: 0 }],
];

for (const [name, p] of sets) {
  const g = entryGate(c, p);
  const tr: SimTrade[] = simulate('hull', c, computeAll(c, p).sigHull, p, { allowEntryAt: (i) => g(i) === null }).filter((t) => t.entryTime >= START);
  let bal = BAL0, peak = BAL0, low = BAL0;
  const rows: string[] = [];
  for (const t of tr) {
    const th = riskFor(bal, peak, p);
    const s = contractsFor({ balanceUsd: bal, price: t.entry, riskDist: t.riskDist!, risk: th.risk, leverage: p.LEVERAGE, maxContracts: p.MAX_CONTRACTS, feeRate: p.FEE_RATE, tick: p.TICK, slippageTicks: p.SLIPPAGE_TICKS, fixedContracts: p.FIXED_CONTRACTS });
    const pnl = s.contracts * p.CONTRACT_VALUE * t.netPnl;
    bal += pnl;
    peak = Math.max(th.peak, bal);
    low = Math.min(low, bal);
    rows.push(`  ${ist(t.entryTime)} ${t.side === 'buy' ? 'long ' : 'short'} ${t.entry.toFixed(2)} → ${t.exit.toFixed(2)} ${t.reason.padEnd(12)} ${String(s.contracts).padStart(3)} ct  ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2).padStart(7)}  bal ${bal.toFixed(2)}`);
  }
  console.log(`\n## ${name}: $${BAL0} → $${bal.toFixed(2)} (lowest $${low.toFixed(2)}), ${tr.length} closed trades`);
  console.log(rows.join('\n'));
}
console.log(`\nCandles to ${ist(c[c.length - 1].time)} IST. A trade still open at the end is not counted.`);
