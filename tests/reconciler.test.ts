import { describe, expect, it } from 'vitest';
import { makeEngine } from './fakes/setup.js';

const H = 1_699_999_200;
const reason = { strategy: 'hull' as const, signal: 'signal', candleTime: H - 3600 };

async function opened(over: Parameters<typeof makeEngine>[0] = { TP_R: 5 }) {
  const env = makeEngine(over);
  env.fx.price = 2000;
  await env.exec.enter('buy', H - 3600, reason, 20);
  return { ...env, trade: env.repo.openTrade()! };
}

describe('reconciler without a take-profit (TP_R = 0, the default)', () => {
  it('an SL-only bracket is healthy', async () => {
    const { fx, engine } = await opened({});
    expect(fx.tp()).toBeUndefined();
    await engine.reconcile();
    expect(engine.snapshot().bracketOk).toBe(true);
    expect(engine.snapshot().tpPrice).toBeNull();
  });

  it('a missing SL is re-attached at the stored stop; no TP is added', async () => {
    const { fx, engine, trade } = await opened({});
    fx.orders = [];
    await engine.reconcile();
    expect(fx.sl()!.stopPrice).toBe(trade.sl_price);
    expect(fx.tp()).toBeUndefined();
  });

  it('a crash after the fill: the OPENING row keeps its stored R and planned stop', async () => {
    const { fx, repo, engine } = makeEngine();
    const id = repo.insertTrade({ client_order_id: 'x', status: 'OPENING', side: 'buy', size_contracts: 100, strategy: 'hull', risk_dist: 30, sl_price: 1970, tp_price: null });
    fx.position = { side: 'buy', size: 100, entryPrice: 2000 };
    await engine.reconcile();
    expect(repo.getTrade(id)).toMatchObject({ status: 'OPEN', risk_dist: 30, sl_price: 1970 });
    expect(fx.sl()!.stopPrice).toBe(1970);
  });

  it('an adopted position gets R = SL_MAX and an SL-only bracket', async () => {
    const { fx, repo, engine } = makeEngine();
    fx.position = { side: 'buy', size: 30, entryPrice: 2000 };
    await engine.reconcile();
    const t = repo.openTrade()!;
    expect(t).toMatchObject({ strategy: 'unknown', risk_dist: 40, sl_price: 1960 });
    expect(fx.tp()).toBeUndefined();
  });
});

describe('reconciler decision table', () => {
  it('flat, no orders, no trade → nothing', async () => {
    const { fx, engine } = makeEngine();
    await engine.reconcile();
    expect(fx.calls).not.toContain('cancelAll');
  });

  it('flat with stray orders → cancelAll', async () => {
    const { fx, engine } = makeEngine();
    fx.orders.push({ id: 's', clientOrderId: null, side: 'sell', size: 1, kind: 'stop_loss', stopPrice: 1, state: 'pending' });
    await engine.reconcile();
    expect(fx.orders).toHaveLength(0);
  });

  it('flat + OPEN trade closed by the exchange SL → sl_stage_0, breaker counts', async () => {
    const { fx, repo, engine, trade } = await opened();
    fx.exchangeClose(trade.sl_order_id!, 1980);
    await engine.reconcile();
    expect(repo.getTrade(trade.id)).toMatchObject({ status: 'CLOSED', exit_reason: 'sl_stage_0' });
    expect(repo.kvNum('consecutive_sl')).toBe(1);
  });

  it('SL fill that gapped far through the stop is still sl_stage (matched by order id)', async () => {
    const { fx, repo, engine, trade } = await opened();
    fx.exchangeClose(trade.sl_order_id!, 1900);
    await engine.reconcile();
    expect(repo.getTrade(trade.id)!.exit_reason).toBe('sl_stage_0');
  });

  it('SL fill on a replaced stop id (after a trail) is classified by the sl_move history', async () => {
    const { fx, repo, engine, exec, trade } = await opened();
    fx.editIsNoop = true; // forces place-new-then-cancel-old
    fx.price = 2030;
    await exec.trail({ close: 2030, atr: 5, candles: [{ time: H, open: 2000, high: 2035, low: 1995, close: 2030, volume: 1 }] });
    const t = repo.getTrade(trade.id)!;
    expect(t.stage).toBe(2);
    fx.exchangeClose(t.sl_order_id!, 2020);
    await engine.reconcile();
    expect(repo.getTrade(trade.id)!.exit_reason).toBe('sl_stage_2');
  });

  it('TP fill → tp, and a profitable exit resets the breaker', async () => {
    const { fx, repo, engine, trade } = await opened();
    repo.kvSet('consecutive_sl', 2);
    fx.exchangeClose(trade.tp_order_id!, 2100);
    await engine.reconcile();
    expect(repo.getTrade(trade.id)!.exit_reason).toBe('tp');
    expect(repo.kvNum('consecutive_sl')).toBe(0);
  });

  it('liquidation fill → liquidation + halt', async () => {
    const { fx, repo, halt, engine, trade } = await opened();
    fx.exchangeClose('liq-order', 1950, { liquidation: true });
    await engine.reconcile();
    expect(repo.getTrade(trade.id)!.exit_reason).toBe('liquidation');
    expect(halt.state().kind).toBe('liquidation');
  });

  it('unknown fill within $1 of the stored SL → sl_stage (safety net); far away → external', async () => {
    const a = await opened();
    a.fx.exchangeClose('manual-app-order', 1980.5);
    await a.engine.reconcile();
    expect(a.repo.getTrade(a.trade.id)!.exit_reason).toBe('sl_stage_0');

    const b = await opened();
    b.repo.kvSet('consecutive_sl', 1);
    b.fx.exchangeClose('manual-app-order', 2050);
    await b.engine.reconcile();
    expect(b.repo.getTrade(b.trade.id)!.exit_reason).toBe('external');
    expect(b.repo.kvNum('consecutive_sl')).toBe(1); // external neither counts nor resets
  });

  it('exit fills not visible yet → waits, then settles external after 3 ticks', async () => {
    const { fx, repo, engine, trade } = await opened();
    fx.position = null;
    fx.orders = [];
    for (let i = 0; i < 3; i++) {
      await engine.reconcile();
      expect(repo.getTrade(trade.id)!.status).toBe('OPEN');
    }
    await engine.reconcile();
    expect(repo.getTrade(trade.id)).toMatchObject({ status: 'CLOSED', exit_reason: 'external' });
  });

  it('flat + CLOSING → settles with the stored close_reason', async () => {
    const { fx, repo, engine, trade } = await opened();
    repo.updateTrade(trade.id, { status: 'CLOSING', close_reason: 'manual' });
    fx.addFill('x', 'sell', trade.size_contracts, 2010);
    fx.position = null;
    await engine.reconcile();
    expect(repo.getTrade(trade.id)).toMatchObject({ status: 'CLOSED', exit_reason: 'manual' });
  });

  it('open + CLOSING → retries the close', async () => {
    const { fx, repo, engine, trade } = await opened();
    repo.updateTrade(trade.id, { status: 'CLOSING', close_reason: 'reversal' });
    await engine.reconcile();
    expect(fx.position).toBeNull();
    expect(repo.getTrade(trade.id)).toMatchObject({ status: 'CLOSED', exit_reason: 'reversal' });
  });

  it('flat + OPENING → FAILED', async () => {
    const { repo, engine } = makeEngine();
    const id = repo.insertTrade({ client_order_id: 'x', status: 'OPENING', side: 'buy', size_contracts: 10, strategy: 'hull' });
    await engine.reconcile();
    expect(repo.getTrade(id)!.status).toBe('FAILED');
  });

  it('open + OPENING same side → promoted to OPEN, keeping strategy and reason; bracket attached if missing', async () => {
    const { fx, repo, engine } = makeEngine({ TP_R: 5 });
    const id = repo.insertTrade({ client_order_id: 'x', status: 'OPENING', side: 'buy', size_contracts: 100, strategy: 'ut', entry_reason: '{"signal":"LONG"}', risk_dist: 20 });
    fx.position = { side: 'buy', size: 100, entryPrice: 2000 };
    await engine.reconcile();
    expect(repo.getTrade(id)).toMatchObject({ status: 'OPEN', strategy: 'ut', entry_price: 2000, entry_reason: '{"signal":"LONG"}' });
    expect(fx.sl()).toBeDefined();
    expect(fx.tp()).toBeDefined();
  });

  it('open with no trade → adopted (strategy unknown), bracket attached', async () => {
    const { fx, repo, engine } = makeEngine();
    fx.position = { side: 'sell', size: 30, entryPrice: 2100 };
    await engine.reconcile();
    const t = repo.openTrade()!;
    expect(t).toMatchObject({ status: 'OPEN', strategy: 'unknown', side: 'sell', size_contracts: 30 });
    expect(fx.sl()!.stopPrice).toBe(2140); // R unknown → SL_MAX ($40)
  });

  it('open + SL missing → re-attached at max(DB stop, entry − 20)', async () => {
    const { fx, repo, engine, trade } = await opened();
    repo.updateTrade(trade.id, { sl_price: 2002.5, stage: 1 });
    fx.orders = fx.orders.filter((o) => o.kind !== 'stop_loss');
    await engine.reconcile();
    expect(fx.sl()!.stopPrice).toBe(2002.5);
    expect(engine.snapshot().bracketOk).toBe(true);
  });

  it('smaller size after auto-deleverage → size updated, no halt', async () => {
    const { fx, repo, halt, engine, trade } = await opened();
    fx.position = { ...fx.position!, size: 50 };
    await engine.reconcile();
    expect(repo.getTrade(trade.id)!.size_contracts).toBe(50);
    expect(halt.state().halted).toBe(false);
  });

  it('side mismatch → halt (mismatch)', async () => {
    const { fx, halt, engine } = await opened();
    fx.position = { ...fx.position!, side: 'sell' };
    await engine.reconcile();
    expect(halt.state().kind).toBe('mismatch');
  });

  it('re-sets leverage on the first flat reconcile when leverage_ok = 0', async () => {
    const { fx, repo, engine } = makeEngine();
    fx.leverage = 50;
    repo.kvSet('leverage_ok', 0);
    await engine.reconcile();
    expect(fx.leverage).toBe(20);
    expect(repo.kvNum('leverage_ok')).toBe(1);
  });

  it('margin unknown for more than 5 minutes → fatal_error halt without closing', async () => {
    const { fx, repo, halt, engine, advance } = await opened();
    fx.marginModes = ['unknown'];
    repo.kvSet('margin_unknown_since', 1_699_999_210);
    advance(301);
    await engine.reconcile();
    expect(halt.state().kind).toBe('fatal_error');
    expect(fx.position).not.toBeNull();
  });

  it('snapshot fields', async () => {
    const { fx, engine } = await opened();
    fx.price = 2010;
    const s = await engine.reconcile();
    expect(s).toMatchObject({ position: { side: 'buy', entryPrice: 2000 }, slPrice: 1980, tpPrice: 2100, bracketOk: true, lastPrice: 2010, balance: 300 });
    expect(s.unrealizedPnl).toBeCloseTo(10 * s.position!.sizeContracts * 0.01);
  });
});
