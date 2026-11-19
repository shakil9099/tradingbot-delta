// AlgoAlpha "Zero Lag Liquidity" (docs/algoalpha.pine) on ETHUSD 1h with 3-minute lower-timeframe data,
// combined with UT Bot (1, 10) and with the live Hull bot. npx tsx scripts/algoAlpha.ts
// Port follows the Pine line by line: levels = POC of 3m closes inside a big wick (7 bins), a level breaks after
// two closes beyond it (→ break signal, trend), a rejection = previous bar straddled a level and hl2 is back on
// the far side. Rules are judged on the older period vs the last 365 days, like scripts/utSniper.ts.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { DEFAULT_PARAMS } from '../../src/config/params.js';
import { entryGate } from '../../src/core/entryGate.js';
import { atrPine, utTrailingStop } from '../../src/core/indicators.js';
import { computeAll } from '../../src/core/signals.js';
import { simulate } from '../../src/core/simulator.js';
import { contractsFor, riskFor } from '../../src/core/sizing.js';
import type { Candle, SimTrade } from '../../src/shared/types.js';
import { fetchHistory } from '../lib/candles.js';

const H = 3600;
const IST = 19800;
const P = DEFAULT_PARAMS;
const FEE = P.FEE_RATE;
const SLIP = P.SLIPPAGE_TICKS * P.TICK;
type Dir = 1 | -1;

// ---------- 1h candles ----------
const cache1h = JSON.parse(readFileSync('data/eth_1h_cache.json', 'utf8')) as Candle[];
const by = new Map<number, Candle>();
for (const x of [...cache1h, ...(await fetchHistory(3, '1h'))]) by.set(x.time, x);
const c = [...by.values()].sort((a, b) => a.time - b.time).filter((x) => x.high > x.low || x.volume > 0);
const end = c[c.length - 1].time;
const testFrom = end - 365 * 86400;

// ---------- 3m candles (cached, fetched incrementally) ----------
const F3 = 'data/eth_3m_cache.json';
let m3: Candle[] = existsSync(F3) ? (JSON.parse(readFileSync(F3, 'utf8')) as Candle[]) : [];
{
  const S = 180;
  const PAGE = 2000;
  let start = m3.length ? m3[m3.length - 1].time + S : c[0].time;
  const stop = Math.floor(Date.now() / 1000 / S) * S;
  const got: Candle[] = [];
  let pages = 0;
  while (start < stop) {
    const e = Math.min(start + PAGE * S - 1, stop - 1);
    const url = `https://api.india.delta.exchange/v2/history/candles?resolution=3m&symbol=ETHUSD&start=${start}&end=${e}`;
    let rows: Array<Record<string, number>> = [];
    for (let attempt = 0; attempt < 4; attempt++) {
      const r = await fetch(url, { headers: { 'User-Agent': 'tradingbot-eth/1.0 (backtest)', Accept: 'application/json' } });
      if (r.ok) {
        rows = ((await r.json()) as { result: Array<Record<string, number>> }).result ?? [];
        break;
      }
      await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)));
    }
    for (const x of rows) got.push({ time: +x.time, open: +x.open, high: +x.high, low: +x.low, close: +x.close, volume: +x.volume });
    start = e + 1;
    if (++pages % 40 === 0) process.stderr.write(`3m pages ${pages}…\n`);
  }
  const m = new Map<number, Candle>();
  for (const x of [...m3, ...got]) m.set(x.time, x);
  m3 = [...m.values()].sort((a, b) => a.time - b.time).filter((x) => x.time + 180 <= stop);
  writeFileSync(F3, JSON.stringify(m3));
  process.stderr.write(`3m candles: ${m3.length}\n`);
}
// 3m bars inside each 1h bar
const ltf: Candle[][] = c.map(() => []);
{
  const idx = new Map(c.map((b, i) => [b.time, i]));
  for (const x of m3) {
    const i = idx.get(Math.floor(x.time / H) * H);
    if (i !== undefined) ltf[i].push(x);
  }
}

// ---------- AlgoAlpha port ----------
function rmaSeeded(x: number[], n: number) {
  const out = new Array<number>(x.length).fill(NaN);
  let s = 0, k = 0;
  for (let i = 0; i < x.length; i++) {
    if (Number.isNaN(x[i])) continue;
    if (k < n) {
      s += x[i];
      k++;
      if (k === n) out[i] = s / n;
    } else out[i] = (out[i - 1] * (n - 1) + x[i]) / n;
  }
  return out;
}
const vol = c.map((b) => b.volume);
const up = vol.map((v, i) => (i ? Math.max(v - vol[i - 1], 0) : NaN));
const dn = vol.map((v, i) => (i ? Math.max(vol[i - 1] - v, 0) : NaN));
const ru = rmaSeeded(up, 14);
const rd = rmaSeeded(dn, 14);
const volRsi = ru.map((u, i) => (rd[i] === 0 ? 100 : u === 0 ? 0 : 100 - 100 / (1 + u / rd[i])));
const lw = c.map((b) => Math.min(b.close, b.open) - b.low);
const uw = c.map((b) => b.high - Math.max(b.close, b.open));
const aw = c.map((_, i) => (lw[i] + uw[i]) / 2);
const awSma = aw.map((_, i) => (i < 20 ? NaN : aw.slice(i - 20, i + 1).reduce((a, b) => a + b, 0) / 21));

function poc(top: number, bot: number, bars: Candle[], bins = 7): number {
  if (!bars.length || top === bot) return NaN;
  const seg = (top - bot) / bins;
  const bounds = Array.from({ length: bins + 1 }, (_, k) => bot + k * seg);
  const v = bounds.slice(0, -1).map((lo, k) => bars.reduce((a, x) => a + (x.close >= lo && x.close <= bounds[k + 1] ? x.volume : 0), 0));
  const k = v.indexOf(Math.max(...v));
  return (bounds[k] + bounds[k + 1]) / 2;
}

const brk = new Array<number>(c.length).fill(0); // +1 bullish break, −1 bearish break at this bar
const trend = new Array<number>(c.length).fill(0);
const bullRej = new Array<boolean>(c.length).fill(false);
const bearRej = new Array<boolean>(c.length).fill(false);
{
  type Lvl = { price: number; typ: Dir; born: number; vol: number };
  let lv: Lvl[] = []; // index 0 = newest (array.unshift)
  let tr = 0;
  for (let i = 1; i < c.length; i++) {
    const b = c[i];
    const hl = (aw[i] > awSma[i] * 2) && volRsi[i] > 60 && uw[i] !== lw[i];
    if (hl) {
      const red = lw[i] > uw[i];
      const top = red ? Math.min(b.close, b.open) : b.high;
      const bot = red ? b.low : Math.max(b.close, b.open);
      const p = poc(top, bot, ltf[i]);
      if (!Number.isNaN(p)) {
        lv.unshift({ price: p, typ: red ? -1 : 1, born: i, vol: b.volume });
        if (lv.length > 500) lv.pop();
      }
    }
    let br = 0;
    const keep: Lvl[] = [];
    for (let k = lv.length - 1; k >= 0; k--) {
      const l = lv[k];
      const done = l.typ === 1 ? b.close > l.price && c[i - 1].close > l.price : b.close < l.price && c[i - 1].close < l.price;
      if (done) {
        br = l.typ;
        tr = l.typ;
        continue;
      }
      // Pine: x2 − x1 > 0 is true from the second bar after creation.
      if (i - l.born >= 2 && c[i - 1].high > l.price && c[i - 1].low < l.price) {
        const hl2 = (b.high + b.low) / 2;
        if (hl2 > l.price && l.typ === -1) bullRej[i] = true;
        else if (hl2 < l.price && l.typ === 1) bearRej[i] = true;
      }
      keep.unshift(l);
    }
    lv = keep;
    brk[i] = br;
    trend[i] = tr;
  }
}

// ===== 4-way: entry {AlgoAlpha break, Reversal} x exit {AlgoAlpha break, Reversal} =====
import { riskDistance, initialStops, nextStop } from '../../src/core/exits.js';
import type { Side, Signal } from '../../src/shared/types.js';
const p0 = { ...P, STRATEGY: 'hull' as const, SKIP_WEEKEND_ENTRIES: true, MIN_ATR: 15, BE_TRIG_USD: 0, TRAIL_TRIG_R: 1, BE_TRIG_R: 1, TP_R: 0, MAX_CONTRACTS: 100 };
const ind = computeAll(c, { ...p0, REV_REENTRY: true });
const g = entryGate(c, p0);
const atr = atrPine(c, p0.ATR_LEN);
const AA: Signal[] = brk.map((b, i) => (i < 300 ? 'NONE' : b === 1 ? 'LONG' : b === -1 ? 'SHORT' : 'NONE'));
const RV = ind.sigRev;
const sd = (s: Signal): Side | null => (s === 'LONG' ? 'buy' : s === 'SHORT' ? 'sell' : null);
type Tr = { e: number; x: number; side: Side; ep: number; xp: number; net: number; why: string };
function run(E: Signal[], X: Signal[], stops: 'live' | 'sl') {
  const pp = stops === 'live' ? p0 : { ...p0, BE_TRIG_R: 999, TRAIL_TRIG_R: 999 };
  const S = pp.SLIPPAGE_TICKS * pp.TICK, out: Tr[] = [];
  let pos: any = null, pend: { k: 'close' | 'enter'; side?: Side; R?: number; also?: boolean } | null = null;
  const close = (px: number, t: number, why: string) => { const xp = pos.side === 'buy' ? px - S : px + S; const gr = pos.side === 'buy' ? xp - pos.entry : pos.entry - xp; out.push({ e: pos.t, x: t, side: pos.side, ep: pos.entry, xp, net: gr - (pos.entry + xp) * pp.FEE_RATE, why }); pos = null; };
  const open = (side: Side, px: number, t: number, R: number) => { const entry = side === 'buy' ? px + S : px - S; const { sl } = initialStops(side, entry, R, pp); pos = { side, entry, t, sl, R, hh: -Infinity, ll: Infinity, stage: 0 }; };
  for (let t = 0; t < c.length; t++) {
    const b = c[t];
    if (pend) { const q = pend; pend = null; if (q.k === 'close' && pos) close(b.open, b.time, 'signal'); if (q.side && !pos) open(q.side, b.open, b.time, q.R!); }
    if (pos) {
      const L = pos.side === 'buy';
      if (L ? b.low <= pos.sl : b.high >= pos.sl) close(L ? Math.min(b.open, pos.sl) : Math.max(b.open, pos.sl), b.time, 'stop');
      else { pos.hh = Math.max(pos.hh, b.high); pos.ll = Math.min(pos.ll, b.low); const n = nextStop(pos.side, pos.entry, pos.R, pos.sl, pos.stage, { close: b.close, atr: atr[t], hh: pos.hh, ll: pos.ll }, pp); if (n.changed) { pos.sl = n.sl; pos.stage = n.stage; } }
    }
    if (t < 300) continue;
    const xs = sd(X[t]), es = sd(E[t]);
    const R = riskDistance(atr[t], pp);
    const canEnter = (s: Side) => R !== null && g(t) === null && s;
    if (pos) { if (xs && xs !== pos.side) { pend = { k: 'close' }; if (es && es !== pos.side && canEnter(es)) Object.assign(pend, { side: es, R }); } }
    else if (es && canEnter(es)) pend = { k: 'enter', side: es, R: R! };
  }
  return out;
}
const yr = c[c.length - 1].time - 365 * 86400, m30 = c[c.length - 1].time - 30 * 86400;
const st = (xs: Tr[]) => { let e = 0, pk = 0, dd = 0, w = 0, ls = 0, cur = 0; for (const t of xs) { e += t.net; pk = Math.max(pk, e); dd = Math.max(dd, pk - e); if (t.net > 0) { w++; cur = 0; } else ls = Math.max(ls, ++cur); } const L = xs.filter((t) => t.net <= 0); return { n: xs.length, w: xs.length ? Math.round((100 * w) / xs.length) : 0, net: e, dd, al: L.length ? L.reduce((a, t) => a + t.net, 0) / L.length : 0, ls }; };
const rows: string[] = [];
const ctl = simulate('hull', c, ind.sigHullEntry, p0, { allowEntryAt: (t) => g(t) === null }).filter((t) => t.entryTime >= c[300].time).map((t) => ({ e: t.entryTime, x: t.exitTime, side: t.side, ep: t.entry, xp: t.exit, net: t.netPnl, why: t.reason }));
const line = (name: string, xs: Tr[]) => { const a = st(xs), o = st(xs.filter((t) => t.e < yr)), y = st(xs.filter((t) => t.e >= yr)), m = st(xs.filter((t) => t.e >= m30)); rows.push(`| ${name} | ${a.n} | ${a.w}% | ${o.net.toFixed(0)} | ${y.net.toFixed(0)} | ${m.net.toFixed(0)} | **${a.net.toFixed(0)}** | ${o.dd.toFixed(0)} / ${y.dd.toFixed(0)} | ${a.al.toFixed(1)} | ${a.ls} |`); };
void line; void ctl; void rows;

// ===== Safety version: CTC on touch at +0.5R (3m bars), trail 3×ATR from 1R on 1h close; account with 5% risk and day limits =====
import { feeLock } from '../../src/core/exits.js';
type T2 = Tr & { R: number; ctc: boolean };
function runSafe(E: Signal[], X: Signal[], ctcR: number | null, beCloseR: number) {
  const pp = { ...p0, BE_TRIG_R: beCloseR };
  const S = pp.SLIPPAGE_TICKS * pp.TICK, out: T2[] = [];
  let pos: any = null, pend: { k: 'close' | 'enter'; side?: Side; R?: number } | null = null;
  const close = (px: number, t: number, why: string) => { const xp = pos.side === 'buy' ? px - S : px + S; const gr = pos.side === 'buy' ? xp - pos.entry : pos.entry - xp; out.push({ e: pos.t, x: t, side: pos.side, ep: pos.entry, xp, net: gr - (pos.entry + xp) * pp.FEE_RATE, why, R: pos.R, ctc: pos.ctc }); pos = null; };
  const open = (side: Side, px: number, t: number, R: number) => { const entry = side === 'buy' ? px + S : px - S; const { sl } = initialStops(side, entry, R, pp); pos = { side, entry, t, sl, R, hh: -Infinity, ll: Infinity, stage: 0, ctc: false }; };
  for (let t = 0; t < c.length; t++) {
    const b = c[t];
    if (pend) { const q = pend; pend = null; if (q.k === 'close' && pos) close(b.open, b.time, 'signal'); if (q.side && !pos) open(q.side, b.open, b.time, q.R!); }
    if (pos) {
      const L = pos.side === 'buy';
      const bars = ltf[t].length ? ltf[t] : [b];
      for (const k of bars) {
        if (L ? k.low <= pos.sl : k.high >= pos.sl) { close(L ? Math.min(k.open, pos.sl) : Math.max(k.open, pos.sl), k.time, pos.ctc ? 'ctc' : 'stop'); break; }
        if (ctcR !== null && !pos.ctc && (L ? k.high - pos.entry : pos.entry - k.low) >= ctcR * pos.R) {
          const lk = feeLock(pos.entry, pp); const ns = L ? pos.entry + lk : pos.entry - lk;
          if (L ? ns > pos.sl : ns < pos.sl) pos.sl = ns;
          pos.ctc = true;
        }
      }
      if (pos) {
        pos.hh = Math.max(pos.hh, b.high); pos.ll = Math.min(pos.ll, b.low);
        const n = nextStop(pos.side, pos.entry, pos.R, pos.sl, pos.stage, { close: b.close, atr: atr[t], hh: pos.hh, ll: pos.ll }, pp);
        if (n.changed) { pos.sl = n.sl; pos.stage = n.stage; if (n.stage >= 1) pos.ctc = true; }
      }
    }
    if (t < 300) continue;
    const xs = sd(X[t]), es = sd(E[t]);
    const R = riskDistance(atr[t], pp);
    const can = (s: Side) => R !== null && g(t) === null && !!s;
    if (pos) { if (xs && xs !== pos.side) { pend = { k: 'close' }; if (es && es !== pos.side && can(es)) Object.assign(pend, { side: es, R }); } }
    else if (es && can(es)) pend = { k: 'enter', side: es, R: R! };
  }
  return out;
}
const istDay = (t: number) => new Date((t + 19800) * 1000).toISOString().slice(0, 10);
/** 5% risk per trade; once a day's realised net is ≥ +up or ≤ −down of the day-start balance, no new entries that IST day. */
function account(xs: T2[], start: number, up: number | null, down: number | null) {
  let bal = start, pk = start, dd = 0, day = '', d0 = start, worstDay = 0, dayNet = 0, hitUp = 0, hitDn = 0;
  const taken: T2[] = [];
  const roll = (d: string) => { if (d !== day) { if (day) worstDay = Math.min(worstDay, dayNet / d0); day = d; d0 = bal; dayNet = 0; } };
  for (const t of xs) {
    roll(istDay(t.e));
    if ((up !== null && dayNet >= up * d0) || (down !== null && dayNet <= -down * d0)) continue;
    const n = contractsFor({ balanceUsd: bal, price: t.ep, riskDist: t.R, risk: 0.05, leverage: P.LEVERAGE, maxContracts: 100, feeRate: P.FEE_RATE, tick: P.TICK, slippageTicks: P.SLIPPAGE_TICKS, fixedContracts: 0 }).contracts;
    const pnl = n * P.CONTRACT_VALUE * t.net;
    bal += pnl; pk = Math.max(pk, bal); dd = Math.max(dd, (pk - bal) / pk); taken.push(t);
    roll(istDay(t.x));
    const before = dayNet; dayNet += pnl;
    if (up !== null && before < up * d0 && dayNet >= up * d0) hitUp++;
    if (down !== null && before > -down * d0 && dayNet <= -down * d0) hitDn++;
  }
  return { bal, dd, worstDay: Math.min(worstDay, dayNet / d0), taken, hitUp, hitDn };
}
const hullTr: T2[] = simulate('hull', c, ind.sigHullEntry, p0, { allowEntryAt: (t) => g(t) === null }).filter((t) => t.entryTime >= c[300].time).map((t) => ({ e: t.entryTime, x: t.exitTime, side: t.side, ep: t.entry, xp: t.exit, net: t.netPnl, why: t.reason, R: t.riskDist!, ctc: t.reason === 'sl_stage_1' }));
const safe = runSafe(RV, AA, 0.5, 999);
const V: [string, T2[], number | null, number | null][] = [
  ['Live Hull (Mix B), 5% risk', hullTr, null, null],
  ['Rev→AA, BE 1R on close, 5% risk', runSafe(RV, AA, null, 1), null, null],
  ['Rev→AA, CTC touch +0.5R, 5% risk', safe, null, null],
  ['YOUR RULES: + day stop +5% / −10%', safe, 0.05, 0.1],
  ['Rev→AA, CTC touch +0.5R, day −10% only', safe, null, 0.1],
];
console.log('SAFE| Version | Trades | Win | CTC exits | Per-ETH full / 12m | $90 → full (worst fall) | $90 → last 12m (worst fall) | Worst day | Days hit +5% / −10% |');
for (const [nm, xs, up, dn] of V) {
  const a = account(xs, 90, up, dn), y = account(xs.filter((t) => t.e >= yr), 90, up, dn);
  const tk = a.taken, w = tk.filter((t) => t.net > 0).length, ce = tk.filter((t) => t.ctc && Math.abs(t.net) < 3).length;
  const pe = tk.reduce((s, t) => s + t.net, 0), pey = tk.filter((t) => t.e >= yr).reduce((s, t) => s + t.net, 0);
  console.log(`SAFE| ${nm} | ${tk.length} | ${Math.round((100 * w) / tk.length)}% | ${Math.round((100 * ce) / tk.length)}% | ${pe.toFixed(0)} / ${pey.toFixed(0)} | $${a.bal.toFixed(0)} (${(a.dd * 100).toFixed(0)}%) | $${y.bal.toFixed(0)} (${(y.dd * 100).toFixed(0)}%) | ${(a.worstDay * 100).toFixed(1)}% | ${a.hitUp} / ${a.hitDn} |`);
}
const days = new Set(safe.map((t) => istDay(t.e))).size; console.log('SAFE| trading days with an entry:', days);
