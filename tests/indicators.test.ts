import { describe, expect, it } from 'vitest';
import { atrPine, hma, trueRange, utTrailingStop, wma } from '../src/core/indicators.js';
import { computeAll, hullSignals, utSignals } from '../src/core/signals.js';
import type { Candle } from '../src/shared/types.js';
import { P, fixtureExists, num, readCsv } from './helpers.js';

const HAND = 'tests/fixtures/hand_30.csv';
const GOLDEN = 'tests/fixtures/eth_1h_golden.csv';

const toCandles = (rows: Record<string, string>[]): Candle[] =>
  rows.map((r) => ({ time: num(r.time), open: num(r.open), high: num(r.high), low: num(r.low), close: num(r.close), volume: 0 }));

function expectSeries(actual: number[], expected: number[], tol = 1e-9) {
  expect(actual.length).toBe(expected.length);
  actual.forEach((a, i) => {
    if (Number.isNaN(expected[i])) expect(a, `index ${i}`).toBeNaN();
    else expect(Math.abs(a - expected[i]), `index ${i}: ${a} vs ${expected[i]}`).toBeLessThanOrEqual(tol);
  });
}

describe('wma / hma', () => {
  it('weights the newest value most and is NaN until n values exist', () => {
    expect(wma([1, 2, 3], 3)).toEqual([NaN, NaN, (1 * 1 + 2 * 2 + 3 * 3) / 6]);
  });
  it('propagates NaN inside the window', () => {
    const out = wma([1, NaN, 3, 4, 5], 2);
    expect(out[1]).toBeNaN();
    expect(out[2]).toBeNaN();
    expect(out[3]).toBeCloseTo((3 + 4 * 2) / 3);
  });
  it('hma uses floor(len/2) and round(sqrt(len))', () => {
    const src = Array.from({ length: 80 }, (_, i) => 100 + Math.sin(i / 5) * 10);
    const half = wma(src, 27);
    const full = wma(src, 55);
    const expected = wma(half.map((v, i) => 2 * v - full[i]), 7);
    expectSeries(hma(src, 55), expected);
  });
});

describe('hand_30 fixture (independent Python reference)', () => {
  const rows = readCsv(HAND);
  const c = toCandles(rows);
  const close = c.map((x) => x.close);

  it('true range: first bar is high − low', () => expectSeries(trueRange(c), rows.map((r) => num(r.tr))));
  it('ATR(6) is seeded with the SMA of the first 6 TRs, then RMA', () => expectSeries(atrPine(c, 6), rows.map((r) => num(r.atr6))));
  it('UT trailing stop matches every branch, including equality cases', () => {
    const atr = atrPine(c, 6);
    expectSeries(utTrailingStop(close, atr, 2), rows.map((r) => num(r.ut_stop)));
    const branches = new Set(rows.map((r) => r.ut_branch));
    expect([...branches].sort()).toEqual(['1', '2', '3', '4']);
  });
  it('WMA(4) and HMA(9)', () => {
    expectSeries(wma(close, 4), rows.map((r) => num(r.wma4)));
    expectSeries(hma(close, 9), rows.map((r) => num(r.hma9)));
  });
});

describe.skipIf(!fixtureExists(GOLDEN))('golden TradingView fixture', () => {
  it('Hull and UT stop match within 0.01 after warm-up, and signals fire on the same bars', () => {
    const rows = readCsv(GOLDEN);
    const c = toCandles(rows);
    const out = computeAll(c, P);
    const hullTv = rows.map((r) => num(r.hull));
    const utTv = rows.map((r) => num(r.ut_stop));
    for (let t = P.WARMUP; t < c.length; t++) {
      expect(Math.abs(out.hull[t] - hullTv[t]), `hull @${t}`).toBeLessThanOrEqual(0.01);
      expect(Math.abs(out.utStop[t] - utTv[t]), `ut @${t}`).toBeLessThanOrEqual(0.01);
    }
    // Expected signals are derived from the exported indicator values using the same rules.
    const close = c.map((x) => x.close);
    expect(out.sigHull.slice(P.WARMUP)).toEqual(hullSignals(hullTv).slice(P.WARMUP));
    expect(out.sigUt.slice(P.WARMUP)).toEqual(utSignals(close, utTv).slice(P.WARMUP));
  });
});

if (!fixtureExists(GOLDEN)) {
  console.warn(`[golden test skipped] ${GOLDEN} not found. Export it from TradingView (see README) to run the parity check.`);
}
