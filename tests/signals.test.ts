import { describe, expect, it } from 'vitest';
import { computeAll, direction, hullSignals, utSignals } from '../src/core/signals.js';
import { P, candlesFromCloses } from './helpers.js';

describe('hullSignals', () => {
  it('LONG on the bar HULL crosses above HULL[t−2], SHORT on the reverse', () => {
    //            0   1   2   3   4   5   6   7
    const hull = [10, 9, 8, 7, 9, 11, 10, 8];
    const s = hullSignals(hull);
    // t4: 9 > 8 (up), t3: 7 > 9? no → LONG
    expect(s[4]).toBe('LONG');
    expect(s[5]).toBe('NONE');
    // t7: 8 > 11? no; t6: 10 > 9 yes → SHORT
    expect(s[7]).toBe('SHORT');
  });
  it('a flat Hull (HULL[t] == HULL[t−2]) counts as "not up"', () => {
    const s = hullSignals([1, 2, 3, 4, 3]);
    // t3: 4 > 2 up; t4: 3 > 3? no → SHORT
    expect(s[4]).toBe('SHORT');
  });
  it('NaN inputs never produce a signal', () => {
    expect(hullSignals([NaN, NaN, NaN, 1, 2, 3])).toEqual(['NONE', 'NONE', 'NONE', 'NONE', 'NONE', 'NONE']);
  });
});

describe('utSignals', () => {
  it('crossover and crossunder of close against the stop, equality counted as "not above"', () => {
    const close = [100, 98, 105, 101];
    const stop = [98, 102, 99.6, 103];
    // t1: 98 < 102 and 100 >= 98 → SHORT; t2: 105 > 99.6 and 98 <= 102 → LONG; t3: 101 < 103 and 105 >= 99.6 → SHORT
    expect(utSignals(close, stop)).toEqual(['NONE', 'SHORT', 'LONG', 'SHORT']);
  });
});

describe('computeAll', () => {
  const closes = Array.from({ length: 400 }, (_, i) => 2000 + 40 * Math.sin(i / 15) + (i % 7) - 3);
  const out = computeAll(candlesFromCloses(closes), P);

  it('suppresses every signal before WARMUP', () => {
    expect(out.sigHull.slice(0, P.WARMUP).every((s) => s === 'NONE')).toBe(true);
    expect(out.sigUt.slice(0, P.WARMUP).every((s) => s === 'NONE')).toBe(true);
    expect(out.sigHull.slice(P.WARMUP).some((s) => s !== 'NONE')).toBe(true);
    expect(out.sigUt.slice(P.WARMUP).some((s) => s !== 'NONE')).toBe(true);
  });
  it('utUp is close > utStop', () => {
    out.close.forEach((c, t) => expect(out.utUp[t]).toBe(c > out.utStop[t]));
  });
  it('direction() follows hullUp / utUp and is null when inputs are NaN', () => {
    expect(direction('hull', out, 0)).toBeNull();
    expect(direction('ut', out, 0)).toBeNull();
    const t = 300;
    expect(direction('hull', out, t)).toBe(out.hullUp[t] ? 'up' : 'down');
    expect(direction('ut', out, t)).toBe(out.utUp[t] ? 'up' : 'down');
    expect(direction('hull', out, 10_000)).toBeNull();
  });
});
