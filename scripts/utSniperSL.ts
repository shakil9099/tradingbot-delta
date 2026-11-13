// For the UT sniper rule (UT 1/10 + 4h UT agrees + 10-bar breakout, exit on opposite UT signal, weekend no entries):
// if a stop-loss of k × ATR(14) had been used, how many trades hit it, and of those how many then went back in
// the trade's direction (back to entry, +1R, +2R, or ended profitable at the opposite signal)?
// Also: the strategy's result WITH that stop (exit at stop, then wait for the next sniper entry).
// npx tsx scripts/utSniperSL.ts

import { readFileSync, writeFileSync } from 'node:fs';
import { DEFAULT_PARAMS as P } from '../src/config/params.js';
import { atrPine, utTrailingStop } from '../src/core/indicators.js';
import { computeAll } from '../src/core/signals.js';
import type { Candle } from '../src/shared/types.js';
import { fetchHistory } from './lib/candles.js';

const H = 3600;
const IST = 19800;
const FEE = P.FEE_RATE;
const SLIP = P.SLIPPAGE_TICKS * P.TICK;
type Dir = 1 | -1;

const cache = JSON.parse(readFileSync('data/eth_1h_cache.json', 'utf8')) as Candle[];
const byT = new Map<number, Candle>();
for (const x of [...cache, ...(await fetchHistory(3, '1h'))]) byT.set(x.time, x);
const c = [...byT.values()].sort((a, b) => a.time - b.time).filter((x) => x.high > x.low || x.volume > 0);
const testFrom = c[c.length - 1].time - 365 * 86400;
const close = c.map((x) => x.close);
const sig = computeAll(c, { ...P, UT_KEY: 1, UT_ATR: 10, WARMUP: 300 }).sigUt;
const ATR14 = atrPine(c, 14);

// 4h UT(1,10) direction of the 4h bar completed before the current one (= Pine dir[1] with lookahead_on).
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
const hh = (i: number) => Math.max(...c.slice(i - 10, i).map((x) => x.high));
const ll = (i: number) => Math.min(...c.slice(i - 10, i).map((x) => x.low));
const weekend = (t: number) => [0, 6].includes(new Date((t + IST) * 1000).getUTCDay());
const passes = (i: number, s: Dir) => dir4h[i] === s && (s === 1 ? close[i] > hh(i) : close[i] < ll(i)) && !weekend(c[i + 1].time);

/** Trades of the rule with an optional stop (k × ATR14 at the signal bar; 0 = none). */
function run(k: number) {
  const out: { side: Dir; fill: number; entry: number; exitIdx: number; exit: number; stopped: boolean; R: number }[] = [];
  let pos: { side: Dir; fill: number; entry: number; stop: number; R: number } | null = null;
  const close_ = (idx: number, px: number, stopped: boolean) => {
    out.push({ side: pos!.side, fill: pos!.fill, entry: pos!.entry, exitIdx: idx, exit: px, stopped, R: pos!.R });
    pos = null;
  };
  for (let i = 300; i < c.length - 1; i++) {
    // Stop check inside bar i (the position was filled at an earlier bar's open).
    if (pos && k > 0 && i > pos.fill) {
      const b = c[i];
      if (pos.side === 1 && b.low <= pos.stop) close_(i, Math.min(b.open, pos.stop) - SLIP, true);
      else if (pos.side === -1 && b.high >= pos.stop) close_(i, Math.max(b.open, pos.stop) + SLIP, true);
    }
    const s = sig[i];
    if (s === 'NONE') continue;
    const side: Dir = s === 'LONG' ? 1 : -1;
    if (pos && pos.side !== side) close_(i + 1, c[i + 1].open - pos.side * SLIP, false);
    if (!pos && passes(i, side)) {
      const entry = c[i + 1].open + side * SLIP;
      const R = k > 0 ? k * ATR14[i] : ATR14[i]; // with no stop, R = 1 ATR for reference
      pos = { side, fill: i + 1, entry, stop: entry - side * R, R };
    }
  }
  if (pos) close_(c.length - 1, c[c.length - 1].close, false);
  return out;
}

const net = (t: { side: Dir; entry: number; exit: number }) => (t.exit - t.entry) * t.side - (t.entry + t.exit) * FEE;
const noStop = run(0);
const lines: string[] = [
  '# UT sniper: what happens after a stop-loss is hit',
  '',
  `All sniper trades ${new Date(c[300].time * 1000).toISOString().slice(0, 10)} → ${new Date(c[c.length - 1].time * 1000).toISOString().slice(0, 10)} (${noStop.length} trades; last 365 days = ${noStop.filter((t) => c[t.fill].time >= testFrom).length}). Stop = k × ATR(14) at the signal bar, from the entry price.`,
  '"After the stop" = from the stop bar until the original opposite-signal exit.',
  '',
  '| Stop | Trades that hit it | …then price back to entry | …then reached +1R | …then reached +2R | …would have ended in profit (held to opposite signal) | Net $/ETH without stop | Net $/ETH with stop | Max DD without → with |',
  '|---|---|---|---|---|---|---|---|---|',
];
const dd = (xs: number[]) => {
  let e = 0, p = 0, d = 0;
  for (const x of xs) { e += x; p = Math.max(p, e); d = Math.max(d, p - e); }
  return d;
};
for (const k of [1, 1.5, 2, 3]) {
  let hit = 0, backEntry = 0, r1 = 0, r2 = 0, endedWin = 0;
  for (const t of noStop) {
    const R = k * ATR14[t.fill - 1];
    const stop = t.entry - t.side * R;
    let sIdx = -1;
    for (let i = t.fill + 1; i < t.exitIdx; i++) if ((t.side === 1 ? c[i].low <= stop : c[i].high >= stop)) { sIdx = i; break; }
    if (sIdx < 0) continue;
    hit++;
    let best = -Infinity;
    for (let i = sIdx + 1; i < t.exitIdx; i++) best = Math.max(best, t.side === 1 ? c[i].high : -c[i].low);
    const fav = t.side === 1 ? best - t.entry : best + t.entry; // best excursion in the trade's direction vs entry
    if (fav >= 0) backEntry++;
    if (fav >= R) r1++;
    if (fav >= 2 * R) r2++;
    if (net(t) > 0) endedWin++;
  }
  const withStop = run(k);
  const pct = (x: number) => `${x} (${hit ? Math.round((100 * x) / hit) : 0}%)`;
  lines.push(`| ${k}× ATR | ${hit} of ${noStop.length} | ${pct(backEntry)} | ${pct(r1)} | ${pct(r2)} | ${pct(endedWin)} | ${noStop.map(net).reduce((a, b) => a + b, 0).toFixed(0)} | ${withStop.map(net).reduce((a, b) => a + b, 0).toFixed(0)} | ${dd(noStop.map(net)).toFixed(0)} → ${dd(withStop.map(net)).toFixed(0)} |`);
}
// Losers without a stop: how deep did they go before the exit?
const losers = noStop.filter((t) => net(t) <= 0);
const mae = noStop.map((t) => {
  let worst = 0;
  for (let i = t.fill; i <= Math.min(t.exitIdx, c.length - 1); i++) worst = Math.max(worst, t.side === 1 ? t.entry - c[i].low : c[i].high - t.entry);
  return worst / ATR14[t.fill - 1];
});
const winnersMae = noStop.map((t, j) => ({ t, m: mae[j] })).filter((x) => net(x.t) > 0).map((x) => x.m).sort((a, b) => a - b);
const q = (xs: number[], p: number) => xs[Math.min(xs.length - 1, Math.floor(p * xs.length))];
lines.push('', `Without a stop: ${noStop.length - losers.length} winners, ${losers.length} losers. Winners' worst dip against them before working (in ATR): median ${q(winnersMae, 0.5).toFixed(2)}, 75% ≤ ${q(winnersMae, 0.75).toFixed(2)}, 90% ≤ ${q(winnersMae, 0.9).toFixed(2)}, max ${winnersMae.at(-1)!.toFixed(2)}.`);
writeFileSync('docs/ut-sniper-sl.md', lines.join('\n'));
console.log(lines.join('\n'));

// ---------- cost-to-cost: move the stop to entry + fees once price has gone `trig` × ATR in the trade's favour ----------
function runBE(initK: number, trig: number) {
  const out: { side: Dir; fill: number; entry: number; exit: number; why: string }[] = [];
  let pos: { side: Dir; fill: number; entry: number; stop: number | null; armAt: number; be: boolean } | null = null;
  const done = (px: number, why: string) => {
    out.push({ side: pos!.side, fill: pos!.fill, entry: pos!.entry, exit: px, why });
    pos = null;
  };
  for (let i = 300; i < c.length - 1; i++) {
    if (pos && i > pos.fill) {
      const b = c[i];
      const st = pos.stop;
      if (st !== null && (pos.side === 1 ? b.low <= st : b.high >= st)) done((pos.side === 1 ? Math.min(b.open, st) : Math.max(b.open, st)) - pos.side * SLIP, pos.be ? 'cost' : 'stop');
      else if (trig > 0 && !pos.be && (pos.side === 1 ? b.high >= pos.armAt : b.low <= pos.armAt)) {
        pos.be = true; // takes effect from the next bar (no same-bar guessing)
        pos.stop = pos.entry + pos.side * (2 * pos.entry * FEE + 2 * SLIP);
      }
    }
    const s = sig[i];
    if (s === 'NONE') continue;
    const side: Dir = s === 'LONG' ? 1 : -1;
    if (pos && pos.side !== side) done(c[i + 1].open - pos.side * SLIP, 'signal');
    if (!pos && passes(i, side)) {
      const entry = c[i + 1].open + side * SLIP;
      const a = ATR14[i];
      pos = { side, fill: i + 1, entry, stop: initK > 0 ? entry - side * initK * a : null, armAt: entry + side * trig * a, be: false };
    }
  }
  if (pos) done(c[c.length - 1].close, 'end');
  return out;
}
lines.push('', '## Cost-to-cost stop', '', '| Initial stop | Move to cost after | Trades | Win % | Closed at cost | Net $/ETH all (Feb 2024→) | Net last 365 days | Max DD $ |', '|---|---|---|---|---|---|---|---|');
for (const initK of [0, 2])
  for (const trig of [0, 0.5, 1, 1.5, 2, 3]) {
    const tr = runBE(initK, trig);
    const n = tr.map(net);
    const last = tr.filter((t) => c[t.fill].time >= testFrom).map(net);
    lines.push(`| ${initK ? initK + '× ATR' : 'none'} | ${trig ? trig + '× ATR profit' : 'never (current rule)'} | ${tr.length} | ${Math.round((100 * n.filter((x) => x > 0).length) / n.length)}% | ${tr.filter((t) => t.why === 'cost').length} | ${n.reduce((a, b) => a + b, 0).toFixed(0)} | ${last.reduce((a, b) => a + b, 0).toFixed(0)} | ${dd(n).toFixed(0)} |`);
  }
writeFileSync('docs/ut-sniper-sl.md', lines.join('\n'));
console.log(lines.slice(lines.indexOf('## Cost-to-cost stop')).join('\n'));
