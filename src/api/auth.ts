import bcrypt from 'bcryptjs';
import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export interface AuthConfig {
  user: string;
  passwordHash: string;
  ctlToken: string;
  now?: () => number; // ms
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const WINDOW_MS = 15 * 60_000;

function safeEq(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

declare module 'express-serve-static-core' {
  interface Request {
    viaToken?: boolean;
  }
}

export class Auth {
  /** Login delay state, per client IP (in memory). */
  private failures = new Map<string, { count: number; last: number }>();
  private readonly now: () => number;
  constructor(private readonly cfg: AuthConfig) {
    this.now = cfg.now ?? Date.now;
  }

  /** Seconds the IP must still wait before another attempt (0 = may try now). */
  retryAfter(ip: string): number {
    const f = this.failures.get(ip);
    if (!f) return 0;
    const t = this.now();
    if (t - f.last > WINDOW_MS) {
      this.failures.delete(ip);
      return 0;
    }
    const delay = Math.min(60, 2 ** (f.count - 1)) * 1000;
    return Math.max(0, Math.ceil((f.last + delay - t) / 1000));
  }

  login = async (req: Request, res: Response) => {
    const ip = req.ip ?? 'unknown';
    const wait = this.retryAfter(ip);
    if (wait > 0) {
      res.set('Retry-After', String(wait)).status(429).json({ error: 'too many attempts', retryAfter: wait });
      return;
    }
    const { user, password } = (req.body ?? {}) as { user?: string; password?: string };
    const ok = typeof user === 'string' && typeof password === 'string' && safeEq(user, this.cfg.user) && (await bcrypt.compare(password, this.cfg.passwordHash));
    if (!ok) {
      const f = this.failures.get(ip);
      this.failures.set(ip, { count: (f?.count ?? 0) + 1, last: this.now() });
      res.status(401).json({ error: 'invalid credentials' });
      return;
    }
    this.failures.delete(ip);
    (req.session as Record<string, unknown>).user = this.cfg.user;
    res.json({ ok: true });
  };

  /**
   * Password re-entry for sensitive actions (Amendment B.5): shares the login failure delay; after 5 failed
   * re-entries in one session the session is ended. Sends the error response itself and returns false on failure.
   */
  async reauth(req: Request, res: Response, password: unknown): Promise<boolean> {
    const ip = req.ip ?? 'unknown';
    const wait = this.retryAfter(ip);
    if (wait > 0) {
      res.set('Retry-After', String(wait)).status(429).json({ error: 'too many attempts', retryAfter: wait });
      return false;
    }
    if (typeof password === 'string' && (await bcrypt.compare(password, this.cfg.passwordHash))) {
      this.failures.delete(ip);
      if (req.session) (req.session as Record<string, unknown>).reauthFails = 0;
      return true;
    }
    const f = this.failures.get(ip);
    this.failures.set(ip, { count: (f?.count ?? 0) + 1, last: this.now() });
    const s = req.session as Record<string, unknown> | null | undefined;
    const fails = Number(s?.reauthFails ?? 0) + 1;
    if (fails >= 5) {
      req.session = null;
      res.status(401).json({ error: 'too many wrong passwords; logged out' });
      return false;
    }
    if (s) s.reauthFails = fails;
    res.status(403).json({ error: 'wrong password' });
    return false;
  }

  /** Session only: the ctl token is refused (credential and mode routes, Amendment B.5). */
  requireSession = (req: Request, res: Response, next: NextFunction) => {
    if (req.get('x-ctl-token') || req.viaToken) {
      res.status(403).json({ error: 'not available with the ctl token; use the dashboard' });
      return;
    }
    if ((req.session as Record<string, unknown> | null | undefined)?.user === this.cfg.user) return next();
    res.status(401).json({ error: 'login required' });
  };

  logout = (req: Request, res: Response) => {
    req.session = null;
    res.json({ ok: true });
  };

  /** Session, or X-Ctl-Token from a loopback socket that did not come through Caddy (no X-Forwarded-For). */
  requireAuth = (req: Request, res: Response, next: NextFunction) => {
    const token = req.get('x-ctl-token');
    if (token) {
      const direct = LOOPBACK.has(req.socket.remoteAddress ?? '') && !req.get('x-forwarded-for');
      if (direct && safeEq(token, this.cfg.ctlToken)) {
        req.viaToken = true;
        return next();
      }
      res.status(401).json({ error: 'invalid ctl token' });
      return;
    }
    if ((req.session as Record<string, unknown> | null | undefined)?.user === this.cfg.user) return next();
    res.status(401).json({ error: 'login required' });
  };

  /** CSRF header on every non-GET request (session requests only). */
  requireCsrfHeader = (req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.viaToken) return next();
    if (req.get('x-requested-with')) return next();
    res.status(403).json({ error: 'missing X-Requested-With header' });
  };
}
