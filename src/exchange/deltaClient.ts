// Delta Exchange India REST client. Field names marked VERIFY are on the design's "verify on first run" list;
// the first response from each such endpoint is logged raw.

import { createHmac } from 'node:crypto';
import { log } from '../log.js';
import type { Candle, Side } from '../shared/types.js';
import {
  ExchangeError,
  type BracketReq,
  type ExchangePort,
  type Fill,
  type MarginMode,
  type Order,
  type OrderKind,
  type PlaceOrderReq,
  type Position,
  type Product,
  type Ticker,
} from './types.js';

export interface DeltaClientOpts {
  baseUrl: string;
  apiKey?: string;
  apiSecret?: string;
  productId: number;
  symbol: string;
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number; // ms
  onRateLimited?: () => void;
  onOk?: () => void;
}

interface ReqOpts {
  query?: Record<string, string | number>;
  body?: Record<string, unknown>;
  auth?: boolean;
  /** Order-creating requests are never retried blindly; the executor decides. */
  retry?: boolean;
}

const FATAL_CODES = new Set([
  'insufficient_margin',
  'invalid_size',
  'invalid_price',
  'invalid_api_key',
  'unauthorized',
  'ip_not_whitelisted',
  'product_not_found',
]);

export function sign(secret: string, method: string, path: string, query: string, body: string, ts: string): string {
  return createHmac('sha256', secret).update(method + ts + path + query + body).digest('hex');
}

export function buildQuery(q?: Record<string, string | number>): string {
  if (!q || !Object.keys(q).length) return '';
  return '?' + new URLSearchParams(Object.entries(q).map(([k, v]) => [k, String(v)])).toString();
}

const num = (v: unknown, d = NaN) => (v === null || v === undefined || v === '' ? d : Number(v));

function orderKind(o: Record<string, unknown>): OrderKind {
  const stop = o.stop_order_type as string | null | undefined;
  if (stop === 'stop_loss_order') return 'stop_loss';
  if (stop === 'take_profit_order') return 'take_profit';
  if (o.order_type === 'market_order') return 'market';
  if (o.order_type === 'limit_order') return 'limit';
  return 'other';
}

function toOrder(o: Record<string, unknown>): Order {
  return {
    id: String(o.id),
    clientOrderId: (o.client_order_id as string | null) ?? null,
    side: o.side as Side,
    size: num(o.size, 0),
    kind: orderKind(o),
    stopPrice: o.stop_price === null || o.stop_price === undefined ? null : num(o.stop_price),
    state: String(o.state ?? ''),
  };
}

export class DeltaClient implements ExchangePort {
  consecutiveFailures = 0;
  private readonly fetchFn: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly seenRaw = new Set<string>();

  constructor(private readonly o: DeltaClientOpts) {
    this.fetchFn = o.fetchFn ?? fetch;
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = o.now ?? Date.now;
  }

  /** Raw request with signing, timeout, retry and error classification. */
  async request<T = unknown>(method: string, path: string, ro: ReqOpts = {}): Promise<{ body: T; date: string | null }> {
    const query = buildQuery(ro.query);
    const bodyStr = ro.body ? JSON.stringify(ro.body) : '';
    const retry = ro.retry !== false;
    const delays = [500, 1000, 2000];
    let last: ExchangeError | null = null;

    for (let attempt = 0; attempt <= (retry ? delays.length : 0); attempt++) {
      if (attempt > 0) await this.sleep(delays[attempt - 1]);
      const headers: Record<string, string> = {
        'User-Agent': 'tradingbot-eth/1.0',
        Accept: 'application/json',
        'Content-Type': 'application/json',
      };
      if (ro.auth) {
        if (!this.o.apiKey || !this.o.apiSecret) throw new ExchangeError('API key/secret not configured', 'fatal');
        const ts = String(Math.floor(this.now() / 1000)); // re-signed on every attempt (5 s validity)
        headers['api-key'] = this.o.apiKey;
        headers.timestamp = ts;
        headers.signature = sign(this.o.apiSecret, method, path, query, bodyStr, ts);
      }
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 10_000);
      const started = this.now();
      try {
        const res = await this.fetchFn(this.o.baseUrl + path + query, { method, headers, body: bodyStr || undefined, signal: ac.signal });
        const text = await res.text();
        let json: unknown = null;
        try {
          json = text ? JSON.parse(text) : null;
        } catch {
          json = null;
        }
        log.debug({ method, path, status: res.status, ms: this.now() - started }, 'delta call');
        if (res.ok && json && (json as { success?: boolean }).success !== false) {
          this.consecutiveFailures = 0;
          this.o.onOk?.();
          const key = `${method} ${path}`;
          if (!this.seenRaw.has(key)) {
            this.seenRaw.add(key);
            log.info({ method, path, sample: text.slice(0, 1500) }, 'first response (verify field names)');
          }
          return { body: json as T, date: res.headers.get('date') };
        }
        const code = ((json as { error?: { code?: string } } | null)?.error?.code ?? null) as string | null;
        if (res.status === 429) {
          this.o.onRateLimited?.();
          last = new ExchangeError(`rate limited on ${path}`, 'retryable', 429, code);
        } else if (res.status >= 500) {
          last = new ExchangeError(`HTTP ${res.status} on ${path}`, 'retryable', res.status, code);
        } else if (res.status === 401 || res.status === 403 || (code && FATAL_CODES.has(code))) {
          this.consecutiveFailures++;
          throw new ExchangeError(`fatal ${res.status} ${code ?? ''} on ${path}: ${text.slice(0, 300)}`, 'fatal', res.status, code);
        } else if (code === 'SignatureExpired' || code === 'signature_expired') {
          last = new ExchangeError(`signature expired on ${path}`, 'retryable', res.status, code);
        } else {
          this.consecutiveFailures++;
          throw new ExchangeError(`unknown error ${res.status} ${code ?? ''} on ${path}: ${text.slice(0, 300)}`, 'unknown', res.status, code);
        }
      } catch (err) {
        if (err instanceof ExchangeError && err.kind !== 'retryable') throw err;
        if (!(err instanceof ExchangeError)) last = new ExchangeError(`network error on ${path}: ${(err as Error).message}`, 'retryable');
        else last = err;
      } finally {
        clearTimeout(timer);
      }
    }
    this.consecutiveFailures++;
    if (last?.code === 'SignatureExpired' || last?.code === 'signature_expired') {
      throw new ExchangeError(last.message, 'fatal', last.status, last.code);
    }
    throw last ?? new ExchangeError(`request failed: ${path}`, 'retryable');
  }

  private async result<T>(method: string, path: string, ro: ReqOpts = {}): Promise<T> {
    const { body } = await this.request<{ result: T }>(method, path, ro);
    return body.result;
  }

  /** Clock skew check against the Date header of a public response. Throws if > maxSkewSec. */
  async checkClock(maxSkewSec = 2): Promise<number> {
    const { date } = await this.request('GET', `/v2/products/${this.o.symbol}`);
    if (!date) return 0;
    const skew = Math.abs(this.now() - Date.parse(date)) / 1000;
    if (skew > maxSkewSec + 1) throw new ExchangeError(`clock skew ${skew.toFixed(1)}s exceeds ${maxSkewSec}s; sync the VPS clock (chrony)`, 'fatal');
    return skew;
  }

  async getCandles(start: number, end: number): Promise<Candle[]> {
    const rows = await this.result<Array<Record<string, unknown>>>('GET', '/v2/history/candles', {
      query: { resolution: '1h', symbol: this.o.symbol, start, end },
    });
    return rows.map((r) => ({ time: num(r.time), open: num(r.open), high: num(r.high), low: num(r.low), close: num(r.close), volume: num(r.volume, 0) }));
  }

  async getTicker(): Promise<Ticker> {
    const r = await this.result<Record<string, unknown>>('GET', `/v2/tickers/${this.o.symbol}`);
    return { close: num(r.close), markPrice: num(r.mark_price, num(r.close)) };
  }

  async getPosition(): Promise<Position | null> {
    const r = await this.result<Record<string, unknown> | null>('GET', '/v2/positions', { query: { product_id: this.o.productId }, auth: true });
    const size = num(r?.size, 0);
    if (!r || !size) return null;
    return { side: size > 0 ? 'buy' : 'sell', size: Math.abs(size), entryPrice: num(r.entry_price) };
  }

  async getMarginMode(): Promise<MarginMode> {
    const rows = await this.result<Array<Record<string, unknown>>>('GET', '/v2/positions/margined', {
      query: { product_ids: String(this.o.productId) },
      auth: true,
    });
    const p = (rows ?? []).find((x) => num(x.product_id, num((x.product as Record<string, unknown> | undefined)?.id)) === this.o.productId);
    const m = p?.margin_mode; // VERIFY field name
    return m === 'isolated' ? 'isolated' : m === 'cross' ? 'cross' : 'unknown';
  }

  async getOpenOrders(): Promise<Order[]> {
    const rows = await this.result<Array<Record<string, unknown>>>('GET', '/v2/orders', {
      query: { product_ids: String(this.o.productId), states: 'open,pending' },
      auth: true,
    });
    return (rows ?? []).map(toOrder);
  }

  async getBalance(): Promise<number> {
    const rows = await this.result<Array<Record<string, unknown>>>('GET', '/v2/wallet/balances', { auth: true });
    const pick = (sym: string) => rows.find((r) => String(r.asset_symbol).toUpperCase() === sym);
    const w = pick('USD') ?? pick('USDT'); // VERIFY settling asset
    if (!w) throw new ExchangeError('no USD/USDT wallet found', 'fatal');
    return num(w.available_balance, 0);
  }

  async getLeverage(): Promise<number> {
    const r = await this.result<Record<string, unknown>>('GET', `/v2/products/${this.o.productId}/orders/leverage`, { auth: true });
    return num(r.leverage);
  }

  async setLeverage(n: number): Promise<void> {
    await this.result('POST', `/v2/products/${this.o.productId}/orders/leverage`, { body: { leverage: String(n) }, auth: true });
  }

  async placeOrder(req: PlaceOrderReq): Promise<Order> {
    const body: Record<string, unknown> = {
      product_id: this.o.productId,
      size: req.size,
      side: req.side,
      order_type: 'market_order',
      client_order_id: req.clientOrderId,
    };
    if (req.reduceOnly) body.reduce_only = true;
    if (req.bracketStopLoss !== undefined) body.bracket_stop_loss_price = String(req.bracketStopLoss);
    if (req.bracketTakeProfit !== undefined) body.bracket_take_profit_price = String(req.bracketTakeProfit);
    if (req.bracketStopLoss !== undefined || req.bracketTakeProfit !== undefined) body.bracket_stop_trigger_method = 'last_traded_price';
    const r = await this.result<Record<string, unknown>>('POST', '/v2/orders', { body, auth: true, retry: false });
    return toOrder(r);
  }

  async editBracket(req: BracketReq): Promise<void> {
    const body: Record<string, unknown> = { product_id: this.o.productId, bracket_stop_trigger_method: 'last_traded_price' };
    if (req.stopLoss !== undefined) body.bracket_stop_loss_price = String(req.stopLoss);
    if (req.takeProfit !== undefined) body.bracket_take_profit_price = String(req.takeProfit);
    await this.result('PUT', '/v2/orders/bracket', { body, auth: true, retry: false });
  }

  async placeBracket(req: BracketReq): Promise<void> {
    const body: Record<string, unknown> = { product_id: this.o.productId, bracket_stop_trigger_method: 'last_traded_price' };
    if (req.stopLoss !== undefined) body.stop_loss_order = { order_type: 'market_order', stop_price: String(req.stopLoss) };
    if (req.takeProfit !== undefined) body.take_profit_order = { order_type: 'market_order', stop_price: String(req.takeProfit) };
    await this.result('POST', '/v2/orders/bracket', { body, auth: true, retry: false });
  }

  async cancelOrder(id: string): Promise<void> {
    await this.result('DELETE', '/v2/orders', { body: { id: Number(id), product_id: this.o.productId }, auth: true });
  }

  async cancelAll(): Promise<void> {
    await this.result('DELETE', '/v2/orders/all', {
      body: { product_id: this.o.productId, cancel_limit_orders: true, cancel_stop_orders: true, cancel_reduce_only_orders: true },
      auth: true,
    });
  }

  async getFills(since: number): Promise<Fill[]> {
    // VERIFY: start_time unit (provisionally microseconds) and fill field names.
    const rows = await this.result<Array<Record<string, unknown>>>('GET', '/v2/fills', {
      query: { product_ids: String(this.o.productId), start_time: Math.floor(since * 1_000_000) },
      auth: true,
    });
    return (rows ?? []).map((f) => {
      const created = f.created_at as string | number | undefined;
      const t = typeof created === 'number' ? (created > 1e14 ? created / 1e6 : created > 1e11 ? created / 1e3 : created) : created ? Date.parse(created) / 1000 : 0;
      const fillType = String(f.fill_type ?? f.role ?? '').toLowerCase();
      const meta = (f.meta_data ?? {}) as Record<string, unknown>;
      return {
        id: String(f.id),
        orderId: String(f.order_id),
        side: f.side as Side,
        size: num(f.size, 0),
        price: num(f.price),
        commission: Math.abs(num(f.commission, 0)),
        time: Math.floor(t),
        liquidation: fillType.includes('liquidation') || Boolean(meta.liquidation) || String(meta.source ?? '').includes('liquidation'),
      };
    });
  }

  async getProduct(): Promise<Product> {
    const r = await this.result<Record<string, unknown>>('GET', `/v2/products/${this.o.symbol}`);
    return { id: num(r.id), symbol: String(r.symbol), contractValue: num(r.contract_value), tickSize: num(r.tick_size) };
  }
}
