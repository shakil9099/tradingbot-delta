import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export class LockError extends Error {}

/** Single-instance lock at <dataDir>/bot.lock. A lock whose PID is not alive is replaced. */
export class Lock {
  readonly path: string;
  constructor(private readonly dataDir: string) {
    this.path = join(dataDir, 'bot.lock');
  }

  acquire(pid = process.pid): void {
    mkdirSync(this.dataDir, { recursive: true, mode: 0o700 });
    if (existsSync(this.path)) {
      const other = Number(readFileSync(this.path, 'utf8').trim());
      if (other !== pid && pidAlive(other)) throw new LockError(`another instance is running (pid ${other}); lock ${this.path}`);
    }
    writeFileSync(this.path, String(pid), { mode: 0o600 });
  }

  release(): void {
    try {
      if (existsSync(this.path) && Number(readFileSync(this.path, 'utf8').trim()) === process.pid) unlinkSync(this.path);
    } catch {
      /* ignore */
    }
  }
}
