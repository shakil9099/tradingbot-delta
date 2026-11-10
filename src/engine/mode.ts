// Effective trading mode at boot (design Amendment B.2 and B.9 #1–2). Runs BEFORE the crash-loop guard, so a
// refused boot never stores a crash_loop halt.
//
//   live = DRY_RUN (env) is not true  AND  kv.trading_mode = 'live'
//
// DRY_RUN=true in .env is a server-level lock: always paper. kv.trading_mode is set from the dashboard
// (Go live / Back to paper). One-time upgrade: when kv.trading_mode is unset, an existing DRY_RUN=false deployment
// with keys in .env is recorded as 'live' (so an upgrade never strands a live position); everything else as 'paper'.

import type { Env } from '../config/env.js';
import { readStoredCreds, type Creds, type StoredCreds } from '../store/secrets.js';
import type { Repo } from '../store/repo.js';

export type TradingMode = 'paper' | 'live';
export type CredSource = 'stored' | 'env' | 'none';

export interface ModeResolution {
  live: boolean;
  /** kv.trading_mode (what the dashboard switch says). */
  mode: TradingMode;
  /** DRY_RUN=true in .env forces paper. */
  envLock: boolean;
  creds: Creds | null;
  source: CredSource;
  stored: StoredCreds['status'];
  storedReason: string | null;
  isolatedConfirmed: boolean;
  migrated: boolean;
}

export class ModeError extends Error {}

export function envCreds(env: Env): Creds | null {
  return env.DELTA_API_KEY && env.DELTA_API_SECRET ? { apiKey: env.DELTA_API_KEY, apiSecret: env.DELTA_API_SECRET } : null;
}

/** Credentials the bot would use now (stored first, then .env; CREDENTIALS_SOURCE=env forces .env). */
export function currentCreds(env: Env, repo: Repo): { creds: Creds | null; source: CredSource; stored: StoredCreds } {
  const stored = readStoredCreds(repo, env.SECRETS_KEY);
  if (env.CREDENTIALS_SOURCE === 'env') {
    const e = envCreds(env);
    return { creds: e, source: e ? 'env' : 'none', stored };
  }
  if (stored.status === 'ok') return { creds: stored.creds, source: 'stored', stored };
  // Unreadable stored keys never fall back silently to .env (B.9 #2); the explicit override is CREDENTIALS_SOURCE=env.
  if (stored.status === 'unreadable') return { creds: null, source: 'stored', stored };
  const e = envCreds(env);
  return { creds: e, source: e ? 'env' : 'none', stored };
}

export function resolveMode(env: Env, repo: Repo): ModeResolution {
  let migrated = false;
  if (repo.kvGet('trading_mode') === null) {
    const wasLive = !env.DRY_RUN && envCreds(env) !== null;
    repo.kvSet('trading_mode', wasLive ? 'live' : 'paper');
    if (wasLive) {
      repo.addSystemEvent('mode_migrated', { to: 'live', reason: 'DRY_RUN=false with API keys in .env (pre-dashboard deployment)' });
      migrated = true;
    }
  }
  const mode = (repo.kvGet('trading_mode') === 'live' ? 'live' : 'paper') as TradingMode;
  const envLock = env.DRY_RUN;
  const live = !envLock && mode === 'live';
  const { creds, source, stored } = currentCreds(env, repo);
  const isolatedConfirmed = env.ISOLATED_MARGIN_CONFIRMED || repo.kvNum('isolated_margin_confirmed', 0) === 1;
  const storedReason = stored.status === 'unreadable' ? stored.reason : null;

  if (live) {
    if (stored.status === 'unreadable' && env.CREDENTIALS_SOURCE !== 'env') {
      throw new ModeError(
        `live mode, but the stored API keys are unreadable (${storedReason}). Fix SECRETS_KEY, or put the keys in .env and set CREDENTIALS_SOURCE=env. Open positions keep their stop-loss on Delta.`,
      );
    }
    if (!creds) throw new ModeError('live mode, but no API keys are available (save them from the dashboard or set them in .env)');
    if (!isolatedConfirmed) {
      throw new ModeError('live mode requires isolated margin to be confirmed (Go-live checkbox, or ISOLATED_MARGIN_CONFIRMED=true); set isolated margin for ETHUSD in the Delta app first');
    }
  }
  return { live, mode, envLock, creds, source, stored: stored.status, storedReason, isolatedConfirmed, migrated };
}
