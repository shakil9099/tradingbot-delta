import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../src/config/params.js';
import { atrPine } from '../src/core/indicators.js';
import { reversalSignals } from '../src/core/reversal.js';
import { computeAll, direction, signalsFor } from '../src/core/signals.js';
import type { Candle } from '../src/shared/types.js';
import { bar, candlesFromCloses, fixtureExists } from './helpers.js';

const RP = { REV_ATR_LEN: 14, REV_ATR_MULT: 2, REV_MIN_PCT: 0.001 };

describe('reversalSignals', () => {
  // ATR 10 → threshold max(20, ~0.1) = 20.
  const c: Candle[] = [
    bar(0, 100, 101, 99, 100), // pivot 100, legs 101 / 99
    bar(1, 100, 126, 124, 125), // 125 > 100 + 20 → first leg up, no signal
    bar(2, 125, 131, 129, 130), // leg high 131
    bar(3, 130, 113, 111, 112), // 112 < 131 − 20 = 111? no
    bar(4, 112, 112, 109, 110), // 110 < 111 → SELL; leg low resets to 109
    bar(5, 110, 129, 127, 128), // 128 > 109 + 20 = 129? no
    bar(6, 128, 131, 129, 130), // 130 > 129 → BUY
  ];
  const atr = c.map(() => 10);
  const out = reversalSignals(c, atr, RP);

  it('first leg sets a direction with no signal; SELL and BUY fire on the confirming close', () => {
    expect(out.signals).toEqual(['NONE', 'NONE', 'NONE', 'NONE', 'SHORT', 'NONE', 'LONG']);
    expect(out.trendDir).toEqual([0, 1, 1, 1, -1, -1, 1]);
  });

  it('a close exactly at leg_high − threshold is not a reversal (strict, as in Pine)', () => {
    const d = c.slice(0, 4).concat([bar(4, 112, 112, 110, 111)]);
    expect(reversalSignals(d, d.map(() => 10), RP).signals[4]).toBe('NONE');
  });

  it('threshold is the larger of ATR × mult and close × min %', () => {
    const t = reversalSignals([bar(0, 3000, 3001, 2999, 3000)], [1], RP).threshold[0];
    expect(t).toBeCloseTo(3); // 3000 × 0.1% = 3 beats 1 × 2
    expect(reversalSignals([bar(0, 100, 101, 99, 100)], [10], RP).threshold[0]).toBe(20);
  });

  it('NaN ATR gives no signal and leaves the state untouched', () => {
    const r = reversalSignals(c, c.map(() => NaN), RP);
    expect(r.signals.every((s) => s === 'NONE')).toBe(true);
    expect(r.trendDir.every((d) => d === 0)).toBe(true);
  });
});

describe('reversal through computeAll', () => {
  const closes = Array.from({ length: 600 }, (_, i) => 2000 + 120 * Math.sin(i / 25) + 15 * Math.sin(i / 4));
  const out = computeAll(candlesFromCloses(closes), DEFAULT_PARAMS);

  it('signals are masked before WARMUP and appear after it', () => {
    expect(out.sigRev.slice(0, DEFAULT_PARAMS.WARMUP).every((s) => s === 'NONE')).toBe(true);
    expect(out.sigRev.slice(DEFAULT_PARAMS.WARMUP).some((s) => s !== 'NONE')).toBe(true);
  });

  it('signalsFor and direction use reversal, not UT', () => {
    expect(signalsFor('reversal', out)).toBe(out.sigRev);
    const t = out.close.length - 1;
    expect(direction('reversal', out, t)).toBe(out.revDir[t] === 1 ? 'up' : 'down');
  });
});

const CACHE = 'data/eth_1h_cache.json';
describe.skipIf(!fixtureExists(CACHE))('window-start stability on ETH 1h data', () => {
  const all = (JSON.parse(readFileSync(CACHE, 'utf8')) as Candle[]).filter((x) => x.high > x.low || x.volume > 0);
  const sigTimes = (w: Candle[], from: number) => {
    const r = reversalSignals(w, atrPine(w, RP.REV_ATR_LEN), RP);
    return w.map((b, i) => (b.time >= from && r.signals[i] !== 'NONE' ? `${b.time}:${r.signals[i]}` : '')).filter(Boolean);
  };

  // The bot recomputes over its 2,000-bar window every hour, so the window start moves. The last 500 bars'
  // signals must not depend on it.
  it.each([1, 24, 200])('shifting the window start by %i bars leaves the last 500 bars unchanged', (shift) => {
    for (let end = all.length; end > 4000; end -= 997) {
      const base = all.slice(end - 2200, end);
      const from = base[base.length - 500].time;
      expect(sigTimes(base.slice(shift), from)).toEqual(sigTimes(base, from));
    }
  });
});
