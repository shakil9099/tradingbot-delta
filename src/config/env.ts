import { z } from 'zod';
import { buildParams, type Params, type StrategyMode } from './params.js';

/** "true"/"false" only. z.coerce.boolean() is not used because it reads the string "false" as true. */
const bool = (def: 'true' | 'false') => z.enum(['true', 'false']).default(def).transform((v) => v === 'true');
const optStr = z.string().optional().transform((v) => (v === undefined || v.trim() === '' ? undefined : v.trim()));
const ALLOWED_HOSTS = ['https://api.india.delta.exchange', 'https://cdn-ind.testnet.deltaex.org'];

const schema = z
  .object({
    DELTA_API_KEY: optStr,
    DELTA_API_SECRET: optStr,
    DELTA_BASE_URL: z.string().default('https://api.india.delta.exchange'),
    DASHBOARD_USER: z.string().min(1, 'DASHBOARD_USER is required'),
    DASHBOARD_PASSWORD_HASH: z.string().min(20, 'DASHBOARD_PASSWORD_HASH is required (npm run hash-password)'),
    SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
    CTL_TOKEN: z.string().min(32, 'CTL_TOKEN must be at least 32 characters'),
    ISOLATED_MARGIN_CONFIRMED: bool('false'),
    TELEGRAM_BOT_TOKEN: optStr,
    TELEGRAM_CHAT_ID: optStr,
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    /** Listen address. 127.0.0.1 behind Caddy (EC2); 0.0.0.0 on platforms that route to the container (Railway). */
    HOST: z.string().default('127.0.0.1'),
    /** Express 'trust proxy': 'loopback' behind Caddy; '1' behind one platform proxy (Railway) so HTTPS and client IPs are seen. */
    TRUST_PROXY: z.string().default('loopback'),
    DRY_RUN: bool('false'),
    PAPER_BALANCE: z.coerce.number().positive().default(141),
    MAX_CONTRACTS: z.coerce.number().int().min(1).default(100000),
    /** Fixed contracts per entry (100 = 1 ETH). 0 = risk sizing (RISK_PER_TRADE / RISK_REDUCED). */
    FIXED_CONTRACTS: z.coerce.number().int().min(0).default(0),
    /** Cost-to-cost when an hourly close is this many $ per ETH in profit (or at 1R if sooner). 0 = off. */
    BE_TRIG_USD: z.coerce.number().min(0).default(15),
    STRATEGY: z.enum(['adaptive', 'hull', 'ut', 'reversal', 'revaa']).default('adaptive'),
    /** No new entries for the rest of the IST day after a realised loss of this share of the day-start balance. 0 = off. */
    DAY_LOSS_STOP: z.coerce.number().min(0).max(1).default(0),
    /** Seconds after the hour the cycle runs (a second instance uses a later slot so the two don't hit Delta together). */
    CYCLE_OFFSET_SEC: z.coerce.number().int().min(5).max(300).default(10),
    /** Hull also re-enters on a reversal signal that agrees with Hull's direction (Mix B). Change only while flat. */
    REV_REENTRY: bool('false'),
    /** Take-profit in R. Unset = the strategy's default (Hull 0 = none, reversal 2). Change only while flat. */
    TP_R: z.preprocess((v) => (v === '' ? undefined : v), z.coerce.number().min(0).max(10).optional()),
    LEVERAGE: z.coerce.number().int().min(1).max(100).default(20),
    ATR_GATE_MAX: z.coerce.number().min(0).default(0),
    SKIP_WEEKEND_ENTRIES: bool('true'),
    MIN_ATR: z.coerce.number().min(0).default(15),
    RISK_PER_TRADE: z.coerce.number().gt(0).max(0.3).default(0.2),
    RISK_REDUCED: z.coerce.number().gt(0).max(0.3).default(0.05),
    RISK_REDUCE_DD: z.coerce.number().gt(0).lt(1).default(0.2),
    /** Halt after this many consecutive initial-stop exits. 0 = breaker off. */
    BREAKER_N: z.coerce.number().int().min(0).default(3),
    /** 64 hex chars (openssl rand -hex 32). Encrypts API keys saved from the dashboard (design Amendment B.3). */
    SECRETS_KEY: optStr.refine((v) => v === undefined || /^[0-9a-fA-F]{64}$/.test(v), 'SECRETS_KEY must be 64 hex characters (openssl rand -hex 32)'),
    /** 'auto': stored dashboard keys, else .env keys. 'env': use only .env keys (recovery override, Amendment B.9 #2). */
    CREDENTIALS_SOURCE: z.enum(['auto', 'env']).default('auto'),
    COOKIE_SECURE: bool('true'),
    DATA_DIR: z.string().default('data'),
  })
  .superRefine((e, ctx) => {
    if (!ALLOWED_HOSTS.includes(e.DELTA_BASE_URL.replace(/\/+$/, ''))) {
      ctx.addIssue({ code: 'custom', path: ['DELTA_BASE_URL'], message: `must be one of ${ALLOWED_HOSTS.join(', ')}` });
    }
    // API keys are not required here: they may be saved from the dashboard (Amendment B). Boot checks live mode.
  });

export type Env = z.infer<typeof schema>;

export class EnvError extends Error {}

/** Parses an env object. Throws EnvError naming the missing or invalid key. */
export function parseEnv(raw: Record<string, string | undefined>): Env {
  const r = schema.safeParse(raw);
  if (!r.success) {
    const msg = r.error.issues.map((i) => `${i.path.join('.') || 'env'}: ${i.message}`).join('; ');
    throw new EnvError(msg);
  }
  return { ...r.data, DELTA_BASE_URL: r.data.DELTA_BASE_URL.replace(/\/+$/, '') };
}

export function paramsFromEnv(env: Env): Readonly<Params> {
  return buildParams({
    LEVERAGE: env.LEVERAGE,
    STRATEGY: env.STRATEGY as StrategyMode,
    DRY_RUN: env.DRY_RUN,
    MAX_CONTRACTS: env.MAX_CONTRACTS,
    FIXED_CONTRACTS: env.FIXED_CONTRACTS,
    BE_TRIG_USD: env.BE_TRIG_USD,
    REV_REENTRY: env.REV_REENTRY,
    DAY_LOSS_STOP: env.DAY_LOSS_STOP,
    PAPER_BALANCE: env.PAPER_BALANCE,
    ATR_GATE_MAX: env.ATR_GATE_MAX,
    SKIP_WEEKEND_ENTRIES: env.SKIP_WEEKEND_ENTRIES,
    MIN_ATR: env.MIN_ATR,
    RISK_PER_TRADE: env.RISK_PER_TRADE,
    RISK_REDUCED: env.RISK_REDUCED,
    RISK_REDUCE_DD: env.RISK_REDUCE_DD,
    BREAKER_N: env.BREAKER_N,
    ...(env.TP_R !== undefined ? { TP_R: env.TP_R } : {}),
  });
}
