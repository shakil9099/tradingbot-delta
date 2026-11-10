// npm run backtest -- --pages <k>
// Fetches k pages of 2,000 closed 1h ETHUSD candles from Delta India (public, no auth), then compares
// adaptive vs fixed Hull vs fixed UT, per 1 ETH, after fees and slippage.

import { mkdirSync, writeFileSync } from 'node:fs';
import { DEFAULT_PARAMS } from '../src/config/params.js';
import { entryGate } from '../src/core/entryGate.js';
import { computeAll } from '../src/core/signals.js';
import { simulate, simulateAdaptive, type SimOptions } from '../src/core/simulator.js';
import { simSummary } from '../src/core/stats.js';
import type { SimTrade } from '../src/shared/types.js';
import { HOUR, argPages, fetchHistory } from './lib/candles.js';

function row(name: string, trades: SimTrade[], switches: number | null) {
  const s = simSummary(trades);
  return {
    mode: name,
    trades: s.count,
    winRate: `${(s.winRate * 100).toFixed(1)}%`,
    netPerEth: s.netPnl.toFixed(2),
    avgWin: s.avgWin.toFixed(2),
    avgLoss: s.avgLoss.toFixed(2),
    profitFactor: s.profitFactor === null ? '—' : s.profitFactor.toFixed(2),
    maxDrawdown: s.maxDrawdown.toFixed(2),
    fees: s.fees.toFixed(2),
    switches: switches === null ? '—' : String(switches),
  };
}

async function main() {
  const pages = argPages();
  const p = DEFAULT_PARAMS;
  const candles = await fetchHistory(pages);
  if (candles.length < p.WARMUP + 50) throw new Error(`only ${candles.length} candles; not enough for a backtest`);

  // Gaps are reported, not filled (same rule as live).
  let gaps = 0;
  for (let i = 1; i < candles.length; i++) if (candles[i].time - candles[i - 1].time !== HOUR) gaps++;

  const ind = computeAll(candles, p);
  const optsFor = (q: typeof p): SimOptions => {
    const g = entryGate(candles, q);
    return { allowEntryAt: (i) => g(i) === null };
  };
  // Same entry filters as live (weekend, MIN_ATR, stop ≤ SL_MAX, liquidation guard; env overrides for SKIP_WEEKEND_ENTRIES,
  // ATR_GATE_MAX, MIN_ATR). Per-ETH results; npm run livesim shows the account with risk sizing.
  const live = {
    ...p,
    SKIP_WEEKEND_ENTRIES: (process.env.SKIP_WEEKEND_ENTRIES ?? String(p.SKIP_WEEKEND_ENTRIES)) === 'true',
    ATR_GATE_MAX: Number(process.env.ATR_GATE_MAX ?? p.ATR_GATE_MAX),
    MIN_ATR: Number(process.env.MIN_ATR ?? p.MIN_ATR),
  };
  const opts = optsFor(live);
  const hull = simulate('hull', candles, ind.sigHull, p, opts);
  const ut = simulate('ut', candles, ind.sigUt, p, opts);
  const adaptive = simulateAdaptive(candles, ind, p, opts);

  const from = new Date(candles[0].time * 1000).toISOString();
  const to = new Date(candles[candles.length - 1].time * 1000).toISOString();
  console.log(`\nETHUSD 1h, ${candles.length} candles, ${from} → ${to}, gaps: ${gaps}`);
  console.log(`Per 1 ETH, after fees (${(p.FEE_RATE * 100).toFixed(3)}%/side) and ${p.SLIPPAGE_TICKS} tick slippage per fill. Warm-up ${p.WARMUP} bars.`);
  console.log(`Entry filters: weekend (Sat/Sun IST) ${live.SKIP_WEEKEND_ENTRIES ? 'blocked' : 'allowed'}, min ATR ${live.MIN_ATR}, stop ${p.SL_ATR_MULT}×ATR (\$${p.SL_MIN}–\$${p.SL_MAX}), BE ${p.BE_TRIG_R}R, trail hh − ${p.TRAIL_ATR_MULT}×ATR after ${p.TRAIL_TRIG_R}R, TP ${p.TP_R || "none"}, high-ATR gate ${live.ATR_GATE_MAX > 0 ? `≤ ${live.ATR_GATE_MAX}` : "off"}.\n`);
  console.table([row('adaptive', adaptive.trades, adaptive.switches), row('hull', hull, null), row('ut', ut, null)]);

  const best = [
    { name: 'hull', net: simSummary(hull).netPnl },
    { name: 'ut', net: simSummary(ut).netPnl },
  ].sort((a, b) => b.net - a.net)[0];
  const adaptiveNet = simSummary(adaptive.trades).netPnl;
  console.log(
    adaptiveNet >= best.net
      ? `\nAdaptive (${adaptiveNet.toFixed(2)}) ≥ best fixed (${best.name} ${best.net.toFixed(2)}): STRATEGY=adaptive is supported by this sample.`
      : `\nAdaptive (${adaptiveNet.toFixed(2)}) trails best fixed (${best.name} ${best.net.toFixed(2)}): consider STRATEGY=${best.name}.`,
  );
  console.log('Note: per-ETH figures. The bot sizes by risk (RISK_PER_TRADE); see npm run livesim for account results.');

  mkdirSync('data', { recursive: true, mode: 0o700 });
  const file = `data/backtest-${new Date().toISOString().slice(0, 10)}.csv`;
  const lines = ['mode,strategy,side,entry_time,entry,exit_time,exit,reason,gross,fees,net'];
  const add = (mode: string, ts: SimTrade[]) =>
    ts.forEach((t) =>
      lines.push(
        [mode, t.strategy, t.side, new Date(t.entryTime * 1000).toISOString(), t.entry.toFixed(2), new Date(t.exitTime * 1000).toISOString(), t.exit.toFixed(2), t.reason, t.grossPnl.toFixed(4), t.fees.toFixed(4), t.netPnl.toFixed(4)].join(','),
      ),
    );
  add('adaptive', adaptive.trades);
  add('hull', hull);
  add('ut', ut);
  writeFileSync(file, lines.join('\n') + '\n');
  console.log(`Trades written to ${file}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
