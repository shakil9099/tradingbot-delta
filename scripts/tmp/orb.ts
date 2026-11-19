// ETH session opening-range breakout, NIFTY-ORB style. 3m data; 15m closes for the break; 15m Hull55 trend filter.
import { readFileSync } from 'node:fs';
import type { Candle } from '../../src/shared/types.js';
import { hma } from '../../src/core/indicators.js';
const FEE = 0.00059, SLIP = 0.05;
const m3 = (JSON.parse(readFileSync('data/eth_3m_cache.json', 'utf8')) as Candle[]).filter((x) => x.high >= x.low).sort((a, b) => a.time - b.time);
const idx3 = new Map(m3.map((x, i) => [x.time, i]));
const c15: Candle[] = [];
for (const x of m3) { const s = Math.floor(x.time / 900) * 900, cur = c15[c15.length - 1]; if (!cur || cur.time !== s) c15.push({ ...x, time: s }); else { cur.high = Math.max(cur.high, x.high); cur.low = Math.min(cur.low, x.low); cur.close = x.close; } }
const i15 = new Map(c15.map((x, i) => [x.time, i]));
const hull = hma(c15.map((x) => x.close), 55);
const hullUp = (i: number) => hull[i] > hull[i - 2];
const off = (tz: string, t: number) => { const d = new Date(t * 1000); const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(d).map((x) => [x.type, x.value])); return (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) / 1000 - t); };
const day0 = Math.floor(m3[0].time / 86400) * 86400 + 86400, dayN = Math.floor(m3[m3.length - 1].time / 86400) * 86400;
const SESS: Record<string, (d: number) => number> = {
  'Asia 05:30 IST': (d) => d,
  London: (d) => d + 8 * 3600 - off('Europe/London', d + 12 * 3600),
  'New York': (d) => d + 9.5 * 3600 - off('America/New_York', d + 12 * 3600),
};
type Tr = { t: number; net: number; R: number; why: string };
function session(O: number, L: number, trend: boolean, k: number, tgt: number, winH: number, exitH: number): Tr | null {
  const ist = new Date((O + 19800) * 1000).getUTCDay(); if (ist === 0 || ist === 6) return null;
  let hi = -Infinity, lo = Infinity;
  for (let t = O; t < O + L * 60; t += 180) { const j = idx3.get(t); if (j === undefined) return null; hi = Math.max(hi, m3[j].high); lo = Math.min(lo, m3[j].low); }
  const rng = hi - lo; if (!(rng > 0)) return null;
  for (let t = O + L * 60; t < O + (L + winH * 60) * 60; t += 900) {
    const i = i15.get(t); if (i === undefined) continue;
    const b = c15[i]; const d = b.close > hi ? 1 : b.close < lo ? -1 : 0; if (!d) continue;
    if (trend && (hullUp(i) ? 1 : -1) !== d) return null; // first break against trend → no trade that session (as NIFTY)
    const j0 = idx3.get(t + 900); if (j0 === undefined) return null;
    const e = m3[j0].open + d * SLIP, R = Math.min(40, Math.max(8, k * rng)), sl = e - d * R, tp = tgt ? e + d * tgt * R : NaN;
    const end = O + exitH * 3600;
    for (let j = j0; j < m3.length; j++) {
      const x = m3[j];
      const fin = (px: number, why: string) => ({ t: O, R, why, net: (px - e) * d - (px + e) * FEE });
      if (x.time >= end) return fin(x.open - d * SLIP, 'time');
      if (d === 1 ? x.low <= sl : x.high >= sl) return fin((d === 1 ? Math.min(x.open, sl) : Math.max(x.open, sl)) - d * SLIP, 'stop');
      if (tgt && (d === 1 ? x.high >= tp : x.low <= tp)) return fin(tp, 'target');
    }
    return null;
  }
  return null;
}
const end = m3[m3.length - 1].time, yr = end - 365 * 86400;
const st = (xs: Tr[]) => { let e = 0, pk = 0, dd = 0, w = 0, ls = 0, cur = 0; for (const t of xs) { e += t.net; pk = Math.max(pk, e); dd = Math.max(dd, pk - e); if (t.net > 0) { w++; cur = 0; } else ls = Math.max(ls, ++cur); } const L = xs.filter((t) => t.net <= 0); return { n: xs.length, w: xs.length ? (100 * w) / xs.length : 0, net: e, dd, ls, al: L.length ? L.reduce((a, t) => a + t.net, 0) / L.length : 0 }; };
const res: any[] = [];
const cfgs: any[] = [];
for (const L of [15, 30, 60]) for (const trend of [false, true]) for (const k of [1, 1.5]) for (const tgt of [2, 3, 0]) cfgs.push({ L, trend, k, tgt });
const sessNames = Object.keys(SESS);
const bySess: Record<string, Map<string, Tr[]>> = {};
for (const sn of sessNames) { bySess[sn] = new Map(); for (const cf of cfgs) { const xs: Tr[] = []; for (let d = day0; d < dayN; d += 86400) { const tr = session(SESS[sn](d), cf.L, cf.trend, cf.k, cf.tgt, 2, 6); if (tr && tr.t + 6 * 3600 <= end) xs.push(tr); } bySess[sn].set(JSON.stringify(cf), xs); } }
for (const sn of [...sessNames, 'All 3 sessions']) for (const cf of cfgs) {
  const key = JSON.stringify(cf);
  const xs = sn === 'All 3 sessions' ? sessNames.flatMap((s) => bySess[s].get(key)!).sort((a, b) => a.t - b.t) : bySess[sn].get(key)!;
  res.push({ sn, cf, name: `${sn} | range ${cf.L}m | ${cf.trend ? 'Hull15m trend' : 'no trend'} | stop ${cf.k}×range | ${cf.tgt ? cf.tgt + 'R target' : 'no target'}`, a: st(xs), o: st(xs.filter((t) => t.t < yr)), y: st(xs.filter((t) => t.t >= yr)), m: st(xs.filter((t) => t.t >= end - 30 * 86400)), xs });
}
console.log(`data ${new Date(day0 * 1000).toISOString().slice(0, 10)} → ${new Date(end * 1000).toISOString().slice(0, 10)}, ${res.length} settings`);
const both = res.filter((r) => r.o.net > 0 && r.y.net > 0);
console.log('profitable both periods:', both.length);
const f = (r: any) => `| ${r.name} | ${r.a.n} | ${r.a.w.toFixed(0)}% | ${r.o.net.toFixed(0)} | ${r.y.net.toFixed(0)} | ${r.m.net.toFixed(0)} | **${r.a.net.toFixed(0)}** | ${r.o.dd.toFixed(0)} / ${r.y.dd.toFixed(0)} | ${r.a.al.toFixed(1)} | ${r.a.ls} |`;
console.log('| Setting | Trades | Win | Older | Last 12m | Last 30d | Full | Worst drop older/12m | Avg loss | Losing streak |');
for (const r of [...both].sort((a, b) => Math.min(b.o.net, b.y.net * 1.6) - Math.min(a.o.net, a.y.net * 1.6)).slice(0, 15)) console.log(f(r));
// neighbours per session
for (const sn of [...sessNames, 'All 3 sessions']) { const rs = res.filter((r) => r.sn === sn); console.log(`${sn}: ${rs.filter((r) => r.o.net > 0 && r.y.net > 0).length}/${rs.length} settings profitable in both periods; median full ${[...rs.map((r) => r.a.net)].sort((a, b) => a - b)[18].toFixed(0)}`); }
