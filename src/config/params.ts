import { createHash } from 'node:crypto';

export type StrategyMode = 'adaptive' | 'hull' | 'ut' | 'reversal' | 'revaa';

export interface Params {
  PRODUCT_ID: number;
  SYMBOL: string;
  CONTRACT_VALUE: number;
  TICK: number;
  HULL_LEN: number;
  UT_KEY: number;
  UT_ATR: number;
  /** Reversal (pine/reversal.pine, Medium preset): threshold = max(ATR(REV_ATR_LEN) × REV_ATR_MULT, close × REV_MIN_PCT). */
  REV_ATR_LEN: number;
  REV_ATR_MULT: number;
  REV_MIN_PCT: number;
  /**
   * Mix B (design_draft.md, 2026-11-19): Hull also enters on a reversal signal that agrees with Hull's direction
   * (re-entry after a stop-out). Hull flips still win and are the only signals that reverse. false = plain Hull.
   */
  REV_REENTRY: boolean;
  /** Strategy v2 exits (design Amendment A). R = initial stop distance in $. */
  ATR_LEN: number;
  SL_ATR_MULT: number;
  SL_MIN: number;
  SL_MAX: number;
  MIN_ATR: number;
  BE_TRIG_R: number;
  /** Break-even also when a close is this many $ per ETH in profit (whichever of this and BE_TRIG_R comes first). 0 = off. */
  BE_TRIG_USD: number;
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
  /** Consecutive initial-stop exits that halt the bot. 0 = breaker off. */
  BREAKER_N: number;
  WARMUP: number;
  STRATEGY: StrategyMode;
  DRY_RUN: boolean;
  MAX_CONTRACTS: number;
  /** Fixed size in contracts for every entry (100 = 1 ETH); 0 = risk sizing. Still limited by margin and MAX_CONTRACTS. */
  FIXED_CONTRACTS: number;
  SLIPPAGE_TICKS: number;
  PAPER_BALANCE: number;
  /** Volatility gate: skip new entries when ATR(14) on 1h is above this. 0 = off. Added 2026-11-09, pending author approval. */
  ATR_GATE_MAX: number;
  /** No new entries that would fill on Saturday or Sunday IST. Added 2026-11-09 at the author's request. */
  SKIP_WEEKEND_ENTRIES: boolean;
  /** No new entries for the rest of the IST day once today's realised net ≤ −this × the day-start balance. 0 = off. */
  DAY_LOSS_STOP: number;
  /** STRATEGY=revaa: 1h bars in the window (AlgoAlpha levels persist; 3,000+ matches full history). */
  AA_WINDOW: number;
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
  REV_ATR_LEN: 14,
  REV_ATR_MULT: 2,
  REV_MIN_PCT: 0.001,
  REV_REENTRY: false,
  ATR_LEN: 14,
  SL_ATR_MULT: 2,
  SL_MIN: 10,
  SL_MAX: 40,
  MIN_ATR: 15,
  /** 2026-11-14: 0.5 → 1 (docs/hull-breakeven.md: later move-to-cost beat 0.5R in both test periods). */
  BE_TRIG_R: 1,
  /** 2026-11-19, author's request (no backtest): protect capital, cost-to-cost at +$15 on a close. */
  BE_TRIG_USD: 15,
  /** 2026-11-19: 1.5 → 1 (docs/mixb-grid.md: trail from 1R beat 1.5R for Mix B in both periods with a smaller worst drop). */
  TRAIL_TRIG_R: 1,
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
  FIXED_CONTRACTS: 0,
  SLIPPAGE_TICKS: 1,
  PAPER_BALANCE: 141,
  ATR_GATE_MAX: 0,
  SKIP_WEEKEND_ENTRIES: true,
  DAY_LOSS_STOP: 0,
  AA_WINDOW: 4000,
});

export type ParamOverrides = Partial<Pick<Params, 'LEVERAGE' | 'STRATEGY' | 'DRY_RUN' | 'MAX_CONTRACTS' | 'PAPER_BALANCE' | 'ATR_GATE_MAX' | 'SKIP_WEEKEND_ENTRIES' | 'MIN_ATR' | 'RISK_PER_TRADE' | 'RISK_REDUCED' | 'RISK_REDUCE_DD' | 'BREAKER_N' | 'TP_R' | 'FIXED_CONTRACTS' | 'BE_TRIG_USD' | 'REV_REENTRY' | 'DAY_LOSS_STOP'>>;

/** Reversal's take-profit until the backtest (docs/reversal-backtest.md) is reviewed. */
export const REVERSAL_DEFAULT_TP_R = 2;

/**
 * STRATEGY=reversal applies the reversal exit preset: no break-even, no trailing stop, take-profit at TP_R × R
 * (REVERSAL_DEFAULT_TP_R unless tpOverride is given). Other strategies are returned unchanged.
 * Exits are global, so switch STRATEGY or TP_R only while flat.
 */
export function withStrategyPreset(p: Params, tpOverride?: number): Params {
  if (p.STRATEGY !== 'reversal') return p;
  return { ...p, BE_TRIG_R: 0, BE_TRIG_USD: 0, TRAIL_ATR_MULT: 0, TP_R: tpOverride ?? REVERSAL_DEFAULT_TP_R };
}

/** Builds the frozen params object. Only the env-overridable keys can change. */
export function buildParams(overrides: ParamOverrides = {}): Readonly<Params> {
  return Object.freeze(withStrategyPreset({ ...DEFAULT_PARAMS, ...overrides }, overrides.TP_R));
}

/** SHA-256 of the sorted params JSON, first 12 hex chars. Fills trades.config_hash. */
export function paramsHash(params: Readonly<Params>): string {
  const sorted = Object.fromEntries(Object.entries(params).sort(([a], [b]) => a.localeCompare(b)));
  return createHash('sha256').update(JSON.stringify(sorted)).digest('hex').slice(0, 12);
}
