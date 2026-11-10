// In-memory ExchangePort with scriptable behaviour for executor / reconciler / cycle tests.
import type { BracketReq, ExchangePort, Fill, MarginMode, Order, PlaceOrderReq, Position, Product, Ticker } from '../../src/exchange/types.js';
import { ExchangeError } from '../../src/exchange/types.js';
import type { Candle, Side } from '../../src/shared/types.js';

export class FakeExchange implements ExchangePort {
  price = 2000;
  balance = 300;
  leverage = 20;
  position: Position | null = null;
  orders: Order[] = [];
  fills: Fill[] = [];
  candles: Candle[] = [];
  product: Product = { id: 3136, symbol: 'ETHUSD', contractValue: 0.01, tickSize: 0.05 };
  marginModes: MarginMode[] = ['isolated'];
  calls: string[] = [];
  /** Errors thrown by the next call of a method. */
  failNext = new Map<string, Error[]>();
  /** If false, market orders are accepted but never fill. */
  fills_on_place = true;
  /** editBracket accepted but does not move the stop (not an in-place edit). */
  editIsNoop = false;
  /** placeBracket silently does nothing. */
  placeBracketNoop = false;
  /** getPosition returns null for this many polls after a fill (lag). */
  positionLag = 0;
  private lagLeft = 0;
  private nextId = 1;
  now = () => 1_700_000_000;

  private maybeFail(name: string): void {
    this.calls.push(name);
    const q = this.failNext.get(name);
    if (q?.length) throw q.shift()!;
  }
  fail(name: string, err: Error = new ExchangeError(`${name} failed`, 'retryable')): void {
    const q = this.failNext.get(name) ?? [];
    q.push(err);
    this.failNext.set(name, q);
  }
  private id(): string {
    return `o${this.nextId++}`;
  }
  sl(): Order | undefined {
    return this.orders.find((o) => o.kind === 'stop_loss');
  }
  tp(): Order | undefined {
    return this.orders.find((o) => o.kind === 'take_profit');
  }

  private setLeg(kind: 'stop_loss' | 'take_profit', price: number): void {
    if (!this.position) return;
    const exitSide: Side = this.position.side === 'buy' ? 'sell' : 'buy';
    this.orders = this.orders.filter((o) => o.kind !== kind);
    this.orders.push({ id: this.id(), clientOrderId: null, side: exitSide, size: this.position.size, kind, stopPrice: price, state: 'pending' });
  }

  addFill(orderId: string, side: Side, size: number, price: number, extra: Partial<Fill> = {}): void {
    this.fills.push({ id: this.id(), orderId, side, size, price, commission: price * size * 0.01 * 0.0005, time: this.now(), liquidation: false, ...extra });
  }

  /** Simulates the exchange closing the position via an order (e.g. SL hit). */
  exchangeClose(orderId: string, price: number, extra: Partial<Fill> = {}): void {
    const pos = this.position!;
    this.addFill(orderId, pos.side === 'buy' ? 'sell' : 'buy', pos.size, price, extra);
    this.position = null;
    this.orders = [];
  }

  async getCandles(start: number, end: number): Promise<Candle[]> {
    this.maybeFail('getCandles');
    return this.candles.filter((c) => c.time >= start && c.time <= end);
  }
  async getTicker(): Promise<Ticker> {
    this.maybeFail('getTicker');
    return { close: this.price, markPrice: this.price };
  }
  async getPosition(): Promise<Position | null> {
    this.maybeFail('getPosition');
    if (this.lagLeft > 0) {
      this.lagLeft--;
      return null;
    }
    return this.position ? { ...this.position } : null;
  }
  async getMarginMode(): Promise<MarginMode> {
    this.maybeFail('getMarginMode');
    return this.marginModes.length > 1 ? this.marginModes.shift()! : this.marginModes[0];
  }
  async getOpenOrders(): Promise<Order[]> {
    this.maybeFail('getOpenOrders');
    return this.orders.map((o) => ({ ...o }));
  }
  async getBalance(): Promise<number> {
    this.maybeFail('getBalance');
    return this.balance;
  }
  async getLeverage(): Promise<number> {
    this.maybeFail('getLeverage');
    return this.leverage;
  }
  async setLeverage(n: number): Promise<void> {
    this.maybeFail('setLeverage');
    this.leverage = n;
  }
  async placeOrder(req: PlaceOrderReq): Promise<Order> {
    this.maybeFail('placeOrder');
    const order: Order = { id: this.id(), clientOrderId: req.clientOrderId, side: req.side, size: req.size, kind: 'market', stopPrice: null, state: 'closed' };
    if (!this.fills_on_place) return order;
    if (req.reduceOnly) {
      if (this.position && this.position.side !== req.side) {
        this.addFill(order.id, req.side, Math.min(req.size, this.position.size), this.price);
        this.position = null;
      }
      return order;
    }
    this.position = { side: req.side, size: req.size, entryPrice: this.price };
    this.addFill(order.id, req.side, req.size, this.price);
    this.lagLeft = this.positionLag;
    if (req.bracketStopLoss !== undefined) this.setLeg('stop_loss', req.bracketStopLoss);
    if (req.bracketTakeProfit !== undefined) this.setLeg('take_profit', req.bracketTakeProfit);
    return order;
  }
  async editBracket(req: BracketReq): Promise<void> {
    this.maybeFail('editBracket');
    if (this.editIsNoop) return;
    if (req.stopLoss !== undefined) {
      const sl = this.sl();
      if (sl) sl.stopPrice = req.stopLoss;
    }
    if (req.takeProfit !== undefined) {
      const tp = this.tp();
      if (tp) tp.stopPrice = req.takeProfit;
    }
  }
  async placeBracket(req: BracketReq): Promise<void> {
    this.maybeFail('placeBracket');
    if (this.placeBracketNoop || !this.position) return;
    const exitSide: Side = this.position.side === 'buy' ? 'sell' : 'buy';
    // Adds new legs without removing old ones (like a separate order).
    if (req.stopLoss !== undefined)
      this.orders.push({ id: this.id(), clientOrderId: null, side: exitSide, size: this.position.size, kind: 'stop_loss', stopPrice: req.stopLoss, state: 'pending' });
    if (req.takeProfit !== undefined)
      this.orders.push({ id: this.id(), clientOrderId: null, side: exitSide, size: this.position.size, kind: 'take_profit', stopPrice: req.takeProfit, state: 'pending' });
  }
  async cancelOrder(id: string): Promise<void> {
    this.maybeFail('cancelOrder');
    this.orders = this.orders.filter((o) => o.id !== id);
  }
  async cancelAll(): Promise<void> {
    this.maybeFail('cancelAll');
    this.orders = [];
  }
  async getFills(since: number): Promise<Fill[]> {
    this.maybeFail('getFills');
    return this.fills.filter((f) => f.time >= since);
  }
  async getProduct(): Promise<Product> {
    this.maybeFail('getProduct');
    return this.product;
  }
}
