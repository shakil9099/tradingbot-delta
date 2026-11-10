import { describe, expect, it } from 'vitest';
import { isBreached, roundTick } from '../src/core/ratchet.js';

describe('roundTick', () => {
  it('rounds up, down and nearest on the 0.05 grid without float noise', () => {
    expect(roundTick(2228.91, 'up')).toBe(2228.95);
    expect(roundTick(2228.91, 'down')).toBe(2228.9);
    expect(roundTick(2228.9, 'up')).toBe(2228.9);
    expect(roundTick(0.1 + 0.2, 'nearest')).toBe(0.3);
  });
});

describe('isBreached', () => {
  it('long breached when SL ≥ last; short when SL ≤ last', () => {
    expect(isBreached('buy', 2250, 2250)).toBe(true);
    expect(isBreached('buy', 2250, 2250.05)).toBe(false);
    expect(isBreached('sell', 2200, 2200)).toBe(true);
    expect(isBreached('sell', 2200, 2199.95)).toBe(false);
  });
});
