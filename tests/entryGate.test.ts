import { describe, expect, it } from 'vitest';
import { entryGate, isWeekendIST } from '../src/core/entryGate.js';
import type { Candle } from '../src/shared/types.js';
import { P } from './helpers.js';

const utc = (s: string) => Date.parse(s) / 1000;
const bar = (time: number, close = 2000): Candle => ({ time, open: close, high: close + 1, low: close - 1, close, volume: 1 });
const MON = utc('2026-11-09T00:00:00Z');
const off = { ...P, MIN_ATR: 0, ATR_GATE_MAX: 0, SKIP_WEEKEND_ENTRIES: false };
const flat = (n: number, v: number) => Array.from({ length: n }, () => v);

describe('isWeekendIST', () => {
  it('Saturday starts at Friday 18:30 UTC and Monday starts at Sunday 18:30 UTC', () => {
    expect(isWeekendIST(utc('2026-11-06T18:29:59Z'))).toBe(false); // Fri 23:59:59 IST
    expect(isWeekendIST(utc('2026-11-06T18:30:00Z'))).toBe(true); // Sat 00:00 IST
    expect(isWeekendIST(utc('2026-11-08T18:29:59Z'))).toBe(true); // Sun 23:59:59 IST
    expect(isWeekendIST(utc('2026-11-08T18:30:00Z'))).toBe(false); // Mon 00:00 IST
  });
});

describe('entryGate', () => {
  it('allows an entry when every optional filter is off', () => {
    expect(entryGate([bar(MON)], off, [16])(0)).toBeNull();
  });

  it('checks the fill time (candle time + 1h) against the IST weekend', () => {
    const cs = [bar(utc('2026-11-06T17:00:00Z')), bar(utc('2026-11-06T18:00:00Z')), bar(utc('2026-11-08T17:00:00Z')), bar(utc('2026-11-08T18:00:00Z'))];
    const g = entryGate(cs, { ...off, SKIP_WEEKEND_ENTRIES: true }, flat(4, 16));
    expect(g(0)).toBeNull(); // fills Fri 23:30 IST
    expect(g(1)).toContain('weekend'); // fills Sat 00:30 IST
    expect(g(2)).toContain('weekend'); // fills Sun 23:30 IST
    expect(g(3)).toBeNull(); // fills Mon 00:30 IST
  });

  it('skips entries while ATR is below MIN_ATR (default 15)', () => {
    expect(entryGate([bar(MON)], P, [14.99])(0)).toContain('low volatility');
    expect(entryGate([bar(MON)], P, [15])(0)).toBeNull();
  });

  it('skips entries when 2 × ATR is above SL_MAX ($40)', () => {
    expect(entryGate([bar(MON)], off, [20])(0)).toBeNull();
    expect(entryGate([bar(MON)], off, [20.5])(0)).toContain('stop too wide');
  });

  it('skips entries when the stop is more than half the estimated liquidation distance', () => {
    // price 300 → liquidation ≈ 300 × (1/20 − 0.005) = 13.5 away; R = 10 > 6.75
    expect(entryGate([bar(MON, 300)], off, [3])(0)).toContain('liquidation');
    expect(entryGate([bar(MON, 2000)], off, [3])(0)).toBeNull();
  });

  it('optional high-ATR gate', () => {
    expect(entryGate([bar(MON)], { ...off, ATR_GATE_MAX: 12 }, [13])(0)).toContain('volatility gate');
  });

  it('computes ATR(ATR_LEN) itself when none is passed (not available during warm-up)', () => {
    const cs = Array.from({ length: 30 }, (_, i) => bar(MON + i * 3600));
    const g = entryGate(cs, off);
    expect(g(5)).toContain('ATR not available');
    expect(g(29)).toBeNull();
  });
});
