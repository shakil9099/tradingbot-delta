// UT Bot (1, 10) "sniper" entry search on ETHUSD 1h. npx tsx scripts/utSniper.ts
// Rules are CHOSEN on the train period (data start → 365 days ago) and only then REPORTED on the last 365 days
// (test), which the selection never sees. Exit = opposite UT signal; no new entries Sat–Sun IST (trade held).
// Fills: next bar open (market) or a stop at the signal bar's high/low (break entry), ± 1 tick slippage,
// fee FEE_RATE per side. Per 1 ETH.

import { readFileSync, writeFileSync } from 'node:fs';
import { DEFAULT_PARAMS as P } from '../src/config/params.js';
import { atrPine, hma, utTrailingStop } from '../src/core/indicators.js';
import { computeAll } from '../src/core/signals.js';
import type { Candle } from '../src/shared/types.js';
import { fetchHistory } from './lib/candles.js';

const H = 3600;
const IST = 19800;
const FEE = P.FEE_RATE;
const SLIP = P.SLIPPAGE_TICKS * P.TICK;
type Dir = 1 | -1;

// ---------- data: cache (from 2024-02) + fresh pages up to now ----------
const cache = JSON.parse(readFileSync('data/eth_1h_cache.json', 'utf8')) as Candle[];
const fresh = await fetchHistory(3, '1h');
const byT = new Map<number, Candle>();
for (const x of [...cache, ...fresh]) byT.set(x.time, x);
const c = [...byT.values()].sort((a, b) => a.time - b.time).filter((x) => x.high > x.low || x.volume > 0);
const end = c[c.length - 1].time;
const testFrom = end - 365 * 86400;

// ---------- indicators ----------
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
const ind = computeAll(c, { ...P, UT_KEY: 1, UT_ATR: 10, WARMUP: 300 });
const ATR14 = atrPine(c, 14);
const ATR10 = atrPine(c, 10);
const ATR10_AVG = sma(ATR10.map((x) => (Number.isNaN(x) ? 0 : x)), 50);
const HULL = hma(close, 55);
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
const hh = (i: number, n: number) => Math.max(...c.slice(Math.max(0, i - n), i).map((x) => x.high));
const ll = (i: number, n: number) => Math.min(...c.slice(Math.max(0, i - n), i).map((x) => x.low));

// 4h UT(1,10) direction from completed 4h candles (UTC-aligned, as TradingView builds crypto 4h bars).
const dir4h = new Array<number>(c.length).fill(NaN);
{
  const c4: Candle[] = [];
  const owner: number[] = [];
  let cur: Candle | null = null;
  for (let i = 0; i < c.length; i++) {
    const b = c[i];
    const start = Math.floor(b.time / (4 * H)) * 4 * H;
    if (!cur || cur.time !== start) {
      cur = { time: start, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume };
      c4.push(cur);
    } else {
      cur.high = Math.max(cur.high, b.high);
      cur.low = Math.min(cur.low, b.low);
      cur.close = b.close;
      cur.volume += b.volume;
    }
    owner[i] = c4.length - 1;
  }
  const st = utTrailingStop(c4.map((x) => x.close), atrPine(c4, 10), 1);
  const d4 = c4.map((x, k) => (x.close > st[k] ? 1 : -1));
  for (let i = 0; i < c.length; i++) {
    // Last COMPLETED 4h bar at the close of 1h bar i: its own 4h bar if i closes it, else the previous one.
    const k = owner[i];
    const closesIt = (c[i].time + H) % (4 * H) === 0;
    // Same as Pine request.security(..., dir[1], lookahead_on): the 4h bar completed before the current one.
    const use = process.env.HTF_SAME_BAR ? (closesIt ? k : k - 1) : k - 1;
    dir4h[i] = use >= 30 ? d4[use] : NaN;
  }
}

// ---------- filters at the signal bar ----------
const FILTERS: Record<string, (i: number, s: Dir) => boolean> = {
  bbExpand: (i) => BB_W[i] > BB_W_AVG[i],
  hull: (i, s) => (HULL[i] > HULL[i - 2] ? 1 : -1) === s,
  ut4h: (i, s) => dir4h[i] === s,
  donchian10: (i, s) => (s === 1 ? close[i] > hh(i, 10) : close[i] < ll(i, 10)),
  strongBar: (i, s) => {
    const b = c[i];
    const rng = b.high - b.low || 1e-9;
    return (b.close - b.open) * s >= 0.5 * ATR14[i] && (s === 1 ? (b.close - b.low) / rng >= 0.7 : (b.high - b.close) / rng >= 0.7);
  },
  volume: (i) => c[i].volume > 1.5 * VOL_AVG[i],
  atrExpand: (i) => ATR10[i] > ATR10_AVG[i],
};

const isWeekendIST = (t: number) => {
  const d = new Date((t + IST) * 1000).getUTCDay();
  return d === 0 || d === 6;
};

interface Trade {
  t: number;
  net: number;
}
function simulate(filters: string[], breakEntry: boolean): Trade[] {
  const fs = filters.map((f) => FILTERS[f]);
  const trades: Trade[] = [];
  let pos: { side: Dir; px: number; t: number } | null = null;
  let pend: { side: Dir; trigger: number; until: number } | null = null;
  const exit = (i: number) => {
    if (!pos) return;
    const px = c[i].open - pos.side * SLIP;
    trades.push({ t: pos.t, net: (px - pos.px) * pos.side - (px + pos.px) * FEE });
    pos = null;
  };
  for (let i = 300; i < c.length - 1; i++) {
    const nb = c[i + 1];
    // A pending break entry fills inside bar i+1 if price trades through the trigger.
    const s = ind.sigUt[i];
    if (s !== 'NONE') {
      const side: Dir = s === 'LONG' ? 1 : -1;
      pend = null;
      if (pos && pos.side !== side) exit(i + 1);
      if (!pos && !isWeekendIST(nb.time) && fs.every((f) => f(i, side))) {
        if (!breakEntry) pos = { side, px: nb.open + side * SLIP, t: nb.time };
        else pend = { side, trigger: side === 1 ? c[i].high + P.TICK : c[i].low - P.TICK, until: i + 3 };
      }
    }
    if (pend && !pos && i + 1 <= pend.until) {
      const p: { side: Dir; trigger: number; until: number } = pend;
      const hit = p.side === 1 ? nb.high >= p.trigger : nb.low <= p.trigger;
      if (hit && !isWeekendIST(nb.time)) {
        const base = p.side === 1 ? Math.max(nb.open, p.trigger) : Math.min(nb.open, p.trigger);
        pos = { side: p.side, px: base + p.side * SLIP, t: nb.time };
        pend = null;
      }
    } else if (pend && i + 1 > pend.until) pend = null;
  }
  if (pos) exit(c.length - 1);
  return trades;
}

function stats(tr: Trade[]) {
  let eq = 0;
  let peak = 0;
  let dd = 0;
  let gw = 0;
  let gl = 0;
  let w = 0;
  for (const t of tr) {
    eq += t.net;
    peak = Math.max(peak, eq);
    dd = Math.max(dd, peak - eq);
    if (t.net > 0) {
      gw += t.net;
      w++;
    } else gl -= t.net;
  }
  return { n: tr.length, net: eq, pf: gl ? gw / gl : 99, dd, win: tr.length ? w / tr.length : 0 };
}

// ---------- search: every single filter and pair, market vs break entry ----------
const names = Object.keys(FILTERS);
const combos: string[][] = [[]];
for (let a = 0; a < names.length; a++) {
  combos.push([names[a]]);
  for (let b = a + 1; b < names.length; b++) combos.push([names[a], names[b]]);
}
const trainFrom = c[300].time;
const trainMid = trainFrom + (testFrom - trainFrom) / 2;
type Row = { rule: string; tr: ReturnType<typeof stats>; tA: ReturnType<typeof stats>; tB: ReturnType<typeof stats>; te: ReturnType<typeof stats>; teMonths: number[] };
const rows: Row[] = [];
for (const f of combos)
  for (const brk of [false, true]) {
    const tr = simulate(f, brk);
    const train = tr.filter((t) => t.t < testFrom);
    const test = tr.filter((t) => t.t >= testFrom);
    rows.push({
      rule: `${f.length ? f.join(' + ') : 'none'}${brk ? ' · break entry' : ' · market entry'}`,
      tr: stats(train),
      tA: stats(train.filter((t) => t.t < trainMid)),
      tB: stats(train.filter((t) => t.t >= trainMid)),
      te: stats(test),
      teMonths: (() => {
        const m = new Map<string, number>();
        for (const t of test) {
          const k = new Date((t.t + IST) * 1000).toISOString().slice(0, 7);
          m.set(k, (m.get(k) ?? 0) + t.net);
        }
        return [...m.values()];
      })(),
    });
  }

// Selection uses TRAIN ONLY: at least 80 trades, profitable in both train halves, ranked by train profit factor.
const eligible = rows.filter((r) => r.tr.n >= 80 && r.tA.net > 0 && r.tB.net > 0).sort((a, b) => b.tr.pf - a.tr.pf);
const base = rows.find((r) => r.rule === 'none · market entry')!;
const iso = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
const line = (r: Row) =>
  `| ${r.rule} | ${r.tr.n} | ${r.tr.net.toFixed(0)} | ${r.tr.pf.toFixed(2)} | ${r.te.n} | ${(r.te.win * 100).toFixed(0)}% | **${r.te.net.toFixed(0)}** | ${r.te.pf.toFixed(2)} | ${r.te.dd.toFixed(0)} | ${r.teMonths.filter((x) => x > 0).length}/${r.teMonths.length} |`;
const out = [
  '# UT Bot (1, 10) sniper-entry search, ETHUSD 1h',
  '',
  `Train (rules chosen here): ${iso(trainFrom)} → ${iso(testFrom)}. Test (never used for choosing): ${iso(testFrom)} → ${iso(end)}.`,
  `Exit on the opposite UT signal; no new entries Sat–Sun IST. Fee ${(FEE * 100).toFixed(3)}%/side + ${SLIP}$ slippage, per 1 ETH.`,
  `${combos.length * 2} rules tried; ${eligible.length} passed the train screen (≥80 trades, profitable in both train halves).`,
  '',
  '| Rule | Train trades | Train net $ | Train PF | Test trades | Test win % | Test net $ | Test PF | Test max DD $ | Test months positive |',
  '|---|---|---|---|---|---|---|---|---|---|',
  line(base),
  ...eligible.slice(0, 12).map(line),
];
writeFileSync('docs/ut-sniper-search.md', out.join('\n'));
writeFileSync('data/ut-sniper-all.json', JSON.stringify(rows.map((r) => ({ rule: r.rule, train: r.tr, test: r.te })), null, 1));
console.log(out.join('\n'));
