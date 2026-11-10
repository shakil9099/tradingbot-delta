// npm run research4 -- --pages 13
// Weekend rule (no new entries Sat/Sun IST) × ATR gate, author's exact system, adaptive + fixed.
// Same method as research3: train first 70%, test last 30%, per 1 ETH after fees and slippage.

import { DEFAULT_PARAMS } from '../src/config/params.js';
import { entryGate } from '../src/core/entryGate.js';
import { computeAll } from '../src/core/signals.js';
import { simulate, simulateAdaptive, type SimOptions } from '../src/core/simulator.js';
import { simSummary } from '../src/core/stats.js';
import type { SimTrade } from '../src/shared/types.js';
import { argPages, fetchHistory } from './lib/candles.js';

type Row = Record<string, string | number>;

async function main() {
  const c = await fetchHistory(argPages());
  const t0 = c[0].time, t1 = c.at(-1)!.time + 3600;
  const split = t0 + Math.floor((t1 - t0) * 0.7);
  const yr = (a: number, b: number) => (b - a) / (365 * 86400);
  const yTr = yr(t0, split), yTe = yr(split, t1);
  const years = [...new Set(c.map((x) => new Date(x.time * 1000).getUTCFullYear()))];
  const ind = computeAll(c, DEFAULT_PARAMS);

  const describe = (base: Row, trades: SimTrade[]): Row => {
    const tr = simSummary(trades.filter((x) => x.entryTime < split));
    const te = simSummary(trades.filter((x) => x.entryTime >= split));
    const all = simSummary(trades);
    const row: Row = {
      ...base,
      trades: all.count,
      tradesYr: +(all.count / (yTr + yTe)).toFixed(0),
      win: `${(all.winRate * 100).toFixed(0)}%`,
      trainYr: +(tr.netPnl / yTr).toFixed(0),
      testYr: +(te.netPnl / yTe).toFixed(0),
      PF: all.profitFactor === null ? 0 : +all.profitFactor.toFixed(2),
      maxDD: +all.maxDrawdown.toFixed(0),
    };
    for (const y of years) row[y] = +trades.filter((x) => new Date(x.entryTime * 1000).getUTCFullYear() === y).reduce((s, x) => s + x.netPnl, 0).toFixed(0);
    return row;
  };

  const rows: Row[] = [];
  for (const weekend of [false, true]) {
    for (const atr of [0, 12, 16]) {
      const g = entryGate(c, { ATR_GATE_MAX: atr, ATR_GATE_LEN: 14, SKIP_WEEKEND_ENTRIES: weekend });
      const opts: SimOptions = g ? { allowEntryAt: (i) => g(i) === null } : {};
      const base = { weekendEntries: weekend ? 'blocked' : 'allowed', atrGate: atr || 'off' };
      rows.push(describe({ mode: 'adaptive', ...base }, simulateAdaptive(c, ind, DEFAULT_PARAMS, opts).trades));
      rows.push(describe({ mode: 'hull', ...base }, simulate('hull', c, ind.sigHull, DEFAULT_PARAMS, opts)));
      rows.push(describe({ mode: 'ut', ...base }, simulate('ut', c, ind.sigUt, DEFAULT_PARAMS, opts)));
    }
  }
  console.log(`\n${c.length} candles ${new Date(t0 * 1000).toISOString().slice(0, 10)} → ${new Date(t1 * 1000).toISOString().slice(0, 10)}; split ${new Date(split * 1000).toISOString().slice(0, 10)}. $/ETH, after fees + slippage.`);
  console.table(rows);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
