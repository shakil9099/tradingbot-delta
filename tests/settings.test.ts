import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/api/server.js';
import { parseEnv } from '../src/config/env.js';
import type { ModeResolution } from '../src/engine/mode.js';
import { log } from '../src/log.js';
import { readStoredCreds } from '../src/store/secrets.js';
import { makeEngine } from './fakes/setup.js';

const PW = 'correct horse battery';
const hash = bcrypt.hashSync(PW, 4);
const SK = 'c3'.repeat(32);
const KEY = 'AKEY-REAL-12345678';
const SECRET = 'TOPSECRET-do-not-leak-0987';
const TOKEN = 'x'.repeat(40);

afterEach(() => vi.restoreAllMocks());

function setup(o: { live?: boolean; envExtra?: Record<string, string>; test?: () => Promise<{ livePosition: boolean }> } = {}) {
  const live = o.live ?? false;
  const e = makeEngine({ DRY_RUN: !live });
  e.repo.kvSet('last_cycle_at', e.c.now());
  e.repo.kvSet('trading_mode', live ? 'live' : 'paper');
  const env = parseEnv({
    DASHBOARD_USER: 'admin',
    DASHBOARD_PASSWORD_HASH: hash,
    SESSION_SECRET: 's'.repeat(40),
    CTL_TOKEN: TOKEN,
    SECRETS_KEY: SK,
    ...(o.envExtra ?? {}),
  });
  const mode: ModeResolution = { live, mode: live ? 'live' : 'paper', envLock: env.DRY_RUN, creds: null, source: 'none', stored: 'none', storedReason: null, isolatedConfirmed: false, migrated: false };
  const spies = { stop: vi.fn(), start: vi.fn(), restart: vi.fn(), test: vi.fn(o.test ?? (async () => ({ livePosition: false }))) };
  const app = createApp({
    engine: e.engine,
    user: 'admin',
    passwordHash: hash,
    ctlToken: TOKEN,
    sessionSecret: 's'.repeat(40),
    cookieSecure: false,
    consecutiveFailures: () => 0,
    nextCycleAt: () => null,
    webDist: '/nonexistent',
    settings: { env, mode, testCredentials: spies.test, stopScheduler: spies.stop, startScheduler: spies.start, requestRestart: spies.restart },
  });
  return { ...e, app, spies, env };
}

async function agentFor(app: ReturnType<typeof setup>['app']) {
  const a = request.agent(app);
  await a.post('/api/login').send({ user: 'admin', password: PW }).expect(200);
  return a;
}
const H = { 'X-Requested-With': 'fetch' };
const save = { apiKey: KEY, apiSecret: SECRET, password: PW, tradingPermission: true };

describe('settings: keys (Amendment B)', () => {
  it('saves after a successful Delta test; stores only ciphertext; never returns the secret', async () => {
    const s = setup();
    const a = await agentFor(s.app);
    const r = await a.post('/api/settings/credentials').set(H).send(save).expect(200);
    expect(r.body).toMatchObject({ keyLast4: '5678' });
    expect(JSON.stringify(r.body)).not.toContain(SECRET);
    expect(s.spies.test).toHaveBeenCalledWith({ apiKey: KEY, apiSecret: SECRET });
    expect(readStoredCreds(s.repo, SK)).toMatchObject({ status: 'ok', creds: { apiKey: KEY, apiSecret: SECRET } });
    const g = await a.get('/api/settings').expect(200);
    expect(g.body.credentials).toMatchObject({ source: 'stored', stored: 'ok', keyLast4: '5678' });
    expect(JSON.stringify(g.body)).not.toContain(SECRET);
    expect(JSON.stringify(g.body)).not.toContain(KEY);
    expect(s.spies.restart).not.toHaveBeenCalled(); // paper: no restart needed
  });

  it('Delta rejection → 400 with the reason, nothing stored, secret not echoed', async () => {
    const s = setup({ test: async () => Promise.reject(new Error(`ip_not_whitelisted_for_api_key ${SECRET}`)) });
    const a = await agentFor(s.app);
    const r = await a.post('/api/settings/credentials').set(H).send(save).expect(400);
    expect(r.body.error).toContain('not whitelisted');
    expect(r.body.error).not.toContain(SECRET);
    expect(readStoredCreds(s.repo, SK).status).toBe('none');
  });

  it('requires the password, the trading-permission tick, SECRETS_KEY and flat', async () => {
    const s = setup();
    const a = await agentFor(s.app);
    await a.post('/api/settings/credentials').set(H).send({ ...save, tradingPermission: false }).expect(400);
    await a.post('/api/settings/credentials').set(H).send({ ...save, apiKey: 'short' }).expect(400);
    s.fx.position = { side: 'buy', size: 1, entryPrice: 2000 };
    await a.post('/api/settings/credentials').set(H).send(save).expect(409);
    s.fx.position = null;
    await a.post('/api/settings/credentials').set(H).send({ ...save, password: 'wrong' }).expect(403); // last: the shared delay then applies
    const n = setup({ envExtra: { SECRETS_KEY: '' } });
    const b = await agentFor(n.app);
    expect((await b.post('/api/settings/credentials').set(H).send(save).expect(400)).body.error).toContain('SECRETS_KEY');
  });

  it('5 wrong password re-entries end the session', async () => {
    const s = setup();
    const a = await agentFor(s.app);
    let last = 0;
    for (let i = 0; i < 5; i++) {
      const r = await a.post('/api/settings/credentials').set(H).send({ ...save, password: `wrong${i}` });
      last = r.status;
      if (r.status === 429) break; // shared login delay may kick in first
    }
    expect([401, 429]).toContain(last);
  });

  it('session only: the ctl token is refused; no session → 401', async () => {
    const s = setup();
    await request(s.app).get('/api/settings').set('X-Ctl-Token', TOKEN).expect(403);
    await request(s.app).get('/api/settings').expect(401);
  });

  it('CSRF header is required on DELETE (and POST)', async () => {
    const s = setup();
    const a = await agentFor(s.app);
    await a.delete('/api/settings/credentials').send({ password: PW }).expect(403);
    await a.post('/api/settings/credentials').send(save).expect(403);
  });

  it('malformed JSON and oversized bodies: generic error, no body or secret in any log call or response', async () => {
    const s = setup();
    const a = await agentFor(s.app);
    const logged: string[] = [];
    for (const m of ['info', 'warn', 'error', 'debug'] as const) vi.spyOn(log, m).mockImplementation(((...args: unknown[]) => void logged.push(JSON.stringify(args))) as never);
    const bad = await a.post('/api/settings/credentials').set(H).set('Content-Type', 'application/json').send(`{"apiKey":"${KEY}","apiSecret":"${SECRET}",`).expect(400);
    expect(bad.body).toEqual({ error: 'invalid JSON' });
    const big = await a.post('/api/settings/credentials').set(H).send({ ...save, pad: 'x'.repeat(3000) }).expect(413);
    expect(big.body).toEqual({ error: 'request too large' });
    expect(logged.join('\n')).not.toContain(SECRET);
    expect(logged.join('\n')).not.toContain(KEY);
  });

  it('removing keys: only in paper and only when flat', async () => {
    const s = setup();
    const a = await agentFor(s.app);
    await a.post('/api/settings/credentials').set(H).send(save).expect(200);
    await a.delete('/api/settings/credentials').set(H).send({ password: PW }).expect(200);
    expect(readStoredCreds(s.repo, SK).status).toBe('none');
    const l = setup({ live: true });
    const b = await agentFor(l.app);
    await b.delete('/api/settings/credentials').set(H).send({ password: PW }).expect(409);
  });

  it('live + flat: replacing keys restarts the bot so they apply at once', async () => {
    const s = setup({ live: true });
    const a = await agentFor(s.app);
    const r = await a.post('/api/settings/credentials').set(H).send(save).expect(202);
    expect(r.body).toMatchObject({ restarting: true, keyLast4: '5678' });
    expect(s.spies.restart).toHaveBeenCalledOnce();
    expect(s.engine.isSuspended).toBe(true);
  });
});

describe('settings: mode switch', () => {
  async function withKeys() {
    const s = setup();
    const a = await agentFor(s.app);
    await a.post('/api/settings/credentials').set(H).send(save).expect(200);
    return { ...s, a };
  }
  const goLive = { mode: 'live', password: PW, confirm: 'LIVE', isolatedConfirmed: true };

  it('go live: needs LIVE typed and the isolated-margin tick; then writes the mode, suspends, answers 202, restarts', async () => {
    const s = await withKeys();
    await s.a.post('/api/settings/mode').set(H).send({ ...goLive, confirm: 'live' }).expect(400);
    await s.a.post('/api/settings/mode').set(H).send({ ...goLive, isolatedConfirmed: false }).expect(400);
    const r = await s.a.post('/api/settings/mode').set(H).send(goLive).expect(202);
    expect(r.body).toEqual({ mode: 'live', restarting: true });
    expect(s.repo.kvGet('trading_mode')).toBe('live');
    expect(s.repo.kvNum('isolated_margin_confirmed')).toBe(1);
    expect(s.repo.kvNum('requested_restart_at')).toBe(s.c.now());
    expect(s.spies.stop).toHaveBeenCalled();
    expect(s.spies.restart).toHaveBeenCalledOnce();
    expect(s.engine.isSuspended).toBe(true);
    s.fx.calls = [];
    await s.engine.reconcile(); // suspended: no exchange calls before the restart
    expect(s.fx.calls).toEqual([]);
    expect(s.repo.listSystemEvents('mode_change')).toHaveLength(1);
  });

  it('go live is refused without keys, under the DRY_RUN lock, when halted, or when Delta shows a position', async () => {
    const n = setup();
    const a = await agentFor(n.app);
    await a.post('/api/settings/mode').set(H).send(goLive).expect(409); // no keys
    const lock = setup({ envExtra: { DRY_RUN: 'true' } });
    const b = await agentFor(lock.app);
    expect((await b.post('/api/settings/mode').set(H).send(goLive).expect(409)).body.error).toContain('DRY_RUN');
    const h = await withKeys();
    h.halt.halt('test', 'manual');
    await h.a.post('/api/settings/mode').set(H).send(goLive).expect(409);
    const p = await withKeys();
    p.spies.test.mockResolvedValueOnce({ livePosition: true });
    expect((await p.a.post('/api/settings/mode').set(H).send(goLive).expect(409)).body.error).toContain('open ETHUSD position');
    expect(p.repo.kvGet('trading_mode')).toBe('paper');
  });

  it('race: a trade that opened before the exclusive re-check → 409, scheduler restarted, mode unchanged', async () => {
    const s = await withKeys();
    // Simulates a trade opening between the request and the exclusive section: the position appears on the
    // second getPosition() call (the re-check under the mutex).
    const orig = s.fx.getPosition.bind(s.fx);
    let calls = 0;
    s.fx.getPosition = async () => (++calls >= 1 ? { side: 'buy', size: 1, entryPrice: 2000 } : orig());
    const r = await s.a.post('/api/settings/mode').set(H).send(goLive).expect(409);
    expect(r.body.error).toContain('open position');
    expect(s.repo.kvGet('trading_mode')).toBe('paper');
    expect(s.spies.restart).not.toHaveBeenCalled();
    expect(s.spies.start).toHaveBeenCalled();
    expect(s.engine.isSuspended).toBe(false);
  });

  it('back to paper from live', async () => {
    const s = setup({ live: true });
    const a = await agentFor(s.app);
    await a.post('/api/settings/mode').set(H).send({ mode: 'paper', password: PW }).expect(202);
    expect(s.repo.kvGet('trading_mode')).toBe('paper');
    await a.post('/api/settings/mode').set(H).send({ mode: 'live', password: PW, confirm: 'LIVE', isolatedConfirmed: true }); // same process still "live"
  });
});

describe('explainDeltaError', () => {
  it('turns ip_not_whitelisted into a plain instruction with the IP Delta sees', async () => {
    const { explainDeltaError } = await import('../src/api/settings.js');
    const raw = 'fatal 401 ip_not_whitelisted_for_api_key on /v2/wallet/balances: {"error":{"code":"ip_not_whitelisted_for_api_key","context":{"client_ip":"203.192.227.219"}},"success":false}';
    expect(explainDeltaError(raw)).toBe(
      "this server's IP 203.192.227.219 is not whitelisted for the key. In Delta → API Keys, add exactly 203.192.227.219 (0.0.0.0 is not a wildcard), save, and try again.",
    );
    expect(explainDeltaError('fatal 500 something else')).toBe('fatal 500 something else');
  });
});
