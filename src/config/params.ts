import { createHash } from 'node:crypto';

export type StrategyMode = 'adaptive' | 'hull' | 'ut';

export interface Params {
  PRODUCT_ID: number;
  SYMBOL: string;
  CONTRACT_VALUE: number;
  TICK: number;
  HULL_LEN: number;
  UT_KEY: number;
  UT_ATR: number;
  /** Strategy v2 exits (design Amendment A). R = initial stop distance in $. */
  ATR_LEN: number;
  SL_ATR_MULT: number;
  SL_MIN: number;
  SL_MAX: number;
  MIN_ATR: number;
  BE_TRIG_R: number;
  TRAIL_TRIG_R: number;
  TRAIL_ATR_MULT: number;
  /** Take-profit in R; 0 = none. */
  TP_R: number;
  /** Share of the balance lost if the initial stop is hit (fees included). */
  RISK_PER_TRADE: number;
  RISK_REDUCED: number;
  /** Use RISK_REDUCED while the balance is more than this share below its peak. */
  RISK_REDUCE_DD: number;
  LEVERAGE: number;
  SEL_N: number;
  SEL_MARGIN: number;
  FEE_RATE: number;
  BREAKER_N: number;
  WARMUP: number;
  STRATEGY: StrategyMode;
  DRY_RUN: boolean;
  MAX_CONTRACTS: number;
  SLIPPAGE_TICKS: number;
  PAPER_BALANCE: number;
  /** Volatility gate: skip new entries when ATR(14) on 1h is above this. 0 = off. Added 2026-11-09, pending author approval. */
  ATR_GATE_MAX: number;
  /** No new entries that would fill on Saturday or Sunday IST. Added 2026-11-09 at the author's request. */
  SKIP_WEEKEND_ENTRIES: boolean;
}

/** Defaults from the design's parameter registry. */
export const DEFAULT_PARAMS: Readonly<Params> = Object.freeze({
  PRODUCT_ID: 3136,
  SYMBOL: 'ETHUSD',
  CONTRACT_VALUE: 0.01,
  TICK: 0.05,
  HULL_LEN: 55,
  UT_KEY: 2,
  UT_ATR: 6,
  ATR_LEN: 14,
  SL_ATR_MULT: 2,
  SL_MIN: 10,
  SL_MAX: 40,
  MIN_ATR: 15,
  BE_TRIG_R: 0.5,
  TRAIL_TRIG_R: 1.5,
  TRAIL_ATR_MULT: 3,
  TP_R: 0,
  RISK_PER_TRADE: 0.2,
  RISK_REDUCED: 0.05,
  RISK_REDUCE_DD: 0.2,
  LEVERAGE: 20,
  SEL_N: 10,
  SEL_MARGIN: 20,
  FEE_RATE: 0.00059,
  BREAKER_N: 3,
  WARMUP: 200,
  STRATEGY: 'adaptive',
  DRY_RUN: false,
  MAX_CONTRACTS: 100000,
  SLIPPAGE_TICKS: 1,
  PAPER_BALANCE: 141,
  ATR_GATE_MAX: 0,
  SKIP_WEEKEND_ENTRIES: true,
});

export type ParamOverrides = Partial<Pick<Params, 'LEVERAGE' | 'STRATEGY' | 'DRY_RUN' | 'MAX_CONTRACTS' | 'PAPER_BALANCE' | 'ATR_GATE_MAX' | 'SKIP_WEEKEND_ENTRIES' | 'MIN_ATR' | 'RISK_PER_TRADE' | 'RISK_REDUCED' | 'RISK_REDUCE_DD'>>;

/** Builds the frozen params object. Only the env-overridable keys can change. */
export function buildParams(overrides: ParamOverrides = {}): Readonly<Params> {
  return Object.freeze({ ...DEFAULT_PARAMS, ...overrides });
}

/** SHA-256 of the sorted params JSON, first 12 hex chars. Fills trades.config_hash. */
export function paramsHash(params: Readonly<Params>): string {
  const sorted = Object.fromEntries(Object.entries(params).sort(([a], [b]) => a.localeCompare(b)));
  return createHash('sha256').update(JSON.stringify(sorted)).digest('hex').slice(0, 12);
}
