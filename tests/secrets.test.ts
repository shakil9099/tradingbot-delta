import { describe, expect, it } from 'vitest';
import { parseEnv } from '../src/config/env.js';
import { ModeError, resolveMode } from '../src/engine/mode.js';
import { openDb } from '../src/store/db.js';
import { Repo } from '../src/store/repo.js';
import { decryptCreds, encryptCreds, readStoredCreds, storeCreds } from '../src/store/secrets.js';

const K1 = 'a1'.repeat(32);
const K2 = 'b2'.repeat(32);
const creds = { apiKey: 'AKEY-12345678', apiSecret: 'SUPERSECRET-abcdefgh' };
const repo = () => new Repo(openDb(':memory:'));

describe('secrets (AES-256-GCM)', () => {
  it('round-trips, with a fresh IV each time', () => {
    const meta = { keyLast4: '5678', savedAt: 100 };
    const a = encryptCreds(K1, creds, meta), b = encryptCreds(K1, creds, meta);
    expect(a.iv).not.toBe(b.iv);
    expect(decryptCreds(K1, a)).toEqual(creds);
  });

  it('detects tampering of ciphertext, IV, tag and the AAD-bound metadata; a wrong key fails', () => {
    const blob = encryptCreds(K1, creds, { keyLast4: '5678', savedAt: 100 });
    const flip = (s: string) => Buffer.from(Buffer.from(s, 'base64').map((x, i) => (i === 0 ? x ^ 1 : x))).toString('base64');
    expect(() => decryptCreds(K1, { ...blob, ct: flip(blob.ct) })).toThrow();
    expect(() => decryptCreds(K1, { ...blob, iv: flip(blob.iv) })).toThrow();
    expect(() => decryptCreds(K1, { ...blob, tag: flip(blob.tag) })).toThrow();
    expect(() => decryptCreds(K1, { ...blob, keyLast4: '0000' })).toThrow();
    expect(() => decryptCreds(K1, { ...blob, savedAt: 101 })).toThrow();
    expect(() => decryptCreds(K2, blob)).toThrow();
  });

  it('the stored row never contains the key or secret in plain text (so backups do not either)', () => {
    const r = repo();
    storeCreds(r, K1, creds, 100);
    const raw = r.kvGet('delta_credentials')!;
    expect(raw).not.toContain(creds.apiSecret);
    expect(raw).not.toContain(creds.apiKey);
    expect(readStoredCreds(r, K1)).toMatchObject({ status: 'ok', creds, meta: { keyLast4: '5678', savedAt: 100 } });
  });

  it('unreadable without SECRETS_KEY or with a different one', () => {
    const r = repo();
    storeCreds(r, K1, creds, 100);
    expect(readStoredCreds(r, undefined)).toMatchObject({ status: 'unreadable', reason: expect.stringContaining('SECRETS_KEY') });
    expect(readStoredCreds(r, K2)).toMatchObject({ status: 'unreadable' });
    expect(readStoredCreds(repo(), K1)).toEqual({ status: 'none' });
  });
});

const base = {
  DASHBOARD_USER: 'admin',
  DASHBOARD_PASSWORD_HASH: '$2a$04$abcdefghijklmnopqrstuuabcdefghijklmnopqrstuvwxyzABCD',
  SESSION_SECRET: 's'.repeat(40),
  CTL_TOKEN: 't'.repeat(40),
};
const env = (x: Record<string, string> = {}) => parseEnv({ ...base, ...x });

describe('resolveMode (Amendment B.2, B.9 #1–2)', () => {
  it('fresh install, no keys → paper (recorded once)', () => {
    const r = repo();
    expect(resolveMode(env(), r)).toMatchObject({ live: false, mode: 'paper', source: 'none', migrated: false });
    expect(r.kvGet('trading_mode')).toBe('paper');
  });

  it('upgrade: an existing DRY_RUN=false deployment with .env keys stays live', () => {
    const r = repo();
    const m = resolveMode(env({ DELTA_API_KEY: 'k'.repeat(10), DELTA_API_SECRET: 's'.repeat(10), ISOLATED_MARGIN_CONFIRMED: 'true' }), r);
    expect(m).toMatchObject({ live: true, mode: 'live', source: 'env', migrated: true });
    expect(r.listSystemEvents('mode_migrated')).toHaveLength(1);
  });

  it('the upgrade is one-time: a later paper choice is kept', () => {
    const r = repo();
    r.kvSet('trading_mode', 'paper');
    expect(resolveMode(env({ DELTA_API_KEY: 'k'.repeat(10), DELTA_API_SECRET: 's'.repeat(10) }), r).live).toBe(false);
  });

  it('DRY_RUN=true locks paper even when the dashboard says live', () => {
    const r = repo();
    r.kvSet('trading_mode', 'live');
    expect(resolveMode(env({ DRY_RUN: 'true' }), r)).toMatchObject({ live: false, envLock: true });
  });

  it('live with stored keys; stored keys take precedence over .env', () => {
    const r = repo();
    storeCreds(r, K1, creds, 1);
    r.kvSet('trading_mode', 'live');
    r.kvSet('isolated_margin_confirmed', 1);
    expect(resolveMode(env({ SECRETS_KEY: K1, DELTA_API_KEY: 'other-key-1', DELTA_API_SECRET: 'other-secret' }), r)).toMatchObject({ live: true, source: 'stored', creds });
  });

  it('live + unreadable stored keys → refuse (never silently use .env); CREDENTIALS_SOURCE=env is the override', () => {
    const r = repo();
    storeCreds(r, K1, creds, 1);
    r.kvSet('trading_mode', 'live');
    r.kvSet('isolated_margin_confirmed', 1);
    const e = { SECRETS_KEY: K2, DELTA_API_KEY: 'envkey-1234', DELTA_API_SECRET: 'envsecret-1234' };
    expect(() => resolveMode(env(e), r)).toThrow(ModeError);
    expect(resolveMode(env({ ...e, CREDENTIALS_SOURCE: 'env' }), r)).toMatchObject({ live: true, source: 'env' });
  });

  it('live without keys or without the isolated-margin confirmation → refuse', () => {
    const r = repo();
    r.kvSet('trading_mode', 'live');
    expect(() => resolveMode(env(), r)).toThrow(/no API keys/);
    storeCreds(r, K1, creds, 1);
    expect(() => resolveMode(env({ SECRETS_KEY: K1 }), r)).toThrow(/isolated margin/);
  });
});
