import cookieSession from 'cookie-session';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
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
  /** Dashboard API keys and the paper/live switch (Amendment B). Omitted in tests that do not need it. */
  settings?: Omit<SettingsDeps, 'engine' | 'auth' | 'localOnly'>;
}

export function createApp(o: ServerOpts): Express {
  const app = express();
  app.set('trust proxy', 'loopback');
  app.disable('x-powered-by');
  app.use(
    cookieSession({
      name: 'ethbot',
      keys: [o.sessionSecret],
      httpOnly: true,
      secure: o.cookieSecure,
      sameSite: 'strict',
      maxAge: 12 * 3600 * 1000,
    }),
  );
  const auth = new Auth({ user: o.user, passwordHash: o.passwordHash, ctlToken: o.ctlToken });
  // Settings first, with their own 2 KB parser (the global parser below then skips the parsed body).
  if (o.settings) app.use('/api/settings', settingsRouter({ ...o.settings, engine: o.engine, auth, localOnly: !o.cookieSecure }));
  app.use(express.json({ limit: '10kb' }));
  app.use(buildRouter({ ...o, auth }));

  const dist = o.webDist ?? resolve(process.cwd(), 'web/dist');
  if (existsSync(dist)) {
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
