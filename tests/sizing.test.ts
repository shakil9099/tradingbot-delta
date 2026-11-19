import { describe, expect, it } from 'vitest';
import { contractsFor, riskFor } from '../src/core/sizing.js';
import { P } from './helpers.js';

const s = (balanceUsd: number, price: number, riskDist = 20, risk = 0.2, maxContracts = 100000) =>
  contractsFor({ balanceUsd, price, riskDist, risk, leverage: 20, maxContracts, feeRate: P.FEE_RATE, tick: P.TICK, slippageTicks: P.SLIPPAGE_TICKS });

describe('contractsFor (risk sizing)', () => {
  it('$141, R $20, 20% at $2,000 → loses ~$28 at the stop', () => {
    // cost per ETH = 20 + 2000 × 2 × 0.00059 + 0.1 = 22.46 → 28.2 / 22.46 = 1.255 ETH → 125 contracts
    const r = s(141, 2000);
    expect(r).toMatchObject({ contracts: 125, base: 125, marginCap: 126 });
    expect(r.riskUsd).toBeCloseTo(1.25 * 22.46, 6);
    expect(r.riskUsd / 141).toBeLessThanOrEqual(0.2);
  });
  it('a wider stop means a smaller size', () => {
    expect(s(141, 2000, 40).contracts).toBe(66); // 28.2 / 42.46
  });
  it('the margin cap floor(balance × 20 × 0.9 / (price × 0.01)) binds at high prices', () => {
    expect(s(141, 4000)).toMatchObject({ contracts: 63, marginCap: 63 });
  });
  it('lower risk scales the size', () => {
    expect(s(141, 2000, 20, 0.05).contracts).toBe(31);
  });
  it('tiny balance or invalid input → SIZE_TOO_SMALL', () => {
    expect(s(1, 2000)).toMatchObject({ contracts: 0, reason: 'SIZE_TOO_SMALL' });
    expect(s(141, 2000, 0)).toMatchObject({ contracts: 0, reason: 'SIZE_TOO_SMALL' });
    expect(s(141, 2000, NaN)).toMatchObject({ contracts: 0, reason: 'SIZE_TOO_SMALL' });
  });
  it('MAX_CONTRACTS caps the size', () => {
    expect(s(141, 2000, 20, 0.2, 1).contracts).toBe(1);
  });
});

describe('riskFor (throttle)', () => {
  it('seeds the peak from the balance', () => {
    expect(riskFor(141, null, P)).toEqual({ risk: 0.2, peak: 141, drawdown: 0, reduced: false });
  });
  it('raises the peak on a new high', () => {
    expect(riskFor(200, 150, P).peak).toBe(200);
  });
  it('exactly 20% below the peak is still full risk; more than 20% is reduced', () => {
    expect(riskFor(80, 100, P)).toMatchObject({ risk: 0.2, reduced: false });
    expect(riskFor(79.99, 100, P)).toMatchObject({ risk: 0.05, reduced: true });
  });
});

describe('fixed size (FIXED_CONTRACTS)', () => {
  const base = { balanceUsd: 106.67, price: 1789.4, riskDist: 31.45, risk: 0.05, leverage: 20, maxContracts: 100, feeRate: 0.00059, tick: 0.05, slippageTicks: 1 };
  it('uses the fixed size instead of risk sizing', () => {
    expect(contractsFor(base).contracts).toBe(15); // 5% risk → 15 ct
    const r = contractsFor({ ...base, fixedContracts: 100 });
    expect(r.contracts).toBe(100);
    expect(r.riskUsd).toBeCloseTo(100 * 0.01 * (31.45 + 1789.4 * 2 * 0.00059 + 0.1), 2);
  });
  it('margin still caps it: $80 at 20x covers 80 contracts at $1789', () => {
    expect(contractsFor({ ...base, balanceUsd: 80, fixedContracts: 100 }).contracts).toBe(80);
  });
  it('MAX_CONTRACTS still caps it', () => {
    expect(contractsFor({ ...base, maxContracts: 50, fixedContracts: 100 }).contracts).toBe(50);
  });
});
