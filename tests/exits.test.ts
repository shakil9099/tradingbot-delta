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

describe('break-even at +$15 (BE_TRIG_USD), whichever of $15 and 1R comes first', () => {
  const live = { ...P, BE_TRIG_R: 1, BE_TRIG_USD: 15 };
  const R40 = 40;
  const long = (close: number) => ({ close, atr: 20, hh: close, ll: E });
  const short = (close: number) => ({ close, atr: 20, hh: E, ll: close });

  it('long, R $40: a close at +$14.95 does nothing, a close at +$15 moves the stop to entry + fees', () => {
    expect(nextStop('buy', E, R40, 1960, 0, long(2014.95), live)).toEqual({ sl: 1960, stage: 0, changed: false });
    expect(nextStop('buy', E, R40, 1960, 0, long(2015), live)).toEqual({ sl: 2002.5, stage: 1, changed: true });
  });

  it('short, R $40: a close at −$15 moves the stop to entry − fees', () => {
    expect(nextStop('sell', E, R40, 2040, 0, short(1985), live)).toEqual({ sl: 1997.5, stage: 1, changed: true });
  });

  it('R $10: 1R comes first, so break-even at +$10', () => {
    expect(nextStop('buy', E, 10, 1990, 0, long(2010), live)).toEqual({ sl: 2002.5, stage: 1, changed: true });
  });

  it('BE_TRIG_USD 0 turns the $15 rule off (1R only)', () => {
    expect(nextStop('buy', E, R40, 1960, 0, long(2015), { ...live, BE_TRIG_USD: 0 }).changed).toBe(false);
  });
});

