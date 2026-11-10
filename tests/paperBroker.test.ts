import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../src/config/params.js';
import { PaperBroker } from '../src/exchange/paperBroker.js';
import { openDb } from '../src/store/db.js';
import { Repo } from '../src/store/repo.js';
import { makeEngine } from './fakes/setup.js';

function broker() {
  let price = 2000;
  const market = {
    getCandles: async () => [],
    getTicker: async () => ({ close: price, markPrice: price }),
    getProduct: async () => ({ id: 3136, symbol: 'ETHUSD', contractValue: 0.01, tickSize: 0.05 }),
  };
  const repo = new Repo(openDb(':memory:'));
  const pb = new PaperBroker(market, repo, DEFAULT_PARAMS, () => 1_700_000_000);
  return { pb, setPrice: (p: number) => (price = p) };
}

describe('PaperBroker', () => {
  it('market fills use the ticker ± 1 tick, with commission FEE_RATE × notional', async () => {
    const { pb } = broker();
    await pb.placeOrder({ side: 'buy', size: 100, clientOrderId: 'a', bracketStopLoss: 1980, bracketTakeProfit: 2100 });
    expect(await pb.getPosition()).toEqual({ side: 'buy', size: 100, entryPrice: 2000.05 });
    const [f] = await pb.getFills(0);
    expect(f.commission).toBeCloseTo(2000.05 * 100 * 0.01 * DEFAULT_PARAMS.FEE_RATE);
    expect((await pb.getOpenOrders()).map((o) => o.kind).sort()).toEqual(['stop_loss', 'take_profit']);
  });

  it('a virtual SL triggered on tick produces a fill with the SL order id; balance updates by net P&L', async () => {
    const { pb, setPrice } = broker();
    await pb.placeOrder({ side: 'buy', size: 100, clientOrderId: 'a', bracketStopLoss: 1980, bracketTakeProfit: 2100 });
    const slId = (await pb.getOpenOrders()).find((o) => o.kind === 'stop_loss')!.id;
    setPrice(1979);
    await pb.tick();
    expect(await pb.getPosition()).toBeNull();
    const exit = (await pb.getFills(0)).at(-1)!;
    expect(exit).toMatchObject({ orderId: slId, side: 'sell', price: 1979.95 });
    const gross = (1979.95 - 2000.05) * 100 * 0.01;
    const fees = (2000.05 + 1979.95) * 100 * 0.01 * DEFAULT_PARAMS.FEE_RATE;
    expect(await pb.getBalance()).toBeCloseTo(141 + gross - fees);
  });

  it('end to end: the reconciler classifies a paper SL hit as sl_stage_0 and the breaker counts it', async () => {
    const env = makeEngine({ DRY_RUN: true });
    let price = 2000;
    const pb = new PaperBroker(
      { getCandles: async () => [], getTicker: async () => ({ close: price, markPrice: price }), getProduct: env.fx.getProduct.bind(env.fx) },
      env.repo,
      env.c.params,
      env.c.now,
    );
    env.c.port = pb;
    await env.exec.enter('buy', 1_699_999_200 - 3600, { strategy: 'hull', signal: 'LONG', candleTime: 0 }, 20);
    expect(env.repo.openTrade()!.status).toBe('OPEN');
    price = 1970;
    await env.engine.reconcile();
    expect(env.repo.listTrades()[0]).toMatchObject({ status: 'CLOSED', exit_reason: 'sl_stage_0', dry_run: 1 });
    expect(env.repo.kvNum('consecutive_sl')).toBe(1);
  });
});
