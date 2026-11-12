import { entryGate } from '../core/entryGate.js';
import { riskDistance } from '../core/exits.js';
import { atrPine } from '../core/indicators.js';
import { Executor, type EnterResult } from '../exchange/executor.js';
import type { Side, StrategyId } from '../shared/types.js';
import type { Ctx } from './context.js';
import { runCycle, waitForCandle, type CycleOutcome } from './cycle.js';
import { peakKey } from '../exchange/executor.js';
import { Mutex } from './mutex.js';
import { Reconciler, type Snapshot } from './reconciler.js';

/** Owns the mutex and exposes every state-changing operation behind it. */
export class Engine {
  readonly mutex = new Mutex();
  /** Set (under the mutex) when a mode/key switch is committed; cycles and reconciles then do nothing until exit. */
  private suspended = false;
  suspend(): void {
    this.suspended = true;
  }
  get isSuspended(): boolean {
    return this.suspended;
  }
  readonly exec: Executor;
  readonly reconciler: Reconciler;
  constructor(readonly c: Ctx) {
    this.exec = new Executor(c);
    this.reconciler = new Reconciler(c, this.exec);
  }

  cycle(opts: { retryMs?: number; maxWaitMs?: number } = {}): Promise<CycleOutcome> {
    return runCycle({ c: this.c, exec: this.exec, mutex: this.mutex, isSuspended: () => this.suspended, ...opts });
  }
  reconcile(): Promise<Snapshot> {
    return this.mutex.runExclusive(async () => (this.suspended ? this.reconciler.getSnapshot() : this.reconciler.reconcile()));
  }
  snapshot(): Snapshot {
    return this.reconciler.getSnapshot();
  }

  /** Manual close; does not halt. Returns false if flat. */
  async manualClose(): Promise<boolean> {
    return this.mutex.runExclusive(async () => {
      if (!(await this.c.port.getPosition())) return false;
      await this.exec.close('manual');
      await this.reconciler.reconcile();
      return true;
    });
  }
  /**
   * Owner-requested entry outside a signal. Uses the normal entry path (ATR stop distance, risk sizing capped by
   * MAX_CONTRACTS, exchange stop, trade row). Refused when suspended, halted, not flat, or when the stop would be
   * wider than SL_MAX. The discretionary entry filters (low ATR, weekend, high-ATR gate) are NOT applied; the one
   * that would have blocked is recorded in the entry reason and the system event.
   */
  async manualEnter(side: Side): Promise<{ result: EnterResult | 'refused'; note: string }> {
    const candles = await waitForCandle({ c: this.c, exec: this.exec, mutex: this.mutex, retryMs: 5_000, maxWaitMs: 0 });
    if (!candles) return { result: 'refused', note: 'latest closed candle not available yet; try again in a minute' };
    return this.mutex.runExclusive(async () => {
      const { c } = this;
      if (this.suspended) return { result: 'refused' as const, note: 'engine suspended (mode switch in progress)' };
      const hs = c.halt.state();
      if (hs.halted) return { result: 'refused' as const, note: `halted (${hs.kind}); resume first` };
      if (await c.port.getPosition()) return { result: 'refused' as const, note: 'a position is already open; close it first' };
      const p = c.params;
      const t = candles.length - 1;
      const atr = atrPine(candles, p.ATR_LEN);
      const R = riskDistance(atr[t], p);
      if (R === null) return { result: 'refused' as const, note: `stop too wide or ATR unavailable (ATR ${atr[t]?.toFixed(2)}, SL_MAX $${p.SL_MAX})` };
      const bypassed = entryGate(candles, p, atr)(t);
      const strategy = (c.repo.kvGet('active_strategy') as StrategyId | null) ?? 'hull';
      // Order-id time is now, not the candle, so it cannot collide with a signal entry on the same candle.
      const result = await this.exec.enter(
        side,
        Math.floor(c.now()),
        { strategy, signal: 'manual entry', candleTime: candles[t].time, manual: true, bypassedFilter: bypassed, riskDist: +R.toFixed(2), atr: +atr[t].toFixed(2) },
        R,
      );
      c.repo.addSystemEvent('manual_enter', { side, result, bypassedFilter: bypassed, riskDist: +R.toFixed(2) });
      await this.reconciler.reconcile();
      return { result, note: bypassed ? `entry filter bypassed: ${bypassed}` : '' };
    });
  }

  pause(): Promise<void> {
    return this.mutex.runExclusive(() => this.c.halt.halt('manual pause', 'manual'));
  }
  resume(): Promise<void> {
    return this.mutex.runExclusive(() => this.c.halt.resume());
  }

  /** Clears the risk-throttle peak (after a deposit or withdrawal); the next entry re-seeds it from the balance. */
  resetPeak() {
    return this.mutex.runExclusive(() => {
      this.c.repo.kvSet(peakKey(this.c.params.DRY_RUN), null);
      this.c.repo.addSystemEvent('peak_reset', {});
    });
  }
}
