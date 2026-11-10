// Rule-based "what can be improved" notes (design: Insight rules 1–8). Pure.

import type { Insight, SimTrade, SystemEvent, TradeEvent, TradeRow } from '../shared/types.js';

export interface InsightParams {
  SL_MAX: number;
  TP_R: number;
  CONTRACT_VALUE: number;
}

const MIN_TRADES = 10;
const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
const usd = (x: number) => `${x < 0 ? '−' : ''}$${Math.abs(x).toFixed(2)}`;
const floorHour = (t: number) => Math.floor(t / 3600) * 3600;

function parse(json: string): Record<string, unknown> {
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function computeInsights(
  trades: readonly TradeRow[],
  tradeEvents: readonly TradeEvent[],
  systemEvents: readonly SystemEvent[],
  simTrades: readonly SimTrade[],
  p: InsightParams,
): Insight[] {
  const closed = trades.filter((t) => t.status === 'CLOSED' && t.net_pnl !== null && t.exit_reason !== null);
  if (closed.length < MIN_TRADES) {
    return [{ id: 'min_trades', severity: 'info', message: `need ≥10 closed trades (have ${closed.length})`, metric: closed.length }];
  }
  const out: Insight[] = [];
  const ethSize = (t: TradeRow) => t.size_contracts * p.CONTRACT_VALUE;
  const perEth = (t: TradeRow) => (ethSize(t) > 0 ? t.net_pnl! / ethSize(t) : 0);

  // 1. Fee drag
  const grossProfit = closed.reduce((s, t) => s + Math.max(0, t.gross_pnl ?? 0), 0);
  const fees = closed.reduce((s, t) => s + (t.fees ?? 0), 0);
  if (grossProfit <= 0) {
    out.push({ id: 'fee_drag', severity: 'warn', message: `no gross profit yet; fees paid ${usd(fees)}`, metric: null });
  } else {
    const r = fees / grossProfit;
    out.push({ id: 'fee_drag', severity: r >= 0.3 ? 'warn' : 'info', message: `fees ate ${pct(r)} of gross profit`, metric: r });
  }

  // 2. Breakeven stop-outs: of trades that reached stage 1, share closed at sl_stage_1 within 2 candles.
  const reachedAt = new Map<number, number>();
  for (const e of tradeEvents) {
    if (e.type !== 'sl_move') continue;
    const stage = Number(parse(e.data).stage); // sl_move data carries the new stage
    if (stage >= 1 && !reachedAt.has(e.trade_id)) reachedAt.set(e.trade_id, e.time);
  }
  const reached = closed.filter((t) => reachedAt.has(t.id));
  if (reached.length === 0) {
    out.push({ id: 'breakeven_stopouts', severity: 'info', message: 'no trades reached stage 1 yet', metric: null });
  } else {
    const quick = reached.filter((t) => t.exit_reason === 'sl_stage_1' && t.exit_time! - reachedAt.get(t.id)! <= 2 * 3600);
    const r = quick.length / reached.length;
    out.push({
      id: 'breakeven_stopouts',
      severity: r >= 0.4 ? 'warn' : 'info',
      message:
        r >= 0.4
          ? `${pct(r)} of stage-1 trades were stopped within 2 candles; consider a later break-even trigger (BE_TRIG_R)`
          : `${pct(r)} of stage-1 trades were stopped within 2 candles`,
      metric: r,
    });
  }

  // 3. Live vs simulated, per ETH, matched by strategy and entry candle.
  const diffs: number[] = [];
  for (const t of closed) {
    if ((t.strategy !== 'hull' && t.strategy !== 'ut') || t.entry_time === null) continue;
    const sim = simTrades.find((s) => s.strategy === t.strategy && s.entryTime === floorHour(t.entry_time!));
    if (sim) diffs.push(sim.netPnl - perEth(t));
  }
  if (diffs.length === 0) {
    out.push({ id: 'live_vs_sim', severity: 'info', message: 'no live trades matched a simulated trade yet', metric: null });
  } else {
    const avg = diffs.reduce((s, d) => s + d, 0) / diffs.length;
    out.push({
      id: 'live_vs_sim',
      severity: avg > 5 ? 'warn' : 'info',
      message:
        avg > 5
          ? `live trails simulated by ${usd(avg)} per ETH per trade (${diffs.length} matched); check slippage and entry timing`
          : `live vs simulated gap ${usd(avg)} per ETH per trade (${diffs.length} matched)`,
      metric: avg,
    });
  }

  // 4. Reversal cost
  const rev = closed.filter((t) => t.exit_reason === 'reversal');
  if (rev.length === 0) {
    out.push({ id: 'reversal_cost', severity: 'info', message: 'no reversal exits yet', metric: null });
  } else {
    const avg = rev.reduce((s, t) => s + t.net_pnl!, 0) / rev.length;
    out.push({
      id: 'reversal_cost',
      severity: avg < 0 ? 'warn' : 'info',
      message: `reversal exits average ${usd(avg)} net (${rev.length} trades)`,
      metric: avg,
    });
  }

  // 5. Losing hours (UTC hour of entry), per-ETH sum below −2 × SL_MAX.
  const byHour = new Map<number, number>();
  for (const t of closed) {
    if (t.entry_time === null) continue;
    const h = new Date(t.entry_time * 1000).getUTCHours();
    byHour.set(h, (byHour.get(h) ?? 0) + perEth(t));
  }
  const bad = [...byHour.entries()].filter(([, v]) => v < -2 * p.SL_MAX).sort((a, b) => a[1] - b[1]);
  out.push({
    id: 'losing_hours',
    severity: bad.length ? 'warn' : 'info',
    message: bad.length
      ? `losing UTC hours: ${bad.map(([h, v]) => `${String(h).padStart(2, '0')}:00 (${usd(v)}/ETH)`).join(', ')}`
      : 'no UTC hour lost more than two maximum stops',
    metric: bad.length,
  });

  // 6. Take-profit reach
  const tpShare = closed.filter((t) => t.exit_reason === 'tp').length / closed.length;
  out.push({
    id: 'tp_reach',
    severity: p.TP_R > 0 && tpShare < 0.05 ? 'warn' : 'info',
    message: p.TP_R <= 0 ? 'no take-profit is set; exits come from the stops and opposite signals' : tpShare < 0.05 ? 'TP is rarely reached; most profit comes from the trail' : `${pct(tpShare)} of trades reached TP`,
    metric: tpShare,
  });

  // 7. Initial-stop rate
  const s0 = closed.filter((t) => t.exit_reason === 'sl_stage_0').length / closed.length;
  out.push({
    id: 'initial_stop_rate',
    severity: s0 > 0.5 ? 'warn' : 'info',
    message: s0 > 0.5 ? `${pct(s0)} of trades hit the initial stop; it may be inside normal 1h noise` : `${pct(s0)} of trades hit the initial stop`,
    metric: s0,
  });

  // 8. Breaker history
  const halts = systemEvents.filter((e) => e.type === 'halt' && parse(e.data).kind === 'breaker');
  out.push({
    id: 'breaker_history',
    severity: 'info',
    message: halts.length
      ? `breaker halted ${halts.length}×: ${halts.map((e) => new Date(e.time * 1000).toISOString().slice(0, 10)).join(', ')}`
      : 'breaker has not halted',
    metric: halts.length,
  });

  return out;
}
