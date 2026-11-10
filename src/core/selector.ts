// Strategy Selection Contract, rules 1–5. Pure: the caller writes the strategy_switch event (rule 6).

import type { Side, Signal, StrategyId } from '../shared/types.js';

export interface SelectInput {
  scores: Record<StrategyId, number>;
  counts: Record<StrategyId, number>;
  active: StrategyId;
  pending: StrategyId | null;
  isFlat: boolean;
  positionSide: Side | null;
  signals: Record<StrategyId, Signal>;
  /** Set when STRATEGY=hull|ut; bypasses the selector. */
  override: StrategyId | null;
}

export interface SelectResult {
  active: StrategyId;
  pending: StrategyId | null;
  switched: boolean;
  reason: string;
}

export interface SelectParams {
  SEL_N: number;
  SEL_MARGIN: number;
}

const EPS = 1e-9;
const other = (s: StrategyId): StrategyId => (s === 'hull' ? 'ut' : 'hull');
const fmt = (n: number) => n.toFixed(2);

export function select(input: SelectInput, p: SelectParams): SelectResult {
  const { scores, counts, active, isFlat, positionSide, signals, override } = input;

  // Rule 5: fixed strategy.
  if (override) {
    return { active: override, pending: null, switched: override !== active, reason: `override STRATEGY=${override}` };
  }

  // Rule 1: cold start.
  if (counts.hull < p.SEL_N || counts.ut < p.SEL_N) {
    return {
      active: 'hull',
      pending: null,
      switched: active !== 'hull',
      reason: `cold start (hull ${counts.hull}, ut ${counts.ut} sim trades < ${p.SEL_N})`,
    };
  }

  // Rule 2: pending when the other strategy leads by at least SEL_MARGIN.
  const candidate = other(active);
  const leads = scores[candidate] >= scores[active] + p.SEL_MARGIN - EPS;
  const pending: StrategyId | null = leads ? candidate : null;
  const leadText = `${candidate} ${fmt(scores[candidate])} vs ${active} ${fmt(scores[active])}`;

  if (!pending) return { active, pending: null, switched: false, reason: 'no lead' };

  // Rule 3: flat → switch now.
  if (isFlat) return { active: pending, pending: null, switched: true, reason: `score lead while flat: ${leadText}` };

  // Rule 4: in a position → switch only when the pending strategy signals against the position.
  const sig = signals[pending];
  const sigSide: Side | null = sig === 'LONG' ? 'buy' : sig === 'SHORT' ? 'sell' : null;
  if (sigSide && positionSide && sigSide !== positionSide) {
    return { active: pending, pending: null, switched: true, reason: `score lead + opposite ${pending} signal: ${leadText}` };
  }
  return { active, pending, switched: false, reason: `pending ${pending}: ${leadText}` };
}
