// Reconciler: runs at boot and every 60 s (inside the shared mutex). The exchange is the source of truth.

import { initialStops, stageOf } from '../core/exits.js';
import type { Executor } from '../exchange/executor.js';
import type { Position } from '../exchange/types.js';
import { alert, log } from '../log.js';
import type { Side, Stage } from '../shared/types.js';
import { brackets, type Ctx } from './context.js';

export interface Snapshot {
  position: { side: Side; sizeContracts: number; entryPrice: number } | null;
  slPrice: number | null;
  tpPrice: number | null;
  slOrderId: string | null;
  tpOrderId: string | null;
  stage: Stage | null;
  bracketOk: boolean;
  balance: number | null;
  lastPrice: number | null;
  unrealizedPnl: number | null;
  at: number;
}

const SETTLE_WAIT_TICKS = 3;

export class Reconciler {
  private snapshot: Snapshot = {
    position: null,
    slPrice: null,
    tpPrice: null,
    slOrderId: null,
    tpOrderId: null,
    stage: null,
    bracketOk: true,
    balance: null,
    lastPrice: null,
    unrealizedPnl: null,
    at: 0,
  };

  constructor(
    private readonly c: Ctx,
    private readonly exec: Executor,
  ) {}

  getSnapshot(): Snapshot {
    return this.snapshot;
  }

  async reconcile(): Promise<Snapshot> {
    const { port, repo, halt } = this.c;
    const p = this.c.params;
    await port.tick?.();
    const pos = await port.getPosition();
    const orders = await port.getOpenOrders();
    const trade = repo.openTrade();
    let bracketOk = true;

    if (!pos) {
      if (trade?.status === 'OPEN') {
        const key = `settle_wait_${trade.id}`;
        const waited = repo.kvNum(key, 0);
        const done = await this.exec.settleExchangeClosed(trade, waited >= SETTLE_WAIT_TICKS);
        if (done) repo.kvSet(key, null);
        else repo.kvSet(key, waited + 1);
      } else if (trade?.status === 'CLOSING') {
        await this.exec.settleOwnClose(trade.id, trade.close_reason ?? 'manual', trade.side === 'buy' ? 'sell' : 'buy', (trade.entry_time ?? this.c.now()) + 1);
      } else if (trade?.status === 'OPENING') {
        repo.updateTrade(trade.id, { status: 'FAILED' });
        log.warn({ tradeId: trade.id }, 'OPENING trade never filled → FAILED');
      }
      if (orders.length) {
        log.warn({ n: orders.length }, 'stray orders while flat → cancelAll');
        await port.cancelAll();
      }
      if (repo.kvNum('leverage_ok', 1) === 0) await this.exec.ensureLeverage().catch((e) => log.warn({ err: e }, 'ensureLeverage failed'));
      repo.kvSet('margin_unknown_since', null);
    } else {
      bracketOk = await this.reconcileOpen(pos, trade);
      await this.recheckMargin();
    }

    // Snapshot for /api/status and /health (2 extra calls: balance, ticker).
    const fresh = repo.openTrade();
    const b = brackets(await port.getOpenOrders().catch(() => orders));
    let balance: number | null = null;
    let lastPrice: number | null = null;
    try {
      balance = await port.getBalance();
    } catch (e) {
      log.warn({ err: e }, 'snapshot: balance failed');
    }
    try {
      lastPrice = (await port.getTicker()).close;
    } catch (e) {
      log.warn({ err: e }, 'snapshot: ticker failed');
    }
    const curPos = pos ? await port.getPosition().catch(() => pos) : null;
    this.snapshot = {
      position: curPos ? { side: curPos.side, sizeContracts: curPos.size, entryPrice: curPos.entryPrice } : null,
      slPrice: b.sl?.stopPrice ?? null,
      tpPrice: b.tp?.stopPrice ?? null,
      slOrderId: b.sl?.id ?? null,
      tpOrderId: b.tp?.id ?? null,
      stage: fresh && fresh.status === 'OPEN' ? (fresh.stage as Stage) : null,
      // A TP leg is required only when the trade has one (TP_R > 0 or a pre-v2 trade).
      bracketOk: curPos ? bracketOk && !!b.sl && (!!b.tp || fresh?.tp_price == null) : true,
      balance,
      lastPrice,
      unrealizedPnl:
        curPos && lastPrice !== null ? (curPos.side === 'buy' ? lastPrice - curPos.entryPrice : curPos.entryPrice - lastPrice) * curPos.size * p.CONTRACT_VALUE : null,
      at: this.c.now(),
    };
    if (halt.state().halted) log.debug('reconcile: halted');
    return this.snapshot;
  }

  private async reconcileOpen(pos: Position, trade: ReturnType<Ctx['repo']['openTrade']>): Promise<boolean> {
    const { port, repo, halt } = this.c;
    const p = this.c.params;
    let t = trade;

    if (!t || (t.status === 'OPENING' && t.side !== pos.side)) {
      // Adopt an unknown position.
      // R is unknown for an adopted position: use SL_MAX (the widest stop the strategy allows).
      const b = brackets(await port.getOpenOrders());
      const def = initialStops(pos.side, pos.entryPrice, p.SL_MAX, p);
      const sl = b.sl?.stopPrice ?? def.sl;
      const id = repo.insertTrade({
        client_order_id: `adopted-${this.c.now()}`,
        status: 'OPEN',
        side: pos.side,
        size_contracts: pos.size,
        strategy: 'unknown',
        dry_run: p.DRY_RUN ? 1 : 0,
        entry_reason: JSON.stringify({ adopted: true }),
        entry_time: this.c.now(),
        entry_price: pos.entryPrice,
        sl_price: sl,
        tp_price: b.tp?.stopPrice ?? def.tp,
        risk_dist: p.SL_MAX,
        stage: stageOf(pos.side, pos.entryPrice, sl),
        sl_order_id: b.sl?.id ?? null,
        tp_order_id: b.tp?.id ?? null,
        fees: +(pos.entryPrice * pos.size * p.CONTRACT_VALUE * p.FEE_RATE).toFixed(6),
        config_hash: this.c.configHash,
      });
      alert(`adopted an unknown ${pos.side} position of ${pos.size} contracts @ ${pos.entryPrice} (trade ${id}); stop distance assumed $${p.SL_MAX}`);
      t = repo.getTrade(id);
    } else if (t.status === 'OPENING') {
      // Crash after the fill: promote the outbox row, keeping its strategy and reason.
      const def = initialStops(pos.side, pos.entryPrice, t.risk_dist ?? p.SL_MAX, p);
      repo.updateTrade(t.id, {
        status: 'OPEN',
        entry_price: pos.entryPrice,
        size_contracts: pos.size,
        entry_time: t.entry_time ?? this.c.now(),
        sl_price: t.sl_price ?? def.sl,
        tp_price: t.tp_price ?? def.tp,
        risk_dist: t.risk_dist ?? p.SL_MAX,
        fees: t.fees ?? +(pos.entryPrice * pos.size * p.CONTRACT_VALUE * p.FEE_RATE).toFixed(6),
      });
      alert(`promoted OPENING trade ${t.id} to OPEN after restart`);
      t = repo.getTrade(t.id);
    } else if (t.status === 'CLOSING') {
      alert(`trade ${t.id} was CLOSING with the position still open; retrying the close`);
      const r = await this.exec.close(t.close_reason ?? 'manual');
      return r !== 'failed';
    }
    if (!t) return false;

    if (pos.side !== t.side || pos.size > t.size_contracts) {
      halt.halt(`position mismatch: exchange ${pos.side} ${pos.size}, DB ${t.side} ${t.size_contracts}`, 'mismatch');
      repo.addSystemEvent('reconcile_mismatch', { exchange: pos, trade: { id: t.id, side: t.side, size: t.size_contracts } });
      return false;
    }
    if (pos.size < t.size_contracts) {
      repo.updateTrade(t.id, { size_contracts: pos.size });
      repo.addTradeEvent(t.id, 'size_change', { from: t.size_contracts, to: pos.size });
      alert(`position size reduced ${t.size_contracts} → ${pos.size} (auto-deleverage or partial close)`);
    }

    const b = brackets(await port.getOpenOrders());
    if (!b.sl || (t.tp_price !== null && !b.tp)) {
      const def = initialStops(t.side, t.entry_price ?? pos.entryPrice, t.risk_dist ?? p.SL_MAX, p);
      const sl = t.side === 'buy' ? Math.max(t.sl_price ?? def.sl, def.sl) : Math.min(t.sl_price ?? def.sl, def.sl);
      alert(`bracket missing (sl ${!!b.sl}, tp ${t.tp_price === null ? 'none' : !!b.tp}); re-attaching`);
      return this.exec.ensureBracket(t.id, sl, t.tp_price);
    }
    if (b.sl.id !== t.sl_order_id || (b.tp?.id ?? null) !== t.tp_order_id) {
      repo.updateTrade(t.id, { sl_order_id: b.sl.id, tp_order_id: b.tp?.id ?? null });
    }
    return true;
  }

  private async recheckMargin(): Promise<void> {
    const { port, repo, halt } = this.c;
    const since = repo.kvNum('margin_unknown_since', 0);
    if (!since) return;
    const m = await port.getMarginMode().catch(() => 'unknown' as const);
    if (m === 'isolated') repo.kvSet('margin_unknown_since', null);
    else if (m === 'cross') {
      await this.exec.close('margin_mode');
      halt.halt('margin mode is cross; isolated is required', 'fatal_error');
      repo.kvSet('margin_unknown_since', null);
    } else if (this.c.now() - since > 300) {
      halt.halt('margin mode still unknown 5 minutes after entry', 'fatal_error');
    }
  }
}
