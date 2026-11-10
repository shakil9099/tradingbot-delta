import { log } from '../log.js';

const BASE_RECONCILE_MS = 60_000;
const MAX_RECONCILE_MS = 300_000;

/** Next HH:00:10 UTC strictly after `now` (ms). */
export function nextCycleAt(now: number): number {
  const hour = 3_600_000;
  const t = Math.floor(now / hour) * hour + 10_000;
  return t > now ? t : t + hour;
}

/** Next 00:30 UTC after `now` (ms). */
export function nextBackupAt(now: number): number {
  const day = 86_400_000;
  const t = Math.floor(now / day) * day + 30 * 60_000;
  return t > now ? t : t + day;
}

export interface SchedulerDeps {
  cycle: () => Promise<void>;
  reconcile: () => Promise<void>;
  backup: () => Promise<unknown>;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
}

export class Scheduler {
  reconcileMs = BASE_RECONCILE_MS;
  nextRunAt: number | null = null;
  private timers = new Set<unknown>();
  private stopped = false;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (h: unknown) => void;

  constructor(private readonly d: SchedulerDeps) {
    this.now = d.now ?? Date.now;
    this.setTimer = d.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = d.clearTimer ?? ((h) => clearTimeout(h as NodeJS.Timeout));
  }

  /** Doubles the reconcile interval (up to 5 minutes). Wired to deltaClient onRateLimited. */
  backoff(): void {
    this.reconcileMs = Math.min(MAX_RECONCILE_MS, this.reconcileMs * 2);
  }
  /** Back to 60 s. Wired to deltaClient onOk. */
  reset(): void {
    this.reconcileMs = BASE_RECONCILE_MS;
  }

  start(): void {
    this.stopped = false;
    this.armCycle();
    this.armReconcile();
    this.armBackup();
  }

  stop(): void {
    this.stopped = true;
    for (const t of this.timers) this.clearTimer(t);
    this.timers.clear();
  }

  private arm(fn: () => Promise<unknown>, at: number, rearm: () => void): void {
    if (this.stopped) return;
    const h = this.setTimer(async () => {
      this.timers.delete(h);
      try {
        await fn();
      } catch (err) {
        log.error({ err }, 'scheduled task failed');
      }
      rearm();
    }, Math.max(0, at - this.now()));
    this.timers.add(h);
  }

  private armCycle(): void {
    this.nextRunAt = nextCycleAt(this.now());
    this.arm(this.d.cycle, this.nextRunAt, () => this.armCycle());
  }
  private armReconcile(): void {
    this.arm(this.d.reconcile, this.now() + this.reconcileMs, () => this.armReconcile());
  }
  private armBackup(): void {
    this.arm(this.d.backup, nextBackupAt(this.now()), () => this.armBackup());
  }
}
