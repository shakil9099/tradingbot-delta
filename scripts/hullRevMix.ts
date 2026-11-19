// Hull + reversal entry mixes (2026-11-19). Every mix uses Hull's LIVE exits (break-even 1R, 3×ATR trail from 1.5R,
// no TP) and the live entry gate (no weekend entries, MIN_ATR 15, SL_MAX 40). A mix passes only if it beats plain Hull
// in BOTH the older period and the last 12 months, on per-ETH profit, without a bigger worst drop.
// npx tsx scripts/hullRevMix.ts [--offline]     → docs/hull-reversal-mix.md
import { readFileSync, writeFileSync } from 'node:fs';
import { DEFAULT_PARAMS, type Params } from '../src/config/params.js';
import { entryGate } from '../src/core/entryGate.js';
import { computeAll, direction } from '../src/core/signals.js';
import { simulate } from '../src/core/simulator.js';
import { contractsFor } from '../src/core/sizing.js';
import type { Candle, Side, Signal, SimTrade } from '../src/shared/types.js';
import { fetchHistory } from './lib/candles.js';

const cached = JSON.parse(readFileSync('data/eth_1h_cache.json', 'utf8')) as Candle[];
const byTime = new Map(cached.map((x) => [x.time, x]));
if (!process.argv.includes('--offline')) for (const x of await fetchHistory(2)) byTime.set(x.time, x);
const c = [...byTime.values()].sort((a, b) => a.time - b.time).filter((x) => x.high > x.low || x.volume > 0);
const yr = c[c.length - 1].time - 365 * 86400;
const day = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);

const p: Params = { ...DEFAULT_PARAMS, STRATEGY: 'hull', MIN_ATR: 15, SKIP_WEEKEND_ENTRIES: true, MAX_CONTRACTS: 100, BE_TRIG_USD: 0 };
const ind = computeAll(c, p);
const gate = entryGate(c, p);
const n = c.length;
const sideOf = (s: Signal): Side | null => (s === 'LONG' ? 'buy' : s === 'SHORT' ? 'sell' : null);
const dirSide = (strategy: 'hull' | 'reversal', t: number): Side | null => {
  const d = direction(strategy, ind, t);
  return d === 'up' ? 'buy' : d === 'down' ? 'sell' : null;
};

/** A mix = a signal array plus an extra entry rule. A blocked entry still closes an opposite position (as live). */
interface Mix { name: string; how: string; sig: Signal[]; allow?: (t: number, side: Side) => boolean; control?: boolean }
// Mix B comes from the live code (computeAll with REV_REENTRY → sigHullEntry), so the backtest and the bot share one rule.
const hullOrRevWithHull = computeAll(c, { ...p, REV_REENTRY: true }).sigHullEntry;
const hullOrAnyRev = ind.sigHull.map((s, t) => (s !== 'NONE' ? s : ind.sigRev[t])) as Signal[];
const isHullFlip = (t: number) => ind.sigHull[t] !== 'NONE';

const mixes: Mix[] = [
  { name: 'Hull only (live)', how: 'Enter and reverse on Hull flips.', sig: ind.sigHull, control: true },
  {
    name: 'A. Hull confirmed by reversal',
    how: "Hull flips, but enter only when reversal's direction agrees; otherwise the flip only closes.",
    sig: ind.sigHull, allow: (t, s) => dirSide('reversal', t) === s,
  },
  {
    name: 'B. Hull + re-entry on reversal',
    how: "Hull flips as live; after a stop-out, a reversal signal in Hull's direction re-enters.",
    sig: hullOrRevWithHull,
  },
  {
    name: 'C. Hull + re-entry + early exit',
    how: "As B, and a reversal signal against the open trade closes it (no new trade until a Hull flip or an agreeing reversal signal).",
    sig: hullOrAnyRev, allow: (t, s) => isHullFlip(t) || dirSide('hull', t) === s,
  },
  {
    name: "D. Reversal in Hull's direction",
    how: "Enter only on reversal signals that agree with Hull's direction; an opposite reversal signal closes.",
    sig: ind.sigRev, allow: (t, s) => dirSide('hull', t) === s,
  },
  {
    name: 'E. Either signal',
    how: 'Enter and reverse on any Hull flip or any reversal signal (Hull wins a same-bar tie).',
    sig: hullOrAnyRev,
  },
];

const run = (m: Mix): SimTrade[] =>
  simulate('hull', c, m.sig, p, { allowEntryAt: (t, s) => gate(t) === null && (m.allow ? m.allow(t, s) : true) })
    .filter((t) => t.entryTime >= c[300].time);

const st = (xs: SimTrade[]) => {
  let e = 0, pk = 0, dd = 0, w = 0;
  for (const t of xs) { e += t.netPnl; pk = Math.max(pk, e); dd = Math.max(dd, pk - e); if (t.netPnl > 0) w++; }
  return { n: xs.length, net: e, dd, win: xs.length ? w / xs.length : 0 };
};
/** $107 start, 5% risk per trade (or fixed contracts), 20x margin, ≤100 contracts: end balance and worst fall. */
const acct = (xs: SimTrade[], fixed = 0) => {
  let bal = 107, pk = 107, dd = 0;
  for (const t of xs) {
    const s = contractsFor({ balanceUsd: bal, price: t.entry, riskDist: t.riskDist!, risk: 0.05, leverage: p.LEVERAGE, maxContracts: 100, feeRate: p.FEE_RATE, tick: p.TICK, slippageTicks: p.SLIPPAGE_TICKS, fixedContracts: fixed });
    bal += s.contracts * p.CONTRACT_VALUE * t.netPnl; pk = Math.max(pk, bal); dd = Math.max(dd, (pk - bal) / pk);
  }
  return { bal, dd };
};

const res = mixes.map((m) => {
  const tr = run(m);
  const lyTr = tr.filter((t) => t.entryTime >= yr);
  return { m, tr, all: st(tr), old: st(tr.filter((t) => t.entryTime < yr)), ly: st(lyTr), a: acct(tr), f: acct(tr, 100), fly: acct(lyTr, 100) };
});
const ctl = res.find((r) => r.m.control)!;
const pass = (r: (typeof res)[number]) =>
  !r.m.control && r.old.net > ctl.old.net && r.ly.net > ctl.ly.net && r.old.dd <= ctl.old.dd && r.ly.dd <= ctl.ly.dd;

const out = [
  '# Hull + reversal entry mixes',
  '',
  `ETHUSD 1h, ${day(c[300].time)} to ${day(c[c.length - 1].time)}. "Last 12 mo" = from ${day(yr)}; "older" = before that.`,
  '',
  "Every mix uses Hull's live exits: break-even at 1R, then a 3×ATR trail from 1.5R, and no take-profit. Every mix also uses the live entry filters: no weekend entries, ATR at least 15, and a stop of at most $40. Fees and one tick of slippage are included on each side.",
  '',
  'Profit and worst drop are $ per 1 ETH traded. The account column starts at $107 and risks 5% per trade, showing the end balance and its worst fall.',
  '',
  'A mix **passes** only if it beats plain Hull in both periods, with a worst drop no bigger in either.',
  '',
  'The two "fixed 1 ETH" columns start at $107 and trade 100 contracts each time, capped by margin (about 98 contracts at $107). One starts in Feb 2024, the other 12 months ago.',
  '',
  '| Mix | Trades | Win % | Older $/ETH | Last 12 mo $/ETH | Full $/ETH | Worst drop older / last 12 mo | Account from $107, 5% risk (worst fall) | Fixed 1 ETH from $107, full (worst fall) | Fixed 1 ETH from $107, last 12 mo (worst fall) | Passes |',
  '|---|---|---|---|---|---|---|---|---|---|---|',
  ...res.map((r) => {
    const a = (x: { bal: number; dd: number }) => `$${x.bal.toFixed(0)} (${(x.dd * 100).toFixed(0)}%)`;
    return `| ${r.m.name} | ${r.all.n} | ${Math.round(r.all.win * 100)}% | ${r.old.net.toFixed(0)} | ${r.ly.net.toFixed(0)} | **${r.all.net.toFixed(0)}** | ${r.old.dd.toFixed(0)} / ${r.ly.dd.toFixed(0)} | ${a(r.a)} | ${a(r.f)} | ${a(r.fly)} | ${r.m.control ? 'control' : pass(r) ? '**yes**' : 'no'} |`;
  }),
  '',
  '## What each mix does',
  '',
  ...res.map((r) => `* **${r.m.name}:** ${r.m.how}`),
  '',
];
writeFileSync('docs/hull-reversal-mix.md', out.join('\n'));
console.log(out.join('\n'));
