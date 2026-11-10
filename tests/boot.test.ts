import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { boot, BootError } from '../src/boot.js';
import { parseEnv } from '../src/config/env.js';
import { FakeExchange } from './fakes/fakeExchange.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function env(extra: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ethbot-'));
  dirs.push(dir);
  return parseEnv({
    DASHBOARD_USER: 'admin',
    DASHBOARD_PASSWORD_HASH: '$2a$04$abcdefghijklmnopqrstuuabcdefghijklmnopqrstuvwxyzABCD',
    SESSION_SECRET: 's'.repeat(40),
    CTL_TOKEN: 't'.repeat(40),
    DELTA_API_KEY: 'k',
    DELTA_API_SECRET: 's',
    DATA_DIR: join(dir, 'data'),
    ...extra,
  });
}

const now = () => 1_699_999_200 + 10;

describe('boot', () => {
  it('refuses to start live without ISOLATED_MARGIN_CONFIRMED', async () => {
    await expect(boot({ env: env(), port: new FakeExchange(), dbPath: ':memory:', now })).rejects.toBeInstanceOf(BootError);
  });

  it('exits on clock skew', async () => {
    const fx = Object.assign(new FakeExchange(), { checkClock: async () => Promise.reject(new Error('clock skew 9s')) });
    await expect(boot({ env: env({ ISOLATED_MARGIN_CONFIRMED: 'true' }), port: fx, dbPath: ':memory:', now })).rejects.toThrow(/clock skew/);
  });

  it('halts on a product mismatch, writes a boot event and sets last_cycle_at; creates data/ on a fresh install', async () => {
    const fx = new FakeExchange();
    fx.product = { ...fx.product, tickSize: 0.1 };
    const b = await boot({ env: env({ ISOLATED_MARGIN_CONFIRMED: 'true' }), port: fx, now });
    expect(b.engine.c.halt.state().kind).toBe('fatal_error');
    expect(b.repo.listSystemEvents('boot')).toHaveLength(1);
    expect(b.repo.kvNum('last_cycle_at')).toBe(now());
    b.close();
  });

  it('DRY_RUN does not need API keys or ISOLATED_MARGIN_CONFIRMED', async () => {
    const e = env({ DRY_RUN: 'true', DELTA_API_KEY: '', DELTA_API_SECRET: '' });
    const b = await boot({ env: e, port: new FakeExchange(), dbPath: ':memory:', now });
    expect(b.engine.c.params.DRY_RUN).toBe(true);
    b.close();
  });
});
