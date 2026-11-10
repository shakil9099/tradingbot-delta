import { pino } from 'pino';

export const log = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: {
    paths: [
      '["api-key"]',
      'signature',
      'password',
      '*.secret',
      'apiKey',
      'apiSecret',
      '*.apiKey',
      '*.apiSecret',
      '*.*.apiKey',
      '*.*.apiSecret',
      'body',
      '*.body',
      'SECRETS_KEY',
      '*.SECRETS_KEY',
      '["x-ctl-token"]',
      'headers["api-key"]',
      'headers.signature',
      'headers["x-ctl-token"]',
    ],
    censor: '[redacted]',
  },
});

export function child(cycleId: string) {
  return log.child({ cycleId });
}

type Notifier = (text: string) => Promise<void> | void;
let notifier: Notifier | null = null;

/** Registers the alert sink (Telegram). Wired in index.ts; absent in phase 1 and in tests. */
export function setNotifier(fn: Notifier | null): void {
  notifier = fn;
}

/** "Alert" = log at error level, plus a Telegram message if configured. Never throws. */
export function alert(text: string, data: Record<string, unknown> = {}): void {
  log.error({ alert: true, ...data }, text);
  if (!notifier) return;
  try {
    const r = notifier(text);
    if (r && typeof (r as Promise<void>).catch === 'function') {
      (r as Promise<void>).catch((err) => log.warn({ err }, 'notifier failed'));
    }
  } catch (err) {
    log.warn({ err }, 'notifier failed');
  }
}
