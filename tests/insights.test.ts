import { describe, expect, it } from 'vitest';
import { computeInsights } from '../src/core/insights.js';
import type { ExitReason, SimTrade, SystemEvent, TradeEvent, TradeRow } from '../src/shared/types.js';
import { P } from './helpers.js';

let id = 0;
const H = 1_700_000_000 - (1_700_000_000 % 3600); // an exact hour
function trade(o: Partial<TradeRow> & { exit_reason: ExitReason; net_pnl: number }): TradeRow {
  id++;
  return {
    id,
    client_order_id: `c${id}`,
    status: 'CLOSED',
    side: 'buy',
    size_contracts: 100,
    strategy: 'hull',
    dry_run: 0,
    entry_reason: '{}',
    entry_time: H + id * 7200 + 10,
    entry_price: 2000,
    sl_price: 1980,
    tp_price: 2100,
    risk_dist: 20,
    stage: 0,
    sl_order_id: null,
    tp_order_id: null,
    close_reason: null,
    close_client_order_id: null,
    exit_time: H + id * 7200 + 3600,
    exit_price: 2000,
    gross_pnl: o.net_pnl + 2.6,
    fees: 2.6,
    config_hash: 'x',
    ...o,
  };
}
const byId = (list: ReturnType<typeof computeInsights>, key: string) => list.find((i) => i.id === key)!;

describe('computeInsights', () => {
  it('below 10 closed trades returns a single "need ≥10" item', () => {
    const r = computeInsights([trade({ exit_reason: 'tp', net_pnl: 97 })], [], [], [], P);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ id: 'min_trades', severity: 'info' });
  });

  it('flags each rule above its threshold and not below it', () => {
    id = 0;
    const losers = Array.from({ length: 6 }, () => trade({ exit_reason: 'sl_stage_0', net_pnl: -22.6, gross_pnl: -20 }));
    const stage1 = Array.from({ length: 3 }, () => trade({ exit_reason: 'sl_stage_1', net_pnl: -0.1, gross_pnl: 2.5 }));
    const rev = trade({ exit_reason: 'reversal', net_pnl: -5, gross_pnl: -2.4 });
    const trades = [...losers, ...stage1, rev];
    const events: TradeEvent[] = stage1.map((t, i) => ({
      id: i,
      trade_id: t.id,
      time: t.exit_time! - 3600, // reached stage 1 one candle before the exit
      type: 'sl_move',
      data: JSON.stringify({ stage: 1 }),
    }));
    const sys: SystemEvent[] = [{ id: 1, time: H, type: 'halt', data: JSON.stringify({ kind: 'breaker' }) }];
    const sim: SimTrade[] = [
      { strategy: 'hull', entryTime: H + 1 * 7200, side: 'buy', entry: 2000, exitTime: 0, exit: 0, reason: 'tp', grossPnl: 0, fees: 0, netPnl: 50 },
    ];
    const r = computeInsights(trades, events, sys, sim, { ...P, TP_R: 5 });

    expect(byId(r, 'fee_drag').severity).toBe('warn'); // fees 26 vs gross profit 7.5
    expect(byId(r, 'breakeven_stopouts')).toMatchObject({ severity: 'warn', metric: 1 });
    // live per-ETH = −22.6 / 1 ETH; sim +50 → gap 72.6 > 5
    expect(byId(r, 'live_vs_sim')).toMatchObject({ severity: 'warn' });
    expect(byId(r, 'live_vs_sim').metric).toBeCloseTo(72.6);
    expect(byId(r, 'reversal_cost')).toMatchObject({ severity: 'warn', metric: -5 });
    expect(byId(r, 'tp_reach').severity).toBe('warn');
    expect(byId(r, 'initial_stop_rate')).toMatchObject({ severity: 'warn', metric: 0.6 });
    expect(byId(r, 'breaker_history')).toMatchObject({ metric: 1 });
  });

  it('does not flag when below the thresholds', () => {
    id = 0;
    const winners = Array.from({ length: 8 }, () => trade({ exit_reason: 'tp', net_pnl: 97, gross_pnl: 99.6 }));
    const losers = Array.from({ length: 2 }, () => trade({ exit_reason: 'sl_stage_0', net_pnl: -22.6, gross_pnl: -20 }));
    const r = computeInsights([...winners, ...losers], [], [], [], { ...P, TP_R: 5 });
    expect(byId(r, 'fee_drag').severity).toBe('info');
    expect(byId(r, 'tp_reach').severity).toBe('info');
    expect(byId(r, 'initial_stop_rate').severity).toBe('info');
    expect(byId(r, 'losing_hours').severity).toBe('info');
    expect(byId(r, 'breaker_history')).toMatchObject({ metric: 0 });
  });

  it('with no take-profit configured, TP reach is informational', () => {
    id = 0;
    const ts = Array.from({ length: 10 }, () => trade({ exit_reason: 'reversal', net_pnl: 5 }));
    const r = computeInsights(ts, [], [], [], P);
    expect(byId(r, 'tp_reach')).toMatchObject({ severity: 'info' });
    expect(byId(r, 'tp_reach').message).toContain('no take-profit');
  });

  it('losing hours sums per-ETH P&L by UTC entry hour below −2 × SL_MAX (−$80)', () => {
    id = 0;
    const sameHour = (i: number) => H + i * 86400 + 10; // same UTC hour every day
    const bad = Array.from({ length: 4 }, (_, i) => trade({ exit_reason: 'sl_stage_0', net_pnl: -22.6, entry_time: sameHour(i) }));
    const rest = Array.from({ length: 6 }, () => trade({ exit_reason: 'tp', net_pnl: 97 }));
    const r = computeInsights([...bad, ...rest], [], [], [], P);
    expect(byId(r, 'losing_hours').severity).toBe('warn');
  });
});
