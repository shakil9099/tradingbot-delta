// Tick rounding and stop-breach check shared by the exit rules (src/core/exits.ts) and the executor.

import type { Side } from '../shared/types.js';

const EPS = 1e-9;

function decimalsOf(tick: number): number {
  const s = tick.toString();
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
}

/** Rounds a price to the tick grid. 'up' = ceil, 'down' = floor, 'nearest' = round. Works in integer ticks. */
export function roundTick(p: number, dir: 'up' | 'down' | 'nearest', tick = 0.05): number {
  const ticks = Math.round((p / tick) * 1e6) / 1e6; // strip float noise before ceil/floor
  const n = dir === 'up' ? Math.ceil(ticks) : dir === 'down' ? Math.floor(ticks) : Math.round(ticks);
  return Number((n * tick).toFixed(decimalsOf(tick)));
}

/** True if the stop is already at or through the last price (long: SL ≥ last; short: SL ≤ last). */
export function isBreached(side: Side, sl: number, lastPrice: number): boolean {
  return side === 'buy' ? sl >= lastPrice : sl <= lastPrice;
}
