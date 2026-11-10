import { describe, expect, it } from 'vitest';
import { feeLock, initialStops, nextStop, riskDistance, stageOf } from '../src/core/exits.js';
import { P } from './helpers.js';

const E = 2000; // entry
const R = 20;
const LOCK = feeLock(E, P); // 2000 × 2 × 0.00059 + 2 × 0.05 = 2.46

describe('riskDistance', () => {
  it('2 × ATR, floor $10, null above $40 or for a missing ATR', () => {
    expect(riskDistance(15, P)).toBe(30);
    expect(riskDistance(3, P)).toBe(10);
    expect(riskDistance(20, P)).toBe(40);
    expect(riskDistance(20.01, P)).toBeNull();
    expect(riskDistance(NaN, P)).toBeNull();
  });
});

describe('initialStops', () => {
  it('SL entry ∓ R rounded toward profit; no TP when TP_R = 0', () => {
    expect(initialStops('buy', E, 17.33, P)).toEqual({ sl: 1982.7, tp: null });
    expect(initialStops('sell', E, 17.33, P)).toEqual({ sl: 2017.3, tp: null });
  });
  it('TP at ± TP_R × R when TP_R > 0', () => {
    expect(initialStops('buy', E, 20, { ...P, TP_R: 5 })).toEqual({ sl: 1980, tp: 2100 });
    expect(initialStops('sell', E, 20, { ...P, TP_R: 5 })).toEqual({ sl: 2020, tp: 1900 });
  });
});

describe('nextStop (long)', () => {
  const m = (close: number, hh = close, atr = 5) => ({ close, atr, hh, ll: E });
  it('below 0.5R: no change', () => {
    expect(nextStop('buy', E, R, 1980, 0, m(2009.95), P)).toEqual({ sl: 1980, stage: 0, changed: false });
  });
  it('at exactly 0.5R: break-even = entry + fees, rounded up (stage 1)', () => {
    expect(LOCK).toBeCloseTo(2.46);
    expect(nextStop('buy', E, R, 1980, 0, m(2010), P)).toEqual({ sl: 2002.5, stage: 1, changed: true });
  });
  it('at 1.5R: trailing hh − 3 × ATR when tighter than break-even (stage 2)', () => {
    expect(nextStop('buy', E, R, 1980, 0, m(2030, 2040, 5), P)).toEqual({ sl: 2025, stage: 2, changed: true });
  });
  it('at 1.5R with a wide ATR the break-even is tighter and wins (stage 1)', () => {
    expect(nextStop('buy', E, R, 1980, 0, m(2030, 2030, 12), P)).toEqual({ sl: 2002.5, stage: 1, changed: true });
  });
  it('never loosens', () => {
    expect(nextStop('buy', E, R, 2025, 2, m(2031, 2040, 10), P)).toEqual({ sl: 2025, stage: 2, changed: false });
  });
  it('a trailing level at or above the close is rejected and break-even applies instead', () => {
    expect(nextStop('buy', E, R, 1980, 0, m(2030, 2100, 5), P)).toEqual({ sl: 2002.5, stage: 1, changed: true }); // 2085 ≥ close
  });
  it('a missing ATR disables the trail but not break-even', () => {
    expect(nextStop('buy', E, R, 1980, 0, m(2030, 2040, NaN), P)).toEqual({ sl: 2002.5, stage: 1, changed: true });
  });
});

describe('nextStop (short)', () => {
  const m = (close: number, ll = close, atr = 5) => ({ close, atr, hh: E, ll });
  it('break-even = entry − fees, rounded down', () => {
    expect(nextStop('sell', E, R, 2020, 0, m(1990), P)).toEqual({ sl: 1997.5, stage: 1, changed: true });
  });
  it('trailing ll + 3 × ATR (stage 2), never loosens', () => {
    expect(nextStop('sell', E, R, 2020, 0, m(1970, 1960, 5), P)).toEqual({ sl: 1975, stage: 2, changed: true });
    expect(nextStop('sell', E, R, 1975, 2, m(1969, 1960, 10), P).changed).toBe(false);
  });
});

describe('stageOf', () => {
  it('0 on the loss side of entry, else 1', () => {
    expect(stageOf('buy', E, 1980)).toBe(0);
    expect(stageOf('buy', E, 2002.5)).toBe(1);
    expect(stageOf('sell', E, 2020)).toBe(0);
    expect(stageOf('sell', E, 1997.5)).toBe(1);
  });
});
