/** Promise mutex shared by the cycle, the reconciler and the control routes (which ctl also reaches). */
export class Mutex {
  private tail: Promise<unknown> = Promise.resolve();
  private held = false;

  get isHeld(): boolean {
    return this.held;
  }

  runExclusive<T>(fn: () => Promise<T> | T): Promise<T> {
    const run = this.tail.then(async () => {
      this.held = true;
      try {
        return await fn();
      } finally {
        this.held = false;
      }
    });
    this.tail = run.catch(() => undefined);
    return run;
  }
}
