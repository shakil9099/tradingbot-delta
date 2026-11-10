// Settings: Delta API keys from the dashboard and the paper/live switch (design Amendment B).
// Session only (the ctl token is refused), CSRF header on every non-GET, password re-entry, own 2 KB JSON parser.
// Mode changes and live key changes run under the engine mutex with the scheduler stopped, re-check "flat",
// write the new state, answer 202 and then restart the process (PM2 brings it back with the new mode).

import express, { Router, type NextFunction, type Request, type Response } from 'express';
import type { Env } from '../config/env.js';
import type { Engine } from '../engine/engine.js';
import { currentCreds, type ModeResolution } from '../engine/mode.js';
import { alert, log } from '../log.js';
import { deleteStoredCreds, storeCreds, type Creds } from '../store/secrets.js';
import type { Auth } from './auth.js';

export interface SettingsDeps {
  engine: Engine;
  auth: Auth;
  env: Env;
  /** Mode the process booted with. */
  mode: ModeResolution;
  /** Authenticated read-only check of new keys; also reports whether the real account has an ETHUSD position. */
  testCredentials: (c: Creds) => Promise<{ livePosition: boolean }>;
  stopScheduler: () => void;
  startScheduler: () => void;
  /** Graceful exit after the response; PM2 restarts the bot (Amendment B.4). */
  requestRestart: () => void;
  /** COOKIE_SECURE=false (local dev): accept only direct loopback requests. */
  localOnly: boolean;
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/** Turns Delta's raw rejection into a plain instruction where we recognise it. */
export function explainDeltaError(raw: string): string {
  if (raw.includes('ip_not_whitelisted_for_api_key')) {
    const ip = /"client_ip"\s*:\s*"([^"]+)"/.exec(raw)?.[1];
    return ip
      ? `this server's IP ${ip} is not whitelisted for the key. In Delta → API Keys, add exactly ${ip} (0.0.0.0 is not a wildcard), save, and try again.`
      : 'this server\'s IP is not whitelisted for the key. Add the server\'s exact public IP in Delta → API Keys (0.0.0.0 is not a wildcard).';
  }
  if (/invalid_api_key|api_key_not_found|Unauthorized|401/i.test(raw) && /signature|api_key/i.test(raw)) {
    return 'the API key or secret is not valid. Copy both again from Delta → API Keys (the secret is shown only when the key is created).';
  }
  return raw;
}
const KEY_RE = /^[\x21-\x7e]{8,256}$/;

export function settingsRouter(d: SettingsDeps): Router {
  const r = Router();
  const { engine, auth, env } = d;
  const { repo } = engine.c;

  r.use(express.json({ limit: '2kb' }));
  r.use((req: Request, res: Response, next: NextFunction) => {
    if (d.localOnly && (!LOOPBACK.has(req.socket.remoteAddress ?? '') || req.get('x-forwarded-for'))) {
      res.status(403).json({ error: 'settings need HTTPS (COOKIE_SECURE=true) or a direct local connection' });
      return;
    }
    next();
  });
  r.use(auth.requireSession, auth.requireCsrfHeader);

  const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response) => {
    try {
      await fn(req, res);
    } catch (err) {
      // Never log the request body or the error's raw text (it could echo a key).
      log.error({ route: req.path, errName: (err as Error).name }, 'settings error');
      if (!res.headersSent) res.status(500).json({ error: 'internal error' });
    }
  };

  /** Flat = no position on the active port and no OPENING/OPEN/CLOSING trade. */
  const isFlat = async () => !(await engine.c.port.getPosition()) && !repo.openTrade();

  /** Stops the scheduler under the mutex, re-checks flat, applies the change; restarts the scheduler if not flat. */
  async function switchExclusive(apply: () => void): Promise<boolean> {
    return engine.mutex.runExclusive(async () => {
      d.stopScheduler();
      if (!(await isFlat())) {
        d.startScheduler();
        return false;
      }
      apply();
      engine.suspend(); // nothing trades between this commit and the restart
      return true;
    });
  }

  function restartAfter(res: Response, body: Record<string, unknown>): void {
    repo.kvSet('requested_restart_at', engine.c.now());
    res.status(202).json({ ...body, restarting: true });
    d.requestRestart();
  }

  r.get(
    '/',
    wrap(async (_req, res) => {
      const cur = currentCreds(env, repo);
      const meta = cur.stored.status === 'ok' ? cur.stored.meta : cur.stored.status === 'unreadable' ? cur.stored.meta : null;
      res.json({
        mode: d.mode.live ? 'live' : 'paper',
        requestedMode: repo.kvGet('trading_mode') ?? 'paper',
        envLock: env.DRY_RUN,
        secretsKeyConfigured: !!env.SECRETS_KEY,
        credentialsSource: env.CREDENTIALS_SOURCE,
        credentials: {
          source: cur.source,
          stored: cur.stored.status,
          unreadableReason: cur.stored.status === 'unreadable' ? cur.stored.reason : null,
          keyLast4: cur.source === 'env' ? (cur.creds?.apiKey.slice(-4) ?? null) : (meta?.keyLast4 ?? null),
          savedAt: meta?.savedAt ?? null,
          verifiedAt: repo.kvNum('credentials_verified_at', 0) || null,
        },
        isolatedConfirmed: d.mode.isolatedConfirmed,
        flat: await isFlat(),
        halted: engine.c.halt.state().halted,
        risk: engine.c.params.RISK_PER_TRADE,
        riskReduced: engine.c.params.RISK_REDUCED,
      });
    }),
  );

  r.post(
    '/credentials',
    wrap(async (req, res) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      if (!(await auth.reauth(req, res, b.password))) return;
      if (!env.SECRETS_KEY) return void res.status(400).json({ error: 'SECRETS_KEY is not set in .env (openssl rand -hex 32), so keys cannot be stored encrypted' });
      const apiKey = typeof b.apiKey === 'string' ? b.apiKey.trim() : '';
      const apiSecret = typeof b.apiSecret === 'string' ? b.apiSecret.trim() : '';
      if (!KEY_RE.test(apiKey) || !KEY_RE.test(apiSecret)) return void res.status(400).json({ error: 'API key and secret must be 8–256 printable characters' });
      if (b.tradingPermission !== true) return void res.status(400).json({ error: 'confirm the key has Trading permission and no Withdrawal permission' });
      if (!(await isFlat())) return void res.status(409).json({ error: 'keys can only be changed with no open position' });
      try {
        await d.testCredentials({ apiKey, apiSecret });
      } catch (e) {
        const msg = String((e as Error).message ?? 'rejected').replaceAll(apiKey, '[key]').replaceAll(apiSecret, '[secret]');
        return void res.status(400).json({ error: `Delta rejected the key: ${explainDeltaError(msg)}` });
      }
      let meta = { keyLast4: '', savedAt: 0 };
      const now = engine.c.now();
      const apply = () => {
        meta = storeCreds(repo, env.SECRETS_KEY!, { apiKey, apiSecret }, now);
        repo.kvSet('credentials_verified_at', now);
        repo.addSystemEvent('credentials_saved', { keyLast4: meta.keyLast4, mode: d.mode.live ? 'live' : 'paper' });
      };
      if (d.mode.live) {
        // Live and flat: apply under the mutex and restart so the new keys take effect now (B.9 #8).
        if (!(await switchExclusive(apply))) return void res.status(409).json({ error: 'a trade opened meanwhile; keys not changed' });
        alert(`API keys replaced (…${meta.keyLast4}); restarting`);
        return restartAfter(res, { keyLast4: meta.keyLast4, verifiedAt: now });
      }
      apply();
      alert(`API keys saved (…${meta.keyLast4})`);
      res.json({ keyLast4: meta.keyLast4, verifiedAt: now });
    }),
  );

  r.delete(
    '/credentials',
    wrap(async (req, res) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      if (!(await auth.reauth(req, res, b.password))) return;
      if (d.mode.live || repo.kvGet('trading_mode') === 'live') return void res.status(409).json({ error: 'switch back to paper before removing the keys' });
      if (!(await isFlat())) return void res.status(409).json({ error: 'keys can only be removed with no open position' });
      deleteStoredCreds(repo);
      repo.kvSet('credentials_verified_at', null);
      repo.addSystemEvent('credentials_removed', {});
      alert('API keys removed');
      res.json({ ok: true });
    }),
  );

  r.post(
    '/mode',
    wrap(async (req, res) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      if (!(await auth.reauth(req, res, b.password))) return;
      const target = b.mode;
      if (target !== 'live' && target !== 'paper') return void res.status(400).json({ error: "mode must be 'live' or 'paper'" });
      const current = d.mode.live ? 'live' : 'paper';
      if (target === current) return void res.status(409).json({ error: `already in ${current} mode` });

      if (target === 'live') {
        if (env.DRY_RUN) return void res.status(409).json({ error: 'DRY_RUN=true in .env locks the bot to paper trading; set it to false and restart first' });
        if (b.confirm !== 'LIVE') return void res.status(400).json({ error: 'type LIVE to confirm' });
        if (b.isolatedConfirmed !== true) return void res.status(400).json({ error: 'confirm that isolated margin is set for ETHUSD in the Delta app' });
        if (engine.c.halt.state().halted) return void res.status(409).json({ error: 'the bot is halted; resolve and resume first' });
        const cur = currentCreds(env, repo);
        if (!cur.creds) return void res.status(409).json({ error: cur.stored.status === 'unreadable' ? `stored keys are unreadable (${cur.stored.reason})` : 'save API keys first' });
        let probe: { livePosition: boolean };
        try {
          probe = await d.testCredentials(cur.creds);
        } catch (e) {
          return void res.status(400).json({ error: `Delta rejected the key: ${explainDeltaError(String((e as Error).message))}` });
        }
        if (probe.livePosition) return void res.status(409).json({ error: 'the Delta account already has an open ETHUSD position; close it on Delta first' });
      }
      const now = engine.c.now();
      const ok = await switchExclusive(() => {
        repo.kvSet('trading_mode', target);
        if (target === 'live') {
          repo.kvSet('isolated_margin_confirmed', 1);
          repo.kvSet('credentials_verified_at', now);
        }
        repo.addSystemEvent('mode_change', { from: current, to: target });
      });
      if (!ok) return void res.status(409).json({ error: 'close the open position first (a trade may have just opened)' });
      alert(`trading mode ${current} → ${target.toUpperCase()} (from the dashboard); restarting`);
      restartAfter(res, { mode: target });
    }),
  );

  return r;
}
