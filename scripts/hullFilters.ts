// Can this session's entry filters improve the LIVE Hull strategy (exits unchanged: 2×ATR stop, BE 0.5R, trail)?
// npx tsx scripts/hullFilters.ts
// Filters are CHOSEN on the older period and REPORTED on the last 365 days (never used for choosing).
// Same simulator, entry gate (weekend, MIN_ATR) and fees as the live bot. Per 1 ETH.

import { readFileSync, writeFileSync } from 'node:fs';
import { DEFAULT_PARAMS } from '../src/config/params.js';
import { entryGate } from '../src/core/entryGate.js';
import { atrPine, utTrailingStop } from '../src/core/indicators.js';
import { computeAll } from '../src/core/signals.js';
import { simulate } from '../src/core/simulator.js';
import type { Candle, SimTrade } from '../src/shared/types.js';
import { fetchHistory } from './lib/candles.js';

const H = 3600;
const p = { ...DEFAULT_PARAMS, STRATEGY: 'hull' as const, SKIP_WEEKEND_ENTRIES: true, MIN_ATR: 15, ATR_GATE_MAX: 0 };
const cache = JSON.parse(readFileSync('data/eth_1h_cache.json', 'utf8')) as Candle[];
const by = new Map<number, Candle>();
for (const x of [...cache, ...(await fetchHistory(3, '1h'))]) by.set(x.time, x);
const c = [...by.values()].sort((a, b) => a.time - b.time).filter((x) => x.high > x.low || x.volume > 0);
const end = c[c.length - 1].time;
const testFrom = end - 365 * 86400;
const from = c[300].time;
const mid = from + (testFrom - from) / 2;

const ind = computeAll(c, p);
const gate = entryGate(c, p);
const close = c.map((x) => x.close);
const sma = (x: number[], n: number) => {
  const out = new Array<number>(x.length).fill(NaN);
  let s = 0;
  for (let i = 0; i < x.length; i++) {
    s += x[i];
    if (i >= n) s -= x[i - n];
    if (i >= n - 1) out[i] = s / n;
  }
  return out;
};
const rma = (x: number[], n: number) => {
  const out = new Array<number>(x.length).fill(NaN);
  let s = 0;
  for (let i = 0; i < x.length; i++) {
    if (i < n) {
      s += x[i];
      if (i === n - 1) out[i] = s / n;
    } else out[i] = (out[i - 1] * (n - 1) + x[i]) / n;
  }
  return out;
};
const TR = c.map((b, i) => (i ? Math.max(b.high - b.low, Math.abs(b.high - c[i - 1].close), Math.abs(b.low - c[i - 1].close)) : b.high - b.low));
const ATR14 = atrPine(c, 14);
const ATR10 = atrPine(c, 10);
const ATR10_AVG = sma(ATR10.map((x) => (Number.isNaN(x) ? 0 : x)), 50);
const VOL_AVG = sma(c.map((x) => x.volume), 20);
const BB_W = (() => {
  const m = sma(close, 20);
  return close.map((_, i) => {
    if (i < 19) return NaN;
    let v = 0;
    for (let k = i - 19; k <= i; k++) v += (close[k] - m[i]) ** 2;
    return (4 * Math.sqrt(v / 20)) / m[i];
  });
})();
const BB_W_AVG = sma(BB_W.map((x) => (Number.isNaN(x) ? 0 : x)), 100);
const ADX = (() => {
  const pdm = c.map((b, i) => (i && b.high - c[i - 1].high > c[i - 1].low - b.low && b.high - c[i - 1].high > 0 ? b.high - c[i - 1].high : 0));
  const mdm = c.map((b, i) => (i && c[i - 1].low - b.low > b.high - c[i - 1].high && c[i - 1].low - b.low > 0 ? c[i - 1].low - b.low : 0));
  const tr = rma(TR, 14);
  const pp = rma(pdm, 14).map((v, i) => (100 * v) / tr[i]);
  const mm = rma(mdm, 14).map((v, i) => (100 * v) / tr[i]);
  return rma(pp.map((v, i) => (Number.isNaN(v) ? 0 : (100 * Math.abs(v - mm[i])) / (v + mm[i] || 1))), 14);
})();
const CHOP = c.map((_, i) => {
  if (i < 14) return NaN;
  let s = 0, hi = -Infinity, lo = Infinity;
  for (let k = i - 13; k <= i; k++) {
    s += TR[k];
    hi = Math.max(hi, c[k].high);
    lo = Math.min(lo, c[k].low);
  }
  return (100 * Math.log10(s / (hi - lo))) / Math.log10(14);
});
const hhN = (i: number, n: number) => Math.max(...c.slice(i - n, i).map((x) => x.high));
const llN = (i: number, n: number) => Math.min(...c.slice(i - n, i).map((x) => x.low));
const utUp1h = computeAll(c, { ...p, UT_KEY: 1, UT_ATR: 10 }).utUp;

// 4h UT(1,10) direction of the 4h bar completed before the current one (Pine dir[1], lookahead_on).
const dir4h = new Array<number>(c.length).fill(NaN);
{
  const c4: Candle[] = [];
  const owner: number[] = [];
  for (let i = 0; i < c.length; i++) {
    const b = c[i];
    const start = Math.floor(b.time / (4 * H)) * 4 * H;
    const cur = c4[c4.length - 1];
    if (!cur || cur.time !== start) c4.push({ ...b, time: start });
    else {
      cur.high = Math.max(cur.high, b.high);
      cur.low = Math.min(cur.low, b.low);
      cur.close = b.close;
    }
    owner[i] = c4.length - 1;
  }
  const st = utTrailingStop(c4.map((x) => x.close), atrPine(c4, 10), 1);
  for (let i = 0; i < c.length; i++) {
    const k = owner[i] - 1;
    dir4h[i] = k >= 30 ? (c4[k].close > st[k] ? 1 : -1) : NaN;
  }
}

type F = (i: number, s: 1 | -1) => boolean;
const FILTERS: Record<string, F> = {
  ut4h: (i, s) => dir4h[i] === s,
  ut1h: (i, s) => (utUp1h[i] ? 1 : -1) === s,
  donchian10: (i, s) => (s === 1 ? close[i] > hhN(i, 10) : close[i] < llN(i, 10)),
  donchian20: (i, s) => (s === 1 ? close[i] > hhN(i, 20) : close[i] < llN(i, 20)),
  bbExpand: (i) => BB_W[i] > BB_W_AVG[i],
  adx20: (i) => ADX[i] > 20,
  chop50: (i) => CHOP[i] < 50,
  chop618: (i) => CHOP[i] < 61.8,
  strongBar: (i, s) => {
    const b = c[i];
    const rng = b.high - b.low || 1e-9;
    return (b.close - b.open) * s >= 0.5 * ATR14[i] && (s === 1 ? (b.close - b.low) / rng >= 0.7 : (b.high - b.close) / rng >= 0.7);
  },
  volume: (i) => c[i].volume > 1.5 * VOL_AVG[i],
  atrExpand: (i) => ATR10[i] > ATR10_AVG[i],
};

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
const months = (xs: SimTrade[]) => {
  const m = new Map<string, number>();
  for (const t of xs) m.set(new Date(t.entryTime * 1000).toISOString().slice(0, 7), (m.get(new Date(t.entryTime * 1000).toISOString().slice(0, 7)) ?? 0) + t.netPnl);
  return `${[...m.values()].filter((x) => x > 0).length}/${m.size}`;
};

const names = Object.keys(FILTERS);
const combos: string[][] = [[]];
for (let a = 0; a < names.length; a++) {
  combos.push([names[a]]);
  for (let b = a + 1; b < names.length; b++) combos.push([names[a], names[b]]);
}
type Row = { rule: string; tr: ReturnType<typeof stats>; a: ReturnType<typeof stats>; b: ReturnType<typeof stats>; te: ReturnType<typeof stats>; full: ReturnType<typeof stats>; m: string };
const rows: Row[] = [];
for (const f of combos) {
  const fs = f.map((k) => FILTERS[k]);
  const trades = simulate('hull', c, ind.sigHull, p, {
    allowEntryAt: (i, side) => gate(i) === null && fs.every((fn) => fn(i, side === 'buy' ? 1 : -1)),
  }).filter((t) => t.entryTime >= from);
  const train = trades.filter((t) => t.entryTime < testFrom);
  const test = trades.filter((t) => t.entryTime >= testFrom);
  rows.push({ rule: f.length ? f.join(' + ') : 'LIVE BOT (no extra filter)', tr: stats(train), a: stats(train.filter((t) => t.entryTime < mid)), b: stats(train.filter((t) => t.entryTime >= mid)), te: stats(test), full: stats(trades), m: months(test) });
}
const base = rows[0];
// Chosen on TRAIN only: ≥ 40 train trades, beats the live bot's train profit factor AND is profitable in both train halves.
const pick = rows.slice(1).filter((r) => r.tr.n >= 40 && r.tr.pf > base.tr.pf && r.a.net > 0 && r.b.net > 0).sort((x, y) => y.tr.pf - x.tr.pf);
const iso = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
const line = (r: Row) =>
  `| ${r.rule} | ${r.tr.n} | ${r.tr.net.toFixed(0)} | ${r.tr.pf.toFixed(2)} | ${r.te.n} | ${(r.te.win * 100).toFixed(0)}% | **${r.te.net.toFixed(0)}** | ${r.te.pf.toFixed(2)} | ${r.te.dd.toFixed(0)} | ${r.m} | ${r.full.net.toFixed(0)} | ${r.full.dd.toFixed(0)} |`;
const out = [
  '# Live Hull bot + entry filters',
  '',
  `Older period (filters chosen here): ${iso(from)} → ${iso(testFrom)}. Last 365 days (judged only): ${iso(testFrom)} → ${iso(end)}.`,
  `Exits unchanged (stop ${p.SL_ATR_MULT}×ATR clamp $${p.SL_MIN}–$${p.SL_MAX}, BE ${p.BE_TRIG_R}R, trail ${p.TRAIL_ATR_MULT}×ATR after ${p.TRAIL_TRIG_R}R); weekend + MIN_ATR gate as live. Per 1 ETH after fees.`,
  `${rows.length} rules tried; ${pick.length} beat the live bot on the older period (PF, both halves profitable, ≥ 40 trades).`,
  '',
  '| Rule | Older trades | Older net $ | Older PF | Last-yr trades | Last-yr win % | Last-yr net $ | Last-yr PF | Last-yr max DD $ | Last-yr months + | Full net $ | Full max DD $ |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|',
  line(base),
  ...pick.slice(0, 15).map(line),
];
const both = rows.slice(1).filter((r) => r.tr.net > base.tr.net && r.te.net > base.te.net);
out.push("", `Rules that beat the live bot on net profit in BOTH periods: ${both.length ? both.map((r) => r.rule).join(", ") : "none"}.`, "", "Top 5 by last-year net (shown for transparency; picking from this list would be fitting to the test year):", "", ...rows.slice(1).sort((x, y) => y.te.net - x.te.net).slice(0, 5).map(line));
writeFileSync("docs/hull-filters.md", out.join("\n"));
console.log(out.join('\n'));
