import { readFileSync, existsSync } from 'node:fs';
import { DEFAULT_PARAMS, type Params } from '../src/config/params.js';
import type { Candle } from '../src/shared/types.js';

// Exit-mechanics tests are written for a 0.5R break-even trigger; the live default became 1R on 2026-11-14.
export const P: Params = { ...DEFAULT_PARAMS, BE_TRIG_R: 0.5 };

export function readCsv(path: string): Record<string, string>[] {
  const [header, ...rows] = readFileSync(path, 'utf8').trim().split('\n');
  const keys = header.split(',');
  return rows.map((r) => Object.fromEntries(r.split(',').map((v, i) => [keys[i], v])));
}

export const fixtureExists = (path: string) => existsSync(path);

export const num = (s: string | undefined) => (s === undefined || s === '' ? NaN : Number(s));

/** Builds candles from closes; each bar opens at the previous close, range ±0.5 around open/close. */
export function candlesFromCloses(closes: number[], start = 1_700_000_000): Candle[] {
  return closes.map((c, i) => {
    const o = i === 0 ? c : closes[i - 1];
    return { time: start + i * 3600, open: o, high: Math.max(o, c) + 0.5, low: Math.min(o, c) - 0.5, close: c, volume: 1 };
  });
}

export const bar = (time: number, open: number, high: number, low: number, close: number): Candle => ({ time, open, high, low, close, volume: 1 });
