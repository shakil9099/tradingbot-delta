// Entry filters shared by the live cycle and the backtests (design Amendment A.3). A blocked entry is skipped;
// a blocked reversal only closes the open trade. Stops on open trades are never affected.

import type { Candle } from '../shared/types.js';
import { riskDistance, type ExitParams } from './exits.js';
import { atrPine } from './indicators.js';

const HOUR = 3600;
/** Assumed maintenance margin rate for the liquidation estimate (Delta ETHUSD is about 0.5%). */
export const MMR = 0.005;
const IST_OFFSET = 5 * 3600 + 30 * 60;

/** True when the unix time (seconds) falls on Saturday or Sunday in India (UTC+5:30). */
export function isWeekendIST(unixSec: number): boolean {
  const day = new Date((unixSec + IST_OFFSET) * 1000).getUTCDay();
  return day === 0 || day === 6;
}

export interface GateParams extends ExitParams {
  ATR_LEN: number;
  /** Skip entries while ATR is below this ($). 0 = off. */
  MIN_ATR: number;
  /** Optional: skip entries while ATR is above this ($). 0 = off. */
  ATR_GATE_MAX: number;
  SKIP_WEEKEND_ENTRIES: boolean;
  LEVERAGE: number;
}

/**
 * Returns, for bar index i, why a new entry decided at that bar's close is blocked, or null.
 * The entry fills at the next bar's open (= candle time + 1h), so the weekend check uses that time.
 */
export function entryGate(candles: readonly Candle[], p: GateParams, atrIn?: readonly number[]): (i: number) => string | null {
  const atr = atrIn ?? atrPine(candles, p.ATR_LEN);
  return (i) => {
    if (p.SKIP_WEEKEND_ENTRIES && isWeekendIST(candles[i].time + HOUR)) return 'weekend (Sat/Sun IST): no new entries';
    const a = atr[i];
    if (!Number.isFinite(a)) return 'ATR not available yet';
    if (p.MIN_ATR > 0 && a < p.MIN_ATR) return `low volatility: ATR ${a.toFixed(2)} < ${p.MIN_ATR}`;
    if (p.ATR_GATE_MAX > 0 && a > p.ATR_GATE_MAX) return `volatility gate: ATR ${a.toFixed(2)} > ${p.ATR_GATE_MAX}`;
    const R = riskDistance(a, p);
    if (R === null) return `stop too wide: ${p.SL_ATR_MULT} × ATR ${a.toFixed(2)} > $${p.SL_MAX}`;
    // Isolated-margin liquidation sits about price × (1/LEVERAGE − MMR) away; keep the stop within half of it.
    const liq = candles[i].close * (1 / p.LEVERAGE - MMR);
    if (R > 0.5 * liq) return `stop $${R.toFixed(2)} too close to liquidation (~$${liq.toFixed(0)} away)`;
    return null;
  };
}
