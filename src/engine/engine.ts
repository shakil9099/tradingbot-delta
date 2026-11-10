import { Executor } from '../exchange/executor.js';
import type { Ctx } from './context.js';
import { runCycle, type CycleOutcome } from './cycle.js';
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
