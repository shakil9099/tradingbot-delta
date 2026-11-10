// npm run research5 -- --pages 13 [--refresh]
// Round 5: new exits for the Hull/UT system, author's constraints (2026-11-09):
//   - weekends (Sat/Sun IST) blocked for new entries
//   - ATR used to skip entries when volatility is too LOW (minAtr)
//   - initial SL = slK × ATR(14), floor $10, capped at $40 (over the cap: clamp to 40, or skip the trade)
//   - break-even, trailing and TP expressed in R (R = initial stop distance)
//   - pass bar: train > 0, test > 0, every calendar year > 0, per-ETH max drawdown < $141
// Fill rules match src/core/simulator.ts exactly; the script first proves that by reproducing the core
// simulator's results on the live config. Train = first 70% of history, test = last 30%.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { DEFAULT_PARAMS as P } from '../src/config/params.js';
import { decide } from '../src/core/decide.js';
import { isWeekendIST } from '../src/core/entryGate.js';
import { atrPine } from '../src/core/indicators.js';
import { roundTick } from '../src/core/ratchet.js';
import { select } from '../src/core/selector.js';
import { computeAll, direction, type IndicatorOutput } from '../src/core/signals.js';
import { simulate, simulateAdaptive } from '../src/core/simulator.js';
import { maxDrawdown } from '../src/core/stats.js';
import type { Candle, Side, Signal, StrategyId } from '../src/shared/types.js';
import { argPages, fetchHistory } from './lib/candles.js';
import { LEGACY, initialBracket, nextStop } from './lib/legacyRatchet.js';

// ---------------------------------------------------------------- data
const CACHE = 'data/eth_1h_cache.json';
export async function loadCandles(): Promise<Candle[]> {
  if (!process.argv.includes('--refresh') && existsSync(CACHE)) {
    const c = JSON.parse(readFileSync(CACHE, 'utf8')) as Candle[];
    if (Date.now() / 1000 - c.at(-1)!.time < 6 * 3600) return c;
  }
  const c = await fetchHistory(argPages());
  mkdirSync('data', { recursive: true, mode: 0o700 });
  writeFileSync(CACHE, JSON.stringify(c));
  return c;
}

// ---------------------------------------------------------------- model
export type Trail =
  | { kind: 'none' }
  | { kind: 'r'; trig: number; gap: number } // close − gap·R once profit ≥ trig·R
  | { kind: 'chand'; trig: number; m: number } // highest high since entry − m·ATR once profit ≥ trig·R
  | { kind: 'ut'; trig: number }; // UT Bot trailing stop line once profit ≥ trig·R

export interface Exit {
  legacy?: boolean; // the author's original $ ladder (scripts/lib/legacyRatchet.ts), as a baseline
  gate: boolean; // weekend + ATR gates on
  slK: number;
  overCap: 'cap' | 'skip';
  minAtr: number;
  beTrig: number | null; // R
  beLock: 'fee' | number; // 'fee' = entry ± round-trip cost; number = fraction of R
  trail: Trail;
  tpR: number | null;
}

export interface RT {
  strategy: StrategyId;
  side: Side;
  entryTime: number;
  exitTime: number;
  entry: number;
  exit: number;
  R: number;
  net: number;
  fees: number;
  reason: string;
}

export const SL_FLOOR = 10;
export const SL_CAP = 40;
const SLIP = P.SLIPPAGE_TICKS * P.TICK;
const sigSide = (s: Signal): Side | null => (s === 'LONG' ? 'buy' : s === 'SHORT' ? 'sell' : null);

export interface Ctx {
  c: Candle[];
  ind: IndicatorOutput;
  atr: number[];
  weekendFill: boolean[];
}

export function makeCtx(c: Candle[], utKey = P.UT_KEY, utAtr = P.UT_ATR): Ctx {
  return {
    c,
    ind: computeAll(c, { ...P, UT_KEY: utKey, UT_ATR: utAtr }),
    atr: atrPine(c, 14),
    weekendFill: c.map((b) => isWeekendIST(b.time + 3600)),
  };
}

function slDist(x: Ctx, ex: Exit, t: number): number {
  if (ex.legacy) return LEGACY.SL_DIST;
  const d = Math.max(SL_FLOOR, ex.slK * x.atr[t]);
  if (d <= SL_CAP) return d;
  return ex.overCap === 'cap' ? SL_CAP : NaN;
}

function allowAt(x: Ctx, ex: Exit, t: number): boolean {
  if (!ex.gate) return true;
  if (x.weekendFill[t]) return false;
  if (ex.legacy) return true;
  return x.atr[t] >= ex.minAtr && Number.isFinite(slDist(x, ex, t));
}

interface Pos {
  strategy: StrategyId;
  side: Side;
  entry: number;
  entryTime: number;
  sl: number;
  sl0: number;
  tp: number;
  R: number;
  hh: number;
  ll: number;
  stage: 'init' | 'be' | 'trail';
}
type Pend = { kind: 'enter' | 'reverse'; side: Side; strategy: StrategyId; R: number } | { kind: 'close' } | null;

class Book {
  pos: Pos | null = null;
  pending: Pend = null;
  trades: RT[] = [];
  constructor(private readonly ex: Exit, private readonly x: Ctx) {}

  private fill(side: Side, price: number) {
    return side === 'buy' ? price + SLIP : price - SLIP;
  }

  private open(strategy: StrategyId, side: Side, price: number, time: number, R: number) {
    const entry = this.fill(side, price);
    let sl: number, tp: number;
    if (this.ex.legacy) ({ sl, tp } = initialBracket(side, entry, LEGACY));
    else {
      const ex = this.ex;
      sl = side === 'buy' ? roundTick(entry - R, 'up') : roundTick(entry + R, 'down');
      tp = ex.tpR === null ? (side === 'buy' ? Infinity : -Infinity) : roundTick(side === 'buy' ? entry + ex.tpR * R : entry - ex.tpR * R, 'nearest');
    }
    this.pos = { strategy, side, entry, entryTime: time, sl, sl0: sl, tp, R, hh: -Infinity, ll: Infinity, stage: 'init' };
  }

  private close(price: number, time: number, reason: string) {
    const p = this.pos!;
    const exit = this.fill(p.side === 'buy' ? 'sell' : 'buy', price);
    const gross = p.side === 'buy' ? exit - p.entry : p.entry - exit;
    const fees = (p.entry + exit) * P.FEE_RATE;
    this.trades.push({ strategy: p.strategy, side: p.side, entryTime: p.entryTime, exitTime: time, entry: p.entry, exit, R: p.R, net: gross - fees, fees, reason });
    this.pos = null;
  }

  executePending(bar: Candle) {
    const pend = this.pending;
    this.pending = null;
    if (!pend) return;
    if (pend.kind === 'close') {
      if (this.pos) this.close(bar.open, bar.time, 'reversal');
    } else if (pend.kind === 'reverse') {
      if (this.pos) this.close(bar.open, bar.time, 'reversal');
      this.open(pend.strategy, pend.side, bar.open, bar.time, pend.R);
    } else if (!this.pos) this.open(pend.strategy, pend.side, bar.open, bar.time, pend.R);
  }

  manage(t: number) {
    const p = this.pos;
    if (!p) return;
    const bar = this.x.c[t];
    const slReason = () => `sl_${p.stage}`;
    if (p.side === 'buy') {
      if (bar.low <= p.sl) return this.close(bar.open <= p.sl ? bar.open : p.sl, bar.time, slReason());
      if (bar.high >= p.tp) return this.close(bar.open >= p.tp ? bar.open : p.tp, bar.time, 'tp');
    } else {
      if (bar.high >= p.sl) return this.close(bar.open >= p.sl ? bar.open : p.sl, bar.time, slReason());
      if (bar.low <= p.tp) return this.close(bar.open <= p.tp ? bar.open : p.tp, bar.time, 'tp');
    }
    p.hh = Math.max(p.hh, bar.high);
    p.ll = Math.min(p.ll, bar.low);

    if (this.ex.legacy) {
      const n = nextStop(p.side, p.entry, p.sl, bar.close, LEGACY);
      if (n.changed) {
        p.sl = n.sl;
        p.stage = n.stage === 0 ? 'init' : n.stage === 1 ? 'be' : 'trail';
      }
      return;
    }

    const ex = this.ex;
    const long = p.side === 'buy';
    const profit = long ? bar.close - p.entry : p.entry - bar.close;
    // Same selection as src/core/exits.ts nextStop: the tightest candidate still beyond the close (ties → trail),
    // so a trailing level past the close falls back to break-even.
    const round = (v: number) => roundTick(v, long ? 'up' : 'down');
    const cands: Array<{ price: number; stage: Pos['stage'] }> = [];
    if (ex.beTrig !== null && profit >= ex.beTrig * p.R) {
      const lock = ex.beLock === 'fee' ? p.entry * 2 * P.FEE_RATE + 2 * SLIP : ex.beLock * p.R;
      cands.push({ price: long ? p.entry + lock : p.entry - lock, stage: 'be' });
    }
    const tr = ex.trail;
    if (tr.kind === 'r' && profit >= tr.trig * p.R) cands.push({ price: long ? bar.close - tr.gap * p.R : bar.close + tr.gap * p.R, stage: 'trail' });
    else if (tr.kind === 'chand' && profit >= tr.trig * p.R && Number.isFinite(this.x.atr[t]))
      cands.push({ price: long ? p.hh - tr.m * this.x.atr[t] : p.ll + tr.m * this.x.atr[t], stage: 'trail' });
    else if (tr.kind === 'ut' && profit >= tr.trig * p.R) cands.push({ price: this.x.ind.utStop[t], stage: 'trail' });
    let best: { price: number; stage: Pos['stage'] } | null = null;
    for (const c of cands) {
      if (!Number.isFinite(c.price) || !(long ? round(c.price) < bar.close : round(c.price) > bar.close)) continue;
      if (!best || (long ? round(c.price) >= round(best.price) : round(c.price) <= round(best.price))) best = c;
    }
    if (!best) return;
    const r = round(best.price);
    if (long ? r > p.sl + 1e-9 : r < p.sl - 1e-9) {
      p.sl = r;
      const rank = { init: 0, be: 1, trail: 2 } as const;
      p.stage = rank[best.stage] > rank[p.stage] ? best.stage : p.stage;
    }
  }
}

export function runFixed(x: Ctx, ex: Exit, strategy: StrategyId): RT[] {
  const sig = strategy === 'hull' ? x.ind.sigHull : x.ind.sigUt;
  const book = new Book(ex, x);
  for (let t = 0; t < x.c.length; t++) {
    book.executePending(x.c[t]);
    book.manage(t);
    const side = t < P.WARMUP ? null : sigSide(sig[t]);
    if (!side) continue;
    if (!book.pos) {
      if (allowAt(x, ex, t)) book.pending = { kind: 'enter', side, strategy, R: slDist(x, ex, t) };
    } else if (side !== book.pos.side) {
      book.pending = allowAt(x, ex, t) ? { kind: 'reverse', side, strategy, R: slDist(x, ex, t) } : { kind: 'close' };
    }
  }
  return book.trades;
}

/** Mirrors core simulateAdaptive (same select/decide), with O(1) scoring via prefix sums. */
export function runAdaptive(x: Ctx, ex: Exit, hullT: RT[], utT: RT[]): RT[] {
  const prep = (a: RT[]) => {
    const s = [...a].sort((p, q) => p.exitTime - q.exitTime);
    const pre = [0];
    for (const tr of s) pre.push(pre.at(-1)! + tr.net);
    return { s, pre };
  };
  const H = prep(hullT), U = prep(utT);
  const sc = (pre: number[], k: number) => pre[k] - pre[Math.max(0, k - P.SEL_N)];
  const book = new Book(ex, x);
  let active: StrategyId = 'hull';
  let pending: StrategyId | null = null;
  let hi = 0, ui = 0;
  for (let t = 0; t < x.c.length; t++) {
    const bar = x.c[t];
    book.executePending(bar);
    book.manage(t);
    if (t < P.WARMUP) continue;
    while (hi < H.s.length && H.s[hi].exitTime < bar.time) hi++;
    while (ui < U.s.length && U.s[ui].exitTime < bar.time) ui++;
    const sel = select(
      {
        scores: { hull: sc(H.pre, hi), ut: sc(U.pre, ui) },
        counts: { hull: hi, ut: ui },
        active,
        pending,
        isFlat: !book.pos,
        positionSide: book.pos?.side ?? null,
        signals: { hull: x.ind.sigHull[t], ut: x.ind.sigUt[t] },
        override: null,
      },
      P,
    );
    active = sel.active;
    pending = sel.pending;
    const d = decide({
      halted: false,
      haltKind: null,
      position: book.pos ? { side: book.pos.side } : null,
      activeSignal: active === 'hull' ? x.ind.sigHull[t] : x.ind.sigUt[t],
      activeDirection: direction(active, x.ind, t),
    });
    if (d.action === 'ENTER' && d.side) {
      if (allowAt(x, ex, t)) book.pending = { kind: 'enter', side: d.side, strategy: active, R: slDist(x, ex, t) };
    } else if (d.action === 'REVERSE' && d.side) {
      book.pending = allowAt(x, ex, t) ? { kind: 'reverse', side: d.side, strategy: active, R: slDist(x, ex, t) } : { kind: 'close' };
    }
  }
  return book.trades;
}

// ---------------------------------------------------------------- metrics
/** Risk sizing: size so that an initial stop hit (incl. fees) loses `risk` of the balance; 20x margin cap. */
export function account(trades: RT[], risk: number, start = 141): { final: number; ddPct: number; blown: boolean } {
  let bal = start, peak = start, dd = 0;
  for (const tr of [...trades].sort((a, b) => a.entryTime - b.entryTime)) {
    const costR = tr.R + tr.entry * 2 * P.FEE_RATE + 2 * SLIP;
    let size = Math.floor((bal * risk) / costR / 0.01) * 0.01;
    size = Math.min(size, Math.floor((bal * P.LEVERAGE) / tr.entry / 0.01) * 0.01);
    if (size < 0.01) return { final: bal, ddPct: 1, blown: true };
    bal += size * tr.net;
    peak = Math.max(peak, bal);
    dd = Math.max(dd, (peak - bal) / peak);
  }
  return { final: bal, ddPct: dd, blown: false };
}

export interface Period {
  split: number;
  yTr: number;
  yTe: number;
  years: number[];
}

export function period(c: Candle[]): Period {
  const t0 = c[0].time, t1 = c.at(-1)!.time + 3600;
  const split = t0 + Math.floor((t1 - t0) * 0.7);
  const yr = (a: number, b: number) => (b - a) / (365 * 86400);
  return { split, yTr: yr(t0, split), yTe: yr(split, t1), years: [...new Set(c.map((b) => new Date(b.time * 1000).getUTCFullYear()))] };
}

export type Row = Record<string, string | number | boolean>;

export function metrics(trades: RT[], pd: Period): Row {
  const sorted = [...trades].sort((a, b) => a.exitTime - b.exitTime);
  const sum = (a: RT[]) => a.reduce((s, x) => s + x.net, 0);
  const tr = sorted.filter((x) => x.entryTime < pd.split), te = sorted.filter((x) => x.entryTime >= pd.split);
  const wins = sorted.filter((x) => x.net > 0), losses = sorted.filter((x) => x.net <= 0);
  const gw = sum(wins), gl = -sum(losses);
  const row: Row = {
    trades: sorted.length,
    perYr: +(sorted.length / (pd.yTr + pd.yTe)).toFixed(0),
    win: +((wins.length / Math.max(1, sorted.length)) * 100).toFixed(0),
    trainYr: +(sum(tr) / pd.yTr).toFixed(0),
    testYr: +(sum(te) / pd.yTe).toFixed(0),
    PF: gl > 0 ? +(gw / gl).toFixed(2) : 0,
    maxDD: +maxDrawdown(sorted.map((x) => x.net)).toFixed(0),
    avgR: +(sorted.reduce((s, x) => s + x.R, 0) / Math.max(1, sorted.length)).toFixed(1),
  };
  let everyYear = true;
  for (const y of pd.years) {
    const v = +sum(sorted.filter((x) => new Date(x.entryTime * 1000).getUTCFullYear() === y)).toFixed(0);
    row[`y${y}`] = v;
    if (v <= 0) everyYear = false;
  }
  const a5 = account(sorted, 0.05), a2 = account(sorted, 0.02);
  row.acct5 = a5.blown ? 'blown' : +a5.final.toFixed(0);
  row.dd5 = +(a5.ddPct * 100).toFixed(0);
  row.acct2 = a2.blown ? 'blown' : +a2.final.toFixed(0);
  row.dd2 = +(a2.ddPct * 100).toFixed(0);
  row.pass = Number(row.trainYr) > 0 && Number(row.testYr) > 0 && everyYear && Number(row.maxDD) < 141 && sorted.length >= 30;
  return row;
}

export const trailName = (t: Trail) => (t.kind === 'none' ? 'none' : t.kind === 'r' ? `R ${t.trig}/${t.gap}` : t.kind === 'chand' ? `chand ${t.trig}/${t.m}` : `ut ${t.trig}`);
export const exitName = (e: Exit) =>
  e.legacy ? `legacy$${e.gate ? '+wknd' : ''}` : `sl ${e.slK}×ATR ${e.overCap} | minATR ${e.minAtr} | be ${e.beTrig === null ? '—' : `${e.beTrig}R→${e.beLock === 'fee' ? 'fee' : `${e.beLock}R`}`} | trail ${trailName(e.trail)} | tp ${e.tpR ?? '—'}`;

/** Strategy v2 as built (design Amendment A), in research terms. */
export const V2: Exit = {
  gate: true,
  overCap: 'skip',
  slK: P.SL_ATR_MULT,
  minAtr: P.MIN_ATR,
  beTrig: P.BE_TRIG_R,
  beLock: 'fee',
  trail: { kind: 'chand', trig: P.TRAIL_TRIG_R, m: P.TRAIL_ATR_MULT },
  tpR: P.TP_R > 0 ? P.TP_R : null,
};

/** Runs V2 through both this simulator and src/core/simulator.ts with the same entry filter; they must match. */
export function validateCore(x: Ctx): { ok: boolean; detail: string } {
  const opts = { allowEntryAt: (t: number) => allowAt(x, V2, t), atr: x.atr };
  const h = runFixed(x, V2, 'hull'), u = runFixed(x, V2, 'ut'), a = runAdaptive(x, V2, h, u);
  const ch = simulate('hull', x.c, x.ind.sigHull, P, opts), cu = simulate('ut', x.c, x.ind.sigUt, P, opts), ca = simulateAdaptive(x.c, x.ind, P, opts).trades;
  const same = (r: RT[], k: { netPnl: number; entryTime: number; reason: string }[]) =>
    r.length === k.length && r.every((t, i) => t.entryTime === k[i].entryTime && t.reason.replace("sl_init", "sl_stage_0").replace("sl_be", "sl_stage_1").replace("sl_trail", "sl_stage_2") === k[i].reason && Math.abs(t.net - k[i].netPnl) < 1e-6);
  const ok = same(h, ch) && same(u, cu) && same(a, ca);
  return { ok, detail: `hull ${h.length}/${ch.length}, ut ${u.length}/${cu.length}, adaptive ${a.length}/${ca.length}` };
}

// ---------------------------------------------------------------- main
async function main() {
  const c = await loadCandles();
  const x = makeCtx(c);
  const pd = period(c);
  const out: string[] = [];
  const say = (s: string) => (console.log(s), out.push(s));
  say(`${c.length} candles ${new Date(c[0].time * 1000).toISOString().slice(0, 10)} → ${new Date(c.at(-1)!.time * 1000).toISOString().slice(0, 10)}; train/test split ${new Date(pd.split * 1000).toISOString().slice(0, 10)}`);

  // 1. Validation: the live core simulator (Strategy v2) must reproduce this research simulator exactly.
  const v = validateCore(x);
  say(`validation vs core simulator (Strategy v2): ${v.ok} — ${v.detail}`);
  if (!v.ok) throw new Error('research simulator does not match core; aborting');
  const L: Exit = { legacy: true, gate: false, slK: 0, overCap: 'cap', minAtr: 0, beTrig: null, beLock: 'fee', trail: { kind: 'none' }, tpR: null };

  // 2. Baseline: live config today (legacy ladder + weekend block).
  const LW = { ...L, gate: true };
  const bh = runFixed(x, LW, 'hull'), bu = runFixed(x, LW, 'ut');
  const rows: Row[] = [];
  const add = (mode: string, ex: Exit, trades: RT[]) => rows.push({ mode, exit: exitName(ex), ...metrics(trades, pd) });
  add('adaptive', LW, runAdaptive(x, LW, bh, bu));
  add('hull', LW, bh);
  add('ut', LW, bu);
  say('\nBaseline (live today: $20 ladder, weekends blocked):');
  console.table(rows);
  out.push(JSON.stringify(rows, null, 1));

  // 3. Grid.
  const trails: Trail[] = [
    { kind: 'none' },
    { kind: 'r', trig: 1.5, gap: 1 },
    { kind: 'r', trig: 2, gap: 1 },
    { kind: 'r', trig: 2, gap: 1.5 },
    { kind: 'r', trig: 3, gap: 1.5 },
    { kind: 'chand', trig: 1, m: 2 },
    { kind: 'chand', trig: 1, m: 3 },
    { kind: 'chand', trig: 2, m: 3 },
    { kind: 'ut', trig: 1 },
    { kind: 'ut', trig: 2 },
  ];
  const bes: Array<[number | null, 'fee' | number]> = [[null, 'fee'], [0.75, 'fee'], [1, 'fee'], [1.5, 'fee'], [1, 0.5]];
  const grid: Row[] = [];
  const t0 = Date.now();
  for (const slK of [1, 1.5, 2, 3])
    for (const overCap of ['cap', 'skip'] as const)
      for (const minAtr of [0, 10, 15, 20, 25])
        for (const [beTrig, beLock] of bes)
          for (const trail of trails)
            for (const tpR of [2, 3, 5, null]) {
              const ex: Exit = { gate: true, slK, overCap, minAtr, beTrig, beLock, trail, tpR };
              const h = runFixed(x, ex, 'hull'), u = runFixed(x, ex, 'ut');
              const name = exitName(ex);
              grid.push({ mode: 'hull', exit: name, ...metrics(h, pd) });
              grid.push({ mode: 'ut', exit: name, ...metrics(u, pd) });
              grid.push({ mode: 'adaptive', exit: name, ...metrics(runAdaptive(x, ex, h, u), pd) });
            }
  say(`\nGrid: ${grid.length} runs in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  writeFileSync('data/research5-grid.json', JSON.stringify(grid));

  const passes = grid.filter((r) => r.pass);
  say(`Pass bar (train>0, test>0, every year>0, maxDD<$141, ≥30 trades): ${passes.length} of ${grid.length}`);
  const cols = (r: Row) => {
    const { pass: _p, ...rest } = r;
    return rest;
  };
  if (passes.length) {
    say('\nPasses, best by TRAIN $/ETH/yr (chosen on train only):');
    const top = [...passes].sort((a, b) => Number(b.trainYr) - Number(a.trainYr)).slice(0, 25).map(cols);
    console.table(top);
    out.push(JSON.stringify(top, null, 1));
  }
  say('\nTop 20 by TRAIN regardless of the bar (how they did in test):');
  const topTr = [...grid].sort((a, b) => Number(b.trainYr) - Number(a.trainYr)).slice(0, 20);
  console.table(topTr);
  out.push(JSON.stringify(topTr, null, 1));
  say('\nLowest max drawdown with train>0 and test>0:');
  const safe = grid.filter((r) => Number(r.trainYr) > 0 && Number(r.testYr) > 0 && Number(r.trades) >= 30).sort((a, b) => Number(a.maxDD) - Number(b.maxDD)).slice(0, 20);
  console.table(safe);
  out.push(JSON.stringify(safe, null, 1));
  writeFileSync(`data/research5-${new Date().toISOString().slice(0, 10)}.txt`, out.join('\n') + '\n');
}

if (process.argv[1]?.endsWith('research5.ts')) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
