// Close bookkeeping shared by the executor (bot-initiated closes) and the reconciler (exchange-side exits).

import { nextCount, shouldHalt } from '../core/breaker.js';
import type { Fill } from '../exchange/types.js';
import { alert, log } from '../log.js';
import type { ExitReason, Stage, TradeRow } from '../shared/types.js';
import { opposite, type Ctx } from './context.js';

/** Writes CLOSED, exit fields, P&L and fees, then updates the breaker. */
export function settle(c: Ctx, trade: TradeRow, reason: ExitReason, exitFills: readonly Fill[], fallbackPrice: number): TradeRow {
  const p = c.params;
  const size = trade.size_contracts;
  const qty = exitFills.reduce((s, f) => s + f.size, 0);
  const exitPrice = qty > 0 ? exitFills.reduce((s, f) => s + f.price * f.size, 0) / qty : fallbackPrice;
  const exitFees = exitFills.length ? exitFills.reduce((s, f) => s + f.commission, 0) : exitPrice * size * p.CONTRACT_VALUE * p.FEE_RATE;
  const entry = trade.entry_price ?? exitPrice;
  const gross = (trade.side === 'buy' ? exitPrice - entry : entry - exitPrice) * size * p.CONTRACT_VALUE;
  const fees = (trade.fees ?? 0) + exitFees;
  const net = gross - fees;
  const exitTime = exitFills.length ? Math.max(...exitFills.map((f) => f.time)) : c.now();

  c.repo.updateTrade(trade.id, {
    status: 'CLOSED',
    exit_time: exitTime,
    exit_price: +exitPrice.toFixed(4),
    exit_reason: reason,
    gross_pnl: +gross.toFixed(6),
    fees: +fees.toFixed(6),
    net_pnl: +net.toFixed(6),
  });
  if (!exitFills.length) c.repo.addTradeEvent(trade.id, 'error', { note: 'no exit fills found; exit price and fees estimated', fallbackPrice });

  const count = nextCount(c.repo.kvNum('consecutive_sl', 0), reason, net);
  c.repo.kvSet('consecutive_sl', count);
  alert(`CLOSED ${trade.side} ${size} ct @ ${exitPrice.toFixed(2)} (${reason}) net ${net.toFixed(2)} USD`, { tradeId: trade.id });
  if (reason === 'liquidation') c.halt.halt('position was liquidated', 'liquidation');
  else if (shouldHalt(count, p.BREAKER_N)) c.halt.halt(`breaker: ${count} consecutive stop-losses`, 'breaker');
  return c.repo.getTrade(trade.id)!;
}

/** Previous SL order ids of a trade (from sl_move events) plus the current one. */
function slIds(c: Ctx, trade: TradeRow): Set<string> {
  const ids = new Set<string>();
  if (trade.sl_order_id) ids.add(trade.sl_order_id);
  for (const e of c.repo.listTradeEvents(trade.id)) {
    if (e.type !== 'sl_move' && e.type !== 'bracket_attach') continue;
    try {
      const d = JSON.parse(e.data) as Record<string, unknown>;
      for (const k of ['oldId', 'newId', 'slOrderId']) if (d[k]) ids.add(String(d[k]));
    } catch {
      /* ignore */
    }
  }
  return ids;
}

/**
 * Classifies a trade the exchange closed (exit classification table). Returns null when no exit fills
 * are visible yet (the caller waits and retries).
 */
export async function classifyExchangeClose(c: Ctx, trade: TradeRow): Promise<{ reason: ExitReason; fills: Fill[] } | null> {
  const since = (trade.entry_time ?? c.now() - 86400) - 5;
  const all = await c.port.getFills(since);
  const exitSide = opposite(trade.side);
  const fills = all.filter((f) => f.side === exitSide && f.time >= since);
  if (!fills.length) return null;
  const sl = slIds(c, trade);
  const stage = trade.stage as Stage;
  if (fills.some((f) => f.liquidation)) return { reason: 'liquidation', fills };
  if (fills.some((f) => sl.has(f.orderId))) return { reason: `sl_stage_${stage}` as ExitReason, fills };
  if (trade.tp_order_id && fills.some((f) => f.orderId === trade.tp_order_id)) return { reason: 'tp', fills };
  const qty = fills.reduce((s, f) => s + f.size, 0);
  const vwap = fills.reduce((s, f) => s + f.price * f.size, 0) / qty;
  if (trade.sl_price !== null && Math.abs(vwap - trade.sl_price) <= 1) {
    log.warn({ tradeId: trade.id }, 'exit matched SL by price (safety net), not by order id');
    return { reason: `sl_stage_${stage}` as ExitReason, fills };
  }
  return { reason: 'external', fills };
}
