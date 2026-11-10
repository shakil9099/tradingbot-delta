import type { Params } from '../config/params.js';
import type { ExchangePort, Order } from '../exchange/types.js';
import type { Side } from '../shared/types.js';
import type { Repo } from '../store/repo.js';
import type { Halt } from './halt.js';

export interface Ctx {
  port: ExchangePort;
  repo: Repo;
  params: Readonly<Params>;
  halt: Halt;
  configHash: string;
  /** ms */
  sleep: (ms: number) => Promise<void>;
  /** unix seconds */
  now: () => number;
}

export const opposite = (s: Side): Side => (s === 'buy' ? 'sell' : 'buy');
export const floorHour = (t: number) => Math.floor(t / 3600) * 3600;

export function brackets(orders: readonly Order[]): { sl: Order | null; tp: Order | null; sls: Order[] } {
  const sls = orders.filter((o) => o.kind === 'stop_loss');
  return { sl: sls[0] ?? null, tp: orders.find((o) => o.kind === 'take_profit') ?? null, sls };
}

export const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
