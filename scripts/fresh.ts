// npm run fresh -- [--res 1h|15m] [--refresh]
// "Fresh bot" research (2026-11-09): new entry families (no Hull, no UT Bot) on 15m or 1h ETHUSD, long and short,
// run through the LIVE core simulator (src/core/simulator.ts: same fills, fees, slippage, break-even, ATR trail).
// Three-way split to limit overfitting: CHOOSE on the first 50%, CHECK on the next 20%, and the last 30% (HOLDOUT)
// is only reported for the final shortlist. Benchmark: the current bot (Strategy v2, 1h) on the same segments.
// All figures per 1 ETH after fees + slippage.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { DEFAULT_PARAMS, type Params } from '../src/config/params.js';
import { MMR, entryGate } from '../src/core/entryGate.js';
import { atrPine } from '../src/core/indicators.js';
import { computeAll } from '../src/core/signals.js';
import { simulate, simulateAdaptive } from '../src/core/simulator.js';
import { maxDrawdown } from '../src/core/stats.js';
import type { Candle, Signal, SimTrade } from '../src/shared/types.js';
import { RES_SEC, fetchHistory } from './lib/candles.js';
import { ema, rsi, sma, stdev } from './lib/ta.js';

const arg = (k: string, d: string) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);

export async function loadRes(res: string): Promise<Candle[]> {
  const file = `data/eth_${res}_cache.json`;
  const S = RES_SEC[res];
  if (!process.argv.includes('--refresh') && existsSync(file)) {
    const c = JSON.parse(readFileSync(file, 'utf8')) as Candle[];
    if (Date.now() / 1000 - c.at(-1)!.time < 6 * 3600) return c;
  }
  const pages = Math.ceil(((Date.now() / 1000 - Date.parse('2024-02-06') / 1000) / S) / 2000) + 1;
  const c = await fetchHistory(pages, res);
  mkdirSync('data', { recursive: true, mode: 0o700 });
  writeFileSync(file, JSON.stringify(c));
  return c;
}

// ------------------------------------------------------------------ signal families (pure, bar-close only)
type Gen = { family: string; name: string; maxLen: number; sig: (c: Candle[]) => Signal[] };
const none = (n: number): Signal[] => new Array<Signal>(n).fill('NONE');

/** Close breaks the prior N-bar high (LONG) / low (SHORT); fires on the first bar of each break. */
function donchian(N: number, trendLen = 0): Gen {
  return {
    family: trendLen ? 'donchian+trend' : 'donchian',
    name: trendLen ? `donch ${N} / ema${trendLen}` : `donch ${N}`,
    maxLen: Math.max(N, trendLen),
    sig: (c) => {
      const out = none(c.length);
      const tr = trendLen ? ema(c.map((b) => b.close), trendLen) : null;
      let prevUp = false, prevDn = false;
      for (let t = N; t < c.length; t++) {
        let hi = -Infinity, lo = Infinity;
        for (let k = t - N; k < t; k++) (hi = Math.max(hi, c[k].high)), (lo = Math.min(lo, c[k].low));
        const up = c[t].close > hi, dn = c[t].close < lo;
        if (up && !prevUp && (!tr || c[t].close > tr[t])) out[t] = 'LONG';
        if (dn && !prevDn && (!tr || c[t].close < tr[t])) out[t] = 'SHORT';
        (prevUp = up), (prevDn = dn);
      }
      return out;
    },
  };
}

function emaCross(f: number, s: number): Gen {
  return {
    family: 'ema cross', name: `ema ${f}/${s}`, maxLen: s * 3,
    sig: (c) => {
      const x = c.map((b) => b.close), a = ema(x, f), b = ema(x, s), out = none(c.length);
      for (let t = 1; t < c.length; t++) {
        if (!Number.isFinite(b[t - 1])) continue;
        if (a[t - 1] <= b[t - 1] && a[t] > b[t]) out[t] = 'LONG';
        else if (a[t - 1] >= b[t - 1] && a[t] < b[t]) out[t] = 'SHORT';
      }
      return out;
    },
  };
}

function macd(f: number, s: number, g: number, zero = false): Gen {
  return {
    family: 'macd', name: `macd ${f}/${s}/${g}${zero ? ' zero' : ''}`, maxLen: s * 3,
    sig: (c) => {
      const x = c.map((b) => b.close), ef = ema(x, f), es = ema(x, s);
      const m = x.map((_, t) => ef[t] - es[t]);
      const firstOk = m.findIndex(Number.isFinite);
      const sigl = new Array<number>(c.length).fill(NaN);
      const tail = ema(m.slice(firstOk), g);
      tail.forEach((v, i) => (sigl[firstOk + i] = v));
      const ref = zero ? x.map(() => 0) : sigl;
      const out = none(c.length);
      for (let t = 1; t < c.length; t++) {
        if (!Number.isFinite(ref[t - 1]) || !Number.isFinite(m[t - 1])) continue;
        if (m[t - 1] <= ref[t - 1] && m[t] > ref[t]) out[t] = 'LONG';
        else if (m[t - 1] >= ref[t - 1] && m[t] < ref[t]) out[t] = 'SHORT';
      }
      return out;
    },
  };
}

/** Close crosses outside EMA(n) ± k·ATR(n). */
function keltner(n: number, k: number): Gen {
  return {
    family: 'keltner', name: `keltner ${n}×${k}`, maxLen: n * 3,
    sig: (c) => {
      const x = c.map((b) => b.close), m = ema(x, n), a = atrPine(c, n), out = none(c.length);
      for (let t = 1; t < c.length; t++) {
        if (!Number.isFinite(m[t - 1]) || !Number.isFinite(a[t - 1])) continue;
        const up0 = x[t - 1] > m[t - 1] + k * a[t - 1], up1 = x[t] > m[t] + k * a[t];
        const dn0 = x[t - 1] < m[t - 1] - k * a[t - 1], dn1 = x[t] < m[t] - k * a[t];
        if (!up0 && up1) out[t] = 'LONG';
        else if (!dn0 && dn1) out[t] = 'SHORT';
      }
      return out;
    },
  };
}

/** Bollinger(n, 2) width in the lowest q of the last 200 bars, then a close outside the band. */
function squeeze(n: number, q: number): Gen {
  return {
    family: 'squeeze', name: `squeeze ${n} q${q}`, maxLen: 200 + n,
    sig: (c) => {
      const x = c.map((b) => b.close), m = sma(x, n), sd = stdev(x, n), out = none(c.length);
      const w = x.map((_, t) => (4 * sd[t]) / m[t]);
      for (let t = 200 + n; t < c.length; t++) {
        const hist = w.slice(t - 200, t).filter(Number.isFinite).sort((a, b) => a - b);
        const thr = hist[Math.floor(hist.length * q)];
        if (!(w[t - 1] <= thr)) continue;
        if (x[t] > m[t] + 2 * sd[t]) out[t] = 'LONG';
        else if (x[t] < m[t] - 2 * sd[t]) out[t] = 'SHORT';
      }
      return out;
    },
  };
}

/** Mean reversion: RSI(n) crosses back up through lo (LONG) / down through hi (SHORT). */
function rsiRev(n: number, lo: number, hi: number): Gen {
  return {
    family: 'rsi reversion', name: `rsi${n} ${lo}/${hi}`, maxLen: n * 5,
    sig: (c) => {
      const r = rsi(c.map((b) => b.close), n), out = none(c.length);
      for (let t = 1; t < c.length; t++) {
        if (r[t - 1] < lo && r[t] >= lo) out[t] = 'LONG';
        else if (r[t - 1] > hi && r[t] <= hi) out[t] = 'SHORT';
      }
      return out;
    },
  };
}

/** Momentum: close − close[L] crosses above +k·ATR(14) (LONG) / below −k·ATR (SHORT). */
function momentum(L: number, k: number): Gen {
  return {
    family: 'momentum', name: `mom ${L} k${k}`, maxLen: L + 20,
    sig: (c) => {
      const a = atrPine(c, 14), out = none(c.length);
      const z = c.map((b, t) => (t >= L ? (b.close - c[t - L].close) / a[t] : NaN));
      for (let t = L + 1; t < c.length; t++) {
        if (!Number.isFinite(z[t - 1]) || !Number.isFinite(z[t])) continue;
        if (z[t - 1] <= k && z[t] > k) out[t] = 'LONG';
        else if (z[t - 1] >= -k && z[t] < -k) out[t] = 'SHORT';
      }
      return out;
    },
  };
}

function generators(res: string): Gen[] {
  const m = res === '15m' ? 4 : 1; // 15m: also test the same clock-time lengths (×4 bars)
  const L = (n: number) => [...new Set([n, n * m])];
  const g: Gen[] = [];
  for (const N of [...L(20), ...L(55), ...L(100), ...L(200)]) g.push(donchian(N));
  for (const N of [...L(20), ...L(55), ...L(100)]) g.push(donchian(N, 200 * m));
  for (const [f, s] of [[9, 21], [20, 50], [50, 200]]) for (const k of L(1)) g.push(emaCross(f * k, s * k));
  if (m > 1) for (const [f, s] of [[9, 21], [20, 50]]) g.push(emaCross(f * m, s * m));
  for (const k of L(1)) (g.push(macd(12 * k, 26 * k, 9 * k)), g.push(macd(12 * k, 26 * k, 9 * k, true)));
  for (const n of L(20)) for (const k of [1.5, 2, 2.5]) g.push(keltner(n, k));
  for (const n of L(20)) for (const q of [0.1, 0.2]) g.push(squeeze(n, q));
  for (const [n, lo, hi] of [[2, 10, 90], [14, 30, 70], [14, 25, 75]] as const) g.push(rsiRev(n, lo, hi));
  for (const Lb of [...L(24), ...L(72)]) for (const k of [2, 3]) g.push(momentum(Lb, k));
  return [...new Map(g.map((x) => [x.name, x])).values()];
}

// ------------------------------------------------------------------ exits (live core parameters)
interface ExitSet { name: string; o: Partial<Params> }
function exitGrid(): ExitSet[] {
  const out: ExitSet[] = [];
  for (const sl of [1.5, 2, 3])
    for (const be of [0, 0.5, 1])
      for (const [tt, tm] of [[0, 0], [1, 2], [1.5, 3], [2, 4]] as const)
        for (const tp of [0, 3])
          out.push({
            name: `sl ${sl}×ATR | be ${be || '—'} | trail ${tm ? `${tt}R/${tm}×ATR` : '—'} | tp ${tp || '—'}`,
            o: { SL_ATR_MULT: sl, BE_TRIG_R: be, TRAIL_TRIG_R: tt || 1.5, TRAIL_ATR_MULT: tm, TP_R: tp, SL_MAX: 1e9 },
          });
  return out;
}

// ------------------------------------------------------------------ evaluation
export interface Seg { a: number; b: number; c: number; d: number } // [a,b) choose, [b,c) check, [c,d) holdout
export function segments(c: Candle[]): Seg {
  const a = c[0].time, d = c.at(-1)!.time + 3600;
  return { a, b: a + Math.floor((d - a) * 0.5), c: a + Math.floor((d - a) * 0.7), d };
}
const YR = 365 * 86400;
export function evaluate(tr: SimTrade[], s: Seg) {
  const part = (lo: number, hi: number) => tr.filter((x) => x.entryTime >= lo && x.entryTime < hi);
  const sum = (a: SimTrade[]) => a.reduce((z, x) => z + x.netPnl, 0);
  const pf = (a: SimTrade[]) => {
    const w = a.filter((x) => x.netPnl > 0).reduce((z, x) => z + x.netPnl, 0), l = -a.filter((x) => x.netPnl <= 0).reduce((z, x) => z + x.netPnl, 0);
    return l > 0 ? w / l : w > 0 ? 99 : 0;
  };
  const ch = part(s.a, s.b), ck = part(s.b, s.c), ho = part(s.c, s.d);
  const sorted = [...tr].sort((x, y) => x.exitTime - y.exitTime);
  return {
    trades: tr.length,
    perYr: +(tr.length / ((s.d - s.a) / YR)).toFixed(0),
    win: +((tr.filter((x) => x.netPnl > 0).length / Math.max(1, tr.length)) * 100).toFixed(0),
    chooseYr: +(sum(ch) / ((s.b - s.a) / YR)).toFixed(0),
    choosePF: +pf(ch).toFixed(2),
    checkYr: +(sum(ck) / ((s.c - s.b) / YR)).toFixed(0),
    holdoutYr: +(sum(ho) / ((s.d - s.c) / YR)).toFixed(0),
    allYr: +(sum(tr) / ((s.d - s.a) / YR)).toFixed(0),
    PF: +pf(tr).toFixed(2),
    maxDD: +maxDrawdown(sorted.map((x) => x.netPnl)).toFixed(0),
    ddChoose: +maxDrawdown([...ch].sort((x, y) => x.exitTime - y.exitTime).map((x) => x.netPnl)).toFixed(0),
  };
}

async function main() {
  const res = arg('--res', '1h');
  const c = await loadRes(res);
  const s = segments(c);
  const iso = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
  const out: string[] = [];
  const say = (x: string) => (console.log(x), out.push(x));
  say(`\n${res}: ${c.length} candles ${iso(s.a)} → ${iso(s.d)}. choose ${iso(s.a)}–${iso(s.b)}, check –${iso(s.c)}, holdout –${iso(s.d)}`);

  // Benchmark: the current bot (Strategy v2, 1h, adaptive Hull/UT, its own gates).
  const h1 = res === '1h' ? c : await loadRes('1h');
  const atr1 = atrPine(h1, 14);
  const g1 = entryGate(h1, DEFAULT_PARAMS, atr1);
  const bench = evaluate(simulateAdaptive(h1, computeAll(h1, DEFAULT_PARAMS), DEFAULT_PARAMS, { allowEntryAt: (i) => g1(i) === null, atr: atr1 }).trades, segments(h1));
  say('Benchmark — current bot (Strategy v2, 1h). Note: v2 was tuned with the whole history visible, so its check/holdout numbers are optimistic:');
  console.table([bench]);
  out.push(JSON.stringify(bench));

  const gens = generators(res);
  const exits = exitGrid();
  const atr = atrPine(c, 14);
  const t0 = Date.now();
  const rows: Array<Record<string, string | number> & ReturnType<typeof evaluate>> = [];
  // Filters: 'none' = liquidation guard only (a safety rule); 'v2' = the current bot's entry filters (weekend IST,
  // ATR ≥ MIN_ATR scaled to the timeframe, stop ≤ $40, liquidation guard).
  const atrScale = res === '15m' ? 0.5 : 1; // ATR(14) on 15m is about half the 1h value
  for (const g of gens) {
    const sig = g.sig(c);
    const warm = Math.max(200, g.maxLen + 50);
    for (const filter of ['none', 'v2'] as const)
      for (const e of exits) {
        const p = { ...DEFAULT_PARAMS, ...e.o, WARMUP: warm, ...(filter === 'v2' ? { SL_MAX: 40, MIN_ATR: DEFAULT_PARAMS.MIN_ATR * atrScale } : {}) };
        const gate = filter === 'v2' ? entryGate(c, p, atr) : null;
        const allow = (t: number) =>
          gate ? gate(t) === null : Math.max(p.SL_MIN, p.SL_ATR_MULT * atr[t]) <= 0.5 * c[t].close * (1 / p.LEVERAGE - MMR);
        const tr = simulate('hull', c, sig, p, { allowEntryAt: allow, atr });
        rows.push({ family: g.family, entry: g.name, filter, exit: e.name, ...evaluate(tr, s) });
      }
  }
  say(`${rows.length} runs (${gens.length} entries × ${exits.length} exits) in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  writeFileSync(`data/fresh-${res}-grid.json`, JSON.stringify(rows));

  // Stage 1 (choose segment only): positive, PF ≥ 1.3, ≥ 40 trades overall, drawdown in choose ≤ 2 × its yearly profit.
  const s1 = rows.filter((r) => r.chooseYr > 0 && r.choosePF >= 1.3 && r.trades >= 40 && r.ddChoose <= 2 * r.chooseYr);
  // Stage 2 (check segment): must stay positive. Rank by min(choose, check) per year — rewards consistency.
  const s2 = s1.filter((r) => r.checkYr > 0).sort((x, y) => Math.min(y.chooseYr, y.checkYr) - Math.min(x.chooseYr, x.checkYr));
  say(`stage 1 (choose segment) passed: ${s1.length}; stage 2 (check segment) passed: ${s2.length}`);
  // Best per entry (avoid 20 rows of the same entry with tiny exit changes).
  const best = new Map<string, (typeof s2)[number]>();
  for (const r of s2) if (!best.has(`${r.entry}|${r.filter}`)) best.set(`${r.entry}|${r.filter}`, r);
  const short = [...best.values()].slice(0, 16);
  say('\nShortlist (one row per entry, chosen WITHOUT looking at holdout) — holdout shown now for the first time:');
  console.table(short.map(({ ddChoose: _d, ...r }) => r));
  out.push(JSON.stringify(short, null, 1));

  // Family robustness: share of a family's runs positive in both choose and check.
  const fam = new Map<string, { n: number; ok: number }>();
  for (const r of rows) {
    const f = fam.get(r.family as string) ?? { n: 0, ok: 0 };
    f.n++;
    if (r.chooseYr > 0 && r.checkYr > 0) f.ok++;
    fam.set(r.family as string, f);
  }
  say('\nFamily robustness (share of all its runs positive in both choose and check):');
  console.table(Object.fromEntries([...fam].map(([k, v]) => [k, `${((v.ok / v.n) * 100).toFixed(0)}% of ${v.n}`])));
  // Low-drawdown view: stage-2 survivors with all-period maxDD ≤ 1.5 × the benchmark's (chosen without holdout).
  const lowDD = s2.filter((r) => r.maxDD <= 1.5 * bench.maxDD);
  const bestLow = new Map<string, (typeof s2)[number]>();
  for (const r of lowDD) if (!bestLow.has(`${r.entry}|${r.filter}`)) bestLow.set(`${r.entry}|${r.filter}`, r);
  say(`\nLow-drawdown survivors (maxDD ≤ ${1.5 * bench.maxDD}): ${lowDD.length} runs, ${bestLow.size} entries:`);
  console.table([...bestLow.values()].slice(0, 12).map(({ ddChoose: _d, ...r }) => r));
  out.push(JSON.stringify([...bestLow.values()].slice(0, 12), null, 1));
  writeFileSync(`data/fresh-${res}-${new Date().toISOString().slice(0, 10)}.txt`, out.join('\n') + '\n');
}

if (process.argv[1]?.endsWith('fresh.ts')) main().catch((e) => (console.error(e), process.exit(1)));
