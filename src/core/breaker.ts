// Circuit breaker: counts initial-stop exits with no profitable trade between them.

import type { ExitReason } from '../shared/types.js';

export function nextCount(count: number, exitReason: ExitReason, netPnl: number): number {
  if (exitReason === 'sl_stage_0') return count + 1;
  if (exitReason === 'external') return count;
  if (netPnl > 0) return 0;
  return count; // losing reversals, sl_stage_1, etc.
}

export function shouldHalt(count: number, n: number): boolean {
  return count >= n;
}
