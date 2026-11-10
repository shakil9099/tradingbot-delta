import type { SimTrade, StatsResponse, StrategyStats, TradeRow, TradeStrategy } from '../shared/types.js';

function summarize(nets: readonly number[]): StrategyStats {
  const wins = nets.filter((n) => n > 0);
  const losses = nets.filter((n) => n <= 0);
  const sumWins = wins.reduce((s, n) => s + n, 0);
  const sumLosses = losses.reduce((s, n) => s + n, 0);
  return {
    count: nets.length,
    wins: wins.length,
    winRate: nets.length ? wins.length / nets.length : 0,
    netPnl: sumWins + sumLosses,
    avgWin: wins.length ? sumWins / wins.length : 0,
    avgLoss: losses.length ? sumLosses / losses.length : 0,
    profitFactor: sumLosses < 0 ? sumWins / Math.abs(sumLosses) : null,
  };
}

/** Max peak-to-trough drop of a cumulative series that starts at 0. */
export function maxDrawdown(nets: readonly number[]): number {
  let equity = 0;
  let peak = 0;
  let dd = 0;
  for (const n of nets) {
    equity += n;
    peak = Math.max(peak, equity);
    dd = Math.max(dd, peak - equity);
  }
  return dd;
}

/** Dashboard stats over closed live trades, ordered by exit time. */
export function computeStats(trades: readonly TradeRow[]): StatsResponse {
  const closed = trades
    .filter((t) => t.status === 'CLOSED' && t.net_pnl !== null && t.exit_time !== null)
    .sort((a, b) => a.exit_time! - b.exit_time!);
  const nets = closed.map((t) => t.net_pnl!);
  const by = (s: TradeStrategy) => summarize(closed.filter((t) => t.strategy === s).map((t) => t.net_pnl!));
  let equity = 0;
  return {
    total: summarize(nets),
    byStrategy: { hull: by('hull'), ut: by('ut'), unknown: by('unknown') },
    feesPaid: closed.reduce((s, t) => s + (t.fees ?? 0), 0),
    maxDrawdown: maxDrawdown(nets),
    equity: closed.map((t) => {
      equity += t.net_pnl!;
      return { time: t.exit_time!, equity };
    }),
  };
}

/** Backtest summary over simulated trades (per ETH). */
export function simSummary(trades: readonly SimTrade[]): StrategyStats & { maxDrawdown: number; fees: number } {
  const sorted = [...trades].sort((a, b) => a.exitTime - b.exitTime);
  const nets = sorted.map((t) => t.netPnl);
  return { ...summarize(nets), maxDrawdown: maxDrawdown(nets), fees: sorted.reduce((s, t) => s + t.fees, 0) };
}
