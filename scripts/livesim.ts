// npm run livesim — the built Strategy v2 (src/core: same simulator, entry gate and sizing as the live bot) on the
// cached ETH history, with the live risk throttle, the 0.9 × 20x margin cap and the 3-initial-stop breaker.
// (a) the real history from $141; (b) Monte Carlo: 20,000 bootstrap orderings of the real trades, 12 months.
// Breaker: after 3 initial-stop exits with no profitable trade between them the bot halts; here we assume the
// author resumes at the next trade (so the halt costs nothing) and count how often it would have fired.
import { DEFAULT_PARAMS as P } from '../src/config/params.js';
import { nextCount, shouldHalt } from '../src/core/breaker.js';
import { entryGate } from '../src/core/entryGate.js';
import { atrPine } from '../src/core/indicators.js';
import { computeAll } from '../src/core/signals.js';
import { simulateAdaptive } from '../src/core/simulator.js';
import { contractsFor, riskFor } from '../src/core/sizing.js';
import type { ExitReason, SimTrade } from '../src/shared/types.js';
import { loadCandles } from './research5.js';

function step(bal: number, peak: number, t: SimTrade): { bal: number; peak: number } | null {
  const th = riskFor(bal, peak, P);
  const s = contractsFor({ balanceUsd: bal, price: t.entry, riskDist: t.riskDist!, risk: th.risk, leverage: P.LEVERAGE, maxContracts: P.MAX_CONTRACTS, feeRate: P.FEE_RATE, tick: P.TICK, slippageTicks: P.SLIPPAGE_TICKS });
  if (!s.contracts) return null;
  const b = bal + s.contracts * P.CONTRACT_VALUE * t.netPnl;
  return { bal: b, peak: Math.max(th.peak, b) };
}

async function main() {
  const c = await loadCandles();
  const ind = computeAll(c, P);
  const atr = atrPine(c, P.ATR_LEN);
  const gate = entryGate(c, P, atr);
  const tr = simulateAdaptive(c, ind, P, { allowEntryAt: (i) => gate(i) === null, atr }).trades.sort((a, b) => a.entryTime - b.entryTime);
  const years = (c.at(-1)!.time - c[0].time) / (365 * 86400);
  const perMonth = tr.length / years / 12;
  const net = tr.reduce((s, t) => s + t.netPnl, 0);
  console.log(`${tr.length} trades (${perMonth.toFixed(1)}/month), per-ETH net $${net.toFixed(0)} over ${years.toFixed(2)} years`);

  // (a) history
  let bal = 141, peak = 141, maxdd = 0, cnt = 0, trips = 0;
  const tripAt: string[] = [];
  for (const t of tr) {
    const r = step(bal, peak, t);
    if (!r) break;
    ({ bal, peak } = r);
    maxdd = Math.max(maxdd, (peak - bal) / peak);
    cnt = nextCount(cnt, t.reason as ExitReason, t.netPnl);
    if (shouldHalt(cnt, P.BREAKER_N)) (trips++, tripAt.push(`${new Date(t.exitTime * 1000).toISOString().slice(0, 10)} ($${bal.toFixed(0)})`), (cnt = 0));
  }
  console.log(`(a) history from $141: final $${bal.toFixed(0)}, max drop ${(maxdd * 100).toFixed(0)}%, breaker would fire ${trips}×: ${tripAt.join(', ')}`);

  // (b) Monte Carlo
  let seed = 11;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const N = 20000, H = Math.round(perMonth * 12);
  let dd50 = 0, below = 0, dbl = 0, tripped = 0;
  const fin: number[] = [], tdbl: number[] = [];
  for (let k = 0; k < N; k++) {
    let b = 141, pk = 141, mdd = 0, hit = -1, n = 0, any = false;
    for (let i = 0; i < H; i++) {
      const t = tr[Math.floor(rnd() * tr.length)];
      const r = step(b, pk, t);
      if (!r) { b = 0; mdd = 1; break; }
      ({ bal: b, peak: pk } = r);
      mdd = Math.max(mdd, (pk - b) / pk);
      n = nextCount(n, t.reason as ExitReason, t.netPnl);
      if (shouldHalt(n, P.BREAKER_N)) (any = true), (n = 0);
      if (hit < 0 && b >= 282) hit = i + 1;
    }
    if (mdd >= 0.5) dd50++;
    if (b < 141) below++;
    if (hit > 0) (dbl++, tdbl.push(hit / perMonth));
    if (any) tripped++;
    fin.push(b);
  }
  fin.sort((a, b) => a - b);
  tdbl.sort((a, b) => a - b);
  const pct = (v: number) => `${((v / N) * 100).toFixed(1)}%`;
  console.log(`(b) Monte Carlo 12 months, risk ${P.RISK_PER_TRADE * 100}% → ${P.RISK_REDUCED * 100}% when >${P.RISK_REDUCE_DD * 100}% below peak:`);
  console.table({
    'doubled within 12 months': pct(dbl),
    'median months to double': +(tdbl[tdbl.length >> 1] ?? NaN).toFixed(1),
    'fell ≥ 50% at some point': pct(dd50),
    'below $141 after 12 months': pct(below),
    'breaker fired at least once': pct(tripped),
    'median after 12 months': `$${Math.round(fin[N >> 1])}`,
    'worst 10%': `$${Math.round(fin[Math.floor(N * 0.1)])}`,
    'worst 2%': `$${Math.round(fin[Math.floor(N * 0.02)])}`,
  });
}
main().catch((e) => (console.error(e), process.exit(1)));
