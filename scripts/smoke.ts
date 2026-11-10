// npm run smoke  — DRY_RUN end-to-end check against live Delta public data, no API keys needed.
// Boots exactly like the server (lock, DB, clock check, product check, leverage, reconcile), runs ONE
// candle cycle immediately instead of waiting for HH:00:10, prints the decision and status, then exits.
// Uses a throwaway data dir so it never touches data/bot.db.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { boot } from '../src/boot.js';
import { parseEnv } from '../src/config/env.js';

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'ethbot-smoke-'));
  const env = parseEnv({
    DRY_RUN: 'true',
    DATA_DIR: dir,
    DASHBOARD_USER: 'smoke',
    DASHBOARD_PASSWORD_HASH: '$2a$04$smokesmokesmokesmokesmokesmokesmokesmokesmokesmoke',
    SESSION_SECRET: 's'.repeat(40),
    CTL_TOKEN: 't'.repeat(40),
    STRATEGY: process.env.STRATEGY ?? 'adaptive',
    ATR_GATE_MAX: process.env.ATR_GATE_MAX ?? '0',
    SKIP_WEEKEND_ENTRIES: process.env.SKIP_WEEKEND_ENTRIES ?? 'true',
    DELTA_BASE_URL: process.env.DELTA_BASE_URL ?? 'https://api.india.delta.exchange',
  });
  const b = await boot({ env });
  try {
    const out = await b.engine.cycle({ retryMs: 5_000, maxWaitMs: 15_000 });
    console.log('\ncycle outcome:', out.kind);
    if (out.kind === 'done') console.table([out.decision]);
    if (out.kind === 'error') console.log(out.message);
    const snap = await b.engine.reconcile();
    console.log('snapshot:', JSON.stringify(snap));
    console.log('halt:', JSON.stringify(b.engine.c.halt.state()));
    console.log('sim trades stored:', b.repo.listSimTrades().length, '| trades:', b.repo.countTrades());
  } finally {
    b.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error('SMOKE FAILED:', e instanceof Error ? e.message : e);
  process.exit(1);
});
