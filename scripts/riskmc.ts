// npm run riskmc — time to double $141 at different risk-per-trade levels, proposed round-5 config.
// (a) actual history: start on every calendar month and replay; (b) Monte Carlo: 20,000 random reorderings
// (bootstrap) of the real trades. Trade rate taken from history. Sizing as live: 0.01 ETH steps, 20x margin cap.
import { DEFAULT_PARAMS as P } from '../src/config/params.js';
import { loadCandles, makeCtx, runAdaptive, runFixed, type Exit, type RT } from './research5.js';

const EX: Exit = { gate: true, overCap: 'skip', slK: 2, minAtr: 15, beTrig: 1.5, beLock: 'fee', trail: { kind: 'none' }, tpR: null };
const SLIP = P.SLIPPAGE_TICKS * P.TICK;

function step(bal: number, t: RT, risk: number): number {
  const costR = t.R + t.entry * 2 * P.FEE_RATE + 2 * SLIP;
  let size = Math.floor((bal * risk) / costR / 0.01) * 0.01;
  size = Math.min(size, Math.floor((bal * P.LEVERAGE) / t.entry / 0.01) * 0.01);
  if (size < 0.01) return NaN; // cannot open the minimum size: account effectively finished
  return bal + size * t.net;
}

async function main() {
  const c = await loadCandles();
  const x = makeCtx(c);
  const tr = runAdaptive(x, EX, runFixed(x, EX, 'hull'), runFixed(x, EX, 'ut')).sort((a, b) => a.entryTime - b.entryTime);
  const years = (c.at(-1)!.time - c[0].time) / (365 * 86400);
  const perMonth = tr.length / (years * 12);
  console.log(`${tr.length} trades over ${years.toFixed(2)} years = ${perMonth.toFixed(1)} trades/month`);
  const risks = [0.01, 0.02, 0.03, 0.05, 0.08, 0.1, 0.15, 0.2];

  // (a) history, every start month
  const starts: number[] = [];
  let lastM = '';
  tr.forEach((t, i) => {
    const m = new Date(t.entryTime * 1000).toISOString().slice(0, 7);
    if (m !== lastM) (starts.push(i), (lastM = m));
  });
  const hist = [];
  for (const r of risks) {
    const months: number[] = [];
    let never = 0, worst = 0;
    for (const s of starts) {
      let bal = 141, peak = 141, done = false;
      for (let i = s; i < tr.length; i++) {
        bal = step(bal, tr[i], r);
        if (!Number.isFinite(bal)) { worst = 1; break; }
        peak = Math.max(peak, bal);
        worst = Math.max(worst, (peak - bal) / peak);
        if (bal >= 282) { months.push((tr[i].exitTime - tr[s].entryTime) / (30.44 * 86400)); done = true; break; }
      }
      if (!done) never++;
    }
    months.sort((a, b) => a - b);
    hist.push({ risk: `${r * 100}%`, starts: starts.length, doubled: months.length, medianMonths: +(months[months.length >> 1] ?? NaN).toFixed(1), fastest: +(months[0] ?? NaN).toFixed(1), slowest: +(months.at(-1) ?? NaN).toFixed(1), neverDoubled: never, worstDropSeen: `${(worst * 100).toFixed(0)}%` });
  }
  console.log('\n(a) Real history, starting $141 at the start of each month:');
  console.table(hist);

  // (b) Monte Carlo bootstrap of trades
  let seed = 42;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const N = 20000, horizon = Math.round(perMonth * 12);
  const mc = [];
  for (const r of risks) {
    const tt: number[] = [];
    let dd50 = 0, below70 = 0, lost12 = 0, notIn6 = 0, notIn12 = 0;
    const final12: number[] = [];
    for (let k = 0; k < N; k++) {
      let bal = 141, peak = 141, maxdd = 0, hit = -1, minBal = 141;
      for (let i = 0; i < horizon; i++) {
        bal = step(bal, tr[Math.floor(rnd() * tr.length)], r);
        if (!Number.isFinite(bal)) { bal = 0; maxdd = 1; minBal = 0; break; }
        peak = Math.max(peak, bal); minBal = Math.min(minBal, bal);
        maxdd = Math.max(maxdd, (peak - bal) / peak);
        if (hit < 0 && bal >= 282) hit = i + 1;
      }
      if (hit > 0) tt.push(hit / perMonth);
      if (hit < 0 || hit / perMonth > 6) notIn6++;
      if (hit < 0) notIn12++;
      if (maxdd >= 0.5) dd50++;
      if (minBal < 141 * 0.7) below70++;
      if (bal < 141) lost12++;
      final12.push(bal);
    }
    tt.sort((a, b) => a - b);
    final12.sort((a, b) => a - b);
    const pct = (v: number) => `${((v / N) * 100).toFixed(1)}%`;
    mc.push({
      risk: `${r * 100}%`,
      medianMonthsToDouble: +(tt[Math.floor(tt.length / 2)] ?? NaN).toFixed(1),
      notDoubledIn6m: pct(notIn6),
      notDoubledIn12m: pct(notIn12),
      'dropped ≥50% at some point': pct(dd50),
      'fell below $99': pct(below70),
      'below $141 after 12m': pct(lost12),
      median12m: Math.round(final12[N >> 1]),
      worst10pct12m: Math.round(final12[Math.floor(N * 0.1)]),
    });
  }
  console.log(`\n(b) Monte Carlo, ${N} random orderings of the real trades, 12 months (${horizon} trades):`);
  console.table(mc);
}
main().catch((e) => (console.error(e), process.exit(1)));
