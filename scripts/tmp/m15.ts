// 15m research: chop filter + momentum direction + session window; TP = +$5 net per ETH, SL = −$5 net (or wide variant).
// TP/SL order resolved on 3m bars inside each 15m bar (SL first if both in one 3m bar). Entries at next 15m open.
import { readFileSync } from 'node:fs';
import type { Candle } from '../../src/shared/types.js';
import { ema, sma, adx, rsi, stdev } from '../lib/ta.js';
const FEE = 0.00059, SLIP = 0.05;
const m3 = (JSON.parse(readFileSync('data/eth_3m_cache.json', 'utf8')) as Candle[]).filter((x) => x.high >= x.low);
const Q = 900;
const c: Candle[] = [], kids: Candle[][] = [];
for (const x of m3) {
  const s = Math.floor(x.time / Q) * Q, cur = c[c.length - 1];
  if (!cur || cur.time !== s) { c.push({ ...x, time: s }); kids.push([x]); }
  else { cur.high = Math.max(cur.high, x.high); cur.low = Math.min(cur.low, x.low); cur.close = x.close; cur.volume += x.volume; kids[kids.length - 1].push(x); }
}
const n = c.length, close = c.map((x) => x.close), vol = c.map((x) => x.volume);
const e20 = ema(close, 20), r14 = rsi(close, 14), ad = adx(c, 14);
const e12 = ema(close, 12), e26 = ema(close, 26), macd = e12.map((v, i) => v - e26[i]), sig9 = ema(macd.map((v) => (Number.isNaN(v) ? 0 : v)), 9), hist = macd.map((v, i) => v - sig9[i]);
const vS = sma(vol, 20);
const tr = c.map((b, i) => (i ? Math.max(b.high - b.low, Math.abs(b.high - c[i - 1].close), Math.abs(b.low - c[i - 1].close)) : b.high - b.low));
const chop = c.map((_, i) => { if (i < 14) return NaN; let s = 0, hh = -Infinity, ll = Infinity; for (let k = i - 13; k <= i; k++) { s += tr[k]; hh = Math.max(hh, c[k].high); ll = Math.min(ll, c[k].low); } return (100 * Math.log10(s / (hh - ll))) / Math.log10(14); });
const sd = stdev(close, 20), m20 = sma(close, 20), bbw = sd.map((v, i) => (4 * v) / m20[i]), bbwAvg = sma(bbw.map((v) => (Number.isNaN(v) ? 0 : v)), 100);
type Dir = 1 | -1 | 0;
const MOM: Record<string, (i: number) => Dir> = {
  'EMA20+RSI': (i) => (close[i] > e20[i] && r14[i] > 55 ? 1 : close[i] < e20[i] && r14[i] < 45 ? -1 : 0),
  'MACD hist': (i) => (hist[i] > 0 && hist[i] > hist[i - 1] ? 1 : hist[i] < 0 && hist[i] < hist[i - 1] ? -1 : 0),
  'Breakout8+vol': (i) => { if (!(vol[i] > 1.5 * vS[i])) return 0; let hh = -Infinity, ll = Infinity; for (let k = i - 8; k < i; k++) { hh = Math.max(hh, c[k].high); ll = Math.min(ll, c[k].low); } return close[i] > hh ? 1 : close[i] < ll ? -1 : 0; },
};
const CHOP: Record<string, (i: number) => boolean> = { none: () => true, 'CHOP<61.8': (i) => chop[i] < 61.8, 'ADX>20': (i) => ad[i] > 20, 'BBwidth>avg': (i) => bbw[i] > bbwAvg[i] };
const ist = (t: number) => { const m = Math.floor(((t + 19800) % 86400) / 60); return m; };
const W = (a: string, b: string) => { const [h1, m1] = a.split(':').map(Number), [h2, m2] = b.split(':').map(Number); return [h1 * 60 + m1, h2 * 60 + m2]; };
const US = W('19:00', '23:30'), LDN = W('13:30', '16:30'), ASIA = W('05:30', '08:30');
const inW = (m: number, w: number[]) => m >= w[0] && m < w[1];
const SES: Record<string, (t: number) => boolean> = { 'all day': () => true, 'US 7-11:30PM': (t) => inW(ist(t), US), 'US+London': (t) => inW(ist(t), US) || inW(ist(t), LDN), 'US+LDN+Asia': (t) => inW(ist(t), US) || inW(ist(t), LDN) || inW(ist(t), ASIA) };
type Tr = { t: number; net: number; side: number; win: boolean };
function run(mom: (i: number) => Dir, ok: (i: number) => boolean, ses: (t: number) => boolean, tpNet: number, slNet: number | 'sym'): Tr[] {
  const out: Tr[] = [];
  let i = 120;
  while (i < n - 1) {
    const d = mom(i);
    const nb = c[i + 1];
    if (!d || !ok(i) || !ses(nb.time)) { i++; continue; }
    const e = nb.open + d * SLIP;
    const tpD = (tpNet + 2 * e * FEE) / (1 - FEE);
    const slD = slNet === 'sym' ? tpD : (slNet - 2 * e * FEE) / (1 - FEE);
    if (slD <= 0.1) { i++; continue; }
    const tp = e + d * tpD, sl = e - d * slD;
    let done: Tr | null = null, j = i + 1;
    for (; j < n && !done; j++) {
      for (const k of kids[j]) {
        const hitSl = d === 1 ? k.low <= sl : k.high >= sl, hitTp = d === 1 ? k.high >= tp : k.low <= tp;
        if (hitSl) { const px = (d === 1 ? Math.min(k.open, sl) : Math.max(k.open, sl)) - d * SLIP; done = { t: nb.time, side: d, net: (px - e) * d - (px + e) * FEE, win: false }; break; }
        if (hitTp) { const px = tp; done = { t: nb.time, side: d, net: (px - e) * d - (px + e) * FEE, win: true }; break; }
      }
      if (done) break;
    }
    if (!done) break;
    out.push(done);
    i = j; // re-enter from the exit bar's close onward (either direction)
  }
  return out;
}
const end = c[n - 1].time, yr = end - 365 * 86400, m30 = end - 30 * 86400;
const st = (xs: Tr[]) => { let e = 0, pk = 0, dd = 0, w = 0, ls = 0, cur = 0; for (const t of xs) { e += t.net; pk = Math.max(pk, e); dd = Math.max(dd, pk - e); if (t.net > 0) { w++; cur = 0; } else ls = Math.max(ls, ++cur); } return { n: xs.length, w: xs.length ? (100 * w) / xs.length : 0, net: e, dd, ls }; };
const res: any[] = [];
for (const stop of [5, 'sym'] as const) for (const [mn, mf] of Object.entries(MOM)) for (const [cn, cf] of Object.entries(CHOP)) for (const [sn, sf] of Object.entries(SES)) {
  const xs = run(mf, cf, sf, 5, stop);
  res.push({ name: `${mn} | ${cn} | ${sn} | SL ${stop === 'sym' ? 'same price dist' : '$5 net'}`, a: st(xs), o: st(xs.filter((t) => t.t < yr)), y: st(xs.filter((t) => t.t >= yr)), m: st(xs.filter((t) => t.t >= m30)) });
}
console.log(`15m from 3m: ${new Date(c[120].time * 1000).toISOString().slice(0, 10)} → ${new Date(end * 1000).toISOString().slice(0, 16)}; ${res.length} settings`);
const pos = res.filter((r) => r.o.net > 0 && r.y.net > 0);
console.log('profitable in BOTH periods:', pos.length);
const f = (r: any) => `| ${r.name} | ${r.a.n} | ${r.a.w.toFixed(0)}% | ${r.o.net.toFixed(0)} | ${r.y.net.toFixed(0)} | ${r.m.net.toFixed(0)} | ${r.a.net.toFixed(0)} | ${r.a.dd.toFixed(0)} | ${r.a.ls} |`;
console.log('| Setting | Trades | Win | Older | Last 12m | Last 30d | Full | Worst drop | Losing streak |');
for (const r of [...res].sort((a, b) => b.a.net - a.a.net).slice(0, 12)) console.log(f(r));
console.log('--- worst 3'); for (const r of [...res].sort((a, b) => a.a.net - b.a.net).slice(0, 3)) console.log(f(r));
const avgW = res.reduce((s, r) => s + r.a.w, 0) / res.length; console.log('avg win% $5/$5:', (res.filter(r=>r.name.endsWith('$5 net')).reduce((s,r)=>s+r.a.w,0)/48).toFixed(1), ' sym:', (res.filter(r=>r.name.endsWith('dist')).reduce((s,r)=>s+r.a.w,0)/48).toFixed(1), avgW.toFixed(1));
