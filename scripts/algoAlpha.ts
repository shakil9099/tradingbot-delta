// AlgoAlpha "Zero Lag Liquidity" (docs/algoalpha.pine) on ETHUSD 1h with 3-minute lower-timeframe data,
// combined with UT Bot (1, 10) and with the live Hull bot. npx tsx scripts/algoAlpha.ts
// Port follows the Pine line by line: levels = POC of 3m closes inside a big wick (7 bins), a level breaks after
// two closes beyond it (→ break signal, trend), a rejection = previous bar straddled a level and hl2 is back on
// the far side. Rules are judged on the older period vs the last 365 days, like scripts/utSniper.ts.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { DEFAULT_PARAMS } from '../src/config/params.js';
import { entryGate } from '../src/core/entryGate.js';
import { atrPine, utTrailingStop } from '../src/core/indicators.js';
import { computeAll } from '../src/core/signals.js';
import { simulate } from '../src/core/simulator.js';
import { contractsFor, riskFor } from '../src/core/sizing.js';
import type { Candle, SimTrade } from '../src/shared/types.js';
import { fetchHistory } from './lib/candles.js';

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

// ---------- shared pieces ----------
const close = c.map((x) => x.close);
const ut110 = computeAll(c, { ...P, UT_KEY: 1, UT_ATR: 10, WARMUP: 300 });
const utSig = ut110.sigUt;
const utUp = ut110.utUp;
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
const hh10 = (i: number) => Math.max(...c.slice(i - 10, i).map((x) => x.high));
const ll10 = (i: number) => Math.min(...c.slice(i - 10, i).map((x) => x.low));
const sniper = (i: number, s: Dir) => dir4h[i] === s && (s === 1 ? close[i] > hh10(i) : close[i] < ll10(i));
const weekend = (t: number) => [0, 6].includes(new Date((t + IST) * 1000).getUTCDay());
const recentBreak = (i: number, s: Dir, n: number) => {
  for (let k = i; k > i - n && k > 0; k--) if (brk[k] === s) return true;
  return false;
};
const recentRej = (i: number, s: Dir, n: number) => {
  for (let k = i; k > i - n && k > 0; k--) if ((s === 1 ? bullRej[k] : bearRej[k])) return true;
  return false;
};

// Generic stop-and-reverse sim: entry signals (with filter) and exit signals, next-bar-open fills.
type T = { t: number; net: number };
function sar(entrySig: (i: number) => Dir | 0, exitSig: (i: number) => Dir | 0): T[] {
  const out: T[] = [];
  let pos: { side: Dir; px: number; t: number } | null = null;
  for (let i = 300; i < c.length - 1; i++) {
    const nb = c[i + 1];
    const x = exitSig(i);
    if (pos && x && x !== pos.side) {
      const px = nb.open - pos.side * SLIP;
      out.push({ t: pos.t, net: (px - pos.px) * pos.side - (px + pos.px) * FEE });
      pos = null;
    }
    const e = entrySig(i);
    if (!pos && e && !weekend(nb.time)) pos = { side: e, px: nb.open + e * SLIP, t: nb.time };
  }
  if (pos) {
    const px = c[c.length - 1].close;
    out.push({ t: pos.t, net: (px - pos.px) * pos.side - (px + pos.px) * FEE });
  }
  return out;
}
const ut = (i: number): Dir | 0 => (utSig[i] === 'LONG' ? 1 : utSig[i] === 'SHORT' ? -1 : 0);
const utWith = (f: (i: number, s: Dir) => boolean) => (i: number): Dir | 0 => {
  const s = ut(i);
  return s && f(i, s) ? s : 0;
};
const brkSig = (i: number): Dir | 0 => (brk[i] as Dir | 0);

const RULES: Record<string, () => T[]> = {
  'UT 1/10 plain': () => sar(ut, ut),
  'UT + AlgoAlpha trend agrees': () => sar(utWith((i, s) => trend[i] === s), ut),
  'UT + AlgoAlpha break same way in last 5 bars': () => sar(utWith((i, s) => recentBreak(i, s, 5)), ut),
  'UT + AlgoAlpha break same way in last 24 bars': () => sar(utWith((i, s) => recentBreak(i, s, 24)), ut),
  'UT + AlgoAlpha rejection same way in last 5 bars': () => sar(utWith((i, s) => recentRej(i, s, 5)), ut),
  'AlgoAlpha break entry, exit on opposite UT': () => sar(brkSig, ut),
  'AlgoAlpha break entry, exit on opposite break': () => sar(brkSig, brkSig),
  'AlgoAlpha break + UT 1/10 direction agrees, exit on opposite break': () => sar((i) => (brk[i] && (utUp[i] ? 1 : -1) === brk[i] ? (brk[i] as Dir) : 0), brkSig),
};

// Live Hull bot (exits unchanged) with AlgoAlpha as an entry filter.
const ph = { ...P, STRATEGY: 'hull' as const, SKIP_WEEKEND_ENTRIES: true, MIN_ATR: 15, ATR_GATE_MAX: 0 };
const indH = computeAll(c, ph);
const gate = entryGate(c, ph);
const hull = (f: (i: number, s: Dir) => boolean) => (): T[] =>
  simulate('hull', c, indH.sigHull, ph, { allowEntryAt: (i, side) => gate(i) === null && f(i, side === 'buy' ? 1 : -1) })
    .filter((t: SimTrade) => t.entryTime >= c[300].time)
    .map((t: SimTrade) => ({ t: t.entryTime, net: t.netPnl }));
const HULL_RULES: Record<string, () => T[]> = {
  'LIVE Hull bot': hull(() => true),
  'Hull + AlgoAlpha trend agrees': hull((i, s) => trend[i] === s),
  'Hull + AlgoAlpha break same way in last 24 bars': hull((i, s) => recentBreak(i, s, 24)),
  'Hull + no opposite AlgoAlpha break in last 5 bars': hull((i, s) => !recentBreak(i, (-s) as Dir, 5)),
  'AlgoAlpha break entries + live-bot exits (2×ATR stop, BE, trail; opposite break reverses)': () =>
    simulate('hull', c, brk.map((x, i) => (i < 300 ? 'NONE' : x > 0 ? 'LONG' : x < 0 ? 'SHORT' : 'NONE')), ph, { allowEntryAt: (i) => gate(i) === null })
      .filter((t: SimTrade) => t.entryTime >= c[300].time).map((t: SimTrade) => ({ t: t.entryTime, net: t.netPnl })),
  'UT 1/10 entries + live-bot exits': () =>
    simulate('ut', c, utSig, ph, { allowEntryAt: (i) => gate(i) === null }).filter((t: SimTrade) => t.entryTime >= c[300].time).map((t: SimTrade) => ({ t: t.entryTime, net: t.netPnl })),
  'UT 1/10 + AlgoAlpha trend agrees, live-bot exits': () =>
    simulate('ut', c, utSig, ph, { allowEntryAt: (i, side) => gate(i) === null && trend[i] === (side === 'buy' ? 1 : -1) }).filter((t: SimTrade) => t.entryTime >= c[300].time).map((t: SimTrade) => ({ t: t.entryTime, net: t.netPnl })),
};

const st = (xs: T[]) => {
  let e = 0, pk = 0, dd = 0, w = 0, gw = 0, gl = 0;
  for (const t of xs) {
    e += t.net;
    pk = Math.max(pk, e);
    dd = Math.max(dd, pk - e);
    if (t.net > 0) { w++; gw += t.net; } else gl -= t.net;
  }
  return { n: xs.length, net: e, dd, win: xs.length ? w / xs.length : 0, pf: gl ? gw / gl : 99 };
};
const iso = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
const row = (name: string, tr: T[]) => {
  const o = st(tr.filter((t) => t.t < testFrom));
  const l = st(tr.filter((t) => t.t >= testFrom));
  const a = st(tr);
  return `| ${name} | ${o.n} | ${o.net.toFixed(0)} | ${o.pf.toFixed(2)} | ${l.n} | ${(l.win * 100).toFixed(0)}% | **${l.net.toFixed(0)}** | ${l.pf.toFixed(2)} | ${l.dd.toFixed(0)} | ${a.net.toFixed(0)} | ${a.dd.toFixed(0)} |`;
};
const head = '| Rule | Older trades | Older net $ | Older PF | Last-yr trades | Last-yr win % | Last-yr net $ | Last-yr PF | Last-yr max DD $ | Full net $ | Full max DD $ |\n|---|---|---|---|---|---|---|---|---|---|---|';
const nB = brk.filter((x, i) => x && c[i].time >= testFrom).length;
const nR = bullRej.filter((x, i) => x && c[i].time >= testFrom).length + bearRej.filter((x, i) => x && c[i].time >= testFrom).length;
const recent = c
  .map((b, i) => ({ i, b }))
  .filter(({ i }) => brk[i] !== 0)
  .slice(-Number(process.env.AA_LAST ?? 6))
  .map(({ i, b }) => `${new Date((b.time + IST) * 1000).toISOString().slice(0, 16).replace('T', ' ')} IST ${brk[i] > 0 ? 'Bullish break ▲' : 'Bearish break ▼'}`);
const out = [
  '# AlgoAlpha Zero Lag Liquidity + UT Bot (1, 10), ETHUSD 1h only (AlgoAlpha’s own 3m wick profile kept, as on TradingView)',
  '',
  `Older: ${iso(c[300].time)} → ${iso(testFrom)}. Last 365 days: ${iso(testFrom)} → ${iso(end)}. 3m lower-timeframe data from Delta India. Per 1 ETH after fees (${(FEE * 100).toFixed(3)}%/side + ${SLIP}$).`,
  `AlgoAlpha events in the last year: ${nB} breaks, ${nR} rejections. Latest breaks (compare with TradingView): ${recent.join('; ')}.`,
  '',
  '## UT Bot rules (exit on the opposite UT signal unless stated; no new entries Sat–Sun IST)',
  '',
  head,
  ...Object.entries(RULES).map(([k, f]) => row(k, f())),
  '',
  '## With the live bot’s exit engine (2×ATR stop, BE 0.5R, 3×ATR trail after 1.5R)',
  '',
  head,
  ...Object.entries(HULL_RULES).map(([k, f]) => row(k, f())),
];
writeFileSync('docs/algoalpha-backtest.md', out.join('\n'));
console.log(out.join('\n'));

// ---------- loss-streak guard on "AlgoAlpha break entry, exit on opposite break" ----------
// The underlying trade sequence does not depend on pausing (entries are break signals, exits opposite breaks or
// a stop), so a guard is a filter over the full sequence. "Shadow" = the paused trades are still followed on paper.
const ATR14g = atrPine(c, 14);
function aaTrades(stopK: number) {
  const out: { t: number; net: number; exitT: number }[] = [];
  let pos: { side: Dir; px: number; t: number; stop: number; fill: number } | null = null;
  const close_ = (px: number, i: number) => {
    out.push({ t: pos!.t, net: (px - pos!.px) * pos!.side - (px + pos!.px) * FEE, exitT: c[i].time });
    pos = null;
  };
  for (let i = 300; i < c.length - 1; i++) {
    if (pos && stopK > 0 && i > pos.fill) {
      const b = c[i];
      if (pos.side === 1 && b.low <= pos.stop) close_(Math.min(b.open, pos.stop) - SLIP, i);
      else if (pos.side === -1 && b.high >= pos.stop) close_(Math.max(b.open, pos.stop) + SLIP, i);
    }
    const s = brk[i] as Dir | 0;
    if (!s) continue;
    const nb = c[i + 1];
    if (pos && pos.side !== s) close_(nb.open - pos.side * SLIP, i + 1);
    if (!pos && !weekend(nb.time)) {
      const px = nb.open + s * SLIP;
      pos = { side: s, px, t: nb.time, stop: px - s * stopK * ATR14g[i], fill: i + 1 };
    }
  }
  return out;
}
type G = { name: string; pick: (tr: { t: number; net: number; exitT: number }[]) => { t: number; net: number }[] };
const guard = (n: number, resume: 'shadowWin' | number | 'skip1'): G['pick'] => (tr) => {
  const taken: { t: number; net: number }[] = [];
  let streak = 0;
  let paused = false;
  let until = 0;
  let skip = 0;
  for (const x of tr) {
    if (paused) {
      if (resume === 'shadowWin') { if (x.net > 0) { paused = false; streak = 0; } continue; }
      if (resume === 'skip1') { if (skip-- > 0) continue; paused = false; streak = 0; }
      else { if (x.t < until) continue; paused = false; streak = 0; }
    }
    taken.push(x);
    streak = x.net > 0 ? 0 : streak + 1;
    if (streak >= n) { paused = true; until = x.exitT + (typeof resume === 'number' ? resume * 3600 : 0); skip = 1; }
  }
  return taken;
};
const GUARDS: G[] = [
  { name: 'no guard', pick: (tr) => tr },
  { name: '2 losses → pause until a shadow trade wins', pick: guard(2, 'shadowWin') },
  { name: '2 losses → skip the next trade', pick: guard(2, 'skip1') },
  { name: '2 losses → pause 24 h', pick: guard(2, 24) },
  { name: '2 losses → pause 72 h', pick: guard(2, 72) },
  { name: '3 losses → pause until a shadow trade wins', pick: guard(3, 'shadowWin') },
];
const maxStreak = (xs: { net: number }[]) => { let m = 0, k = 0; for (const x of xs) { k = x.net > 0 ? 0 : k + 1; m = Math.max(m, k); } return m; };
const g: string[] = ['', '## AlgoAlpha break (exit on opposite break) with a loss-streak guard', '', '| Safety stop | Guard | Older trades | Older net $ | Last-yr trades | Last-yr net $ | Last-yr PF | Last-yr max DD $ | Full net $ | Full max DD $ | Longest losing run | Profit ÷ DD |', '|---|---|---|---|---|---|---|---|---|---|---|---|'];
for (const k of [0, 2, 3]) {
  const all = aaTrades(k);
  for (const gd of GUARDS) {
    const tr = gd.pick(all);
    const o = st(tr.filter((t) => t.t < testFrom));
    const l = st(tr.filter((t) => t.t >= testFrom));
    const a = st(tr);
    g.push(`| ${k ? k + '× ATR' : 'none'} | ${gd.name} | ${o.n} | ${o.net.toFixed(0)} | ${l.n} | **${l.net.toFixed(0)}** | ${l.pf.toFixed(2)} | ${l.dd.toFixed(0)} | ${a.net.toFixed(0)} | ${a.dd.toFixed(0)} | ${maxStreak(tr)} | ${(a.net / a.dd).toFixed(1)} |`);
  }
}
writeFileSync('docs/algoalpha-backtest.md', [...out, ...g].join('\n'));
console.log(g.join('\n'));

// ---------- AlgoAlpha break with the live exit engine: does a trailing stop help? ----------
// Initial stop 3×ATR(14) (no $ clamp), exit/reverse on the opposite break, weekend gate, no MIN_ATR (as tested).
const aaSig = brk.map((x, i) => (i < 300 ? 'NONE' : x > 0 ? 'LONG' : x < 0 ? 'SHORT' : 'NONE')) as ('LONG' | 'SHORT' | 'NONE')[];
const tq: string[] = ['', '## AlgoAlpha break + 3×ATR stop: trailing-stop variants (live exit engine)', '', '| Break-even | Trail starts at | Trail distance | Older net $ | Older DD $ | Last-yr net $ | Last-yr DD $ | Full net $ | Full DD $ | Profit ÷ DD | Beats "no trail" in both periods? |', '|---|---|---|---|---|---|---|---|---|---|---|'];
const variants: { be: number; tr: number; m: number }[] = [{ be: 0, tr: 0, m: 0 }];
for (const be of [0, 1]) for (const tr of [1, 1.5, 2, 3]) for (const m of [2, 3, 4]) variants.push({ be, tr, m });
variants.push({ be: 1, tr: 0, m: 0 }, { be: 0.5, tr: 0, m: 0 });
let baseO = 0, baseL = 0;
for (const v of variants) {
  const pv = { ...ph, SL_ATR_MULT: 3, SL_MIN: 0, SL_MAX: 1e9, MIN_ATR: 0, LEVERAGE: 5, BE_TRIG_R: v.be, TRAIL_TRIG_R: v.tr || 1e9, TRAIL_ATR_MULT: v.m, TP_R: 0 };
  const gv = entryGate(c, pv);
  const tr = simulate('hull', c, aaSig, pv, { allowEntryAt: (i) => gv(i) === null }).filter((t: SimTrade) => t.entryTime >= c[300].time).map((t: SimTrade) => ({ t: t.entryTime, net: t.netPnl }));
  const o = st(tr.filter((t) => t.t < testFrom)), l = st(tr.filter((t) => t.t >= testFrom)), a = st(tr);
  if (!v.be && !v.tr) { baseO = o.net; baseL = l.net; }
  const both = v.be || v.tr ? (o.net > baseO && l.net > baseL ? 'YES' : 'no') : '—';
  tq.push(`| ${v.be ? v.be + 'R' : 'off'} | ${v.tr ? v.tr + 'R profit' : 'off'} | ${v.m ? v.m + '× ATR' : '—'} | ${o.net.toFixed(0)} | ${o.dd.toFixed(0)} | **${l.net.toFixed(0)}** | ${l.dd.toFixed(0)} | ${a.net.toFixed(0)} | ${a.dd.toFixed(0)} | ${(a.net / a.dd).toFixed(1)} | ${both} |`);
}
writeFileSync('docs/algoalpha-backtest.md', [...out, ...g, ...tq].join('\n'));
console.log(tq.join('\n'));

// ---------- compounding at a fixed risk %: actual history + bootstrap Monte Carlo (1 year ≈ 90 trades) ----------
{
  const pv = { ...ph, SL_ATR_MULT: 3, SL_MIN: 0, SL_MAX: 1e9, MIN_ATR: 0, LEVERAGE: 5, BE_TRIG_R: 0, TRAIL_TRIG_R: 1e9, TRAIL_ATR_MULT: 0, TP_R: 0 };
  const gv = entryGate(c, pv);
  const trs = simulate('hull', c, aaSig, pv, { allowEntryAt: (i) => gv(i) === null }).filter((t: SimTrade) => t.entryTime >= c[300].time);
  // Loss at the stop incl. costs = 1 unit of risk; each trade's result in those units.
  const rm = trs.map((t: SimTrade) => t.netPnl / ((t.riskDist ?? NaN) + t.entry * 2 * FEE + 2 * SLIP)).filter(Number.isFinite);
  const lines: string[] = ['', '## Compounding at a fixed risk per trade (3×ATR stop, opposite-break exit)', '', `${rm.length} trades; average result ${(rm.reduce((a, b) => a + b, 0) / rm.length).toFixed(2)} × risk; win rate ${Math.round((100 * rm.filter((x) => x > 0).length) / rm.length)}%.`, '', '| Risk per trade | Actual history Feb 2024→now: end balance (start = 1.00) | Worst fall from peak | 1-year simulations: chance of falling below 50% of start | …below 20% of start | Median balance after 1 year |', '|---|---|---|---|---|---|'];
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (const risk of [0.2, 0.1, 0.05, 0.02]) {
    let b = 1, pk = 1, dd = 0;
    for (const r of rm) { b *= 1 + risk * r; pk = Math.max(pk, b); dd = Math.max(dd, 1 - b / pk); }
    let below50 = 0, below20 = 0;
    const ends: number[] = [];
    const N = 20000;
    for (let s = 0; s < N; s++) {
      let x = 1, h50 = false, h20 = false;
      // blocks of 5 consecutive trades keep some of the real losing-streak clustering
      for (let k = 0; k < 90; k += 5) {
        const st0 = Math.floor(rnd() * (rm.length - 5));
        for (let j = 0; j < 5; j++) { x *= Math.max(0, 1 + risk * rm[st0 + j]); if (x < 0.5) h50 = true; if (x < 0.2) h20 = true; }
      }
      if (h50) below50++;
      if (h20) below20++;
      ends.push(x);
    }
    ends.sort((a, b2) => a - b2);
    lines.push(`| ${risk * 100}% | ${b.toFixed(2)} | ${(dd * 100).toFixed(0)}% | ${((100 * below50) / N).toFixed(0)}% | ${((100 * below20) / N).toFixed(0)}% | ${ends[N >> 1].toFixed(2)} |`);
  }
  writeFileSync('docs/algoalpha-backtest.md', [...out, ...g, ...tq, ...lines].join('\n'));
  console.log(lines.join('\n'));
}

// ---------- Hull × AlgoAlpha combinations (Hull exits; break-even at 0.5R = live, and at 1R) ----------
{
  const hullDir = indH.hull.map((h, i) => (i >= 2 && Number.isFinite(h) && Number.isFinite(indH.hull[i - 2]) ? (h > indH.hull[i - 2] ? 1 : -1) : 0));
  const combo: string[] = ['', '## Hull × AlgoAlpha combinations (Hull exits, live gates)', '', '| Rule | Break-even at | Trades older / last yr | Per-ETH older | Per-ETH last yr | Per-ETH full | Max DD $/ETH | Beats plain Hull (same BE) in both periods? |', '|---|---|---|---|---|---|---|---|'];
  const toT = (xs: SimTrade[]) => xs.filter((t) => t.entryTime >= c[300].time).map((t) => ({ t: t.entryTime, net: t.netPnl }));
  for (const be of [0.5, 1]) {
    const pb = { ...ph, BE_TRIG_R: be };
    const gb = entryGate(c, pb);
    const viaHull = (f: (i: number, s: Dir) => boolean) => toT(simulate('hull', c, indH.sigHull, pb, { allowEntryAt: (i, side) => gb(i) === null && f(i, side === 'buy' ? 1 : -1) }));
    const sigFrom = (fn: (i: number) => Dir | 0) => c.map((_, i) => { const s = i < 300 ? 0 : fn(i); return s > 0 ? 'LONG' : s < 0 ? 'SHORT' : 'NONE'; }) as ('LONG' | 'SHORT' | 'NONE')[];
    const viaSig = (fn: (i: number) => Dir | 0) => toT(simulate('hull', c, sigFrom(fn), pb, { allowEntryAt: (i) => gb(i) === null }));
    const rules: [string, () => T[]][] = [
      ['Plain Hull', () => viaHull(() => true)],
      ['Hull + AlgoAlpha trend agrees', () => viaHull((i, s) => trend[i] === s)],
      ['Hull + AlgoAlpha break same way in last 12 h', () => viaHull((i, s) => recentBreak(i, s, 12))],
      ['Hull + AlgoAlpha break same way in last 48 h', () => viaHull((i, s) => recentBreak(i, s, 48))],
      ['Hull, skip if opposite AlgoAlpha break in last 24 h', () => viaHull((i, s) => !recentBreak(i, (-s) as Dir, 24))],
      ['AlgoAlpha break entry when Hull points the same way', () => viaSig((i) => (brk[i] && hullDir[i] === brk[i] ? (brk[i] as Dir) : 0))],
      ['Hull flip OR AlgoAlpha break in Hull direction', () => viaSig((i) => { const h = indH.sigHull[i]; if (h !== 'NONE') return h === 'LONG' ? 1 : -1; return brk[i] && hullDir[i] === brk[i] ? (brk[i] as Dir) : 0; })],
    ];
    let bo = 0, bl = 0;
    for (const [name, f] of rules) {
      const tr = f();
      const o = st(tr.filter((t) => t.t < testFrom)), l = st(tr.filter((t) => t.t >= testFrom)), a = st(tr);
      if (name === 'Plain Hull') { bo = o.net; bl = l.net; }
      combo.push(`| ${name} | ${be}R${be === 0.5 ? ' (live)' : ''} | ${o.n} / ${l.n} | ${o.net.toFixed(0)} | ${l.net.toFixed(0)} | **${a.net.toFixed(0)}** | ${a.dd.toFixed(0)} | ${name === 'Plain Hull' ? '—' : o.net > bo && l.net > bl ? 'YES' : 'no'} |`);
    }
  }
  writeFileSync('docs/hull-algoalpha.md', combo.join('\n'));
  console.log(combo.join('\n'));
}

// ---------- Hull entries, AlgoAlpha exits ----------
{
  const rowsX: string[] = ['', '## Hull entries with AlgoAlpha exits', '', '| Version | Trades older / last yr | Per-ETH older | Per-ETH last yr | Per-ETH full | Max DD $/ETH | Win % | Avg hours in trade |', '|---|---|---|---|---|---|---|---|'];
  const toT = (xs: SimTrade[]) => xs.filter((t) => t.entryTime >= c[300].time).map((t) => ({ t: t.entryTime, net: t.netPnl, h: (t.exitTime - t.entryTime) / 3600 }));
  // Simulator path: Hull flips enter/reverse; an opposite AlgoAlpha break is fed as a signal that may only CLOSE (entries allowed only on Hull flips).
  const viaSim = (be: number, trail: boolean, aaExit: boolean) => {
    const pb = { ...ph, BE_TRIG_R: be, TRAIL_TRIG_R: trail ? ph.TRAIL_TRIG_R : 1e9, TRAIL_ATR_MULT: trail ? ph.TRAIL_ATR_MULT : 0 };
    const gb = entryGate(c, pb);
    const sig = c.map((_, i) => {
      if (i < 300) return 'NONE';
      if (indH.sigHull[i] !== 'NONE') return indH.sigHull[i];
      return aaExit && brk[i] ? (brk[i] > 0 ? 'LONG' : 'SHORT') : 'NONE';
    }) as ('LONG' | 'SHORT' | 'NONE')[];
    return toT(simulate('hull', c, sig, pb, { allowEntryAt: (i, side) => gb(i) === null && indH.sigHull[i] === (side === 'buy' ? 'LONG' : 'SHORT') }));
  };
  // Custom path: Hull entry, initial stop (live R), exit ONLY on an opposite AlgoAlpha break; Hull flips ignored while in a trade.
  const aaOnly = () => {
    const gb = entryGate(c, ph);
    const atrL = atrPine(c, ph.ATR_LEN);
    const out2: { t: number; net: number; h: number }[] = [];
    let pos: { side: Dir; px: number; t: number; stop: number; fill: number } | null = null;
    const done = (px: number, i: number) => { out2.push({ t: pos!.t, net: (px - pos!.px) * pos!.side - (px + pos!.px) * FEE, h: (c[i].time - pos!.t) / 3600 }); pos = null; };
    for (let i = 300; i < c.length - 1; i++) {
      if (pos && i > pos.fill) {
        const b = c[i];
        if (pos.side === 1 && b.low <= pos.stop) done(Math.min(b.open, pos.stop) - SLIP, i);
        else if (pos.side === -1 && b.high >= pos.stop) done(Math.max(b.open, pos.stop) + SLIP, i);
      }
      const nb = c[i + 1];
      if (pos && brk[i] && brk[i] !== pos.side) done(nb.open - pos.side * SLIP, i + 1);
      const h = indH.sigHull[i];
      if (!pos && h !== 'NONE' && gb(i) === null) {
        const side: Dir = h === 'LONG' ? 1 : -1;
        const R = Math.max(ph.SL_MIN, ph.SL_ATR_MULT * atrL[i]);
        const px = nb.open + side * SLIP;
        pos = { side, px, t: nb.time, stop: px - side * R, fill: i + 1 };
      }
    }
    return out2;
  };
  const versions: [string, () => { t: number; net: number; h: number }[]][] = [
    ['Plain Hull (live exits, BE 0.5R)', () => viaSim(0.5, true, false)],
    ['Plain Hull, BE 1R (recommended)', () => viaSim(1, true, false)],
    ['1. Live exits + exit on opposite AlgoAlpha break (BE 0.5R)', () => viaSim(0.5, true, true)],
    ['1. Same with BE 1R', () => viaSim(1, true, true)],
    ['2. Stop + BE 1R, no trailing; exit on opposite AlgoAlpha break', () => viaSim(1, false, true)],
    ['2b. Stop only (no BE, no trail); exit on opposite AlgoAlpha break or Hull flip', () => viaSim(0, false, true)],
    ['3. Stop only; exit ONLY on opposite AlgoAlpha break (Hull flips ignored in trade)', aaOnly],
  ];
  for (const [name, f] of versions) {
    const tr = f();
    const o = st(tr.filter((t) => t.t < testFrom)), l = st(tr.filter((t) => t.t >= testFrom)), a = st(tr);
    rowsX.push(`| ${name} | ${o.n} / ${l.n} | ${o.net.toFixed(0)} | ${l.net.toFixed(0)} | **${a.net.toFixed(0)}** | ${a.dd.toFixed(0)} | ${Math.round(a.win * 100)}% | ${(tr.reduce((s, t) => s + t.h, 0) / (tr.length || 1)).toFixed(0)} |`);
  }
  writeFileSync('docs/hull-algoalpha-exit.md', rowsX.join('\n'));
  console.log(rowsX.join('\n'));
}

// ---------- control: is it the AlgoAlpha exit or just "no trailing"? + account results ----------
{
  const ctl: string[] = ['', '## Control and account results', '', '| Version | Per-ETH older | Per-ETH last yr | Per-ETH full | Max DD $/ETH | Account last yr (today sizing) | Account full (today sizing) | Account last yr (10%) | Account full (10%) |', '|---|---|---|---|---|---|---|---|---|'];
  type Sz = typeof ph & { RISK_PER_TRADE: number; RISK_REDUCED: number; MAX_CONTRACTS: number };
  const acct = (xs: SimTrade[], p: Sz) => {
    let bal = 195, peak = 195, mdd = 0;
    for (const t of xs) {
      const th = riskFor(bal, peak, p);
      const s = contractsFor({ balanceUsd: bal, price: t.entry, riskDist: t.riskDist!, risk: th.risk, leverage: p.LEVERAGE, maxContracts: p.MAX_CONTRACTS, feeRate: p.FEE_RATE, tick: p.TICK, slippageTicks: p.SLIPPAGE_TICKS });
      bal += s.contracts * p.CONTRACT_VALUE * t.netPnl;
      peak = Math.max(th.peak, bal);
      mdd = Math.max(mdd, (peak - bal) / peak);
    }
    return `$${bal.toFixed(0)} (${(mdd * 100).toFixed(0)}%)`;
  };
  const today: Sz = { ...ph, MAX_CONTRACTS: 100 };
  const ten: Sz = { ...ph, RISK_PER_TRADE: 0.1, RISK_REDUCED: 0.1, MAX_CONTRACTS: 5000 };
  const run = (be: number, trail: boolean, aaExit: boolean) => {
    const pb = { ...ph, BE_TRIG_R: be, TRAIL_TRIG_R: trail ? ph.TRAIL_TRIG_R : 1e9, TRAIL_ATR_MULT: trail ? ph.TRAIL_ATR_MULT : 0 };
    const gb = entryGate(c, pb);
    const sig = c.map((_, i) => (i < 300 ? 'NONE' : indH.sigHull[i] !== 'NONE' ? indH.sigHull[i] : aaExit && brk[i] ? (brk[i] > 0 ? 'LONG' : 'SHORT') : 'NONE')) as ('LONG' | 'SHORT' | 'NONE')[];
    return simulate('hull', c, sig, pb, { allowEntryAt: (i, side) => gb(i) === null && indH.sigHull[i] === (side === 'buy' ? 'LONG' : 'SHORT') }).filter((t) => t.entryTime >= c[300].time);
  };
  const vs: [string, SimTrade[]][] = [
    ['Live today (BE 0.5R, trailing)', run(0.5, true, false)],
    ['BE 1R, trailing', run(1, true, false)],
    ['CONTROL: stop + BE 1R, no trailing, exit on Hull flip only', run(1, false, false)],
    ['CONTROL: stop only, no BE/trail, exit on Hull flip only', run(0, false, false)],
    ['2. stop + BE 1R, no trailing, exit on Hull flip OR opposite AlgoAlpha break', run(1, false, true)],
    ['2b. stop only, exit on Hull flip OR opposite AlgoAlpha break', run(0, false, true)],
  ];
  for (const [name, tr] of vs) {
    const T2 = tr.map((t) => ({ t: t.entryTime, net: t.netPnl }));
    const o = st(T2.filter((t) => t.t < testFrom)), l = st(T2.filter((t) => t.t >= testFrom)), a = st(T2);
    const ly = tr.filter((t) => t.entryTime >= testFrom);
    ctl.push(`| ${name} | ${o.net.toFixed(0)} | ${l.net.toFixed(0)} | **${a.net.toFixed(0)}** | ${a.dd.toFixed(0)} | ${acct(ly, today)} | ${acct(tr, today)} | ${acct(ly, ten)} | ${acct(tr, ten)} |`);
  }
  writeFileSync('docs/hull-algoalpha-exit.md', [readFileSync('docs/hull-algoalpha-exit.md', 'utf8'), ...ctl].join('\n'));
  console.log(ctl.join('\n'));
}
