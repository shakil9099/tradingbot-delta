// Boot sequence (design file 9). Separated from index.ts so tests can drive it with a fake exchange.

import { join } from 'node:path';
import { paramsFromEnv, type Env } from './config/env.js';
import { paramsHash } from './config/params.js';
import { ModeError, resolveMode, type ModeResolution } from './engine/mode.js';
import type { Creds } from './store/secrets.js';
import { DeltaClient } from './exchange/deltaClient.js';
import { PaperBroker } from './exchange/paperBroker.js';
import type { ExchangePort } from './exchange/types.js';
import { recordBoot } from './engine/bootGuard.js';
import { realSleep, type Ctx } from './engine/context.js';
import { Engine } from './engine/engine.js';
import { Halt } from './engine/halt.js';
import { Lock } from './engine/lock.js';
import { log } from './log.js';
import { openDb } from './store/db.js';
import { Repo } from './store/repo.js';

export class BootError extends Error {}

export interface Booted {
  engine: Engine;
  repo: Repo;
  lock: Lock;
  client: DeltaClient | null;
  /** Effective mode and credentials source (design Amendment B.2). */
  mode: ModeResolution;
  close: () => void;
}

export interface BootOpts {
  env: Env;
  /** Test hook: replaces the Delta client and paper broker. */
  port?: ExchangePort & { checkClock?: () => Promise<number> };
  dbPath?: string;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  onRateLimited?: () => void;
  onOk?: () => void;
  /**
   * Paper-boot guard (B.9 #1): true if the real Delta account has an open ETHUSD position.
   * Default: an authenticated DeltaClient.getPosition(). Tests inject a fake.
   */
  probeLivePosition?: (creds: Creds) => Promise<boolean>;
}

export async function boot(o: BootOpts): Promise<Booted> {
  const { env } = o;
  const now = o.now ?? (() => Math.floor(Date.now() / 1000));

  // 2. Lock (creates data/).
  const lock = new Lock(env.DATA_DIR);
  lock.acquire();

  // 3. DB + migrate.
  const db = openDb(o.dbPath ?? join(env.DATA_DIR, 'bot.db'));
  const repo = new Repo(db);
  const early = (msg: string): never => {
    db.close();
    lock.release();
    throw new BootError(msg);
  };

  // 3b. Effective mode and credentials (Amendment B.2). Checked BEFORE the crash-loop guard (B.9 #2).
  let mode: ModeResolution;
  try {
    mode = resolveMode(env, repo);
  } catch (e) {
    if (e instanceof ModeError) early(e.message);
    throw e;
  }
  const params = Object.freeze({ ...paramsFromEnv(env), DRY_RUN: !mode.live });
  // A non-terminal trade from the other mode means the switch was not clean (B.9 #3): refuse.
  const pending = repo.openTrade();
  if (pending && pending.dry_run !== (mode.live ? 0 : 1)) {
    early(`trade ${pending.id} is ${pending.status} in ${pending.dry_run ? 'paper' : 'live'} mode, but the bot is starting in ${mode.live ? 'live' : 'paper'} mode; switch back, or settle that trade first`);
  }
  // Paper boot while the real account has a position: that position would go unmanaged (B.9 #1).
  // (Tests that inject a fake port and no probe skip this check.)
  const probe =
    o.probeLivePosition ??
    (o.port
      ? null
      : async (cr: Creds) =>
          !!(await new DeltaClient({ baseUrl: env.DELTA_BASE_URL, apiKey: cr.apiKey, apiSecret: cr.apiSecret, productId: params.PRODUCT_ID, symbol: params.SYMBOL }).getPosition()));
  if (!mode.live && mode.creds && probe) {
    let open = false;
    try {
      open = await probe(mode.creds);
    } catch (e) {
      // Cannot verify (network, key not whitelisted…): warn, do not block paper trading.
      log.warn({ err: (e as Error).message }, 'paper boot: could not check the Delta account for an open position');
    }
    if (open) {
      early('the Delta account has an open ETHUSD position, but the bot is starting in paper mode; go live from the dashboard so it is managed, or close it on Delta');
    }
  }

  repo.kvSet('last_cycle_at', now()); // so /health is not stale at first boot
  const halt = new Halt(repo);

  // 4–6. Crash-loop guard (restarts the author requested are not counted, B.9 #9), boot event, Telegram warning.
  recordBoot(repo, halt, now());
  repo.addSystemEvent('boot', {
    mode: mode.live ? 'live' : 'paper',
    envLock: mode.envLock,
    credentials: mode.source,
    strategy: params.STRATEGY,
    risk: params.RISK_PER_TRADE,
    skipWeekendEntries: params.SKIP_WEEKEND_ENTRIES,
  });
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) log.warn('Telegram is not configured: alerts go to the log only; point an uptime monitor at /health');

  // Exchange.
  let client: DeltaClient | null = null;
  let port: ExchangePort;
  if (o.port) port = o.port;
  else {
    client = new DeltaClient({
      baseUrl: env.DELTA_BASE_URL,
      apiKey: mode.creds?.apiKey,
      apiSecret: mode.creds?.apiSecret,
      productId: params.PRODUCT_ID,
      symbol: params.SYMBOL,
      onRateLimited: o.onRateLimited,
      onOk: o.onOk,
    });
    port = mode.live ? client : new PaperBroker(client, repo, params, now);
  }

  const fail = (msg: string): never => {
    db.close();
    lock.release();
    throw new BootError(msg);
  };

  // 8. Clock.
  try {
    if (client) await client.checkClock(2);
    else if (o.port?.checkClock) await o.port.checkClock();
  } catch (e) {
    fail((e as Error).message);
  }

  const c: Ctx = { port, repo, params, halt, configHash: paramsHash(params), sleep: o.sleep ?? realSleep, now };
  const engine = new Engine(c);

  // 9. Product check.
  const prod = await port.getProduct();
  if (prod.id !== params.PRODUCT_ID || prod.contractValue !== params.CONTRACT_VALUE || prod.tickSize !== params.TICK) {
    halt.halt(`product mismatch: ${JSON.stringify(prod)}`, 'fatal_error');
  }

  // 10. Candle-time sanity check (warn only).
  try {
    const t = now();
    const top = Math.floor(t / 3600) * 3600;
    const candles = await port.getCandles(top - 10 * 3600, top - 1);
    const newest = candles.filter((x) => x.time + 3600 <= t).sort((a, b) => a.time - b.time).at(-1)?.time;
    const ok = newest === top - 3600 || (t - top <= 300 && newest === top - 7200);
    if (!ok) log.warn({ newest, expected: top - 3600 }, 'candle time sanity check failed (candle "time" may not be the open time)');
  } catch (e) {
    log.warn({ err: e }, 'candle sanity check failed');
  }

  // 11. Leverage.
  if (!(await port.getPosition())) await engine.exec.ensureLeverage();
  else repo.kvSet('leverage_ok', 0);

  // 12. First reconcile.
  await engine.reconcile();

  return {
    engine,
    repo,
    lock,
    client,
    mode,
    close: () => {
      db.close();
      lock.release();
    },
  };
}
