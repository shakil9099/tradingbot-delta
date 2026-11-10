import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { boot, BootError } from '../src/boot.js';
import { parseEnv } from '../src/config/env.js';
import { openDb } from '../src/store/db.js';
import { Repo } from '../src/store/repo.js';
import { FakeExchange } from './fakes/fakeExchange.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function setup(extra: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ethbot-mode-'));
  dirs.push(dir);
  const env = parseEnv({
    DASHBOARD_USER: 'admin',
    DASHBOARD_PASSWORD_HASH: '$2a$04$abcdefghijklmnopqrstuuabcdefghijklmnopqrstuvwxyzABCD',
    SESSION_SECRET: 's'.repeat(40),
    CTL_TOKEN: 't'.repeat(40),
    DATA_DIR: join(dir, 'data'),
    ...extra,
  });
  const dbPath = join(dir, 'bot.db');
  const db = () => new Repo(openDb(dbPath));
  return { env, dbPath, db };
}
const now = () => 1_699_999_200 + 10;
const KEYS = { DELTA_API_KEY: 'envkey-1234', DELTA_API_SECRET: 'envsecret-1234' };

describe('boot: effective mode (Amendment B.2 / B.9)', () => {
  it('a refused boot (live, no isolated-margin confirmation) never records boots, so PM2 retries cannot trip crash_loop', async () => {
    const { env, dbPath, db } = setup(KEYS); // DRY_RUN unset (false) + .env keys → migrated to live
    for (let i = 0; i < 7; i++) await expect(boot({ env, port: new FakeExchange(), dbPath, now })).rejects.toBeInstanceOf(BootError);
    const r = db();
    expect(r.kvGet('boot_times')).toBeNull();
    expect(r.kvGet('halt_kind')).toBeNull();
  });

  it('DRY_RUN=true boots paper even with live requested; boot event shows the effective mode', async () => {
    const { env, dbPath, db } = setup({ ...KEYS, DRY_RUN: 'true' });
    const pre = db();
    pre.kvSet('trading_mode', 'live');
    pre.db.close();
    const b = await boot({ env, port: new FakeExchange(), dbPath, now, probeLivePosition: async () => false });
    expect(b.mode).toMatchObject({ live: false, envLock: true });
    expect(b.engine.c.params.DRY_RUN).toBe(true);
    expect(JSON.parse(b.repo.listSystemEvents('boot')[0].data)).toMatchObject({ mode: 'paper', envLock: true, credentials: 'env' });
    b.close();
  });

  it('paper boot while the real Delta account has a position → refused', async () => {
    const { env, dbPath } = setup({ ...KEYS, DRY_RUN: 'true' });
    await expect(boot({ env, port: new FakeExchange(), dbPath, now, probeLivePosition: async () => true })).rejects.toThrow(/open ETHUSD position/);
  });

  it('paper boot when the position check itself fails → warns and boots', async () => {
    const { env, dbPath } = setup({ ...KEYS, DRY_RUN: 'true' });
    const b = await boot({ env, port: new FakeExchange(), dbPath, now, probeLivePosition: async () => Promise.reject(new Error('ip not whitelisted')) });
    expect(b.mode.live).toBe(false);
    b.close();
  });

  it('a non-terminal trade from the other mode refuses the boot', async () => {
    const { env, dbPath, db } = setup({ ...KEYS, ISOLATED_MARGIN_CONFIRMED: 'true' });
    const pre = db();
    pre.kvSet('trading_mode', 'live');
    pre.insertTrade({ client_order_id: 'p', status: 'OPEN', side: 'buy', size_contracts: 10, strategy: 'hull', dry_run: 1 });
    pre.db.close();
    await expect(boot({ env, port: new FakeExchange(), dbPath, now })).rejects.toThrow(/paper mode, but the bot is starting in live/);
  });

  it('live boot uses the effective mode in params; an author-requested restart is not counted by the crash-loop guard', async () => {
    const { env, dbPath, db } = setup({ ...KEYS, ISOLATED_MARGIN_CONFIRMED: 'true' });
    const pre = db();
    pre.kvSet('requested_restart_at', now());
    pre.db.close();
    const b = await boot({ env, port: new FakeExchange(), dbPath, now });
    expect(b.mode).toMatchObject({ live: true, source: 'env' });
    expect(b.engine.c.params.DRY_RUN).toBe(false);
    expect(b.repo.kvGet('boot_times')).toBeNull();
    expect(b.repo.kvGet('requested_restart_at')).toBeNull();
    b.close();
  });
});
