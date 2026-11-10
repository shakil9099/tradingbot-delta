import { describe, expect, it } from 'vitest';
import { decide } from '../src/core/decide.js';
import { select, type SelectInput } from '../src/core/selector.js';
import { P } from './helpers.js';

const base: SelectInput = {
  scores: { hull: 0, ut: 0 },
  counts: { hull: 10, ut: 10 },
  active: 'hull',
  pending: null,
  isFlat: true,
  positionSide: null,
  signals: { hull: 'NONE', ut: 'NONE' },
  override: null,
};

describe('select', () => {
  it('cold start: fewer than 10 trades for either strategy → hull', () => {
    const r = select({ ...base, active: 'ut', counts: { hull: 12, ut: 9 } }, P);
    expect(r).toMatchObject({ active: 'hull', pending: null, switched: true });
  });

  it('margin boundary: a 19.99 lead does not switch, a 20 lead does', () => {
    expect(select({ ...base, scores: { hull: 0, ut: 19.99 } }, P)).toMatchObject({ active: 'hull', switched: false, pending: null });
    expect(select({ ...base, scores: { hull: 0, ut: 20 } }, P)).toMatchObject({ active: 'ut', switched: true, pending: null });
  });

  it('flat switch counts a same-bar signal of the new strategy (the caller then enters)', () => {
    const r = select({ ...base, scores: { hull: -10, ut: 30 }, signals: { hull: 'NONE', ut: 'LONG' } }, P);
    expect(r.active).toBe('ut');
    const d = decide({ halted: false, haltKind: null, position: null, activeSignal: 'LONG', activeDirection: 'up' });
    expect(d).toMatchObject({ action: 'ENTER', side: 'buy' });
  });

  it('in a position: stays pending until the pending strategy signals against the position, then switches (REVERSE)', () => {
    const inPos = { ...base, isFlat: false, positionSide: 'buy' as const, scores: { hull: 0, ut: 25 } };
    expect(select(inPos, P)).toMatchObject({ active: 'hull', pending: 'ut', switched: false });
    expect(select({ ...inPos, signals: { hull: 'NONE', ut: 'LONG' } }, P)).toMatchObject({ active: 'hull', pending: 'ut' });
    const sw = select({ ...inPos, signals: { hull: 'NONE', ut: 'SHORT' } }, P);
    expect(sw).toMatchObject({ active: 'ut', pending: null, switched: true });
    const d = decide({ halted: false, haltKind: null, position: { side: 'buy' }, activeSignal: 'SHORT', activeDirection: 'down' });
    expect(d).toMatchObject({ action: 'REVERSE', side: 'sell' });
  });

  it('clears pending when the lead disappears', () => {
    const r = select({ ...base, isFlat: false, positionSide: 'buy', pending: 'ut', scores: { hull: 0, ut: 5 } }, P);
    expect(r.pending).toBeNull();
  });

  it('override bypasses the selector', () => {
    expect(select({ ...base, override: 'ut', counts: { hull: 0, ut: 0 } }, P)).toMatchObject({ active: 'ut', switched: true });
    expect(select({ ...base, active: 'ut', override: 'ut' }, P)).toMatchObject({ active: 'ut', switched: false });
  });

  it('has no side effects on its input', () => {
    const input = structuredClone({ ...base, scores: { hull: 0, ut: 50 } });
    const copy = structuredClone(input);
    select(input, P);
    expect(input).toEqual(copy);
  });
});
