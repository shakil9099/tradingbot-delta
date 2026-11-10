import { describe, expect, it } from 'vitest';
import { computeAll } from '../src/core/signals.js';
import { score, simulate, simulateAdaptive, type SimParams } from '../src/core/simulator.js';
import type { Signal } from '../src/shared/types.js';
import { P, bar, candlesFromCloses } from './helpers.js';

const SP: SimParams = { ...P, WARMUP: 0 };
const T = (i: number) => 1_700_000_000 + i * 3600;
const sigs = (n: number, at: Record<number, Signal>): Signal[] => Array.from({ length: n }, (_, i) => at[i] ?? 'NONE');
const fee = (a: number, b: number) => (a + b) * P.FEE_RATE;

// ATR fixed per test so R = max(SL_MIN, 2 × ATR) is known: ATR 10 → R 20.
const atr = (n: number, v = 10) => ({ atr: Array.from({ length: n }, () => v) });

describe('simulate (Strategy v2 exits)', () => {
  it('enters at the next open with slippage; SL = entry − R; SL first when the entry bar spans it', () => {
    const c = [bar(T(0), 100, 101, 99, 100), bar(T(1), 100, 201, 79, 150)];
    const [tr] = simulate('hull', c, sigs(2, { 0: 'LONG' }), SP, atr(2));
    expect(tr.entry).toBeCloseTo(100.05);
    expect(tr.reason).toBe('sl_stage_0');
    expect(tr.exit).toBeCloseTo(80.0); // SL 80.05 minus 1 tick slippage
    expect(tr.riskDist).toBe(20);
    expect(tr.grossPnl).toBeCloseTo(80 - 100.05);
    expect(tr.fees).toBeCloseTo(fee(100.05, 80));
    expect(tr.netPnl).toBeCloseTo(tr.grossPnl - tr.fees);
  });

  it('fills at the open when the bar gaps through the stop', () => {
    const c = [bar(T(0), 100, 101, 99, 100), bar(T(1), 100, 101, 99, 100), bar(T(2), 70, 71, 69, 70)];
    const [tr] = simulate('hull', c, sigs(3, { 0: 'LONG' }), SP, atr(3));
    expect(tr.exit).toBeCloseTo(69.95);
    expect(tr.exitTime).toBe(T(2));
  });

  it('no TP by default; with TP_R = 5 it takes profit at entry + 5R', () => {
    const c = [bar(T(0), 100, 101, 99, 100), bar(T(1), 100, 101, 99, 100), bar(T(2), 150, 210, 140, 205)];
    expect(simulate('hull', c, sigs(3, { 0: 'LONG' }), SP, atr(3))).toHaveLength(0); // still open
    const [tr] = simulate('hull', c, sigs(3, { 0: 'LONG' }), { ...SP, TP_R: 5 }, atr(3));
    expect(tr.reason).toBe('tp');
    expect(tr.exit).toBeCloseTo(200.05 - 0.05);
  });

  it('trails on the close (hh − 3 × ATR after 1.5R) and exits at the trailed stop', () => {
    const c = [
      bar(T(0), 100, 101, 99, 100),
      bar(T(1), 100, 132, 99, 131), // close +30.95 ≥ 1.5R → SL = 132 − 30 = 102 (stage 2)
      bar(T(2), 125, 126, 101, 110), // low 101 ≤ 102 → exit
    ];
    const [tr] = simulate('hull', c, sigs(3, { 0: 'LONG' }), SP, atr(3));
    expect(tr.reason).toBe('sl_stage_2');
    expect(tr.exit).toBeCloseTo(101.95);
  });

  it('break-even on the close after 0.5R, exit at entry + fees', () => {
    const c = [
      bar(T(0), 100, 101, 99, 100),
      bar(T(1), 100, 112, 99, 111), // +10.95 ≥ 0.5R → SL = 100.05 + 0.218 → 100.3 (stage 1)
      bar(T(2), 105, 106, 100, 101),
    ];
    const [tr] = simulate('hull', c, sigs(3, { 0: 'LONG' }), SP, atr(3));
    expect(tr.reason).toBe('sl_stage_1');
    expect(tr.exit).toBeCloseTo(100.25);
  });

  it('R follows ATR: a wider stop survives a dip the narrower one does not', () => {
    const c = [bar(T(0), 100, 101, 99, 100), bar(T(1), 100, 101, 75, 76), bar(T(2), 76, 77, 75, 76)];
    expect(simulate('hull', c, sigs(3, { 0: 'LONG' }), SP, atr(3, 10))).toHaveLength(1); // R 20 → SL 80.05 hit
    expect(simulate('hull', c, sigs(3, { 0: 'LONG' }), SP, atr(3, 15))).toHaveLength(0); // R 30 → SL 70.05 holds
  });

  it('an entry whose stop would exceed SL_MAX is skipped, and a reversal then only closes', () => {
    const c = [bar(T(0), 100, 101, 99, 100), bar(T(1), 100, 102, 98, 101), bar(T(2), 101, 103, 99, 100), bar(T(3), 100, 101, 99, 100)];
    expect(simulate('hull', c, sigs(4, { 0: 'LONG' }), SP, atr(4, 25))).toHaveLength(0); // R 50 > 40
    const a = [10, 25, 25, 25]; // entry allowed at bar 0 only
    const trades = simulate('hull', c, sigs(4, { 0: 'LONG', 1: 'SHORT' }), SP, { atr: a });
    expect(trades).toHaveLength(1);
    expect(trades[0].reason).toBe('reversal');
  });

  it('reverses at the next open on an opposite signal', () => {
    const c = [bar(T(0), 100, 101, 99, 100), bar(T(1), 100, 102, 98, 101), bar(T(2), 101, 103, 99, 100), bar(T(3), 100, 101, 99, 100)];
    const trades = simulate('hull', c, sigs(4, { 0: 'LONG', 1: 'SHORT' }), SP, atr(4));
    expect(trades).toHaveLength(1);
    expect(trades[0].reason).toBe('reversal');
    expect(trades[0].exit).toBeCloseTo(100.95); // open 101 − slip
  });

  it('waits for the next flip after an SL exit (no re-entry on the existing trend)', () => {
    const c = [bar(T(0), 100, 101, 99, 100), bar(T(1), 100, 101, 75, 76), bar(T(2), 76, 77, 75, 76), bar(T(3), 76, 77, 75, 76)];
    const trades = simulate('hull', c, sigs(4, { 0: 'LONG' }), SP, atr(4));
    expect(trades).toHaveLength(1);
  });

  it('allowEntryAt blocks entries, and a blocked reversal only closes', () => {
    const c = [bar(T(0), 100, 101, 99, 100), bar(T(1), 100, 102, 98, 101), bar(T(2), 101, 103, 99, 100), bar(T(3), 100, 101, 99, 100)];
    expect(simulate('hull', c, sigs(4, { 0: 'LONG' }), SP, { ...atr(4), allowEntryAt: () => false })).toHaveLength(0);
    const trades = simulate('hull', c, sigs(4, { 0: 'LONG', 1: 'SHORT', 2: 'SHORT' }), SP, { ...atr(4), allowEntryAt: (t) => t === 0 });
    expect(trades).toHaveLength(1);
    expect(trades[0].reason).toBe('reversal');
  });

  it('ignores signals before WARMUP', () => {
    const c = [bar(T(0), 100, 101, 99, 100), bar(T(1), 100, 101, 70, 70)];
    expect(simulate('hull', c, sigs(2, { 0: 'LONG' }), { ...SP, WARMUP: 5 }, atr(2))).toHaveLength(0);
  });
});

describe('score', () => {
  it('sums the last n trades by exit time and counts all trades', () => {
    const mk = (exitTime: number, netPnl: number) =>
      ({ strategy: 'hull', entryTime: 0, side: 'buy', entry: 0, exitTime, exit: 0, reason: 'tp', grossPnl: 0, fees: 0, netPnl }) as const;
    const r = score([mk(3, 1), mk(1, 100), mk(2, 2)], 2);
    expect(r).toEqual({ score: 3, count: 3 });
  });
});

describe('simulateAdaptive', () => {
  const closes = Array.from({ length: 900 }, (_, i) => 2000 + 60 * Math.sin(i / 23) + 25 * Math.sin(i / 7));
  const candles = candlesFromCloses(closes);
  const ind = computeAll(candles, P);

  it('equals fixed Hull when both strategies have identical signals (scores tie, no switch)', () => {
    const same = { ...ind, sigUt: ind.sigHull };
    const a = simulateAdaptive(candles, same, P);
    const h = simulate('hull', candles, ind.sigHull, P);
    expect(a.switches).toBe(0);
    expect(a.trades).toEqual(h);
  });

  it('returns trades and a switch count on real indicator output', () => {
    const a = simulateAdaptive(candles, ind, P);
    expect(a.trades.length).toBeGreaterThan(0);
    expect(a.switches).toBeGreaterThanOrEqual(0);
    a.trades.forEach((t) => expect(['hull', 'ut']).toContain(t.strategy));
  });
});
