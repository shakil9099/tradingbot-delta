// UT Bot (key 1, ATR 10) on ETHUSD with consolidation filters, exit on the opposite signal, weekend off.
// npx tsx scripts/utChop.ts
// Signals on bar close, fills at the next bar's open ± 1 tick, fee 0.059% per side (FEE_RATE), per 1 ETH.
// Only the last 365 days are traded; earlier bars are warm-up. Results are split into two halves to show
// whether a filter holds up or only fits one stretch.

import { writeFileSync } from 'node:fs';
import { DEFAULT_PARAMS as P } from '../src/config/params.js';
import { atrPine, hma } from '../src/core/indicators.js';
import { computeAll } from '../src/core/signals.js';
import type { Candle } from '../src/shared/types.js';
import { fetchHistory, RES_SEC } from './lib/candles.js';

const DAY = 86400;
const IST = 19800;
const FEE = P.FEE_RATE;
const SLIP = P.SLIPPAGE_TICKS * P.TICK;

// ---------- indicators ----------
const ema = (x: number[], n: number) => {
  const out = new Array<number>(x.length).fill(NaN);
  const a = 2 / (n + 1);
  let e = NaN;
  x.forEach((v, i) => {
    e = Number.isNaN(e) ? v : a * v + (1 - a) * e;
    out[i] = i >= n - 1 ? e : NaN;
  });
  return out;
};
const sma = (x: number[], n: number) => x.map((_, i) => (i < n - 1 ? NaN : x.slice(i - n + 1, i + 1).reduce((a, b) => a + b, 0) / n));
const trueRange = (c: Candle[]) => c.map((b, i) => (i ? Math.max(b.high - b.low, Math.abs(b.high - c[i - 1].close), Math.abs(b.low - c[i - 1].close)) : b.high - b.low));
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
function adx(c: Candle[], n = 14) {
  const pdm = c.map((b, i) => (i ? (b.high - c[i - 1].high > c[i - 1].low - b.low && b.high - c[i - 1].high > 0 ? b.high - c[i - 1].high : 0) : 0));
  const mdm = c.map((b, i) => (i ? (c[i - 1].low - b.low > b.high - c[i - 1].high && c[i - 1].low - b.low > 0 ? c[i - 1].low - b.low : 0) : 0));
  const tr = rma(trueRange(c), n);
  const p = rma(pdm, n).map((v, i) => (100 * v) / tr[i]);
  const m = rma(mdm, n).map((v, i) => (100 * v) / tr[i]);
  const dx = p.map((v, i) => (Number.isNaN(v) ? 0 : (100 * Math.abs(v - m[i])) / (v + m[i] || 1)));
  return rma(dx, n);
}
function chop(c: Candle[], n = 14) {
  const tr = trueRange(c);
  return c.map((_, i) => {
    if (i < n) return NaN;
    let s = 0;
    let hi = -Infinity;
    let lo = Infinity;
    for (let k = i - n + 1; k <= i; k++) {
      s += tr[k];
      hi = Math.max(hi, c[k].high);
      lo = Math.min(lo, c[k].low);
    }
    return (100 * Math.log10(s / (hi - lo))) / Math.log10(n);
  });
}
function bbWidth(close: number[], n = 20) {
  const m = sma(close, n);
  return close.map((_, i) => {
    if (i < n - 1) return NaN;
    const w = close.slice(i - n + 1, i + 1);
    const sd = Math.sqrt(w.reduce((a, v) => a + (v - m[i]) ** 2, 0) / n);
    return (4 * sd) / m[i];
  });
}

// ---------- simulation ----------
type Dir = 1 | -1;
interface Trade {
  side: Dir;
  entryT: number;
  exitT: number;
  entry: number;
  exit: number;
  net: number;
  fees: number;
  why: string;
}
const isWeekendIST = (t: number) => {
  const d = new Date((t + IST) * 1000).getUTCDay();
  return d === 0 || d === 6;
};

function simulate(c: Candle[], sig: string[], allow: (i: number, side: Dir) => boolean, from: number, closeWeekend: boolean) {
  const trades: Trade[] = [];
  let pos: { side: Dir; entry: number; t: number } | null = null;
  let skipped = 0;
  const close = (i: number, why: string) => {
    if (!pos) return;
    const px = c[i].open - pos.side * SLIP;
    const fees = (pos.entry + px) * FEE;
    trades.push({ side: pos.side, entryT: pos.t, exitT: c[i].time, entry: pos.entry, exit: px, net: (px - pos.entry) * pos.side - fees, fees, why });
    pos = null;
  };
  for (let i = from; i < c.length - 1; i++) {
    const fillT = c[i + 1].time;
    if (closeWeekend && pos && isWeekendIST(fillT) && !isWeekendIST(c[i].time)) close(i + 1, 'weekend');
    const s = sig[i];
    if (s === 'NONE') continue;
    const side: Dir = s === 'LONG' ? 1 : -1;
    if (pos && pos.side !== side) close(i + 1, 'opposite signal');
    if (pos) continue;
    if (isWeekendIST(fillT)) continue;
    if (!allow(i, side)) {
      skipped++;
      continue;
    }
    pos = { side, entry: c[i + 1].open + side * SLIP, t: fillT };
  }
  if (pos) close(c.length - 1, 'end of test');
  return { trades, skipped };
}

function stats(tr: Trade[]) {
  const net = tr.reduce((a, t) => a + t.net, 0);
  const wins = tr.filter((t) => t.net > 0);
  const gw = wins.reduce((a, t) => a + t.net, 0);
  const gl = -tr.filter((t) => t.net <= 0).reduce((a, t) => a + t.net, 0);
  let eq = 0;
  let peak = 0;
  let dd = 0;
  for (const t of tr) {
    eq += t.net;
    peak = Math.max(peak, eq);
    dd = Math.max(dd, peak - eq);
  }
  return { n: tr.length, win: tr.length ? wins.length / tr.length : 0, net, pf: gl ? gw / gl : Infinity, dd, fees: tr.reduce((a, t) => a + t.fees, 0), avg: tr.length ? net / tr.length : 0 };
}

async function run(res: '15m' | '1h') {
  const S = RES_SEC[res];
  const need = Math.ceil((365 * DAY) / S) + 600;
  const c = await fetchHistory(Math.ceil(need / 2000), res);
  const ind = computeAll(c, { ...P, UT_KEY: 1, UT_ATR: 10, WARMUP: 300 });
  const closeArr = c.map((b) => b.close);
  const end = c[c.length - 1].time;
  const from = c.findIndex((b) => b.time >= end - 365 * DAY);
  const mid = c[from].time + (end - c[from].time) / 2;

  const ADX = adx(c);
  const CHOP = chop(c);
  const BBW = bbWidth(closeArr);
  const BBW_AVG = sma(BBW.map((x) => (Number.isNaN(x) ? 0 : x)), 100);
  const E50 = ema(closeArr, 50);
  const ATR14 = atrPine(c, 14);
  const HULL = hma(closeArr, 55);
  // 4h trend from the same bars: EMA 50 of 4-hour closes, sampled at each bar (no look-ahead: only completed 4h blocks).
  const per4h = (4 * 3600) / S;
  const htf = new Array<number>(c.length).fill(NaN);
  {
    const closes4: number[] = [];
    const e4: number[] = [];
    let e = NaN;
    for (let i = 0; i < c.length; i++) {
      if ((c[i].time + S) % (4 * 3600) === 0) {
        closes4.push(c[i].close);
        e = Number.isNaN(e) ? c[i].close : (2 / 51) * c[i].close + (1 - 2 / 51) * e;
        e4.push(e);
      }
      htf[i] = e4.length >= 3 ? (e4[e4.length - 1] > e4[e4.length - 3] ? 1 : -1) : NaN;
    }
    void per4h;
  }

  const filters: Record<string, (i: number, side: Dir) => boolean> = {
    'none (plain UT 1/10)': () => true,
    'ADX(14) > 20': (i) => ADX[i] > 20,
    'ADX(14) > 25': (i) => ADX[i] > 25,
    'Choppiness(14) < 61.8': (i) => CHOP[i] < 61.8,
    'Choppiness(14) < 50': (i) => CHOP[i] < 50,
    'BB width > its 100-bar avg': (i) => BBW[i] > BBW_AVG[i],
    'Price ≥ 1 ATR from EMA50, same side': (i, s) => (closeArr[i] - E50[i]) * s >= ATR14[i],
    'Hull 55 slope agrees': (i, s) => (HULL[i] > HULL[i - 2] ? 1 : -1) === s,
    '4h EMA50 slope agrees': (i, s) => htf[i] === s,
    'ADX > 20 + 4h trend agrees': (i, s) => ADX[i] > 20 && htf[i] === s,
    'Choppiness < 61.8 + 4h trend agrees': (i, s) => CHOP[i] < 61.8 && htf[i] === s,
  };

  const rows: string[] = [];
  const csv: string[] = ['filter,weekend,trades,winRate,net,profitFactor,maxDD,fees,H1net,H2net,H1pf,H2pf,skipped'];
  for (const closeWeekend of [false, true]) {
    rows.push(`\n### ${res} · weekend: ${closeWeekend ? 'no entries Sat–Sun IST AND close open trade at Saturday 00:00 IST' : 'no new entries Sat–Sun IST (open trade held)'}\n`);
    rows.push('| Filter | Trades | Win % | Net $/ETH | Profit factor | Max DD $ | Fees $ | 1st half net (PF) | 2nd half net (PF) | Signals skipped |');
    rows.push('|---|---|---|---|---|---|---|---|---|---|');
    for (const [name, f] of Object.entries(filters)) {
      const { trades, skipped } = simulate(c, ind.sigUt, f, from, closeWeekend);
      const a = stats(trades);
      const h1 = stats(trades.filter((t) => t.entryT < mid));
      const h2 = stats(trades.filter((t) => t.entryT >= mid));
      const pf = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : '∞');
      rows.push(`| ${name} | ${a.n} | ${(a.win * 100).toFixed(0)}% | ${a.net.toFixed(0)} | ${pf(a.pf)} | ${a.dd.toFixed(0)} | ${a.fees.toFixed(0)} | ${h1.net.toFixed(0)} (${pf(h1.pf)}) | ${h2.net.toFixed(0)} (${pf(h2.pf)}) | ${skipped} |`);
      csv.push([JSON.stringify(name), closeWeekend, a.n, a.win.toFixed(3), a.net.toFixed(2), pf(a.pf), a.dd.toFixed(2), a.fees.toFixed(2), h1.net.toFixed(2), h2.net.toFixed(2), pf(h1.pf), pf(h2.pf), skipped].join(','));
    }
  }
  const iso = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
  const bh = c[c.length - 1].close - c[from].open;
  const head = `## ETHUSD ${res}: ${iso(c[from].time)} → ${iso(end)} (${c.length - from} bars; halves split at ${iso(mid)}). ETH moved ${c[from].open.toFixed(0)} → ${c[c.length - 1].close.toFixed(0)} (buy & hold ${bh >= 0 ? '+' : ''}${bh.toFixed(0)} $/ETH).`;
  return { md: [head, ...rows].join('\n'), csv: csv.join('\n') };
}

const out: string[] = ['# UT Bot (1, 10) consolidation-filter backtest', '', `Per 1 ETH, fee ${(FEE * 100).toFixed(3)}% per side, slippage ${SLIP} $ per side, fills at next bar open. Exit only on the opposite UT signal (or the weekend close where shown).`, ''];
for (const res of ['1h', '15m'] as const) {
  const r = await run(res);
  out.push(r.md, '');
  writeFileSync(`data/utchop-${res}.csv`, r.csv);
}
writeFileSync('docs/ut-chop-backtest.md', out.join('\n'));
console.log(out.join('\n'));
