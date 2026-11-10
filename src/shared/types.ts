// Shared domain and API types. Imported by the server (relative path) and by web/ (via @shared).

export type Side = 'buy' | 'sell';

export interface Candle {
  /** Bar open time, unix seconds. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type StrategyId = 'hull' | 'ut';
/** Strategy recorded on a trade; adopted trades are 'unknown'. */
export type TradeStrategy = StrategyId | 'unknown';

export type Signal = 'LONG' | 'SHORT' | 'NONE';
export type Direction = 'up' | 'down' | null;

export type Stage = 0 | 1 | 2;

export type TradeStatus = 'OPENING' | 'OPEN' | 'CLOSING' | 'CLOSED' | 'FAILED';

export type ExitReason =
  | 'sl_stage_0'
  | 'sl_stage_1'
  | 'sl_stage_2'
  | 'tp'
  | 'reversal'
  | 'manual'
  | 'trail_breached'
  | 'margin_mode'
  | 'liquidation'
  | 'external';

export type Action = 'ENTER' | 'REVERSE' | 'CLOSE' | 'TRAIL' | 'NONE' | 'ERROR';

export type HaltKind = 'breaker' | 'manual' | 'mismatch' | 'fatal_error' | 'crash_loop' | 'liquidation';

export type SystemEventType =
  | 'strategy_switch'
  | 'halt'
  | 'resume'
  | 'boot'
  | 'cycle_missed'
  | 'reconcile_mismatch'
  | 'peak_reset'
  | 'mode_migrated'
  | 'mode_change'
  | 'credentials_saved'
  | 'credentials_removed';

export type SimExitReason = 'sl_stage_0' | 'sl_stage_1' | 'sl_stage_2' | 'tp' | 'reversal';

export interface SimTrade {
  strategy: StrategyId;
  entryTime: number;
  side: Side;
  entry: number;
  exitTime: number;
  exit: number;
  reason: SimExitReason;
  /** All P&L figures are per 1 ETH. */
  grossPnl: number;
  fees: number;
  netPnl: number;
  /** Initial stop distance R in $ (for risk sizing in backtests). */
  riskDist?: number;
}

export interface TradeRow {
  id: number;
  client_order_id: string;
  status: TradeStatus;
  side: Side;
  size_contracts: number;
  strategy: TradeStrategy;
  dry_run: 0 | 1;
  entry_reason: string; // JSON
  entry_time: number | null;
  entry_price: number | null;
  sl_price: number | null;
  tp_price: number | null;
  /** Initial stop distance R in $ (Strategy v2); null for trades opened before the upgrade or adopted. */
  risk_dist: number | null;
  stage: Stage;
  sl_order_id: string | null;
  tp_order_id: string | null;
  close_reason: ExitReason | null;
  close_client_order_id: string | null;
  exit_time: number | null;
  exit_price: number | null;
  exit_reason: ExitReason | null;
  gross_pnl: number | null;
  fees: number | null;
  net_pnl: number | null;
  config_hash: string;
}

export type TradeEventType = 'sl_move' | 'bracket_attach' | 'partial_fill' | 'size_change' | 'error';

export interface TradeEvent {
  id: number;
  trade_id: number;
  time: number;
  type: TradeEventType;
  data: string; // JSON
}

export interface SystemEvent {
  id: number;
  time: number;
  type: SystemEventType;
  data: string; // JSON
}

export interface DecisionRow {
  candle_time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  hull: number | null;
  hull_prev2: number | null;
  ut_stop: number | null;
  atr: number | null;
  sig_hull: Signal;
  sig_ut: Signal;
  score_hull: number;
  score_ut: number;
  active: StrategyId;
  pending: StrategyId | null;
  action: Action;
  note: string | null;
}

export interface StrategyStats {
  count: number;
  wins: number;
  winRate: number;
  netPnl: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number | null;
}

export interface StatsResponse {
  total: StrategyStats;
  byStrategy: Record<TradeStrategy, StrategyStats>;
  feesPaid: number;
  maxDrawdown: number;
  equity: { time: number; equity: number }[];
}

export type InsightSeverity = 'info' | 'warn' | 'alert';

export interface Insight {
  id: string;
  severity: InsightSeverity;
  message: string;
  metric: number | null;
}

export interface StatusResponse {
  position: { side: Side; sizeContracts: number; entryPrice: number } | null;
  slPrice: number | null;
  tpPrice: number | null;
  stage: Stage | null;
  unrealizedPnl: number | null;
  balance: number | null;
  halted: boolean;
  haltReason: string | null;
  haltKind: HaltKind | null;
  consecutiveSl: number;
  active: StrategyId;
  pending: StrategyId | null;
  scores: Record<StrategyId, number>;
  lastSwitchReason: string | null;
  dryRun: boolean;
  paramsHash: string;
  nextCycleAt: number | null;
  /** Risk throttle (design Amendment A.4). */
  risk: { perTrade: number; reduced: number; reduceBelowPeak: number; peak: number | null; drawdown: number | null; current: number | null };
}
