// Chop filters for the LIVE Hull bot: a higher MIN_ATR, a minimum Hull slope, and both together.
// npx tsx scripts/hullChop.ts
// Rules are CHOSEN on the older period and REPORTED on the last 365 days. Exits are the live ones (params.ts). Per 1 ETH.
// Slope = |HULL[t] − HULL[t−2]| at the signal bar, in units of ATR(14).

import { readFileSync, writeFileSync } from 'node:fs';
import { DEFAULT_PARAMS } from '../src/config/params.js';
import { entryGate } from '../src/core/entryGate.js';
import { atrPine } from '../src/core/indicators.js';
import { computeAll } from '../src/core/signals.js';
import { simulate } from '../src/core/simulator.js';
import type { Candle, SimTrade } from '../src/shared/types.js';
import { fetchHistory } from './lib/candles.js';

const base = { ...DEFAULT_PARAMS, STRATEGY: 'hull' as const, SKIP_WEEKEND_ENTRIES: true, ATR_GATE_MAX: 0 };
const cache = JSON.parse(readFileSync('data/eth_1h_cache.json', 'utf8')) as Candle[];
const by = new Map<number, Candle>();
for (const x of [...cache, ...(await fetchHistory(3, '1h'))]) by.set(x.time, x);
const c = [...by.values()].sort((a, b) => a.time - b.time).filter((x) => x.high > x.low || x.volume > 0);
const end = c[c.length - 1].time;
const testFrom = end - 365 * 86400;
const from = c[300].time;
const mid = from + (testFrom - from) / 2;

const ind = computeAll(c, base);
const atr = atrPine(c, base.ATR_LEN);
const slope = (i: number) => Math.abs(ind.hull[i] - ind.hull[i - 2]) / atr[i];

const stats = (xs: SimTrade[]) => {
  let e = 0, pk = 0, dd = 0, w = 0, gw = 0, gl = 0;
  for (const t of xs) {
    e += t.netPnl;
    pk = Math.max(pk, e);
    dd = Math.max(dd, pk - e);
    if (t.netPnl > 0) { w++; gw += t.netPnl; } else gl -= t.netPnl;
  }
  return { n: xs.length, net: e, dd, win: xs.length ? w / xs.length : 0, pf: gl ? gw / gl : 99 };
};
type S = ReturnType<typeof stats>;
type Row = { rule: string; tr: S; a: S; b: S; te: S; full: S };

const MIN_ATRS = [15, 16, 17, 18, 20, 22];
const SLOPES = [0, 0.02, 0.03, 0.05, 0.075, 0.1, 0.15];
const rows: Row[] = [];
for (const minAtr of MIN_ATRS) {
  for (const k of SLOPES) {
    const p = { ...base, MIN_ATR: minAtr };
    const gate = entryGate(c, p);
    const trades = simulate('hull', c, ind.sigHull, p, {
      allowEntryAt: (i) => gate(i) === null && (k === 0 || slope(i) >= k),
    }).filter((t) => t.entryTime >= from);
    const train = trades.filter((t) => t.entryTime < testFrom);
    const test = trades.filter((t) => t.entryTime >= testFrom);
    rows.push({
      rule: minAtr === 15 && k === 0 ? 'LIVE BOT (MIN_ATR 15, no slope)' : `MIN_ATR ${minAtr}${k ? ` + slope ≥ ${k}×ATR` : ''}`,
      tr: stats(train), a: stats(train.filter((t) => t.entryTime < mid)), b: stats(train.filter((t) => t.entryTime >= mid)), te: stats(test), full: stats(trades),
    });
  }
}
const live = rows[0];
// Chosen on the older period only: ≥ 40 trades, higher net AND higher PF than live, both halves profitable.
const pick = rows.slice(1).filter((r) => r.tr.n >= 40 && r.tr.net > live.tr.net && r.tr.pf > live.tr.pf && r.a.net > 0 && r.b.net > 0).sort((x, y) => y.tr.net - x.tr.net);
const both = rows.slice(1).filter((r) => r.tr.net > live.tr.net && r.te.net > live.te.net);

// The three recent live trades: would each rule's slope part have blocked them?
const recent = ['2026-11-16T10:00:00Z', '2026-11-17T02:00:00Z', '2026-11-17T03:00:00Z'].map((s) => {
  const i = c.findIndex((x) => x.time === Date.parse(s) / 1000);
  return i < 0 ? `${s}: candle not found` : `${s} (signal ${ind.sigHull[i]}): slope ${slope(i).toFixed(4)}×ATR, ATR ${atr[i].toFixed(2)}`;
});

const iso = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
const line = (r: Row) =>
  `| ${r.rule} | ${r.tr.n} | ${r.tr.net.toFixed(0)} | ${r.tr.pf.toFixed(2)} | ${r.te.n} | ${(r.te.win * 100).toFixed(0)}% | **${r.te.net.toFixed(0)}** | ${r.te.pf.toFixed(2)} | ${r.te.dd.toFixed(0)} | ${r.full.net.toFixed(0)} | ${r.full.dd.toFixed(0)} |`;
const head = ['| Rule | Older trades | Older net $ | Older PF | Last-yr trades | Last-yr win % | Last-yr net $ | Last-yr PF | Last-yr max DD $ | Full net $ | Full max DD $ |', '|---|---|---|---|---|---|---|---|---|---|---|'];
const out = [
  '# Live Hull bot: chop filters (MIN_ATR, Hull slope)',
  '',
  `Older period (rules chosen here): ${iso(from)} → ${iso(testFrom)}. Last 365 days (judged only): ${iso(testFrom)} → ${iso(end)}.`,
  `Exits as live: stop ${base.SL_ATR_MULT}×ATR clamp $${base.SL_MIN}–$${base.SL_MAX}, BE ${base.BE_TRIG_R}R, trail ${base.TRAIL_ATR_MULT}×ATR after ${base.TRAIL_TRIG_R}R; weekend gate on. Per 1 ETH after fees.`,
  `${rows.length} rules tried; ${pick.length} beat the live bot on the older period (net and PF, both halves profitable, ≥ 40 trades).`,
  '',
  '## Live bot and rules chosen on the older period',
  '',
  ...head,
  line(live),
  ...pick.slice(0, 15).map(line),
  '',
  `Rules that beat the live bot on net profit in BOTH periods: ${both.length ? both.map((r) => r.rule).join(', ') : 'none'}.`,
  '',
  '## All rules',
  '',
  ...head,
  ...rows.map(line),
  '',
  '## Recent live signals',
  '',
  ...recent.map((s) => `- ${s}`),
];
writeFileSync('docs/hull-chop.md', out.join('\n'));
console.log(out.join('\n'));
