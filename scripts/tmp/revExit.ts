import { readFileSync } from 'node:fs';
import { DEFAULT_PARAMS, type Params } from '../../src/config/params.js';
import { entryGate } from '../../src/core/entryGate.js';
import { computeAll } from '../../src/core/signals.js';
import { simulate } from '../../src/core/simulator.js';
import type { Candle, Signal, SimTrade } from '../../src/shared/types.js';
import { fetchHistory } from '../lib/candles.js';

const cached = JSON.parse(readFileSync('data/eth_1h_cache.json', 'utf8')) as Candle[];
const by = new Map(cached.map((x) => [x.time, x]));
for (const x of await fetchHistory(2)) by.set(x.time, x);
const c = [...by.values()].sort((a, b) => a.time - b.time).filter((x) => x.high > x.low || x.volume > 0);
const yr = c[c.length - 1].time - 365 * 86400;
const p: Params = { ...DEFAULT_PARAMS, STRATEGY: 'hull', MIN_ATR: 15, SKIP_WEEKEND_ENTRIES: true, MAX_CONTRACTS: 100, BE_TRIG_USD: 0, REV_REENTRY: true, TRAIL_TRIG_R: 1 } as Params;
const ind = computeAll(c, p);
const gate = entryGate(c, p);
const live = ind.sigHullEntry;
const withExit = live.map((s, t) => (s !== 'NONE' ? s : ind.sigRev[t])) as Signal[];
const run = (sig: Signal[], allow?: (t: number, s: string) => boolean) =>
  simulate('hull', c, sig, p, { allowEntryAt: (t, s) => gate(t) === null && (allow ? allow(t, s) : true) }).filter((t) => t.entryTime >= c[300].time);
const A = run(live);
const B = run(withExit, (t, s) => live[t] === (s === 'buy' ? 'LONG' : 'SHORT'));
const R = simulate('reversal', c, ind.sigRev, { ...p, STRATEGY: 'reversal', BE_TRIG_R: 999, TRAIL_TRIG_R: 999, TP_R: 0 } as Params, { allowEntryAt: (t) => gate(t) === null }).filter((t) => t.entryTime >= c[300].time);
const st = (xs: SimTrade[]) => { let e = 0, pk = 0, dd = 0, w = 0, ls = 0, cur = 0; for (const t of xs) { e += t.netPnl; pk = Math.max(pk, e); dd = Math.max(dd, pk - e); if (t.netPnl > 0) { w++; cur = 0; } else { cur++; ls = Math.max(ls, cur); } } return `${xs.length} trades, win ${Math.round((100 * w) / Math.max(1, xs.length))}%, net ${e.toFixed(0)}/ETH, worst drop ${dd.toFixed(0)}, avg loss ${(xs.filter(t=>t.netPnl<=0).reduce((a,t)=>a+t.netPnl,0)/Math.max(1,xs.filter(t=>t.netPnl<=0).length)).toFixed(1)}, longest losing streak ${ls}`; };
const d = (t: number) => new Date(t * 1000).toISOString().slice(5, 16).replace('T', ' ');
for (const [n, xs] of [['LIVE Mix B', A], ['Mix B + exit on opposite reversal', B], ['Pure reversal, no TP', R]] as const) {
  console.log(`\n== ${n}\n full: ${st(xs)}\n last 12m: ${st(xs.filter((t) => t.entryTime >= yr))}\n last 30d: ${st(xs.filter((t) => t.entryTime >= c[c.length-1].time - 30*86400))}`);
  for (const t of xs.filter((t) => t.entryTime >= c[c.length - 1].time - 6 * 86400)) console.log(`  ${d(t.entryTime)} ${t.side} ${t.entry} -> ${d(t.exitTime)} ${t.exit} ${t.reason} ${t.netPnl.toFixed(1)}`);
}
const m = new Map<string, number>();
for (const t of A) { const k = new Date(t.entryTime * 1000).toISOString().slice(0, 7); m.set(k, (m.get(k) ?? 0) + t.netPnl); }
console.log('\nMONTHS', [...m].map(([k, v]) => `${k}:${v.toFixed(0)}`).join(' '));
