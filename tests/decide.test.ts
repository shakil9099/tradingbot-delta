import { describe, expect, it } from 'vitest';
import { decide, type DecideInput } from '../src/core/decide.js';
import type { HaltKind } from '../src/shared/types.js';

const d = (o: Partial<DecideInput>) =>
  decide({ halted: false, haltKind: null, position: null, activeSignal: 'NONE', activeDirection: null, ...o });

describe('action table — not halted', () => {
  it('flat + signal → ENTER on the signal side', () => {
    expect(d({ activeSignal: 'SHORT' })).toMatchObject({ action: 'ENTER', side: 'sell' });
  });
  it('flat + no signal → NONE (direction state never opens from flat)', () => {
    expect(d({ activeDirection: 'up' })).toMatchObject({ action: 'NONE' });
  });
  it('open + opposite signal → REVERSE', () => {
    expect(d({ position: { side: 'buy' }, activeSignal: 'SHORT', activeDirection: 'down' })).toMatchObject({
      action: 'REVERSE',
      side: 'sell',
      reason: 'signal',
    });
  });
  it('open + not opposite → TRAIL', () => {
    expect(d({ position: { side: 'buy' }, activeSignal: 'LONG', activeDirection: 'up' })).toMatchObject({ action: 'TRAIL' });
  });
  it('missed flip: direction disagrees with the position, no signal → REVERSE with missed_flip', () => {
    expect(d({ position: { side: 'buy' }, activeDirection: 'down' })).toMatchObject({ action: 'REVERSE', side: 'sell', reason: 'missed_flip' });
  });
  it('a null direction never triggers a reversal', () => {
    expect(d({ position: { side: 'sell' }, activeDirection: null })).toMatchObject({ action: 'TRAIL' });
  });
});

describe('action table — halted, one case per HaltKind', () => {
  const protecting: HaltKind[] = ['breaker', 'manual', 'crash_loop'];
  const frozen: HaltKind[] = ['mismatch', 'fatal_error'];

  it('halted + flat → NONE for every kind (liquidation always leaves the bot flat)', () => {
    for (const k of [...protecting, ...frozen, 'liquidation' as const]) {
      expect(d({ halted: true, haltKind: k, activeSignal: 'LONG' })).toMatchObject({ action: 'NONE' });
    }
  });
  it.each(protecting)('%s: opposite → CLOSE only, otherwise TRAIL', (k) => {
    expect(d({ halted: true, haltKind: k, position: { side: 'buy' }, activeSignal: 'SHORT' }).action).toBe('CLOSE');
    expect(d({ halted: true, haltKind: k, position: { side: 'buy' }, activeDirection: 'down' }).action).toBe('CLOSE');
    expect(d({ halted: true, haltKind: k, position: { side: 'buy' }, activeDirection: 'up' }).action).toBe('TRAIL');
  });
  it.each(frozen)('%s: open position → NONE (bracket stays, author decides)', (k) => {
    expect(d({ halted: true, haltKind: k, position: { side: 'buy' }, activeSignal: 'SHORT' }).action).toBe('NONE');
    expect(d({ halted: true, haltKind: k, position: { side: 'buy' } }).action).toBe('NONE');
  });
});
