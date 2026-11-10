import { describe, expect, it } from 'vitest';
import { nextCount, shouldHalt } from '../src/core/breaker.js';

describe('breaker', () => {
  it('three sl_stage_0 exits trip the breaker', () => {
    let c = 0;
    c = nextCount(c, 'sl_stage_0', -22.6);
    c = nextCount(c, 'sl_stage_0', -22.6);
    expect(shouldHalt(c, 3)).toBe(false);
    c = nextCount(c, 'sl_stage_0', -22.6);
    expect(shouldHalt(c, 3)).toBe(true);
  });
  it('a profitable exit resets the count', () => {
    expect(nextCount(2, 'tp', 97)).toBe(0);
    expect(nextCount(2, 'reversal', 3)).toBe(0);
  });
  it('a losing reversal leaves the count unchanged', () => {
    expect(nextCount(2, 'reversal', -5)).toBe(2);
  });
  it('sl_stage_1 leaves the count unchanged', () => {
    expect(nextCount(2, 'sl_stage_1', -0.1)).toBe(2);
  });
  it('external leaves the count unchanged, even when profitable', () => {
    expect(nextCount(2, 'external', 50)).toBe(2);
  });
});
