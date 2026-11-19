// Reversal (pine/reversal.pine) with a take-profit sweep, against live Hull. Same entry filters, fees and sizing as live.
// npx tsx scripts/reversal.ts            (cache + fresh candles from Delta, so it runs up to the last closed hour)
// npx tsx scripts/reversal.ts --offline  (cache only)
import { readFileSync, writeFileSync } from 'node:fs';
import { DEFAULT_PARAMS, withStrategyPreset, type Params } from '../src/config/params.js';
import { entryGate } from '../src/core/entryGate.js';
import { computeAll } from '../src/core/signals.js';
import { simulate } from '../src/core/simulator.js';
import { contractsFor, riskFor } from '../src/core/sizing.js';
import type { Candle, SimTrade } from '../src/shared/types.js';
import { fetchHistory } from './lib/candles.js';

const cached = JSON.parse(readFileSync('data/eth_1h_cache.json', 'utf8')) as Candle[];
const byTime = new Map(cached.map((x) => [x.time, x]));
if (!process.argv.includes('--offline')) for (const x of await fetchHistory(2)) byTime.set(x.time, x);
const c = [...byTime.values()].sort((a, b) => a.time - b.time).filter((x) => x.high > x.low || x.volume > 0);
const testFrom = c[c.length - 1].time - 365 * 86400;
const iso = (t: number) => new Date(t * 1000).toISOString().slice(0, 16).replace('T', ' ');
const ist = (t: number) => new Date((t + 19800) * 1000).toISOString().slice(5, 16).replace('T', ' ');

const live: Params = { ...DEFAULT_PARAMS, STRATEGY: 'hull', MIN_ATR: 15, SKIP_WEEKEND_ENTRIES: true, MAX_CONTRACTS: 100 };
const revP = (tp: number): Params => withStrategyPreset({ ...live, STRATEGY: 'reversal' }, tp);

const st = (xs: SimTrade[]) => {
  let e = 0, pk = 0, dd = 0, w = 0;
  for (const t of xs) { e += t.netPnl; pk = Math.max(pk, e); dd = Math.max(dd, pk - e); if (t.netPnl > 0) w++; }
  return { n: xs.length, net: e, dd, win: xs.length ? w / xs.length : 0 };
};
/** Live sizing (20% risk, risk cut in drawdown, 1 ETH cap) from $195; end balance and worst fall. */
function account(xs: SimTrade[], p: Params) {
  let bal = 195, peak = 195, mdd = 0;
  for (const t of xs) {
    const th = riskFor(bal, peak, p);
    const s = contractsFor({ balanceUsd: bal, price: t.entry, riskDist: t.riskDist!, risk: th.risk, leverage: p.LEVERAGE, maxContracts: p.MAX_CONTRACTS, feeRate: p.FEE_RATE, tick: p.TICK, slippageTicks: p.SLIPPAGE_TICKS });
    bal += s.contracts * p.CONTRACT_VALUE * t.netPnl;
    peak = Math.max(th.peak, bal);
    mdd = Math.max(mdd, (peak - bal) / peak);
  }
  return `$${bal.toFixed(0)} (${(mdd * 100).toFixed(0)}%)`;
}
function run(strategy: 'hull' | 'reversal', p: Params): SimTrade[] {
  const g = entryGate(c, p);
  const ind = computeAll(c, p);
  const sig = strategy === 'hull' ? ind.sigHull : ind.sigRev;
  return simulate(strategy, c, sig, p, { allowEntryAt: (i) => g(i) === null }).filter((t) => t.entryTime >= c[300].time);
}

const out = [
  '# Reversal strategy backtest',
  '',
  `ETHUSD 1h, ${iso(c[300].time)} to ${iso(c[c.length - 1].time)} UTC. "Last yr" = the final 365 days, "older" = before that.`,
  'Reversal = pine/reversal.pine (Medium: max(2×ATR14, 0.1% of close)), stop 2×ATR (10–40), no break-even, no trail, exit on TP, SL or the opposite signal (which reverses).',
  'Hull = live today (break-even 1R, 3×ATR trail from 1.5R, no TP). Both: no weekend entries, MIN_ATR 15, SL_MAX 40, fees and one tick slippage each way.',
  'When one bar touches both stop and TP the simulator counts the stop (cautious). Per-ETH columns are $ per 1 ETH. Account = live sizing from $195: end balance (worst fall).',
  '',
  '| Strategy | Take-profit | Trades | Win % | Per-ETH older | Per-ETH last yr | Per-ETH full | Max DD $/ETH | Account last yr | Account full |',
  '|---|---|---|---|---|---|---|---|---|---|',
];
const row = (name: string, tp: string, tr: SimTrade[], p: Params) => {
  const o = st(tr.filter((t) => t.entryTime < testFrom));
  const ly = tr.filter((t) => t.entryTime >= testFrom);
  const l = st(ly);
  const a = st(tr);
  out.push(`| ${name} | ${tp} | ${a.n} | ${Math.round(a.win * 100)}% | ${o.net.toFixed(0)} | ${l.net.toFixed(0)} | **${a.net.toFixed(0)}** | ${a.dd.toFixed(0)} | ${account(ly, p)} | ${account(tr, p)} |`);
};
row('Hull (live)', 'none', run('hull', live), live);
const revRuns = new Map<number, SimTrade[]>();
for (const tp of [0, 1, 1.5, 2, 3, 4]) {
  const p = revP(tp);
  const tr = run('reversal', p);
  revRuns.set(tp, tr);
  row('Reversal', tp ? `${tp}R` : 'none', tr, p);
}

// Exit mix for each TP, to see how often the TP, the stop and the opposite signal end a trade.
out.push('', '## How reversal trades end', '', '| Take-profit | TP | Stop | Opposite signal |', '|---|---|---|---|');
for (const [tp, tr] of revRuns) {
  const k = (f: (r: string) => boolean) => `${Math.round((tr.filter((t) => f(t.reason)).length / tr.length) * 100)}%`;
  out.push(`| ${tp ? `${tp}R` : 'none'} | ${k((r) => r === 'tp')} | ${k((r) => r.startsWith('sl_'))} | ${k((r) => r === 'reversal')} |`);
}

// The last 10 days, trade by trade: what each would have done around the recent 55-point move.
const since = c[c.length - 1].time - 10 * 86400;
const recent = (name: string, tr: SimTrade[]) => {
  out.push('', `### ${name}: trades in the last 10 days (IST)`, '', '| Entry | Side | Entry $ | Exit | Exit $ | Why | Net $/ETH |', '|---|---|---|---|---|---|---|');
  for (const t of tr.filter((x) => x.exitTime >= since)) {
    out.push(`| ${ist(t.entryTime)} | ${t.side === 'buy' ? 'long' : 'short'} | ${t.entry.toFixed(2)} | ${ist(t.exitTime)} | ${t.exit.toFixed(2)} | ${t.reason} | ${t.netPnl.toFixed(2)} |`);
  }
};
out.push('', '## Recent trades');
recent('Hull (live)', run('hull', live));
recent('Reversal, no TP', revRuns.get(0)!);
recent('Reversal, TP 2R', revRuns.get(2)!);

writeFileSync('docs/reversal-backtest.md', out.join('\n') + '\n');
console.log(out.join('\n'));
