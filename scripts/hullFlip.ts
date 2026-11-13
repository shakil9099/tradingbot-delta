// Hull 55 on ETHUSD 1h as a pure flip system: exit only when Hull changes direction (no stop, no BE, no trail).
// npx tsx scripts/hullFlip.ts
// Fill at the next bar's open ± 1 tick, fee FEE_RATE per side. On a flip the trade closes; the opposite trade
// opens only if entries are allowed (otherwise flat until the next flip).

import { readFileSync, writeFileSync } from 'node:fs';
import { DEFAULT_PARAMS as P } from '../src/config/params.js';
import { atrPine } from '../src/core/indicators.js';
import { computeAll } from '../src/core/signals.js';
import type { Candle } from '../src/shared/types.js';

const IST = 19800;
const SLIP = P.SLIPPAGE_TICKS * P.TICK;
const c = (JSON.parse(readFileSync('data/eth_1h_cache.json', 'utf8')) as Candle[]).filter((x) => x.high > x.low || x.volume > 0);
const end = c[c.length - 1].time;
const testFrom = end - 365 * 86400;
const sig = computeAll(c, { ...P, WARMUP: 300 }).sigHull;
const atr = atrPine(c, 14);
const weekend = (t: number) => [0, 6].includes(new Date((t + IST) * 1000).getUTCDay());

type T = { t: number; side: 1 | -1; entry: number; exit: number; net: number; mae: number; bars: number };
function run(allow: (i: number) => boolean): T[] {
  const out: T[] = [];
  let pos: { side: 1 | -1; entry: number; t: number; i: number } | null = null;
  for (let i = 300; i < c.length - 1; i++) {
    const s = sig[i];
    if (s === 'NONE') continue;
    const side: 1 | -1 = s === 'LONG' ? 1 : -1;
    const nb = c[i + 1];
    if (pos && pos.side !== side) {
      const px = nb.open - pos.side * SLIP;
      let mae = 0;
      for (let k = pos.i; k <= i + 1; k++) mae = Math.max(mae, pos.side === 1 ? pos.entry - c[k].low : c[k].high - pos.entry);
      out.push({ t: pos.t, side: pos.side, entry: pos.entry, exit: px, net: (px - pos.entry) * pos.side - (px + pos.entry) * P.FEE_RATE, mae, bars: i + 1 - pos.i });
      pos = null;
    }
    if (!pos && !weekend(nb.time) && allow(i)) pos = { side, entry: nb.open + side * SLIP, t: nb.time, i: i + 1 };
  }
  return out;
}

const stats = (xs: T[]) => {
  let e = 0, pk = 0, dd = 0, w = 0, gw = 0, gl = 0, streak = 0, maxStreak = 0;
  for (const t of xs) {
    e += t.net;
    pk = Math.max(pk, e);
    dd = Math.max(dd, pk - e);
    if (t.net > 0) { w++; gw += t.net; streak = 0; } else { gl -= t.net; streak++; maxStreak = Math.max(maxStreak, streak); }
  }
  const maes = xs.map((t) => t.mae).sort((a, b) => a - b);
  return { n: xs.length, net: e, dd, win: xs.length ? w / xs.length : 0, pf: gl ? gw / gl : 99, maxStreak, avgWin: w ? gw / w : 0, avgLoss: xs.length - w ? gl / (xs.length - w) : 0, maeMed: maes[maes.length >> 1] ?? 0, maeMax: maes[maes.length - 1] ?? 0, bars: xs.reduce((a, t) => a + t.bars, 0) / (xs.length || 1) };
};
// Account: position value = k × balance at entry (no stop, so no risk sizing), compounding, from $195.
function account(xs: T[], k: number) {
  let b = 195, pk = 195, dd = 0;
  for (const t of xs) {
    const eth = (k * b) / t.entry;
    b += eth * t.net;
    if (b <= 0) return { end: 0, dd: 1 };
    pk = Math.max(pk, b);
    dd = Math.max(dd, 1 - b / pk);
  }
  return { end: b, dd };
}

const variants: [string, (i: number) => boolean][] = [
  ['Hull flip, weekend rule only', () => true],
  ['Hull flip + live entry filters (ATR $15–$20)', (i) => atr[i] >= 15 && 2 * atr[i] <= 40],
];
const iso = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
const out: string[] = ['# Hull 55 flip system (exit only on direction change), ETHUSD 1h', '', `Older: ${iso(c[300].time)} → ${iso(testFrom)}; last 365 days: ${iso(testFrom)} → ${iso(end)}. Per 1 ETH after fees (0.059%/side) + 1 tick slippage.`, ''];
for (const [name, f] of variants) {
  const tr = run(f);
  const o = stats(tr.filter((t) => t.t < testFrom));
  const l = stats(tr.filter((t) => t.t >= testFrom));
  const a = stats(tr);
  out.push(`## ${name}`, '', '| | Older | Last 365 days | Full |', '|---|---|---|---|');
  const r = (label: string, f2: (s: ReturnType<typeof stats>) => string) => out.push(`| ${label} | ${f2(o)} | ${f2(l)} | ${f2(a)} |`);
  r('Trades', (s) => String(s.n));
  r('Win rate', (s) => `${Math.round(s.win * 100)}%`);
  r('Net $/ETH', (s) => `**${s.net.toFixed(0)}**`);
  r('Profit factor', (s) => s.pf.toFixed(2));
  r('Max drawdown $/ETH', (s) => s.dd.toFixed(0));
  r('Avg win / avg loss $', (s) => `${s.avgWin.toFixed(0)} / ${s.avgLoss.toFixed(0)}`);
  r('Longest losing run', (s) => String(s.maxStreak));
  r('Worst move against a trade (median / max) $', (s) => `${s.maeMed.toFixed(0)} / ${s.maeMax.toFixed(0)}`);
  r('Avg hours in a trade', (s) => s.bars.toFixed(0));
  out.push('', '| Position size | Last 365 days: $195 → | worst fall | Full period: $195 → | worst fall |', '|---|---|---|---|---|');
  for (const k of [1, 2, 3, 5]) {
    const ly = account(tr.filter((t) => t.t >= testFrom), k);
    const al = account(tr, k);
    out.push(`| ${k}× balance | $${ly.end.toFixed(0)} | ${(ly.dd * 100).toFixed(0)}% | $${al.end.toFixed(0)} | ${(al.dd * 100).toFixed(0)}% |`);
  }
  out.push('');
}
writeFileSync('docs/hull-flip.md', out.join('\n'));
console.log(out.join('\n'));
