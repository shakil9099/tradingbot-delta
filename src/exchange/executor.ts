// Order sequences from the design's "Exchange integration": entry, close, reverse, trail, leverage.
// Every order is preceded by an outbox row. Retries are guarded by re-reading the position size.

import { initialStops, nextStop } from '../core/exits.js';
import { isBreached } from '../core/ratchet.js';
import { contractsFor, riskFor } from '../core/sizing.js';
import { brackets, floorHour, opposite, type Ctx } from '../engine/context.js';
import { classifyExchangeClose, settle } from '../engine/settle.js';
import { alert, log } from '../log.js';
import type { Candle, ExitReason, Side, Stage, StrategyId, TradeRow } from '../shared/types.js';
import { ExchangeError, type Position } from './types.js';

export type EnterResult = 'opened' | 'skipped' | 'failed';
export type CloseResult = 'closed' | 'flat' | 'failed';

export interface EntryReason {
  strategy: StrategyId;
  signal: string;
  candleTime: number;
  [k: string]: unknown;
}

/** Inputs for the stop update on a candle close (design Amendment A.2). */
export interface TrailInput {
  close: number;
  /** ATR(ATR_LEN) at this close. */
  atr: number;
  /** The closed-candle window; hh/ll are taken from bars at or after the entry's floor hour. */
  candles: readonly Candle[];
}

/** Delta rejects client_order_id longer than 32 characters (verified on the first live run, 2026-11-10). */
export const MAX_COID = 32;
const REASON_CODE: Record<ExitReason, string> = {
  sl_stage_0: 's0',
  sl_stage_1: 's1',
  sl_stage_2: 's2',
  tp: 'tp',
  reversal: 'rv',
  manual: 'mn',
  trail_breached: 'tb',
  margin_mode: 'mm',
  liquidation: 'lq',
  external: 'ex',
};
/** Entry id, e.g. eth-1794315600-o-s-1 (≤ 21 chars). */
export const openCoid = (candleTime: number, side: Side, attempt: number) => `eth-${candleTime}-o-${side === 'buy' ? 'b' : 's'}-${attempt}`;
/** Close id, e.g. eth-1794315600-c-mm-2 (≤ 21 chars). */
export const closeCoid = (candleTime: number, reason: ExitReason, attempt: number) => `eth-${candleTime}-c-${REASON_CODE[reason]}-${attempt}`;

/** kv key of the balance peak used by the risk throttle; separate for paper and live. */
export const peakKey = (dryRun: boolean) => (dryRun ? 'equity_peak_paper' : 'equity_peak_live');

export class Executor {
  constructor(private readonly c: Ctx) {}

  private get p() {
    return this.c.params;
  }

  private async waitForPosition(timeoutMs = 10_000): Promise<Position | null> {
    for (let waited = 0; waited <= timeoutMs; waited += 500) {
      const pos = await this.c.port.getPosition();
      if (pos) return pos;
      await this.c.sleep(500);
    }
    return null;
  }

  private async waitForFlat(timeoutMs = 10_000): Promise<boolean> {
    for (let waited = 0; waited <= timeoutMs; waited += 500) {
      if (!(await this.c.port.getPosition())) return true;
      await this.c.sleep(500);
    }
    return false;
  }

  /** Sets leverage while flat and records whether the read-back matches. */
  async ensureLeverage(): Promise<boolean> {
    if (await this.c.port.getPosition()) return false;
    await this.c.port.setLeverage(this.p.LEVERAGE);
    const lev = await this.c.port.getLeverage();
    const ok = lev === this.p.LEVERAGE;
    this.c.repo.kvSet('leverage_ok', ok ? 1 : 0);
    if (!ok) alert(`leverage read back ${lev}, expected ${this.p.LEVERAGE}; entries blocked`);
    return ok;
  }

  /** Opens a trade with initial stop distance R (unrounded; from riskDistance at the signal bar). */
  async enter(side: Side, candleTime: number, reason: EntryReason, R: number): Promise<EnterResult> {
    const { port, repo, halt } = this.c;
    const p = this.p;
    if (halt.state().halted) return 'skipped';

    // Pre-checks: flat, no stray orders, leverage read back.
    if (await port.getPosition()) {
      log.warn('enter: position already open; skipping');
      return 'skipped';
    }
    if ((await port.getOpenOrders()).length) {
      await port.cancelAll();
      if ((await port.getOpenOrders()).length) {
        alert('enter: stray orders remain after cancelAll; entry refused');
        return 'skipped';
      }
    }
    const lev = await port.getLeverage();
    if (lev !== p.LEVERAGE) {
      repo.kvSet('leverage_ok', 0);
      alert(`enter: leverage is ${lev}, expected ${p.LEVERAGE}; entry refused`);
      return 'skipped';
    }

    if (!(R > 0) || !Number.isFinite(R)) {
      alert(`enter: invalid stop distance ${R}; entry refused`);
      return 'skipped';
    }
    const balance = await port.getBalance();
    const ticker = await port.getTicker();
    // Risk throttle: RISK_REDUCED while the balance is more than RISK_REDUCE_DD below its peak.
    const key = peakKey(p.DRY_RUN);
    const th = riskFor(balance, repo.kvGet(key) === null ? null : repo.kvNum(key, balance), p);
    repo.kvSet(key, th.peak);
    const size = contractsFor({
      balanceUsd: balance,
      price: ticker.close,
      riskDist: R,
      risk: th.risk,
      leverage: p.LEVERAGE,
      maxContracts: p.MAX_CONTRACTS,
      feeRate: p.FEE_RATE,
      tick: p.TICK,
      slippageTicks: p.SLIPPAGE_TICKS,
      contractValue: p.CONTRACT_VALUE,
    });
    if (!size.contracts) {
      log.warn({ balance, price: ticker.close, R, risk: th.risk }, 'SIZE_TOO_SMALL');
      return 'skipped';
    }
    const est = initialStops(side, ticker.close, R, p);
    const sizing = {
      risk: th.risk,
      reducedRisk: th.reduced,
      drawdown: +th.drawdown.toFixed(4),
      peak: +th.peak.toFixed(2),
      riskUsd: +size.riskUsd.toFixed(2),
      marginCapped: size.contracts < size.base,
    };

    for (let attempt = 1; attempt <= 2; attempt++) {
      const coid = openCoid(candleTime, side, attempt);
      const id = repo.insertTrade({
        client_order_id: coid,
        status: 'OPENING',
        side,
        size_contracts: size.contracts,
        strategy: reason.strategy,
        dry_run: p.DRY_RUN ? 1 : 0,
        entry_reason: JSON.stringify({ ...reason, effectiveLeverage: +size.effectiveLeverage.toFixed(2), balance, ...sizing }),
        config_hash: this.c.configHash,
        stage: 0,
        // Written before the order (outbox), so a crash after the fill still knows R and the planned stop.
        risk_dist: R,
        sl_price: est.sl,
        tp_price: est.tp,
      });
      let err: unknown = null;
      let orderId: string | null = null;
      try {
        orderId = (await port.placeOrder({ side, size: size.contracts, clientOrderId: coid, bracketStopLoss: est.sl, bracketTakeProfit: est.tp ?? undefined })).id;
      } catch (e) {
        err = e;
        log.error({ err: e }, 'entry order failed');
      }
      // Retry guard: the position itself, not the order response. Always wait the full 10 s —
      // an order whose response errored may still have filled.
      const pos = (await this.waitForPosition(10_000)) ?? (await port.getPosition());
      if (pos) return this.afterFill(id, side, pos, size.contracts, orderId, R);
      repo.updateTrade(id, { status: 'FAILED' });
      const kind = err instanceof ExchangeError ? err.kind : err ? 'retryable' : 'none';
      if (kind === 'fatal' || kind === 'unknown') {
        halt.halt(`entry rejected: ${(err as Error).message}`, 'fatal_error');
        return 'failed';
      }
      const stillNewest = floorHour(this.c.now()) - 3600 === candleTime;
      if (attempt === 1 && kind === 'retryable' && stillNewest) continue;
      alert(`entry did not fill (${coid})`);
      return 'failed';
    }
    return 'failed';
  }

  private async afterFill(id: number, side: Side, pos: Position, requested: number, orderId: string | null, R: number): Promise<EnterResult> {
    const { port, repo, halt } = this.c;
    const p = this.p;
    if (pos.side !== side) {
      halt.halt(`entry filled on the wrong side (${pos.side})`, 'mismatch');
      return 'failed';
    }
    if (pos.size < requested) {
      repo.addTradeEvent(id, 'partial_fill', { requested, filled: pos.size });
      alert(`partial fill: ${pos.size}/${requested} contracts; not topping up`);
    }
    const entryTime = this.c.now();
    const br = initialStops(side, pos.entryPrice, R, p);
    repo.updateTrade(id, { size_contracts: pos.size, entry_price: pos.entryPrice, entry_time: entryTime, sl_price: br.sl, tp_price: br.tp });

    // Move the bracket to exactly entry ∓ R (and ± TP when TP_R > 0).
    try {
      await port.editBracket({ stopLoss: br.sl, takeProfit: br.tp ?? undefined });
    } catch (e) {
      log.warn({ err: e }, 'editBracket after fill failed; will verify and re-attach');
    }
    const ok = await this.ensureBracket(id, br.sl, br.tp);
    if (!ok) {
      alert('bracket could not be confirmed after entry; closing and halting');
      await this.close('manual');
      halt.halt('bracket could not be confirmed after entry', 'fatal_error');
      return 'failed';
    }
    repo.updateTrade(id, { status: 'OPEN' });

    // Entry fees from fills (estimate if unavailable).
    try {
      const fills = (await port.getFills(entryTime - 60)).filter((f) => f.side === side && (!orderId || f.orderId === orderId));
      const fee = fills.length ? fills.reduce((s, f) => s + f.commission, 0) : pos.entryPrice * pos.size * p.CONTRACT_VALUE * p.FEE_RATE;
      repo.updateTrade(id, { fees: +fee.toFixed(6) });
    } catch (e) {
      repo.updateTrade(id, { fees: +(pos.entryPrice * pos.size * p.CONTRACT_VALUE * p.FEE_RATE).toFixed(6) });
      log.warn({ err: e }, 'could not read entry fills; fee estimated');
    }
    alert(`OPEN ${side} ${pos.size} ct @ ${pos.entryPrice} SL ${br.sl} (R $${R.toFixed(2)})${br.tp !== null ? ` TP ${br.tp}` : ''}`, { tradeId: id });

    await this.checkMarginAfterFill(id);
    return 'opened';
  }

  /** Confirms the SL (and the TP when tp is not null) exist near the expected prices; attaches missing legs once. */
  async ensureBracket(id: number, sl: number, tp: number | null): Promise<boolean> {
    const { port, repo } = this.c;
    const near = (a: number | null, b: number | null) => a !== null && b !== null && Math.abs(a - b) <= this.p.TICK / 2;
    let b = brackets(await port.getOpenOrders());
    const missing = { stopLoss: b.sl ? undefined : sl, takeProfit: b.tp || tp === null ? undefined : tp };
    if (missing.stopLoss !== undefined || missing.takeProfit !== undefined) {
      try {
        await port.placeBracket(missing);
      } catch (e) {
        log.error({ err: e }, 'placeBracket failed');
      }
      b = brackets(await port.getOpenOrders());
    }
    if (!b.sl || (tp !== null && !b.tp)) return false;
    if (!near(b.sl.stopPrice, sl) || (tp !== null && !near(b.tp?.stopPrice ?? null, tp))) {
      log.warn({ sl: b.sl.stopPrice, tp: b.tp?.stopPrice ?? null, expected: { sl, tp } }, 'bracket prices differ from expected');
    }
    repo.updateTrade(id, { sl_order_id: b.sl.id, tp_order_id: b.tp?.id ?? null, sl_price: b.sl.stopPrice ?? sl, tp_price: b.tp?.stopPrice ?? tp });
    repo.addTradeEvent(id, 'bracket_attach', { slOrderId: b.sl.id, tpOrderId: b.tp?.id ?? null, sl: b.sl.stopPrice, tp: b.tp?.stopPrice ?? null });
    return true;
  }

  /** Polls the margined endpoint (it lags ~10 s). Acts only on an explicit 'cross'. */
  private async checkMarginAfterFill(id: number): Promise<void> {
    const { port, repo, halt } = this.c;
    for (let i = 0; i < 15; i++) {
      let m: string = 'unknown';
      try {
        m = await port.getMarginMode();
      } catch (e) {
        log.warn({ err: e }, 'getMarginMode failed');
      }
      if (m === 'isolated') {
        repo.kvSet('margin_unknown_since', null);
        return;
      }
      if (m === 'cross') {
        await this.close('margin_mode');
        halt.halt('margin mode is cross; isolated is required', 'fatal_error');
        return;
      }
      await this.c.sleep(1000);
    }
    repo.kvSet('margin_unknown_since', this.c.now());
    alert(`margin mode unknown after fill (trade ${id}); keeping position, reconciler re-checks`);
  }

  /** Bot-initiated close (reversal, manual, trail_breached, margin_mode). */
  async close(reason: ExitReason, candleTime?: number): Promise<CloseResult> {
    const { port, repo, halt } = this.c;
    const ct = candleTime ?? floorHour(this.c.now());
    const trade = repo.openTrade();
    let pos = await port.getPosition();
    if (!pos) {
      if (trade?.status === 'OPEN') await this.settleExchangeClosed(trade);
      return 'flat';
    }
    for (let attempt = 1; attempt <= 2; attempt++) {
      const coid = closeCoid(ct, reason, attempt);
      if (trade) repo.updateTrade(trade.id, { status: 'CLOSING', close_reason: reason, close_client_order_id: coid });
      const startedAt = this.c.now();
      try {
        await port.placeOrder({ side: opposite(pos.side), size: pos.size, clientOrderId: coid, reduceOnly: true });
      } catch (e) {
        log.error({ err: e }, 'close order failed');
      }
      if (await this.waitForFlat()) {
        try {
          await port.cancelAll();
        } catch (e) {
          log.warn({ err: e }, 'cancelAll after close failed');
        }
        if (trade) await this.settleOwnClose(trade.id, reason, opposite(trade.side), startedAt);
        return 'closed';
      }
      pos = await port.getPosition();
      if (!pos) return 'closed';
    }
    halt.halt(`close (${reason}) did not reach flat`, 'fatal_error');
    return 'failed';
  }

  /** Settles a trade closed by our own reduce-only order. */
  async settleOwnClose(tradeId: number, reason: ExitReason, closeSide: Side, since: number): Promise<void> {
    const trade = this.c.repo.getTrade(tradeId);
    if (!trade || trade.status === 'CLOSED') return;
    let fills: Awaited<ReturnType<typeof this.c.port.getFills>> = [];
    try {
      fills = (await this.c.port.getFills(since - 5)).filter((f) => f.side === closeSide && f.time >= since - 5);
    } catch (e) {
      log.warn({ err: e }, 'could not read close fills');
    }
    const fallback = (await this.c.port.getTicker().catch(() => ({ close: trade.entry_price ?? 0 }))).close;
    settle(this.c, trade, reason, fills, fallback);
  }

  /** Settles a trade the exchange closed (SL/TP/liquidation/external). Returns false if fills are not visible yet. */
  async settleExchangeClosed(trade: TradeRow, force = false): Promise<boolean> {
    const r = await classifyExchangeClose(this.c, trade);
    if (!r && !force) return false;
    const fallback = (await this.c.port.getTicker().catch(() => ({ close: trade.sl_price ?? trade.entry_price ?? 0 }))).close;
    settle(this.c, trade, r?.reason ?? 'external', r?.fills ?? [], fallback);
    return true;
  }

  async reverse(newSide: Side, candleTime: number, reason: EntryReason, R: number): Promise<void> {
    const r = await this.close('reversal', candleTime);
    if (r === 'failed') return;
    if (this.c.halt.state().halted) return;
    await this.enter(newSide, candleTime, reason, R);
  }

  /** Stop update on a candle close: read SL from the exchange, PUT, read back, fall back to place-then-cancel. */
  async trail(input: TrailInput): Promise<void> {
    const { port, repo, halt } = this.c;
    const p = this.p;
    const trade = repo.openTrade();
    if (!trade || trade.status !== 'OPEN' || trade.entry_price === null) return;
    const entry = trade.entry_price;
    const closePrice = input.close;
    // Trades from before Strategy v2 were opened with the $20 stop (migration 2 sets risk_dist = 20 for them);
    // adopted positions without R use SL_MAX.
    const R = trade.risk_dist ?? p.SL_MAX;

    // 0. Current SL from the exchange (never cached). If missing: re-attach, confirm, or close and halt.
    let before = brackets(await port.getOpenOrders());
    let currentSl = before.sl?.stopPrice ?? null;
    if (currentSl === null) {
      const fallback = initialStops(trade.side, entry, R, p).sl;
      const sl = trade.side === 'buy' ? Math.max(trade.sl_price ?? fallback, fallback) : Math.min(trade.sl_price ?? fallback, fallback);
      alert('trail: no SL order on the exchange; re-attaching');
      try {
        await port.placeBracket({ stopLoss: sl });
      } catch (e) {
        log.error({ err: e }, 'trail: re-attach SL failed');
      }
      before = brackets(await port.getOpenOrders());
      currentSl = before.sl?.stopPrice ?? null;
      if (currentSl === null) {
        alert('trail: SL could not be re-attached; closing and halting');
        await this.close('manual');
        halt.halt('stop-loss could not be re-attached while trailing', 'fatal_error');
        return;
      }
    }

    // 1. Next stop. hh/ll over the bars since the entry's floor hour (entry bar included).
    const from = floorHour(trade.entry_time ?? this.c.now());
    let hh = -Infinity;
    let ll = Infinity;
    for (const b of input.candles) {
      if (b.time < from) continue;
      hh = Math.max(hh, b.high);
      ll = Math.min(ll, b.low);
    }
    if (!Number.isFinite(hh)) hh = ll = closePrice;
    const next = nextStop(trade.side, entry, R, currentSl, trade.stage as Stage, { close: closePrice, atr: input.atr, hh, ll }, p);
    if (!next.changed) return;

    // 2. Already breached → close, then return.
    const tk = await port.getTicker();
    if (isBreached(trade.side, next.sl, tk.close)) {
      await this.close('trail_breached');
      return;
    }

    // 3. PUT with up to 3 retries; on failure keep the old stop, alert, return.
    let ok = false;
    for (let i = 0; i < 3 && !ok; i++) {
      try {
        await port.editBracket({ stopLoss: next.sl, takeProfit: trade.tp_price ?? undefined });
        ok = true;
      } catch (e) {
        log.warn({ err: e, attempt: i + 1 }, 'trail PUT failed');
        await this.c.sleep(500);
      }
    }
    if (!ok) {
      alert(`trail: PUT failed 3 times; old stop ${currentSl} kept`);
      return;
    }

    // 4–5. Read back; if not moved, place the new SL first, confirm, then cancel the old one.
    const near = (a: number | null) => a !== null && Math.abs(a - next.sl) <= p.TICK / 2;
    const after = brackets(await port.getOpenOrders());
    let newId = after.sls.find((o) => near(o.stopPrice))?.id ?? null;
    if (!newId) {
      try {
        await port.placeBracket({ stopLoss: next.sl });
      } catch (e) {
        log.error({ err: e }, 'placing trailed SL failed');
      }
      const again = brackets(await port.getOpenOrders());
      const fresh = again.sls.find((o) => near(o.stopPrice));
      if (!fresh) {
        alert(`trail: could not confirm new stop ${next.sl}; old stop kept`);
        return;
      }
      newId = fresh.id;
      for (const old of again.sls.filter((o) => o.id !== fresh.id)) {
        try {
          await port.cancelOrder(old.id);
        } catch (e) {
          log.warn({ err: e }, 'cancel old SL failed');
        }
      }
    }

    // 6. Store and log.
    repo.updateTrade(trade.id, { sl_price: next.sl, stage: next.stage, sl_order_id: newId });
    repo.addTradeEvent(trade.id, 'sl_move', { oldSl: currentSl, newSl: next.sl, stage: next.stage, oldId: before.sl?.id ?? null, newId, close: closePrice });
    alert(`SL moved ${currentSl} → ${next.sl} (stage ${next.stage})`, { tradeId: trade.id });
  }
}
