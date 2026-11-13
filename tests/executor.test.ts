import { describe, expect, it } from 'vitest';
import { MAX_COID, closeCoid, openCoid, peakKey } from '../src/exchange/executor.js';
import { ExchangeError } from '../src/exchange/types.js';
import { makeEngine } from './fakes/setup.js';
import { bar } from './helpers.js';

const H = 1_699_999_200;
const reason = { strategy: 'hull' as const, signal: 'signal', candleTime: H - 3600 };
const R = 20;

describe('executor.enter (Strategy v2 sizing and stop)', () => {
  it('normal entry: risk-sized, SL at entry − R, no TP leg, R stored, OPEN', async () => {
    const { fx, repo, exec } = makeEngine();
    fx.price = 2000;
    expect(await exec.enter('buy', H - 3600, reason, R)).toBe('opened');
    const t = repo.openTrade()!;
    // balance 300 × 20% = $60; cost per ETH = 20 + 2000 × 2 × 0.00059 + 0.1 = 22.46 → 2.67 ETH = 267 contracts
    expect(t).toMatchObject({ status: 'OPEN', side: 'buy', size_contracts: 267, entry_price: 2000, sl_price: 1980, tp_price: null, risk_dist: 20 });
    expect(t.sl_order_id).toBe(fx.sl()!.id);
    expect(fx.tp()).toBeUndefined();
    expect(t.tp_order_id).toBeNull();
    expect(t.fees).toBeGreaterThan(0);
    const er = JSON.parse(t.entry_reason);
    expect(er).toMatchObject({ risk: 0.2, reducedRisk: false, marginCapped: false });
    expect(er.riskUsd).toBeCloseTo(2.67 * 22.46, 2);
    expect(repo.kvNum(peakKey(false))).toBe(300);
  });

  it('the margin cap binds when 20% risk needs more than 18× notional', async () => {
    const { fx, repo, exec } = makeEngine();
    fx.price = 2225; // base 264 > cap floor(300 × 20 × 0.9 / 22.25) = 242
    await exec.enter('buy', H - 3600, reason, R);
    const t = repo.openTrade()!;
    expect(t.size_contracts).toBe(242);
    expect(JSON.parse(t.entry_reason).marginCapped).toBe(true);
  });

  it('risk throttle: more than 20% below the peak → 5% risk', async () => {
    const { fx, repo, exec } = makeEngine();
    repo.kvSet(peakKey(false), 500); // balance 300 = 40% below
    fx.price = 2000;
    await exec.enter('buy', H - 3600, reason, R);
    const t = repo.openTrade()!;
    expect(t.size_contracts).toBe(66); // 300 × 5% / 22.46 = 0.667 ETH
    expect(JSON.parse(t.entry_reason)).toMatchObject({ risk: 0.05, reducedRisk: true });
    expect(repo.kvNum(peakKey(false))).toBe(500); // peak kept
  });

  it('the peak is kept per mode (paper vs live)', async () => {
    const { fx, repo, exec } = makeEngine({ DRY_RUN: true });
    repo.kvSet(peakKey(false), 10_000); // a live peak must not throttle paper trading
    fx.price = 2000;
    await exec.enter('buy', H - 3600, reason, R);
    expect(JSON.parse(repo.openTrade()!.entry_reason).risk).toBe(0.2);
    expect(repo.kvNum(peakKey(true))).toBe(300);
  });

  it('writes R and the planned stop into the outbox row before the order', async () => {
    const { fx, repo, exec } = makeEngine();
    const orig = fx.placeOrder.bind(fx);
    let atSend: unknown;
    fx.placeOrder = async (req) => {
      const row = repo.listTrades()[0];
      atSend = { status: row.status, risk_dist: row.risk_dist, sl_price: row.sl_price };
      return orig(req);
    };
    fx.price = 2000;
    await exec.enter('buy', H - 3600, reason, R);
    expect(atSend).toEqual({ status: 'OPENING', risk_dist: 20, sl_price: 1980 });
  });

  it('an invalid R is refused without an order', async () => {
    const { fx, exec } = makeEngine();
    expect(await exec.enter('buy', H - 3600, reason, NaN)).toBe('skipped');
    expect(await exec.enter('buy', H - 3600, reason, 0)).toBe('skipped');
    expect(fx.position).toBeNull();
  });

  it('TP_R > 0 places and tracks a TP leg', async () => {
    const { fx, repo, exec } = makeEngine({ TP_R: 5 });
    fx.price = 2000;
    await exec.enter('buy', H - 3600, reason, R);
    const t = repo.openTrade()!;
    expect(t.tp_price).toBe(2100);
    expect(fx.tp()!.stopPrice).toBe(2100);
    expect(t.tp_order_id).toBe(fx.tp()!.id);
  });

  it('cancels stray orders before entry', async () => {
    const { fx, exec } = makeEngine();
    fx.orders.push({ id: 'stray', clientOrderId: null, side: 'sell', size: 1, kind: 'stop_loss', stopPrice: 1, state: 'pending' });
    expect(await exec.enter('buy', H - 3600, reason, R)).toBe('opened');
    expect(fx.orders.find((o) => o.id === 'stray')).toBeUndefined();
  });

  it('refuses entry on a leverage read-back mismatch', async () => {
    const { fx, repo, exec } = makeEngine();
    fx.leverage = 200;
    expect(await exec.enter('buy', H - 3600, reason, R)).toBe('skipped');
    expect(repo.kvNum('leverage_ok')).toBe(0);
    expect(fx.position).toBeNull();
  });

  it('fill timeout + retryable error: position-size guard, no duplicate order', async () => {
    const { fx, repo, exec } = makeEngine();
    fx.positionLag = 3;
    const orig = fx.placeOrder.bind(fx);
    let calls = 0;
    fx.placeOrder = async (req) => {
      calls++;
      await orig(req);
      throw new ExchangeError('timeout', 'retryable');
    };
    expect(await exec.enter('buy', H - 3600, reason, R)).toBe('opened');
    expect(calls).toBe(1);
    expect(repo.openTrade()!.status).toBe('OPEN');
  });

  it('a rejected entry (fatal) marks FAILED and halts', async () => {
    const { fx, repo, halt, exec } = makeEngine();
    fx.fail('placeOrder', new ExchangeError('insufficient margin', 'fatal'));
    expect(await exec.enter('buy', H - 3600, reason, R)).toBe('failed');
    expect(repo.listTrades()[0].status).toBe('FAILED');
    expect(halt.state()).toMatchObject({ halted: true, kind: 'fatal_error' });
  });

  it('SL missing after fill is re-attached (no TP needed)', async () => {
    const { fx, repo, exec } = makeEngine();
    const orig = fx.placeOrder.bind(fx);
    fx.placeOrder = async (req) => orig({ ...req, bracketStopLoss: undefined, bracketTakeProfit: undefined });
    expect(await exec.enter('buy', H - 3600, reason, R)).toBe('opened');
    expect(fx.sl()).toBeDefined();
    expect(fx.tp()).toBeUndefined();
    expect(repo.openTrade()!.sl_order_id).toBe(fx.sl()!.id);
  });

  it('SL cannot be confirmed → close and halt', async () => {
    const { fx, repo, halt, exec } = makeEngine();
    const orig = fx.placeOrder.bind(fx);
    fx.placeOrder = async (req) => orig({ ...req, bracketStopLoss: undefined, bracketTakeProfit: undefined });
    fx.placeBracketNoop = true;
    expect(await exec.enter('buy', H - 3600, reason, R)).toBe('failed');
    expect(fx.position).toBeNull();
    expect(halt.state().kind).toBe('fatal_error');
    expect(repo.listTrades()[0].status).toBe('CLOSED');
  });

  it('partial fill updates size_contracts and does not top up', async () => {
    const { fx, repo, exec } = makeEngine();
    const orig = fx.placeOrder.bind(fx);
    fx.placeOrder = async (req) => orig(req.reduceOnly ? req : { ...req, size: 50 });
    await exec.enter('buy', H - 3600, reason, R);
    const t = repo.openTrade()!;
    expect(t.size_contracts).toBe(50);
    expect(repo.listTradeEvents(t.id).some((e) => e.type === 'partial_fill')).toBe(true);
  });

  it('margined endpoint lags, then shows isolated: no close', async () => {
    const { fx, repo, exec } = makeEngine();
    fx.marginModes = ['unknown', 'unknown', 'isolated'];
    await exec.enter('buy', H - 3600, reason, R);
    expect(fx.position).not.toBeNull();
    expect(repo.kvGet('margin_unknown_since')).toBeNull();
  });

  it('margin_mode field absent: no close, alert, margin_unknown_since set', async () => {
    const { fx, repo, exec } = makeEngine();
    fx.marginModes = ['unknown'];
    await exec.enter('buy', H - 3600, reason, R);
    expect(fx.position).not.toBeNull();
    expect(repo.kvNum('margin_unknown_since')).toBeGreaterThan(0);
  });

  it('explicit cross after a fill → close (margin_mode) and fatal_error halt', async () => {
    const { fx, repo, halt, exec } = makeEngine();
    fx.marginModes = ['cross'];
    await exec.enter('buy', H - 3600, reason, R);
    expect(fx.position).toBeNull();
    expect(repo.listTrades()[0]).toMatchObject({ status: 'CLOSED', exit_reason: 'margin_mode' });
    expect(halt.state().kind).toBe('fatal_error');
  });
});

describe('executor.close / reverse', () => {
  it('writes CLOSING before sending the close order', async () => {
    const { fx, repo, exec } = makeEngine();
    await exec.enter('buy', H - 3600, reason, R);
    const id = repo.openTrade()!.id;
    const orig = fx.placeOrder.bind(fx);
    let statusAtSend: string | undefined;
    fx.placeOrder = async (req) => {
      statusAtSend = repo.getTrade(id)!.status;
      return orig(req);
    };
    await exec.close('manual');
    expect(statusAtSend).toBe('CLOSING');
    expect(repo.getTrade(id)!.close_reason).toBe('manual');
  });

  it('a close that never reaches flat halts', async () => {
    const { fx, halt, exec } = makeEngine();
    await exec.enter('buy', H - 3600, reason, R);
    fx.fills_on_place = false;
    expect(await exec.close('manual')).toBe('failed');
    expect(halt.state().kind).toBe('fatal_error');
  });

  it('close bookkeeping: P&L and fees written; a profitable reversal resets consecutive_sl', async () => {
    const { fx, repo, exec } = makeEngine();
    repo.kvSet('consecutive_sl', 2);
    fx.price = 2000;
    await exec.enter('buy', H - 3600, reason, R);
    fx.price = 2030;
    await exec.reverse('sell', H - 3600, reason, R);
    const [newer, older] = repo.listTrades();
    expect(older).toMatchObject({ status: 'CLOSED', exit_reason: 'reversal', exit_price: 2030 });
    expect(older.gross_pnl).toBeCloseTo(30 * 267 * 0.01, 4);
    expect(older.net_pnl!).toBeLessThan(older.gross_pnl!);
    expect(repo.kvNum('consecutive_sl')).toBe(0);
    expect(newer).toMatchObject({ status: 'OPEN', side: 'sell', risk_dist: 20, sl_price: 2050 });
  });

  it('when a reversal close fails, no new entry is made', async () => {
    const { fx, repo, exec } = makeEngine();
    await exec.enter('buy', H - 3600, reason, R);
    fx.fills_on_place = false;
    await exec.reverse('sell', H - 3600, reason, R);
    expect(repo.listTrades()).toHaveLength(1);
  });

  it('close when the exchange already closed it settles via fills (no double order)', async () => {
    const { fx, repo, exec } = makeEngine();
    await exec.enter('buy', H - 3600, reason, R);
    const t = repo.openTrade()!;
    fx.exchangeClose(t.sl_order_id!, t.sl_price!);
    expect(await exec.close('reversal')).toBe('flat');
    expect(repo.getTrade(t.id)).toMatchObject({ status: 'CLOSED', exit_reason: 'sl_stage_0' });
  });
});

describe('executor.ensureLeverage', () => {
  it('sets leverage when flat and records leverage_ok; a mismatch blocks entry', async () => {
    const { fx, repo, exec } = makeEngine();
    fx.leverage = 5;
    expect(await exec.ensureLeverage()).toBe(true);
    expect(repo.kvNum('leverage_ok')).toBe(1);
    fx.setLeverage = async () => undefined;
    fx.leverage = 5;
    expect(await exec.ensureLeverage()).toBe(false);
    expect(await exec.enter('buy', H - 3600, reason, R)).toBe('skipped');
  });
});

describe('executor.trail (break-even and ATR trailing)', () => {
  async function open(r = R) {
    // These tests check the break-even/trailing mechanics at the original 0.5R trigger (the live default is now 1R).
    const env = makeEngine({ BE_TRIG_R: 0.5 });
    env.fx.price = 2000;
    await env.exec.enter('buy', H - 3600, reason, r);
    return env;
  }
  // Entry at H + 10 → the window starts at H. hh 2035 since entry.
  const win = [bar(H - 3600, 1990, 2050, 1985, 2000), bar(H, 2000, 2035, 1995, 2030)];

  it('trailing: at ≥ 1.5R profit the stop goes to hh − 3 × ATR (stage 2); bars before entry are ignored', async () => {
    const { fx, repo, exec } = await open();
    fx.price = 2030;
    await exec.trail({ close: 2030, atr: 5, candles: win }); // 2035 − 15 = 2020 (the 2050 high is before entry)
    expect(fx.sl()!.stopPrice).toBe(2020);
    const t = repo.openTrade()!;
    expect(t).toMatchObject({ sl_price: 2020, stage: 2 });
    expect(repo.listTradeEvents(t.id).some((e) => e.type === 'sl_move')).toBe(true);
  });

  it('break-even: at ≥ 0.5R profit the stop goes to entry + fees (stage 1)', async () => {
    const { fx, repo, exec } = await open();
    fx.price = 2012;
    await exec.trail({ close: 2012, atr: 5, candles: [bar(H, 2000, 2013, 1999, 2012)] });
    // lock = 2000 × 2 × 0.00059 + 2 × 0.05 = 2.46 → 2002.46 → rounded up to 2002.5
    expect(fx.sl()!.stopPrice).toBe(2002.5);
    expect(repo.openTrade()!.stage).toBe(1);
  });

  it('uses the trade R: a 30 R trade has no break-even at +12', async () => {
    const { fx, exec } = await open(30);
    expect(fx.sl()!.stopPrice).toBe(1970);
    fx.calls = [];
    await exec.trail({ close: 2012, atr: 5, candles: [bar(H, 2000, 2013, 1999, 2012)] });
    expect(fx.calls).not.toContain('editBracket');
  });

  it('no change below the trigger → no PUT', async () => {
    const { fx, exec } = await open();
    fx.calls = [];
    await exec.trail({ close: 2005, atr: 5, candles: win });
    expect(fx.calls).not.toContain('editBracket');
  });

  it('never loosens: a lower candidate after a higher stop is ignored', async () => {
    const { fx, exec } = await open();
    fx.price = 2030;
    await exec.trail({ close: 2030, atr: 5, candles: win });
    fx.calls = [];
    await exec.trail({ close: 2031, atr: 10, candles: win }); // 2035 − 30 = 2005 < 2020
    expect(fx.calls).not.toContain('editBracket');
    expect(fx.sl()!.stopPrice).toBe(2020);
  });

  it('PUT fails 3 times → old stop kept, alert', async () => {
    const { fx, exec } = await open();
    for (let i = 0; i < 3; i++) fx.fail('editBracket');
    fx.price = 2030;
    await exec.trail({ close: 2030, atr: 5, candles: win });
    expect(fx.sl()!.stopPrice).toBe(1980);
  });

  it('breach → close(trail_breached)', async () => {
    const { fx, repo, exec } = await open();
    fx.price = 2015; // new SL 2020 ≥ last 2015
    await exec.trail({ close: 2030, atr: 5, candles: win });
    expect(fx.position).toBeNull();
    expect(repo.listTrades()[0].exit_reason).toBe('trail_breached');
  });

  it('read-back mismatch (PUT not in place) → place new SL, then cancel the old one', async () => {
    const { fx, repo, exec } = await open();
    const oldId = fx.sl()!.id;
    fx.editIsNoop = true;
    fx.price = 2030;
    await exec.trail({ close: 2030, atr: 5, candles: win });
    const sls = fx.orders.filter((o) => o.kind === 'stop_loss');
    expect(sls).toHaveLength(1);
    expect(sls[0].stopPrice).toBe(2020);
    expect(sls[0].id).not.toBe(oldId);
    expect(repo.openTrade()!.sl_order_id).toBe(sls[0].id);
  });

  it('SL missing on the exchange → re-attached at the stored stop, then trailed', async () => {
    const { fx, exec } = await open();
    fx.orders = [];
    fx.price = 2005;
    await exec.trail({ close: 2005, atr: 5, candles: win });
    expect(fx.sl()!.stopPrice).toBe(1980);
  });

  it('SL missing and the re-attach does not take → close and fatal halt', async () => {
    const { fx, halt, repo, exec } = await open();
    fx.orders = [];
    fx.placeBracketNoop = true;
    await exec.trail({ close: 2005, atr: 5, candles: win });
    expect(fx.position).toBeNull();
    expect(halt.state().kind).toBe('fatal_error');
    expect(repo.listTrades()[0].status).toBe('CLOSED');
  });
});

describe('client_order_id length (Delta max 32)', () => {
  it('every entry and close id fits, for every exit reason, side and attempt', () => {
    const reasons = ['sl_stage_0', 'sl_stage_1', 'sl_stage_2', 'tp', 'reversal', 'manual', 'trail_breached', 'margin_mode', 'liquidation', 'external'] as const;
    const t = 9_999_999_999; // far-future candle time (10 digits)
    for (const a of [1, 2]) {
      for (const side of ['buy', 'sell'] as const) expect(openCoid(t, side, a).length).toBeLessThanOrEqual(MAX_COID);
      for (const r of reasons) expect(closeCoid(t, r, a).length).toBeLessThanOrEqual(MAX_COID);
    }
    expect(closeCoid(1794315600, 'margin_mode', 2)).toBe('eth-1794315600-c-mm-2');
  });

  it('the ids actually sent to the exchange are short', async () => {
    const { fx, exec } = makeEngine();
    const sent: string[] = [];
    const orig = fx.placeOrder.bind(fx);
    fx.placeOrder = async (req) => (sent.push(req.clientOrderId), orig(req));
    await exec.enter('buy', H - 3600, reason, R);
    await exec.close('margin_mode');
    expect(sent).toHaveLength(2);
    for (const id of sent) expect(id.length).toBeLessThanOrEqual(MAX_COID);
  });
});
