// npm run trail20 — trailing / break-even variants at a fixed risk per trade (default 20%), ranked by capital
// protection. Base: adaptive, weekends blocked, SL 2×ATR (floor $10, skip if > $40), minATR 15, no TP.
import { DEFAULT_PARAMS as P } from '../src/config/params.js';
import { loadCandles, makeCtx, metrics, period, runAdaptive, runFixed, trailName, type Exit, type RT, type Trail } from './research5.js';

const RISK = Number(process.env.RISK ?? 0.2);
const SLIP = P.SLIPPAGE_TICKS * P.TICK;
function step(bal: number, t: RT): number {
  const costR = t.R + t.entry * 2 * P.FEE_RATE + 2 * SLIP;
  let size = Math.floor((bal * RISK) / costR / 0.01) * 0.01;
  size = Math.min(size, Math.floor((bal * P.LEVERAGE) / t.entry / 0.01) * 0.01);
  return size < 0.01 ? NaN : bal + size * t.net;
}

async function main() {
  const c = await loadCandles();
  const x = makeCtx(c);
  const pd = period(c);
  const years = (c.at(-1)!.time - c[0].time) / (365 * 86400);
  const trails: Trail[] = [{ kind: 'none' }];
  for (const trig of [0.5, 1, 1.5, 2]) for (const m of [1.5, 2, 2.5, 3]) trails.push({ kind: 'chand', trig, m });
  for (const trig of [0.5, 1, 1.5, 2]) for (const gap of [0.5, 0.75, 1]) trails.push({ kind: 'r', trig, gap });
  for (const trig of [0.5, 1, 2]) trails.push({ kind: 'ut', trig });
  const bes: Array<[number | null, 'fee' | number]> = [[null, 'fee'], [0.5, 'fee'], [0.75, 'fee'], [1, 'fee'], [1.5, 'fee'], [1, 0.25]];

  const rows = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  for (const [beTrig, beLock] of bes)
    for (const trail of trails) {
      const ex: Exit = { gate: true, overCap: 'skip', slK: 2, minAtr: 15, beTrig, beLock, trail, tpR: null };
      const tr = runAdaptive(x, ex, runFixed(x, ex, 'hull'), runFixed(x, ex, 'ut')).sort((a, b) => a.entryTime - b.entryTime);
      const m = metrics(tr, pd);
      // actual history from the start
      let bal = 141, peak = 141, dd = 0;
      for (const t of tr) { bal = step(bal, t); if (!Number.isFinite(bal)) { bal = 0; dd = 1; break; } peak = Math.max(peak, bal); dd = Math.max(dd, (peak - bal) / peak); }
      // Monte Carlo 12 months
      const perYr = tr.length / years, N = 5000, H = Math.round(perYr);
      let dd50 = 0, below = 0, dbl = 0;
      const fin: number[] = [];
      seed = 7;
      for (let k = 0; k < N; k++) {
        let b = 141, pk = 141, mdd = 0, hit = false;
        for (let i = 0; i < H; i++) {
          b = step(b, tr[Math.floor(rnd() * tr.length)]);
          if (!Number.isFinite(b)) { b = 0; mdd = 1; break; }
          pk = Math.max(pk, b); mdd = Math.max(mdd, (pk - b) / pk);
          if (b >= 282) hit = true;
        }
        if (mdd >= 0.5) dd50++;
        if (b < 141) below++;
        if (hit) dbl++;
        fin.push(b);
      }
      fin.sort((a, b) => a - b);
      const reasons: Record<string, number> = {};
      for (const t of tr) reasons[t.reason] = (reasons[t.reason] ?? 0) + 1;
      rows.push({
        be: beTrig === null ? '—' : `${beTrig}R→${beLock === 'fee' ? 'fee' : `${beLock}R`}`, trail: trailName(trail),
        trades: m.trades, win: m.win, PF: m.PF, trainYr: m.trainYr, testYr: m.testYr, maxDDperEth: m.maxDD,
        histFinal: Math.round(bal), histMaxDD: `${(dd * 100).toFixed(0)}%`,
        mcDrop50: +((dd50 / N) * 100).toFixed(1), mcBelowStart: +((below / N) * 100).toFixed(1), mcDoubled: +((dbl / N) * 100).toFixed(1),
        mcMedian: Math.round(fin[N >> 1]), mcWorst10: Math.round(fin[Math.floor(N * 0.1)]),
        exits: Object.entries(reasons).map(([k, v]) => `${k}:${v}`).join(' '),
      });
    }
  const ok = rows.filter((r) => Number(r.trainYr) > 0 && Number(r.testYr) > 0);
  console.log(`risk ${RISK * 100}%: ${rows.length} variants, ${ok.length} positive in train and test`);
  console.log('\nRanked by capital protection (MC chance of a ≥50% fall, then chance of ending below $141):');
  console.table([...ok].sort((a, b) => a.mcDrop50 - b.mcDrop50 || a.mcBelowStart - b.mcBelowStart).slice(0, 25));
  console.log('\nFor comparison, the most profitable (MC median after 12 months):');
  console.table([...ok].sort((a, b) => b.mcMedian - a.mcMedian).slice(0, 8));
}
main().catch((e) => (console.error(e), process.exit(1)));
