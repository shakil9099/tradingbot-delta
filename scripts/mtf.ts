// Multi-timeframe test: trend from 4h EMA50 vs EMA200, entries on a 15m Hull(55) flip in the trend's direction.
// Exits as live, on 15m: stop max($10, 2×ATR14), cost-to-cost at +$15 (or 1R), trail 3×ATR from 1.5R, no TP;
// plus a close when the 4h trend flips against the position. Compared with the live 1h Hull bot.
// npx tsx scripts/mtf.ts            (cache + fresh candles from Delta)
// Writes docs/mtf-4h-15m.md
import { readFileSync, writeFileSync } from 'node:fs';
import { DEFAULT_PARAMS, type Params } from '../src/config/params.js';
import { entryGate } from '../src/core/entryGate.js';
import { atrPine, hma } from '../src/core/indicators.js';
import { computeAll, hullSignals } from '../src/core/signals.js';
import { simulate } from '../src/core/simulator.js';
import { contractsFor, riskFor } from '../src/core/sizing.js';
import type { Candle, Side, Signal, SimTrade } from '../src/shared/types.js';
import { fetchHistory } from './lib/candles.js';
import { ema } from './lib/ta.js';

const H4 = 4 * 3600;
const M15 = 900;

async function load(file: string, res: '1h' | '15m', pages: number): Promise<Candle[]> {
  const m = new Map((JSON.parse(readFileSync(file, 'utf8')) as Candle[]).map((x) => [x.time, x]));
  for (const x of await fetchHistory(pages, res)) m.set(x.time, x);
  return [...m.values()].sort((a, b) => a.time - b.time).filter((x) => x.high > x.low || x.volume > 0);
}
const c1h = await load('data/eth_1h_cache.json', '1h', 2);
const c15 = await load('data/eth_15m_cache.json', '15m', 4);

// 4h candles from 1h, aligned to 00/04/08/12/16/20 UTC; only complete groups of four.
const groups = new Map<number, Candle[]>();
for (const b of c1h) {
  const k = Math.floor(b.time / H4) * H4;
  groups.set(k, [...(groups.get(k) ?? []), b]);
}
const c4 = [...groups.entries()]
  .filter(([, g]) => g.length === 4)
  .sort((a, b) => a[0] - b[0])
  .map(([time, g]) => ({ time, open: g[0].open, high: Math.max(...g.map((x) => x.high)), low: Math.min(...g.map((x) => x.low)), close: g[3].close, volume: g.reduce((s, x) => s + x.volume, 0) }));
const close4 = c4.map((x) => x.close);
const e50 = ema(close4, 50);
const e200 = ema(close4, 200);
const trend4 = c4.map((_, i) => (Number.isFinite(e200[i]) ? (e50[i] > e200[i] ? 1 : -1) : 0));

// Trend seen at each 15m close: the last 4h candle that had fully closed by then (no look-ahead).
const trendAt: number[] = [];
let j = -1;
for (const b of c15) {
  const closeTime = b.time + M15;
  while (j + 1 < c4.length && c4[j + 1].time + H4 <= closeTime) j++;
  trendAt.push(j >= 0 ? trend4[j] : 0);
}

const live: Params = { ...DEFAULT_PARAMS, STRATEGY: 'hull', MIN_ATR: 15, SKIP_WEEKEND_ENTRIES: true, MAX_CONTRACTS: 100, BE_TRIG_USD: 15 };
// 15m: the $15 ATR floor is an hourly number and would block nearly every 15m entry, so it is off.
const p15: Params = { ...live, MIN_ATR: 0 };

/** 15m Hull flips, filtered by the 4h trend; a 4h flip against the position is sent as a close-only signal. */
function mtfTrades(filter: boolean): SimTrade[] {
  const raw = hullSignals(hma(c15.map((x) => x.close), p15.HULL_LEN));
  const sig: Signal[] = raw.map((s, t) => {
    if (t < p15.WARMUP || trendAt[t] === 0) return 'NONE';
    if (!filter) return s;
    return (s === 'LONG' && trendAt[t] === 1) || (s === 'SHORT' && trendAt[t] === -1) ? s : 'NONE';
  });
  const flipBar = new Set<number>();
  if (filter) {
    for (let t = 1; t < c15.length; t++) {
      if (trendAt[t] !== 0 && trendAt[t - 1] !== 0 && trendAt[t] !== trendAt[t - 1] && sig[t] === 'NONE') {
        sig[t] = trendAt[t] === 1 ? 'LONG' : 'SHORT'; // closes an opposite position; never opens one (below)
        flipBar.add(t);
      }
    }
  }
  const atr = atrPine(c15, p15.ATR_LEN);
  const g = entryGate(c15, p15, atr);
  return simulate('hull', c15, sig, p15, { atr, allowEntryAt: (i: number, _s?: Side) => !flipBar.has(i) && g(i) === null });
}
function hull1h(): SimTrade[] {
  const g = entryGate(c1h, live);
  return simulate('hull', c1h, computeAll(c1h, live).sigHull, live, { allowEntryAt: (i) => g(i) === null });
}

// Common start: once the 4h EMA200 is valid (about 33 days in) for every row.
const start = c15[trendAt.findIndex((x) => x !== 0) + p15.WARMUP].time;
const end = Math.min(c15[c15.length - 1].time, c1h[c1h.length - 1].time);
const ly = end - 365 * 86400;
const rows: Array<[string, SimTrade[]]> = [
  ['Live today: Hull 1h (+$15 cost-to-cost)', hull1h()],
  ['4h EMA50/200 trend + 15m Hull entry', mtfTrades(true)],
  ['15m Hull entry, no 4h filter', mtfTrades(false)],
].map(([n, t]) => [n as string, (t as SimTrade[]).filter((x) => x.entryTime >= start)]);

const st = (xs: SimTrade[]) => {
  let e = 0, pk = 0, dd = 0, w = 0, fees = 0;
  for (const t of xs) { e += t.netPnl; pk = Math.max(pk, e); dd = Math.max(dd, pk - e); if (t.netPnl > 0) w++; fees += t.fees; }
  return { n: xs.length, net: e, dd, win: xs.length ? w / xs.length : 0, fees };
};
function account(xs: SimTrade[], fixed: number, from: number) {
  let bal = 176, peak = 176, mdd = 0;
  for (const t of xs.filter((x) => x.entryTime >= from)) {
    const th = riskFor(bal, peak, live);
    const s = contractsFor({ balanceUsd: bal, price: t.entry, riskDist: t.riskDist!, risk: th.risk, leverage: live.LEVERAGE, maxContracts: live.MAX_CONTRACTS, feeRate: live.FEE_RATE, tick: live.TICK, slippageTicks: live.SLIPPAGE_TICKS, fixedContracts: fixed });
    bal += s.contracts * live.CONTRACT_VALUE * t.netPnl;
    peak = Math.max(th.peak, bal);
    mdd = Math.max(mdd, (peak - bal) / peak);
    if (bal <= 0) return '$0 (wiped out)';
  }
  return `$${bal.toFixed(0)} (worst fall ${(mdd * 100).toFixed(0)}%)`;
}

const iso = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
const out = [
  '# 4h trend + 15m entry vs the live 1h bot',
  '',
  `ETHUSD, ${iso(start)} to ${iso(end)}. Per-ETH columns: $ per 1 ETH after fees and one tick of slippage each way. "Last yr" = final 365 days.`,
  '4h trend = EMA50 vs EMA200 of closed 4h candles. 15m entry = Hull(55) flip in the trend direction. Exits on 15m: stop max($10, 2×ATR14) (no entry if over $40),',
  'cost-to-cost at +$15 or 1R, trail 3×ATR from 1.5R, no TP, and a close when the 4h trend flips. 15m rows skip the $15 ATR floor (an hourly number). No weekend entries.',
  '',
  '| Setup | Trades | Win % | Fees $/ETH | Per-ETH older | Per-ETH last yr | Per-ETH full | Max DD $/ETH |',
  '|---|---|---|---|---|---|---|---|',
];
for (const [n, t] of rows) {
  const a = st(t), o = st(t.filter((x) => x.entryTime < ly)), l = st(t.filter((x) => x.entryTime >= ly));
  out.push(`| ${n} | ${a.n} | ${Math.round(a.win * 100)}% | ${a.fees.toFixed(0)} | ${o.net.toFixed(0)} | ${l.net.toFixed(0)} | **${a.net.toFixed(0)}** | ${a.dd.toFixed(0)} |`);
}
out.push('', '## Account from $176', '', 'Risk = live risk sizing (20%, 5% after a 20% fall from peak). Fixed = 1 ETH every trade (margin permitting).', '');
out.push('| Setup | Since 10 Nov (risk) | Since 10 Nov (1 ETH) | Last 90 days (risk) | Last 90 days (1 ETH) | Last year (risk) | Last year (1 ETH) |', '|---|---|---|---|---|---|---|');
const nov10 = Date.UTC(2026, 10, 10) / 1000;
const d90 = end - 90 * 86400;
for (const [n, t] of rows) {
  out.push(`| ${n} | ${account(t, 0, nov10)} | ${account(t, 100, nov10)} | ${account(t, 0, d90)} | ${account(t, 100, d90)} | ${account(t, 0, ly)} | ${account(t, 100, ly)} |`);
}
writeFileSync('docs/mtf-4h-15m.md', out.join('\n') + '\n');
console.log(out.join('\n'));
