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

function aaBreaks(c: Candle[], ltf: Candle[][]): number[] {
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

void trend; void bullRej; void bearRej;
return brk;
}
import { algoAlpha } from '../../src/core/algoAlpha.js';
void aaBreaks;
const N = 6000;
const C = c.slice(-N), LD = ltf.slice(-N);
// Which hours are "big wick" (the only hours whose 3m bars are used): same formulas as the core.
const vol = C.map((b) => b.volume);
const rma = (x: number[], n: number) => { const o = new Array(x.length).fill(NaN); let s = 0, k = 0; for (let i = 0; i < x.length; i++) { if (Number.isNaN(x[i])) continue; if (k < n) { s += x[i]; k++; if (k === n) o[i] = s / n; } else o[i] = (o[i - 1] * (n - 1) + x[i]) / n; } return o; };
const ru = rma(vol.map((v, i) => (i ? Math.max(v - vol[i - 1], 0) : NaN)), 14), rd = rma(vol.map((v, i) => (i ? Math.max(vol[i - 1] - v, 0) : NaN)), 14);
const vr = ru.map((u, i) => (rd[i] === 0 ? 100 : u === 0 ? 0 : 100 - 100 / (1 + u / rd[i])));
const lw = C.map((b) => Math.min(b.close, b.open) - b.low), uw = C.map((b) => b.high - Math.max(b.close, b.open)), aw = C.map((_, i) => (lw[i] + uw[i]) / 2);
const aws = aw.map((_, i) => (i < 20 ? NaN : aw.slice(i - 20, i + 1).reduce((a, b) => a + b, 0) / 21));
const hl = C.map((_, i) => aw[i] > aws[i] * 2 && vr[i] > 60 && uw[i] !== lw[i]);
const A = algoAlpha(C, LD).brk;
const cmp = (X: number[]) => { let d = 0; for (let i = 3000; i < N; i++) if (X[i] !== A[i]) d++; return d; };
const nb = A.slice(3000).filter(Boolean).length;
console.log(`FB window ${N}h, compared last ${N - 3000}h: ${nb} breaks; big-wick hours ${hl.filter(Boolean).length} of ${N} (${((100 * hl.filter(Boolean).length) / N).toFixed(1)}%)`);
// 1) Drop the 3m bars of every NON-big-wick hour: should change nothing.
console.log(`FB drop 3m of all ordinary hours → break differences: ${cmp(algoAlpha(C, LD.map((x, i) => (hl[i] ? x : []))).brk)}`);
// 2) Newest hour's 3m missing (the live failure case), every endpoint in the last 1000h.
let d2 = 0, d2w = 0;
for (let e = N - 1000; e < N; e++) { const L2 = LD.slice(0, e + 1).map((x, i) => (i === e ? [] : x)); const r = algoAlpha(C.slice(0, e + 1), L2).brk[e]; if (r !== A[e]) { d2++; if (hl[e]) d2w++; } }
console.log(`FB newest hour without 3m, 1000 cycles → wrong break on the current bar: ${d2} (of which big-wick hours ${d2w})`);
// 3) Binance 3m instead of Delta.
const bin: Candle[] = [];
for (let s = C[0].time; s < C[N - 1].time + 3600; s += 1000 * 180) {
  const u = `https://data-api.binance.vision/api/v3/klines?symbol=ETHUSDT&interval=3m&startTime=${s * 1000}&endTime=${(s + 1000 * 180 - 1) * 1000}&limit=1000`;
  const rows = (await (await fetch(u)).json()) as unknown[][];
  for (const r of rows) bin.push({ time: Number(r[0]) / 1000, open: +(r[1] as string), high: +(r[2] as string), low: +(r[3] as string), close: +(r[4] as string), volume: +(r[5] as string) });
}
const idx = new Map(C.map((b, i) => [b.time, i])); const LB: Candle[][] = C.map(() => []);
for (const x of bin) { const i = idx.get(Math.floor(x.time / 3600) * 3600); if (i !== undefined) LB[i].push(x); }
console.log(`FB Binance 3m bars ${bin.length}; all hours from Binance → break differences: ${cmp(algoAlpha(C, LB).brk)} of ${nb}`);
// 4) Binance only for big-wick hours, one at a time (the fallback case), last 300 big-wick hours: does the level change any later break?
let bad = 0, tot = 0;
const wickHours = hl.map((h, i) => (h && i >= 3000 ? i : -1)).filter((i) => i >= 0).slice(-300);
for (const h of wickHours) { tot++; const L4 = LD.map((x, i) => (i === h ? LB[h] : x)); if (cmp(algoAlpha(C, L4).brk) > 0) bad++; }
console.log(`FB Binance for ONE big-wick hour (Delta elsewhere): ${bad} of ${tot} cases changed a later break`);
