// Mix B exit grid (2026-11-19): search break-even, trail, stop and TP around the live exits. A setting PASSES only if it
// beats current Mix B in BOTH the older period and the last 12 months on $/ETH, with a worst drop no bigger in either.
// npx tsx scripts/mixBGrid.ts [--offline]  → docs/mixb-grid.md
import { readFileSync, writeFileSync } from 'node:fs';
import { DEFAULT_PARAMS, type Params } from '../src/config/params.js';
import { entryGate } from '../src/core/entryGate.js';
import { computeAll } from '../src/core/signals.js';
import { simulate } from '../src/core/simulator.js';
import type { Candle, SimTrade } from '../src/shared/types.js';
import { fetchHistory } from './lib/candles.js';

const cached = JSON.parse(readFileSync('data/eth_1h_cache.json', 'utf8')) as Candle[];
const byTime = new Map(cached.map((x) => [x.time, x]));
if (!process.argv.includes('--offline')) for (const x of await fetchHistory(2)) byTime.set(x.time, x);
const c = [...byTime.values()].sort((a, b) => a.time - b.time).filter((x) => x.high > x.low || x.volume > 0);
const yr = c[c.length - 1].time - 365 * 86400;
const day = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
const base: Params = { ...DEFAULT_PARAMS, STRATEGY: 'hull', MIN_ATR: 15, SKIP_WEEKEND_ENTRIES: true, MAX_CONTRACTS: 100, BE_TRIG_USD: 0, REV_REENTRY: true };

const st = (xs: SimTrade[]) => {
  let e = 0, pk = 0, dd = 0, w = 0, ls = 0, worstStreak = 0, streak = 0;
  for (const t of xs) {
    e += t.netPnl; pk = Math.max(pk, e); dd = Math.max(dd, pk - e);
    if (t.netPnl > 0) { w++; streak = 0; } else { streak++; worstStreak = Math.max(worstStreak, streak); }
    ls = Math.min(ls, t.netPnl);
  }
  return { n: xs.length, net: e, dd, win: xs.length ? w / xs.length : 0, worst: ls, streak: worstStreak };
};

type K = { SL_ATR_MULT: number; BE_TRIG_R: number; TRAIL_TRIG_R: number; TRAIL_ATR_MULT: number; TP_R: number };
const run = (k: K) => {
  const p: Params = { ...base, ...k };
  const g = entryGate(c, p);
  const ind = computeAll(c, p);
  const tr = simulate('hull', c, ind.sigHullEntry, p, { allowEntryAt: (i) => g(i) === null }).filter((t) => t.entryTime >= c[300].time);
  return { k, all: st(tr), old: st(tr.filter((t) => t.entryTime < yr)), ly: st(tr.filter((t) => t.entryTime >= yr)) };
};

const live: K = { SL_ATR_MULT: 2, BE_TRIG_R: 1, TRAIL_TRIG_R: 1.5, TRAIL_ATR_MULT: 3, TP_R: 0 };
const ctl = run(live);
const res: ReturnType<typeof run>[] = [];
for (const SL_ATR_MULT of [1.5, 2, 2.5])
  for (const BE_TRIG_R of [0, 0.75, 1, 1.5, 2])
    for (const TRAIL_TRIG_R of [1, 1.5, 2, 3])
      for (const TRAIL_ATR_MULT of [2, 2.5, 3, 4])
        for (const TP_R of [0, 3, 5]) res.push(run({ SL_ATR_MULT, BE_TRIG_R, TRAIL_TRIG_R, TRAIL_ATR_MULT, TP_R }));

const key = (k: K) => `${k.SL_ATR_MULT}|${k.BE_TRIG_R}|${k.TRAIL_TRIG_R}|${k.TRAIL_ATR_MULT}|${k.TP_R}`;
const passes = (r: (typeof res)[number]) => r.old.net > ctl.old.net && r.ly.net > ctl.ly.net && r.old.dd <= ctl.old.dd && r.ly.dd <= ctl.ly.dd;
const passSet = new Set(res.filter(passes).map((r) => key(r.k)));
/** Robustness: how many one-step neighbours (one setting moved one notch) also pass. */
const grid = { SL_ATR_MULT: [1.5, 2, 2.5], BE_TRIG_R: [0, 0.75, 1, 1.5, 2], TRAIL_TRIG_R: [1, 1.5, 2, 3], TRAIL_ATR_MULT: [2, 2.5, 3, 4], TP_R: [0, 3, 5] };
const neighbours = (k: K) => {
  let n = 0, ok = 0;
  for (const f of Object.keys(grid) as (keyof K)[]) {
    const vals = grid[f];
    const i = vals.indexOf(k[f]);
    for (const j of [i - 1, i + 1]) if (j >= 0 && j < vals.length) { n++; if (passSet.has(key({ ...k, [f]: vals[j] }))) ok++; }
  }
  return `${ok}/${n}`;
};
const fmt = (r: (typeof res)[number], tag = '') =>
  `| ${tag}${r.k.SL_ATR_MULT}×ATR | ${r.k.BE_TRIG_R ? `${r.k.BE_TRIG_R}R` : 'off'} | ${r.k.TRAIL_ATR_MULT}×ATR from ${r.k.TRAIL_TRIG_R}R | ${r.k.TP_R ? `${r.k.TP_R}R` : 'none'} | ${r.all.n} | ${Math.round(r.all.win * 100)}% | ${r.old.net.toFixed(0)} | ${r.ly.net.toFixed(0)} | **${r.all.net.toFixed(0)}** | ${r.old.dd.toFixed(0)} / ${r.ly.dd.toFixed(0)} | ${r.all.worst.toFixed(0)} | ${r.all.streak} | ${passes(r) ? neighbours(r.k) : '—'} |`;

const passing = res.filter(passes).sort((a, b) => b.all.net - a.all.net);
const byDd = [...res].filter((r) => r.old.net > 0 && r.ly.net > 0).sort((a, b) => Math.max(a.old.dd, a.ly.dd) - Math.max(b.old.dd, b.ly.dd)).slice(0, 10);
const head = '| Stop | Break-even | Trail | TP | Trades | Win % | Older $/ETH | Last 12 mo | Full | Worst drop older / 12 mo | Worst trade | Losing streak | Neighbours passing |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|';
const out = [
  '# Mix B exit grid',
  '',
  `ETHUSD 1h, ${day(c[300].time)} to ${day(c[c.length - 1].time)}; last 12 months from ${day(yr)}. Mix B entries (Hull + reversal re-entry), live gate, fees and slippage. $ per 1 ETH. ${res.length} settings tried.`,
  '',
  'A setting **passes** only if it beats current Mix B in both periods with a worst drop no bigger in either. "Neighbours passing" = of the settings one notch away on any knob, how many also pass (a lone pass is likely luck).',
  '',
  '## Current Mix B',
  '',
  head,
  fmt(ctl),
  '',
  `## Passing settings (${passing.length})`,
  '',
  head,
  ...passing.slice(0, 25).map((r) => fmt(r)),
  '',
  '## Smallest worst drop (both periods profitable)',
  '',
  head,
  ...byDd.map((r) => fmt(r)),
  '',
];
writeFileSync('docs/mixb-grid.md', out.join('\n'));
console.log(out.join('\n'));
