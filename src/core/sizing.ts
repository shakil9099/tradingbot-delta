// Risk sizing (design Amendment A.4): contracts so that an initial-stop exit, fees included, loses `risk` of the
// balance; capped by margin (balance × leverage × 0.9) and MAX_CONTRACTS. Risk drops to RISK_REDUCED while the
// balance is more than RISK_REDUCE_DD below its recorded peak.

export interface SizingInput {
  balanceUsd: number;
  price: number;
  /** Initial stop distance R in $ per ETH. */
  riskDist: number;
  /** Share of the balance to risk, e.g. 0.2. */
  risk: number;
  leverage: number;
  maxContracts: number;
  feeRate: number;
  tick: number;
  slippageTicks: number;
  /** ETH per contract; 0.01 for ETHUSD. */
  contractValue?: number;
}

export interface SizingResult {
  contracts: number;
  base: number;
  marginCap: number;
  effectiveLeverage: number;
  /** $ lost if the initial stop is hit (fees and slippage included). */
  riskUsd: number;
  reason?: 'SIZE_TOO_SMALL';
}

const EPS = 1e-9;

export function contractsFor(input: SizingInput): SizingResult {
  const { balanceUsd, price, riskDist, risk, leverage, maxContracts } = input;
  const cv = input.contractValue ?? 0.01;
  const costPerEth = riskDist + price * 2 * input.feeRate + 2 * input.slippageTicks * input.tick;
  const ok = balanceUsd > 0 && price > 0 && riskDist > 0 && risk > 0 && Number.isFinite(costPerEth);
  const base = ok ? Math.floor((balanceUsd * risk) / costPerEth / cv + EPS) : 0;
  const marginCap = ok ? Math.floor((balanceUsd * leverage * 0.9) / (price * cv) + EPS) : 0;
  const contracts = Math.max(0, Math.min(base, marginCap, Math.floor(maxContracts)));
  if (contracts < 1) return { contracts: 0, base, marginCap, effectiveLeverage: 0, riskUsd: 0, reason: 'SIZE_TOO_SMALL' };
  return { contracts, base, marginCap, effectiveLeverage: (contracts * cv * price) / balanceUsd, riskUsd: contracts * cv * costPerEth };
}

export interface ThrottleParams {
  RISK_PER_TRADE: number;
  RISK_REDUCED: number;
  RISK_REDUCE_DD: number;
}

/** Risk for the next entry, and the peak to store (max of the old peak and the balance). */
export function riskFor(balance: number, peak: number | null, p: ThrottleParams): { risk: number; peak: number; drawdown: number; reduced: boolean } {
  const pk = Math.max(peak ?? balance, balance);
  const drawdown = pk > 0 ? (pk - balance) / pk : 0;
  const reduced = drawdown > p.RISK_REDUCE_DD;
  return { risk: reduced ? p.RISK_REDUCED : p.RISK_PER_TRADE, peak: pk, drawdown, reduced };
}
