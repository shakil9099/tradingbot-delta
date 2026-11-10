import type { Candle, Side } from '../shared/types.js';

export interface Ticker {
  close: number;
  markPrice: number;
}

/** Open position. size is in contracts and always positive; side gives the direction. */
export interface Position {
  side: Side;
  size: number;
  entryPrice: number;
}

export type OrderKind = 'market' | 'limit' | 'stop_loss' | 'take_profit' | 'other';

export interface Order {
  id: string;
  clientOrderId: string | null;
  side: Side;
  size: number;
  kind: OrderKind;
  stopPrice: number | null;
  state: string;
}

export interface Fill {
  id: string;
  orderId: string;
  side: Side;
  size: number;
  price: number;
  commission: number;
  /** unix seconds */
  time: number;
  liquidation: boolean;
}

export interface Product {
  id: number;
  symbol: string;
  contractValue: number;
  tickSize: number;
}

export interface PlaceOrderReq {
  side: Side;
  size: number;
  clientOrderId: string;
  reduceOnly?: boolean;
  bracketStopLoss?: number;
  bracketTakeProfit?: number;
}

export interface BracketReq {
  stopLoss?: number;
  takeProfit?: number;
}

export type MarginMode = 'isolated' | 'cross' | 'unknown';

/** Everything the bot needs from an exchange. deltaClient, paperBroker and the test fake implement it. */
export interface ExchangePort {
  getCandles(start: number, end: number): Promise<Candle[]>;
  getTicker(): Promise<Ticker>;
  getPosition(): Promise<Position | null>;
  getMarginMode(): Promise<MarginMode>;
  getOpenOrders(): Promise<Order[]>;
  getBalance(): Promise<number>;
  getLeverage(): Promise<number>;
  setLeverage(n: number): Promise<void>;
  placeOrder(req: PlaceOrderReq): Promise<Order>;
  editBracket(req: BracketReq): Promise<void>;
  placeBracket(req: BracketReq): Promise<void>;
  cancelOrder(id: string): Promise<void>;
  cancelAll(): Promise<void>;
  /** Fills at or after `since` (unix seconds). */
  getFills(since: number): Promise<Fill[]>;
  getProduct(): Promise<Product>;
  getOrderByClientId?(id: string): Promise<Order | null>;
  /** Called by the reconciler each tick (paper broker triggers virtual brackets). */
  tick?(): Promise<void>;
}

export type ErrorKind = 'retryable' | 'fatal' | 'unknown';

export class ExchangeError extends Error {
  constructor(
    message: string,
    readonly kind: ErrorKind,
    readonly status: number | null = null,
    readonly code: string | null = null,
  ) {
    super(message);
    this.name = 'ExchangeError';
  }
}
