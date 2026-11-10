// npm run research5b — robustness checks for the round-5 winners (uses the cached candles).
import { DEFAULT_PARAMS as P } from '../src/config/params.js';
import { account, loadCandles, makeCtx, metrics, period, runAdaptive, runFixed, type Exit, type RT, type Trail } from './research5.js';

async function main() {
  const c = await loadCandles();
  const x = makeCtx(c);
  const pd = period(c);
  const base = { gate: true, overCap: 'skip' as const, beLock: 'fee' as const, tpR: null };

  // 1. Neighbourhood heat map: adaptive, no TP, no trail / BE, slK × minATR.
  console.log('\n1) adaptive, no BE, no trail, no TP — train $/yr | test $/yr | maxDD | trades');
  const ks = [1.25, 1.5, 1.75, 2, 2.25, 2.5, 3];
  const mins = [0, 5, 10, 12, 15, 18];
  const heat: Record<string, Record<string, string>> = {};
  for (const slK of ks) {
    heat[`k ${slK}`] = {};
    for (const minAtr of mins) {
      const ex: Exit = { ...base, slK, minAtr, beTrig: null, trail: { kind: 'none' } };
      const m = metrics(runAdaptive(x, ex, runFixed(x, ex, 'hull'), runFixed(x, ex, 'ut')), pd);
      heat[`k ${slK}`][`min ${minAtr}`] = `${m.trainYr}|${m.testYr}|${m.maxDD}|${m.trades}`;
    }
  }
  console.table(heat);

  // 2. Candidates in detail.
  const trails: Record<string, Trail> = { none: { kind: 'none' }, 'chand 2/3': { kind: 'chand', trig: 2, m: 3 }, 'ut 2': { kind: 'ut', trig: 2 }, 'R 3/1.5': { kind: 'r', trig: 3, gap: 1.5 } };
  const cands: Array<[string, Exit]> = [];
  for (const [slK, minAtr] of [[2, 10], [2, 15], [1.5, 10], [2, 0]] as const)
    for (const [tn, trail] of Object.entries(trails))
      for (const beTrig of [null, 1.5])
        cands.push([`k${slK} min${minAtr} be${beTrig ?? '—'} ${tn}`, { ...base, slK, minAtr, beTrig, trail }]);

  const quarters = (tr: RT[]) => {
    const q = new Map<string, number>();
    for (const t of tr) {
      const d = new Date(t.entryTime * 1000);
      const k = `${d.getUTCFullYear()}Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
      q.set(k, (q.get(k) ?? 0) + t.net);
    }
    return [...q.values()];
  };
  const streak = (tr: RT[]) => {
    let s = 0, m = 0;
    for (const t of [...tr].sort((a, b) => a.exitTime - b.exitTime)) (s = t.net <= 0 ? s + 1 : 0), (m = Math.max(m, s));
    return m;
  };
  const rows = [];
  for (const [name, ex] of cands) {
    const tr = runAdaptive(x, ex, runFixed(x, ex, 'hull'), runFixed(x, ex, 'ut'));
    const m = metrics(tr, pd);
    const q = quarters(tr);
    // 3x slippage stress: subtract 4 extra ticks per round trip.
    const stressed = tr.map((t) => ({ ...t, net: t.net - 4 * P.TICK }));
    const ms = metrics(stressed, pd);
    const reasons: Record<string, number> = {};
    for (const t of tr) reasons[t.reason] = (reasons[t.reason] ?? 0) + 1;
    rows.push({
      name, trades: m.trades, win: m.win, trainYr: m.trainYr, testYr: m.testYr, PF: m.PF, maxDD: m.maxDD,
      y24: m.y2024, y25: m.y2025, y26: m.y2026, qPos: `${q.filter((v) => v > 0).length}/${q.length}`,
      lossStreak: streak(tr), stress3xSlip: `${ms.trainYr}|${ms.testYr}`,
      acct2: m.acct2, dd2: m.dd2, acct1: +account(tr, 0.01).final.toFixed(0), dd1: +(account(tr, 0.01).ddPct * 100).toFixed(0),
      exits: Object.entries(reasons).map(([k, v]) => `${k}:${v}`).join(' '),
    });
  }
  console.log('\n2) candidates (adaptive, skip trade when SL > $40, no TP):');
  console.table(rows);
  // 4. How often is the bot allowed to trade at all, by year (ATR band)?
  const allowed = (ex: Exit) => {
    const by: Record<number, [number, number]> = {};
    c.forEach((b, t) => {
      const y = new Date(b.time * 1000).getUTCFullYear();
      by[y] ??= [0, 0];
      by[y][1]++;
      const d = Math.max(10, ex.slK * x.atr[t]);
      if (!x.weekendFill[t] && x.atr[t] >= ex.minAtr && d <= 40) by[y][0]++;
    });
    return Object.fromEntries(Object.entries(by).map(([y, [a, n]]) => [y, `${((a / n) * 100).toFixed(0)}%`]));
  };
  console.log('\n3) share of hours where a new entry is allowed (k2/min10, k2/min15):', allowed(cands[0][1]), allowed(cands[8][1]));
  const recent = x.atr.slice(-24 * 30);
  console.log(`   ATR(14) last 30 days: min ${Math.min(...recent).toFixed(1)}, median ${recent.sort((a, b) => a - b)[recent.length >> 1].toFixed(1)}, max ${Math.max(...recent).toFixed(1)}`);
}
main().catch((e) => (console.error(e), process.exit(1)));
