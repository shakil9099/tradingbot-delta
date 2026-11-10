import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DeltaClient, buildQuery, sign } from '../src/exchange/deltaClient.js';
import { ExchangeError } from '../src/exchange/types.js';

describe('signing', () => {
  it('HMAC-SHA256 hex of method + timestamp + path + query (with ?) + body', () => {
    const expected = createHmac('sha256', 's').update('GET1700000000/v2/orders?product_id=3136').digest('hex');
    expect(sign('s', 'GET', '/v2/orders', '?product_id=3136', '', '1700000000')).toBe(expected);
    // pinned literal so a formula change is caught
    expect(expected).toBe('ecee83c423d0ff8cc941778745a952e0f9aa79fb697499195f1c1ea97d16ff39');
    expect(buildQuery({ product_id: 3136 })).toBe('?product_id=3136');
    expect(buildQuery()).toBe('');
  });
});

type Resp = { status: number; body: unknown };
function client(responses: Resp[], extra: Partial<ConstructorParameters<typeof DeltaClient>[0]> = {}) {
  const seen: Array<{ url: string; init: RequestInit }> = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    const r = responses.shift() ?? { status: 500, body: {} };
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { date: new Date(1_700_000_000_000).toUTCString() } });
  }) as unknown as typeof fetch;
  const c = new DeltaClient({
    baseUrl: 'https://api.india.delta.exchange',
    apiKey: 'k',
    apiSecret: 's',
    productId: 3136,
    symbol: 'ETHUSD',
    fetchFn,
    sleep: async () => undefined,
    now: () => 1_700_000_000_000,
    ...extra,
  });
  return { c, seen };
}

describe('DeltaClient', () => {
  it('sends api-key, timestamp, signature and User-Agent on authed calls', async () => {
    const { c, seen } = client([{ status: 200, body: { success: true, result: { size: 5, entry_price: '2000' } } }]);
    const pos = await c.getPosition();
    expect(pos).toEqual({ side: 'buy', size: 5, entryPrice: 2000 });
    const h = seen[0].init.headers as Record<string, string>;
    expect(h['api-key']).toBe('k');
    expect(h.timestamp).toBe('1700000000');
    expect(h.signature).toBe(sign('s', 'GET', '/v2/positions', '?product_id=3136', '', '1700000000'));
    expect(h['User-Agent']).toContain('tradingbot-eth');
  });

  it('retries 5xx and 429, calling onRateLimited, then succeeds and resets failures', async () => {
    let limited = 0;
    const { c } = client(
      [
        { status: 502, body: {} },
        { status: 429, body: {} },
        { status: 200, body: { success: true, result: { close: '2001', mark_price: '2000.5' } } },
      ],
      { onRateLimited: () => limited++ },
    );
    expect(await c.getTicker()).toEqual({ close: 2001, markPrice: 2000.5 });
    expect(limited).toBe(1);
    expect(c.consecutiveFailures).toBe(0);
  });

  it('classifies fatal (401, insufficient_margin) and unknown (other 4xx) errors without retrying', async () => {
    const a = client([{ status: 401, body: { success: false, error: { code: 'unauthorized' } } }]);
    await expect(a.c.getBalance()).rejects.toMatchObject({ kind: 'fatal' });
    const b = client([{ status: 400, body: { success: false, error: { code: 'insufficient_margin' } } }]);
    await expect(b.c.placeOrder({ side: 'buy', size: 1, clientOrderId: 'x' })).rejects.toMatchObject({ kind: 'fatal' });
    const u = client([{ status: 418, body: { success: false, error: { code: 'teapot' } } }]);
    await expect(u.c.getBalance()).rejects.toMatchObject({ kind: 'unknown' });
    expect(u.seen).toHaveLength(1);
  });

  it('counts consecutive failures after exhausting retries; order creation is not retried', async () => {
    const { c, seen } = client([{ status: 500, body: {} }, { status: 500, body: {} }, { status: 500, body: {} }, { status: 500, body: {} }]);
    await expect(c.getTicker()).rejects.toBeInstanceOf(ExchangeError);
    expect(c.consecutiveFailures).toBe(1);
    expect(seen).toHaveLength(4);
    const o = client([{ status: 500, body: {} }]);
    await expect(o.c.placeOrder({ side: 'buy', size: 1, clientOrderId: 'x' })).rejects.toMatchObject({ kind: 'retryable' });
    expect(o.seen).toHaveLength(1);
  });

  it('maps orders into SL / TP kinds and reads margin mode', async () => {
    const { c } = client([
      {
        status: 200,
        body: {
          success: true,
          result: [
            { id: 1, side: 'sell', size: 10, order_type: 'market_order', stop_order_type: 'stop_loss_order', stop_price: '1980', state: 'pending' },
            { id: 2, side: 'sell', size: 10, order_type: 'market_order', stop_order_type: 'take_profit_order', stop_price: '2100', state: 'pending' },
          ],
        },
      },
      { status: 200, body: { success: true, result: [{ product_id: 3136, margin_mode: 'isolated' }] } },
    ]);
    const orders = await c.getOpenOrders();
    expect(orders.map((o) => [o.kind, o.stopPrice])).toEqual([
      ['stop_loss', 1980],
      ['take_profit', 2100],
    ]);
    expect(await c.getMarginMode()).toBe('isolated');
  });

  it('checkClock throws on large skew', async () => {
    const { c } = client([{ status: 200, body: { success: true, result: {} } }], { now: () => 1_700_000_010_000 });
    await expect(c.checkClock(2)).rejects.toMatchObject({ kind: 'fatal' });
  });
});
