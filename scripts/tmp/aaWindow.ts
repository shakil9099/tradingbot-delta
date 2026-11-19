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
const full = aaBreaks(c, ltf);
for (const W of [500, 1000, 2000, 3000]) {
  let same = 0, diff = 0, missFull = 0, extra = 0;
  for (let end = c.length - 1; end > c.length - 1 - 24 * 120; end -= 1) {
    if (end - W + 1 < 0) break;
    const sub = aaBreaks(c.slice(end - W + 1, end + 1), ltf.slice(end - W + 1, end + 1));
    const a = full[end], b = sub[sub.length - 1];
    if (a === b) same++; else { diff++; if (a && !b) missFull++; if (b && !a) extra++; }
  }
  console.log(`WIN ${W} bars: last-bar break matches full history ${same}/${same + diff}; missed ${missFull}, extra ${extra}`);
}
