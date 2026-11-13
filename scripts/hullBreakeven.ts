// Live Hull with different break-even (cost-to-cost) triggers. Everything else as live.
// npx tsx scripts/hullBreakeven.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { DEFAULT_PARAMS } from '../src/config/params.js';
import { entryGate } from '../src/core/entryGate.js';
import { computeAll } from '../src/core/signals.js';
import { simulate } from '../src/core/simulator.js';
import { contractsFor, riskFor } from '../src/core/sizing.js';
import type { Candle, SimTrade } from '../src/shared/types.js';

const c = (JSON.parse(readFileSync('data/eth_1h_cache.json', 'utf8')) as Candle[]).filter((x) => x.high > x.low || x.volume > 0);
const testFrom = c[c.length - 1].time - 365 * 86400;
const live = { ...DEFAULT_PARAMS, STRATEGY: 'hull' as const, MIN_ATR: 15, SKIP_WEEKEND_ENTRIES: true, MAX_CONTRACTS: 100 };

const st = (xs: SimTrade[]) => {
  let e = 0, pk = 0, dd = 0, w = 0;
  for (const t of xs) { e += t.netPnl; pk = Math.max(pk, e); dd = Math.max(dd, pk - e); if (t.netPnl > 0) w++; }
  return { n: xs.length, net: e, dd, win: xs.length ? w / xs.length : 0 };
};
function account(xs: SimTrade[], p: typeof live) {
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
const sizeNow = live;
const size10 = { ...live, RISK_PER_TRADE: 0.1, RISK_REDUCED: 0.1, MAX_CONTRACTS: 5000 };

const out = [
  '# Live Hull: when to move the stop to cost (break-even trigger)',
  '',
  'Per 1 ETH after fees; account columns start at $195 and show end balance (worst fall). "Today" = 20% risk, risk cut, 1 ETH cap; "10%" = 10% risk, no risk cut, no 1 ETH cap.',
  '',
  '| Move stop to cost at | Win % | Per-ETH older | Per-ETH last yr | Per-ETH full | Max DD $/ETH | Account last yr (today) | Account full (today) | Account last yr (10%) | Account full (10%) |',
  '|---|---|---|---|---|---|---|---|---|---|',
];
for (const tp of [0.5, 0.25, 0.75, 1, 1.5, 0]) {
  const p = { ...live, BE_TRIG_R: tp };
  const g = entryGate(c, p);
  const tr = simulate('hull', c, computeAll(c, p).sigHull, p, { allowEntryAt: (i) => g(i) === null }).filter((t) => t.entryTime >= c[300].time);
  const o = st(tr.filter((t) => t.entryTime < testFrom));
  const l = st(tr.filter((t) => t.entryTime >= testFrom));
  const a = st(tr);
  const ly = tr.filter((t) => t.entryTime >= testFrom);
  out.push(`| ${tp === 0.5 ? '0.5R profit (live)' : tp ? tp + 'R profit' : 'never'} | ${Math.round(a.win * 100)}% | ${o.net.toFixed(0)} | ${l.net.toFixed(0)} | **${a.net.toFixed(0)}** | ${a.dd.toFixed(0)} | ${account(ly, sizeNow)} | ${account(tr, sizeNow)} | ${account(ly, size10)} | ${account(tr, size10)} |`);
}
writeFileSync('docs/hull-breakeven.md', out.join('\n'));
console.log(out.join('\n'));
