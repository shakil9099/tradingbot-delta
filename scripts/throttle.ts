// npm run throttle — risk throttle on top of the chosen exits: trade at the base risk, drop to a lower risk while the
// account is more than X% below its peak, back to base at a new peak. MC over 12 months, 20,000 runs.
import { DEFAULT_PARAMS as P } from '../src/config/params.js';
import { loadCandles, makeCtx, runAdaptive, runFixed, type Exit, type RT } from './research5.js';

const SLIP = P.SLIPPAGE_TICKS * P.TICK;
const EX: Exit = { gate: true, overCap: 'skip', slK: 2, minAtr: 15, beTrig: 0.5, beLock: 'fee', trail: { kind: 'chand', trig: 1.5, m: 3 }, tpR: null };
function step(bal: number, t: RT, risk: number) {
  const costR = t.R + t.entry * 2 * P.FEE_RATE + 2 * SLIP;
  let size = Math.floor((bal * risk) / costR / 0.01) * 0.01;
  size = Math.min(size, Math.floor((bal * P.LEVERAGE) / t.entry / 0.01) * 0.01);
  return size < 0.01 ? NaN : bal + size * t.net;
}
async function main() {
  const c = await loadCandles();
  const x = makeCtx(c);
  const tr = runAdaptive(x, EX, runFixed(x, EX, 'hull'), runFixed(x, EX, 'ut'));
  const years = (c.at(-1)!.time - c[0].time) / (365 * 86400);
  const perMonth = tr.length / years / 12, H = Math.round(perMonth * 12), N = 20000;
  const rules: Array<[string, number, number, number]> = [
    ['20% flat', 0.2, 0.2, 1], ['10% flat', 0.1, 0.1, 1], ['5% flat', 0.05, 0.05, 1],
    ['20%, 5% when >20% down', 0.2, 0.05, 0.2], ['20%, 5% when >30% down', 0.2, 0.05, 0.3],
    ['20%, 2% when >20% down', 0.2, 0.02, 0.2], ['15%, 5% when >20% down', 0.15, 0.05, 0.2],
    ['10%, 3% when >15% down', 0.1, 0.03, 0.15],
  ];
  const out = [];
  for (const [name, base, low, th] of rules) {
    let seed = 99;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    let dd50 = 0, below = 0, below99 = 0;
    const fin: number[] = [], tdbl: number[] = [];
    for (let k = 0; k < N; k++) {
      let b = 141, pk = 141, mdd = 0, hit = -1, mn = 141;
      for (let i = 0; i < H; i++) {
        const r = (pk - b) / pk > th ? low : base;
        b = step(b, tr[Math.floor(rnd() * tr.length)], r);
        if (!Number.isFinite(b)) { b = 0; mdd = 1; mn = 0; break; }
        pk = Math.max(pk, b); mdd = Math.max(mdd, (pk - b) / pk); mn = Math.min(mn, b);
        if (hit < 0 && b >= 282) hit = i + 1;
      }
      if (mdd >= 0.5) dd50++;
      if (b < 141) below++;
      if (mn < 99) below99++;
      if (hit > 0) tdbl.push(hit / perMonth);
      fin.push(b);
    }
    fin.sort((a, b) => a - b); tdbl.sort((a, b) => a - b);
    const pct = (v: number) => `${((v / N) * 100).toFixed(1)}%`;
    out.push({ rule: name, doubledIn12m: pct(tdbl.length), medianMonthsToDouble: +(tdbl[tdbl.length >> 1] ?? NaN).toFixed(1), 'fall ≥50%': pct(dd50), 'ever < $99': pct(below99), 'below $141 at 12m': pct(below), median12m: Math.round(fin[N >> 1]), worst10pct: Math.round(fin[Math.floor(N * 0.1)]), worst2pct: Math.round(fin[Math.floor(N * 0.02)]) });
  }
  console.log(`${tr.length} trades, ${perMonth.toFixed(1)}/month; exits: SL 2×ATR (skip >$40), minATR 15, BE 0.5R→fee, trail highest−3×ATR after 1.5R, exit on opposite signal`);
  console.table(out);
}
main().catch((e) => (console.error(e), process.exit(1)));
