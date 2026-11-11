import 'dotenv/config';
import { createApp } from './api/server.js';
import { boot, BootError } from './boot.js';
import { EnvError, parseEnv } from './config/env.js';
import { DeltaClient } from './exchange/deltaClient.js';
import { Scheduler } from './engine/scheduler.js';
import { alert, log, setNotifier } from './log.js';
import { telegramNotifier } from './notify/telegram.js';
import { backupNightly } from './store/backup.js';

async function main() {
  // 1. Env and params.
  const env = parseEnv(process.env);
  setNotifier(telegramNotifier(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID));

  let scheduler: Scheduler | null = null;
  const b = await boot({ env, onRateLimited: () => scheduler?.backoff(), onOk: () => scheduler?.reset() });
  const { engine, repo, client, mode } = b;
  let shutdown: (sig: string) => Promise<void> = async () => undefined;

  // 13. Scheduler.
  scheduler = new Scheduler({
    cycle: async () => void (await engine.cycle()),
    reconcile: async () => void (await engine.reconcile()),
    backup: () => backupNightly(repo.db, env.DATA_DIR),
  });
  scheduler.start();

  // 14. Server.
  const app = createApp({
    engine,
    user: env.DASHBOARD_USER,
    passwordHash: env.DASHBOARD_PASSWORD_HASH,
    ctlToken: env.CTL_TOKEN,
    sessionSecret: env.SESSION_SECRET,
    cookieSecure: env.COOKIE_SECURE,
    trustProxy: env.TRUST_PROXY,
    consecutiveFailures: () => client?.consecutiveFailures ?? 0,
    nextCycleAt: () => (scheduler?.nextRunAt ? Math.floor(scheduler.nextRunAt / 1000) : null),
    settings: {
      env,
      mode,
      // Authenticated read-only check with the given keys: balance, then position (Amendment B.1).
      testCredentials: async (cr) => {
        const t = new DeltaClient({ baseUrl: env.DELTA_BASE_URL, apiKey: cr.apiKey, apiSecret: cr.apiSecret, productId: engine.c.params.PRODUCT_ID, symbol: engine.c.params.SYMBOL });
        await t.getBalance();
        return { livePosition: !!(await t.getPosition()) };
      },
      stopScheduler: () => scheduler?.stop(),
      startScheduler: () => scheduler?.start(),
      requestRestart: () => {
        // After the 202 is flushed; PM2 restarts the process with the new mode / keys.
        setTimeout(() => void shutdown('restart requested from the dashboard'), 300);
      },
    },
  });
  const server = app.listen(env.PORT, env.HOST, () => log.info({ port: env.PORT, host: env.HOST }, `dashboard listening on ${env.HOST}`));

  // 15. Started.
  alert(`started (${mode.live ? 'LIVE' : 'PAPER'}${mode.envLock ? ' — DRY_RUN lock' : ''}, keys: ${mode.source}, strategy ${env.STRATEGY}${env.ATR_GATE_MAX ? `, ATR gate ${env.ATR_GATE_MAX}` : ''}${env.SKIP_WEEKEND_ENTRIES ? ', no weekend entries' : ''})`);

  let stopping = false;
  shutdown = async (sig: string) => {
    if (stopping) return;
    stopping = true;
    log.info({ sig }, 'shutting down; open positions keep their exchange brackets');
    scheduler?.stop();
    server.close();
    await engine.mutex.runExclusive(() => undefined); // let a running cycle finish
    b.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  if (err instanceof EnvError || err instanceof BootError) log.fatal(err.message);
  else log.fatal({ err }, 'fatal error during start');
  process.exit(1);
});
