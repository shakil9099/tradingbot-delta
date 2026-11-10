// File 69. Phase 1 holds only the stats cases; lock, bootGuard, halt/resume, scheduler, backup and env
// cases are added with their modules in phase 2.
import { describe, expect, it } from 'vitest';
import { computeStats, maxDrawdown } from '../src/core/stats.js';
import type { TradeRow } from '../src/shared/types.js';

const row = (i: number, net: number, strategy: TradeRow['strategy'] = 'hull'): TradeRow =>
  ({ id: i, status: 'CLOSED', strategy, net_pnl: net, fees: 1, exit_time: 1000 + i, size_contracts: 100 }) as TradeRow;

describe('stats', () => {
  it('profit factor, win rate and max drawdown on a fixed list', () => {
    const s = computeStats([row(1, 10), row(2, -5), row(3, -5), row(4, 20), row(5, -10, 'ut')]);
    expect(s.total.count).toBe(5);
    expect(s.total.winRate).toBeCloseTo(0.4);
    expect(s.total.profitFactor).toBeCloseTo(30 / 20);
    expect(s.total.netPnl).toBeCloseTo(10);
    // equity: 10, 5, 0, 20, 10 → peak 20, trough 10 → dd 10 (the earlier 10→0 is also 10)
    expect(s.maxDrawdown).toBeCloseTo(10);
    expect(s.byStrategy.ut.count).toBe(1);
    expect(s.feesPaid).toBe(5);
    expect(s.equity.at(-1)).toEqual({ time: 1005, equity: 10 });
  });
  it('profit factor is null with no losses; drawdown counts from 0', () => {
    expect(computeStats([row(1, 5)]).total.profitFactor).toBeNull();
    expect(maxDrawdown([-3, -2, 4])).toBe(5);
  });
  it('ignores trades that are not CLOSED', () => {
    expect(computeStats([{ ...row(1, 5), status: 'OPEN' }]).total.count).toBe(0);
  });
});
