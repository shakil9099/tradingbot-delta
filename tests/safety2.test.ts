// File 69 (continued): lock, bootGuard, halt/resume, scheduler, backup, env.
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseEnv, EnvError } from '../src/config/env.js';
import { recordBoot } from '../src/engine/bootGuard.js';
import { Halt } from '../src/engine/halt.js';
import { Lock, LockError } from '../src/engine/lock.js';
import { Scheduler, nextBackupAt, nextCycleAt } from '../src/engine/scheduler.js';
import { backupNightly } from '../src/store/backup.js';
import { openDb } from '../src/store/db.js';
import { Repo } from '../src/store/repo.js';

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'ethbot-'));
  dirs.push(d);
  return d;
};
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

describe('lock', () => {
  it('creates data/ on a fresh install, refuses a live PID, replaces a dead one', () => {
    const dir = join(tmp(), 'data');
    const lock = new Lock(dir);
    lock.acquire();
    expect(existsSync(lock.path)).toBe(true);
    writeFileSync(lock.path, String(process.ppid)); // a live process that is not us
    expect(() => new Lock(dir).acquire()).toThrow(LockError);
    writeFileSync(lock.path, '999999'); // dead PID
    expect(() => new Lock(dir).acquire()).not.toThrow();
  });
});

describe('bootGuard / halt', () => {
  it('more than 5 boots in 10 minutes halts with crash_loop; old entries are trimmed', () => {
    const repo = new Repo(openDb(':memory:'));
    const halt = new Halt(repo);
    repo.kvSet('boot_times', JSON.stringify([0, 1, 2]));
    expect(recordBoot(repo, halt, 10_000)).toEqual([10_000]);
    for (let i = 1; i <= 5; i++) recordBoot(repo, halt, 10_000 + i);
    expect(halt.state()).toMatchObject({ halted: true, kind: 'crash_loop' });
  });
  it('halt writes kv and a system event; resume resets consecutive_sl only after a breaker halt', () => {
    const repo = new Repo(openDb(':memory:'));
    const halt = new Halt(repo);
    repo.kvSet('consecutive_sl', 3);
    halt.halt('manual pause', 'manual');
    expect(repo.kvGet('halt_kind')).toBe('manual');
    expect(repo.listSystemEvents('halt')).toHaveLength(1);
    halt.resume();
    expect(repo.kvNum('consecutive_sl')).toBe(3);
    halt.halt('breaker', 'breaker');
    halt.resume();
    expect(repo.kvNum('consecutive_sl')).toBe(0);
    expect(halt.state().halted).toBe(false);
  });
});

describe('scheduler', () => {
  it('arms the cycle at HH:00:10 UTC and the backup at 00:30 UTC', () => {
    expect(new Date(nextCycleAt(Date.UTC(2026, 0, 1, 5, 0, 9))).toISOString()).toBe('2026-01-01T05:00:10.000Z');
    expect(new Date(nextCycleAt(Date.UTC(2026, 0, 1, 5, 0, 11))).toISOString()).toBe('2026-01-01T06:00:10.000Z');
    expect(new Date(nextBackupAt(Date.UTC(2026, 0, 1, 1, 0, 0))).toISOString()).toBe('2026-01-02T00:30:00.000Z');
  });
  it('backoff reaches 300 s, reset restores 60 s', () => {
    const s = new Scheduler({ cycle: async () => {}, reconcile: async () => {}, backup: async () => {}, setTimer: () => 0, clearTimer: () => {} });
    for (let i = 0; i < 10; i++) s.backoff();
    expect(s.reconcileMs).toBe(300_000);
    s.reset();
    expect(s.reconcileMs).toBe(60_000);
  });
});

describe('backup', () => {
  it('keeps the newest 14 files and never throws', async () => {
    const dir = tmp();
    const db = openDb(join(dir, 'bot.db'));
    for (let d = 1; d <= 16; d++) await backupNightly(db, dir, 14, new Date(Date.UTC(2026, 0, d)));
    expect(readdirSync(join(dir, 'backups'))).toHaveLength(14);
    db.close();
    await expect(backupNightly(db, '/proc/definitely/not/writable')).resolves.toBeNull();
  });
});

describe('env', () => {
  const base = { DASHBOARD_USER: 'a', DASHBOARD_PASSWORD_HASH: 'x'.repeat(30), SESSION_SECRET: 's'.repeat(32), CTL_TOKEN: 't'.repeat(32), DRY_RUN: 'true' };
  it('"false" parses as false for both booleans', () => {
    const e = parseEnv({ ...base, DRY_RUN: 'false', ISOLATED_MARGIN_CONFIRMED: 'false', DELTA_API_KEY: 'k', DELTA_API_SECRET: 's' });
    expect(e.DRY_RUN).toBe(false);
    expect(e.ISOLATED_MARGIN_CONFIRMED).toBe(false);
  });
  it('rejects unknown hosts, short secrets and a malformed SECRETS_KEY; keys are optional (dashboard, Amendment B)', () => {
    expect(() => parseEnv({ ...base, DELTA_BASE_URL: 'https://api.delta.exchange' })).toThrow(EnvError);
    expect(() => parseEnv({ ...base, SESSION_SECRET: 'short' })).toThrow(/SESSION_SECRET/);
    expect(() => parseEnv({ ...base, DRY_RUN: 'false' })).not.toThrow();
    expect(() => parseEnv({ ...base, SECRETS_KEY: 'abc' })).toThrow(/SECRETS_KEY/);
    expect(parseEnv({ ...base, SECRETS_KEY: 'a'.repeat(64) }).SECRETS_KEY).toBe('a'.repeat(64));
    expect(() => parseEnv({ ...base, CREDENTIALS_SOURCE: 'db' })).toThrow(EnvError);
    expect(() => parseEnv({ ...base, DRY_RUN: 'yes' })).toThrow(EnvError);
  });
});
