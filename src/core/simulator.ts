// Simulator, per the Strategy Selection Contract and design Amendment A. Pure; also the TypeScript backtester.
// Per strategy, 1 ETH, entries at the next bar's open, SL first when SL and TP share a bar,
// gap fills at the open, 1 tick slippage per fill, stop update on close (src/core/exits.ts), reversal at the
// next open, fees FEE_RATE per side. Initial stop R = riskDistance(ATR at the signal bar); an entry whose R is
// null (stop wider than SL_MAX) is skipped. No funding, no circuit breaker, no sizing (per-ETH P&L).

import type { Candle, SimExitReason, SimTrade, Side, Signal, Stage, StrategyId } from '../shared/types.js';
import { decide } from './decide.js';
import { atrPine } from './indicators.js';
import { initialStops, nextStop, riskDistance, type ExitParams } from './exits.js';
import { select } from './selector.js';
import { direction, type IndicatorOutput } from './signals.js';

export interface SimParams extends ExitParams {
  ATR_LEN: number;
  WARMUP: number;
  SEL_N: number;
  SEL_MARGIN: number;
}

interface OpenPos {
  strategy: StrategyId;
  side: Side;
  entry: number;
  entryTime: number;
  sl: number;
  tp: number | null;
  R: number;
  hh: number;
  ll: number;
  stage: Stage;
}

type Pending =
  | { kind: 'enter'; side: Side; strategy: StrategyId; R: number }
  | { kind: 'reverse'; side: Side; strategy: StrategyId; R: number }
  | { kind: 'close' }
  | null;

export interface SimOptions {
  /** Whether a new position may be opened at bar t's close (entry filters). A blocked reversal only closes. */
  allowEntryAt?: (t: number, side: Side) => boolean;
  /** ATR(ATR_LEN) per bar; computed from the candles when omitted. */
  atr?: readonly number[];
}

/** Shared engine: one position, filled by the same rules for every mode. */
class Book {
  pos: OpenPos | null = null;
  pending: Pending = null;
  trades: SimTrade[] = [];
  constructor(
    private readonly p: SimParams,
    private readonly atr: readonly number[],
  ) {}

  private slip(): number {
    return this.p.SLIPPAGE_TICKS * this.p.TICK;
  }

  /** Fill price for a market order on `side` at `price`, slippage against the trade. */
  private fillPrice(side: Side, price: number): number {
    return side === 'buy' ? price + this.slip() : price - this.slip();
  }

  private open(strategy: StrategyId, side: Side, price: number, time: number, R: number): void {
    const entry = this.fillPrice(side, price);
    const { sl, tp } = initialStops(side, entry, R, this.p);
    this.pos = { strategy, side, entry, entryTime: time, sl, tp, R, hh: -Infinity, ll: Infinity, stage: 0 };
  }

  private close(price: number, time: number, reason: SimExitReason): void {
    const pos = this.pos!;
    const exitSide: Side = pos.side === 'buy' ? 'sell' : 'buy';
    const exit = this.fillPrice(exitSide, price);
    const grossPnl = pos.side === 'buy' ? exit - pos.entry : pos.entry - exit;
    const fees = (pos.entry + exit) * this.p.FEE_RATE;
    this.trades.push({
      strategy: pos.strategy,
      entryTime: pos.entryTime,
      side: pos.side,
      entry: pos.entry,
      exitTime: time,
      exit,
      reason,
      grossPnl,
      fees,
      netPnl: grossPnl - fees,
      riskDist: pos.R,
    });
    this.pos = null;
  }

  /** Step 1 of a bar: execute the order queued at the previous close, at this bar's open. */
  executePending(bar: Candle): void {
    const pend = this.pending;
    this.pending = null;
    if (!pend) return;
    if (pend.kind === 'close') {
      if (this.pos) this.close(bar.open, bar.time, 'reversal');
    } else if (pend.kind === 'reverse') {
      if (this.pos) this.close(bar.open, bar.time, 'reversal');
      this.open(pend.strategy, pend.side, bar.open, bar.time, pend.R);
    } else if (!this.pos) {
      this.open(pend.strategy, pend.side, bar.open, bar.time, pend.R);
    }
  }

  /** Step 2: SL/TP against the bar's range (SL first), then the stop update on the close. */
  manage(bar: Candle, t: number): void {
    const pos = this.pos;
    if (!pos) return;
    if (pos.side === 'buy') {
      if (bar.low <= pos.sl) return this.close(bar.open <= pos.sl ? bar.open : pos.sl, bar.time, `sl_stage_${pos.stage}`);
      if (pos.tp !== null && bar.high >= pos.tp) return this.close(bar.open >= pos.tp ? bar.open : pos.tp, bar.time, 'tp');
    } else {
      if (bar.high >= pos.sl) return this.close(bar.open >= pos.sl ? bar.open : pos.sl, bar.time, `sl_stage_${pos.stage}`);
      if (pos.tp !== null && bar.low <= pos.tp) return this.close(bar.open <= pos.tp ? bar.open : pos.tp, bar.time, 'tp');
    }
    pos.hh = Math.max(pos.hh, bar.high);
    pos.ll = Math.min(pos.ll, bar.low);
    const next = nextStop(pos.side, pos.entry, pos.R, pos.sl, pos.stage, { close: bar.close, atr: this.atr[t], hh: pos.hh, ll: pos.ll }, this.p);
    if (next.changed) {
      pos.sl = next.sl;
      pos.stage = next.stage;
    }
  }
}

const sigSide = (s: Signal): Side | null => (s === 'LONG' ? 'buy' : s === 'SHORT' ? 'sell' : null);

/** One strategy on its own. Signals must already be NONE before WARMUP (computeAll does this). */
export function simulate(
  strategy: StrategyId,
  candles: readonly Candle[],
  signals: readonly Signal[],
  p: SimParams,
  opts: SimOptions = {},
): SimTrade[] {
  const atr = opts.atr ?? atrPine(candles, p.ATR_LEN);
  const book = new Book(p, atr);
  const allowUser = opts.allowEntryAt ?? (() => true);
  const allow = (t: number, side: Side) => riskDistance(atr[t], p) !== null && allowUser(t, side);
  const R = (t: number) => riskDistance(atr[t], p)!;
  for (let t = 0; t < candles.length; t++) {
    const bar = candles[t];
    book.executePending(bar);
    book.manage(bar, t);
    // Signals at this bar's close queue an order for the next open. Entries happen only on flips,
    // so after an SL/TP exit the strategy naturally waits for its next flip.
    const side = t < p.WARMUP ? null : sigSide(signals[t]);
    if (!side) continue;
    if (!book.pos) {
      if (allow(t, side)) book.pending = { kind: 'enter', side, strategy, R: R(t) };
    } else if (side !== book.pos.side) {
      book.pending = allow(t, side) ? { kind: 'reverse', side, strategy, R: R(t) } : { kind: 'close' };
    }
  }
  return book.trades;
}

/** Score = sum of net P&L (per ETH) of the last n closed trades; count = all closed trades. */
export function score(trades: readonly SimTrade[], n: number): { score: number; count: number } {
  const sorted = [...trades].sort((a, b) => a.exitTime - b.exitTime);
  const lastN = sorted.slice(-n);
  return { score: lastN.reduce((s, tr) => s + tr.netPnl, 0), count: trades.length };
}

/**
 * Adaptive replay for the backtest. For each bar t ≥ WARMUP: score each strategy from its own
 * simulate() trades with exitTime < time[t]; call select() with the adaptive position; then apply
 * decide() to the active strategy's signal and direction. Same fills, ratchet, fees and slippage
 * as simulate(). No circuit breaker.
 */
export function simulateAdaptive(
  candles: readonly Candle[],
  ind: IndicatorOutput,
  p: SimParams,
  opts: SimOptions = {},
): { trades: SimTrade[]; switches: number } {
  const atr = opts.atr ?? atrPine(candles, p.ATR_LEN);
  const o2: SimOptions = { ...opts, atr };
  const allowUser = opts.allowEntryAt ?? (() => true);
  const allow = (t: number, side: Side) => riskDistance(atr[t], p) !== null && allowUser(t, side);
  const R = (t: number) => riskDistance(atr[t], p)!;
  const hullTrades = simulate('hull', candles, ind.sigHull, p, o2).sort((a, b) => a.exitTime - b.exitTime);
  const utTrades = simulate('ut', candles, ind.sigUt, p, o2).sort((a, b) => a.exitTime - b.exitTime);
  const book = new Book(p, atr);
  let active: StrategyId = 'hull';
  let pending: StrategyId | null = null;
  let switches = 0;
  let hi = 0;
  let ui = 0;

  for (let t = 0; t < candles.length; t++) {
    const bar = candles[t];
    book.executePending(bar);
    book.manage(bar, t);
    if (t < p.WARMUP) continue;

    while (hi < hullTrades.length && hullTrades[hi].exitTime < bar.time) hi++;
    while (ui < utTrades.length && utTrades[ui].exitTime < bar.time) ui++;
    const known = { hull: hullTrades.slice(0, hi), ut: utTrades.slice(0, ui) };
    const sc = { hull: score(known.hull, p.SEL_N), ut: score(known.ut, p.SEL_N) };

    const sel = select(
      {
        scores: { hull: sc.hull.score, ut: sc.ut.score },
        counts: { hull: sc.hull.count, ut: sc.ut.count },
        active,
        pending,
        isFlat: !book.pos,
        positionSide: book.pos?.side ?? null,
        signals: { hull: ind.sigHull[t], ut: ind.sigUt[t] },
        override: null,
      },
      p,
    );
    if (sel.switched) switches++;
    active = sel.active;
    pending = sel.pending;

    const d = decide({
      halted: false,
      haltKind: null,
      position: book.pos ? { side: book.pos.side } : null,
      activeSignal: active === 'hull' ? ind.sigHull[t] : ind.sigUt[t],
      activeDirection: direction(active, ind, t),
    });
    if (d.action === 'ENTER' && d.side) {
      if (allow(t, d.side)) book.pending = { kind: 'enter', side: d.side, strategy: active, R: R(t) };
    } else if (d.action === 'REVERSE' && d.side) {
      book.pending = allow(t, d.side) ? { kind: 'reverse', side: d.side, strategy: active, R: R(t) } : { kind: 'close' };
    }
  }
  return { trades: book.trades, switches };
}
