import cookieSession from 'cookie-session';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Auth } from './auth.js';
import { log } from '../log.js';
import { buildRouter, type RouteDeps } from './routes.js';
import { settingsRouter, type SettingsDeps } from './settings.js';

export interface ServerOpts extends Omit<RouteDeps, 'auth'> {
  user: string;
  passwordHash: string;
  ctlToken: string;
  sessionSecret: string;
  cookieSecure: boolean;
  webDist?: string;
  /** Express 'trust proxy' (default 'loopback'; a number = proxy hops, e.g. '1' on Railway). */
  trustProxy?: string;
  /** Dashboard API keys and the paper/live switch (Amendment B). Omitted in tests that do not need it. */
  settings?: Omit<SettingsDeps, 'engine' | 'auth' | 'localOnly'>;
  /** Clock for the daily session renewal (tests). */
  now?: () => number;
}

const DAY_MS = 86_400_000;
/** Login lasts a year and renews on the first request each day (docs/designs/pwa_login_design_draft.md). */
export const SESSION_MAX_AGE_MS = 365 * DAY_MS;

/** Cookie signing key tied to the password: a password change (env + restart) ends every session. */
export function sessionKey(sessionSecret: string, passwordHash: string): string {
  return createHash('sha256').update(`${sessionSecret}\n${passwordHash}`).digest('hex');
}

export function createApp(o: ServerOpts): Express {
  const app = express();
  const tp = o.trustProxy ?? 'loopback';
  app.set('trust proxy', /^\d+$/.test(tp) ? Number(tp) : tp);
  app.disable('x-powered-by');
  app.use(
    cookieSession({
      name: 'ethbot',
      keys: [sessionKey(o.sessionSecret, o.passwordHash)],
      httpOnly: true,
      secure: o.cookieSecure,
      sameSite: 'strict',
      maxAge: SESSION_MAX_AGE_MS,
    }),
  );
  // Rolling login: a logged-in session's day stamp changes once a day, so cookie-session re-sends the cookie with a
  // fresh year. Anonymous requests are never given a cookie.
  const now = o.now ?? Date.now;
  app.use((req, _res, next) => {
    const s = req.session as Record<string, unknown> | null | undefined;
    if (s?.user) {
      const d = Math.floor(now() / DAY_MS);
      if (s.d !== d) s.d = d;
    }
    next();
  });
  const auth = new Auth({ user: o.user, passwordHash: o.passwordHash, ctlToken: o.ctlToken });
  // Settings first, with their own 2 KB parser (the global parser below then skips the parsed body).
  if (o.settings) app.use('/api/settings', settingsRouter({ ...o.settings, engine: o.engine, auth, localOnly: !o.cookieSecure }));
  app.use(express.json({ limit: '10kb' }));
  app.use(buildRouter({ ...o, auth }));

  const dist = o.webDist ?? resolve(process.cwd(), 'web/dist');
  if (existsSync(dist)) {
    // Hashed build files never change under the same name: the phone keeps them, so the installed app opens fast.
    app.use('/assets', express.static(resolve(dist, 'assets'), { index: false, immutable: true, maxAge: '365d', fallthrough: false }));
    app.use(express.static(dist, { index: false }));
    app.get(/^\/(?!api\/|health).*/, (_req, res) => res.sendFile(resolve(dist, 'index.html')));
  }

  // Errors (e.g. malformed JSON): never log or echo the request body — it may contain an API secret (B.9 #4).
  app.use((err: { type?: string; status?: number; statusCode?: number }, req: Request, res: Response, _next: NextFunction) => {
    const status = err.status ?? err.statusCode ?? 500;
    log.warn({ path: req.path, type: err.type ?? 'error', status }, 'request error');
    const msg = err.type === 'entity.parse.failed' ? 'invalid JSON' : err.type === 'entity.too.large' ? 'request too large' : 'request error';
    if (!res.headersSent) res.status(status).json({ error: msg });
  });
  return app;
}
