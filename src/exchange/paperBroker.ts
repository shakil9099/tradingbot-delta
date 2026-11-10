// DRY_RUN exchange: public market data from Delta, everything else virtual (state in kv.paper_state).
// Market fills at ticker ± 1 tick against the trade. Virtual SL/TP trigger on each reconcile tick,
// producing fills with the SL/TP order's own id so exit classification and the breaker work unchanged.

import type { Params } from '../config/params.js';
import type { Repo } from '../store/repo.js';
import type { Candle, Side } from '../shared/types.js';
import type { BracketReq, ExchangePort, Fill, MarginMode, Order, PlaceOrderReq, Position, Product, Ticker } from './types.js';

interface PaperState {
  balance: number;
  position: Position | null;
  orders: Order[];
  fills: Fill[];
  nextId: number;
  leverage: number;
}

type MarketData = Pick<ExchangePort, 'getCandles' | 'getTicker' | 'getProduct'>;

export class PaperBroker implements ExchangePort {
  constructor(
    private readonly market: MarketData,
    private readonly repo: Repo,
    private readonly p: Readonly<Params>,
    private readonly now: () => number = () => Math.floor(Date.now() / 1000),
  ) {}

  private load(): PaperState {
    return this.repo.kvJson<PaperState>('paper_state', {
      balance: this.p.PAPER_BALANCE,
      position: null,
      orders: [],
      fills: [],
      nextId: 1,
      leverage: this.p.LEVERAGE,
    });
  }
  private save(s: PaperState): void {
    s.fills = s.fills.slice(-500);
    this.repo.kvSet('paper_state', JSON.stringify(s));
  }
  private id(s: PaperState): string {
    return `paper-${s.nextId++}`;
  }
  private slip(side: Side, price: number): number {
    const d = this.p.SLIPPAGE_TICKS * this.p.TICK;
    return +(side === 'buy' ? price + d : price - d).toFixed(4);
  }

  /** Applies a fill to the virtual position and balance. */
  private fill(s: PaperState, orderId: string, side: Side, size: number, price: number, liquidation = false): void {
    const cv = this.p.CONTRACT_VALUE;
    const commission = price * size * cv * this.p.FEE_RATE;
    s.fills.push({ id: this.id(s), orderId, side, size, price, commission, time: this.now(), liquidation });
    s.balance -= commission;
    const pos = s.position;
    if (!pos) {
      s.position = { side, size, entryPrice: price };
      return;
    }
    if (pos.side === side) {
      const total = pos.size + size;
      s.position = { side, size: total, entryPrice: (pos.entryPrice * pos.size + price * size) / total };
      return;
    }
    const closed = Math.min(pos.size, size);
    s.balance += (pos.side === 'buy' ? price - pos.entryPrice : pos.entryPrice - price) * closed * cv;
    const rest = pos.size - closed;
    s.position = rest > 0 ? { ...pos, size: rest } : null;
    if (!s.position) s.orders = s.orders.filter((o) => o.kind !== 'stop_loss' && o.kind !== 'take_profit');
  }

  private setBracket(s: PaperState, req: BracketReq): void {
    const pos = s.position;
    if (!pos) return;
    const exitSide: Side = pos.side === 'buy' ? 'sell' : 'buy';
    if (req.stopLoss !== undefined) {
      s.orders = s.orders.filter((o) => o.kind !== 'stop_loss');
      s.orders.push({ id: this.id(s), clientOrderId: null, side: exitSide, size: pos.size, kind: 'stop_loss', stopPrice: req.stopLoss, state: 'pending' });
    }
    if (req.takeProfit !== undefined) {
      s.orders = s.orders.filter((o) => o.kind !== 'take_profit');
      s.orders.push({ id: this.id(s), clientOrderId: null, side: exitSide, size: pos.size, kind: 'take_profit', stopPrice: req.takeProfit, state: 'pending' });
    }
  }

  // ---- market data (pass-through) ----
  getCandles(start: number, end: number): Promise<Candle[]> {
    return this.market.getCandles(start, end);
  }
  getTicker(): Promise<Ticker> {
    return this.market.getTicker();
  }
  getProduct(): Promise<Product> {
    return this.market.getProduct();
  }

  // ---- virtual account ----
  async getPosition(): Promise<Position | null> {
    return this.load().position;
  }
  async getMarginMode(): Promise<MarginMode> {
    return 'isolated';
  }
  async getOpenOrders(): Promise<Order[]> {
    return this.load().orders;
  }
  async getBalance(): Promise<number> {
    return this.load().balance;
  }
  async getLeverage(): Promise<number> {
    return this.load().leverage;
  }
  async setLeverage(n: number): Promise<void> {
    const s = this.load();
    s.leverage = n;
    this.save(s);
  }
  async placeOrder(req: PlaceOrderReq): Promise<Order> {
    const s = this.load();
    const tk = await this.market.getTicker();
    let size = req.size;
    if (req.reduceOnly) {
      if (!s.position || s.position.side === req.side) size = 0;
      else size = Math.min(size, s.position.size);
    }
    const order: Order = { id: this.id(s), clientOrderId: req.clientOrderId, side: req.side, size, kind: 'market', stopPrice: null, state: 'closed' };
    if (size > 0) {
      this.fill(s, order.id, req.side, size, this.slip(req.side, tk.close));
      if (req.bracketStopLoss !== undefined || req.bracketTakeProfit !== undefined) {
        this.setBracket(s, { stopLoss: req.bracketStopLoss, takeProfit: req.bracketTakeProfit });
      }
    }
    this.save(s);
    return order;
  }
  async editBracket(req: BracketReq): Promise<void> {
    const s = this.load();
    this.setBracket(s, req);
    this.save(s);
  }
  async placeBracket(req: BracketReq): Promise<void> {
    const s = this.load();
    this.setBracket(s, req);
    this.save(s);
  }
  async cancelOrder(id: string): Promise<void> {
    const s = this.load();
    s.orders = s.orders.filter((o) => o.id !== id);
    this.save(s);
  }
  async cancelAll(): Promise<void> {
    const s = this.load();
    s.orders = [];
    this.save(s);
  }
  async getFills(since: number): Promise<Fill[]> {
    return this.load().fills.filter((f) => f.time >= since);
  }
  async getOrderByClientId(id: string): Promise<Order | null> {
    return this.load().orders.find((o) => o.clientOrderId === id) ?? null;
  }

  /** Triggers virtual SL/TP against the ticker (called by the reconciler each tick). */
  async tick(): Promise<void> {
    const s = this.load();
    const pos = s.position;
    if (!pos) return;
    const px = (await this.market.getTicker()).close;
    const sl = s.orders.find((o) => o.kind === 'stop_loss');
    const tp = s.orders.find((o) => o.kind === 'take_profit');
    const exitSide: Side = pos.side === 'buy' ? 'sell' : 'buy';
    const hitSl = sl && sl.stopPrice !== null && (pos.side === 'buy' ? px <= sl.stopPrice : px >= sl.stopPrice);
    const hitTp = tp && tp.stopPrice !== null && (pos.side === 'buy' ? px >= tp.stopPrice : px <= tp.stopPrice);
    const hit = hitSl ? sl : hitTp ? tp : null;
    if (!hit || hit.stopPrice === null) return;
    this.fill(s, hit.id, exitSide, pos.size, this.slip(exitSide, hit.stopPrice));
    this.save(s);
  }
}
