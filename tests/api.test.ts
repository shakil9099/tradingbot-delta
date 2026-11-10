import bcrypt from 'bcryptjs';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/api/server.js';
import { Auth } from '../src/api/auth.js';
import { makeEngine } from './fakes/setup.js';

const TOKEN = 'x'.repeat(40);
const hash = bcrypt.hashSync('correct horse battery', 4);

function app(failures = 0) {
  const env = makeEngine();
  env.repo.kvSet('last_cycle_at', env.c.now());
  const a = createApp({
    engine: env.engine,
    user: 'admin',
    passwordHash: hash,
    ctlToken: TOKEN,
    sessionSecret: 's'.repeat(40),
    cookieSecure: false,
    consecutiveFailures: () => failures,
    nextCycleAt: () => null,
    webDist: '/nonexistent',
  });
  return { ...env, app: a };
}

async function login(a: ReturnType<typeof app>['app']) {
  const agent = request.agent(a);
  await agent.post('/api/login').send({ user: 'admin', password: 'correct horse battery' }).expect(200);
  return agent;
}

describe('auth', () => {
  it('401 without a session', async () => {
    await request(app().app).get('/api/status').expect(401);
  });
  it('login works and the session reaches /api/status', async () => {
    const { app: a } = app();
    const agent = await login(a);
    const r = await agent.get('/api/status').expect(200);
    expect(r.body).toMatchObject({ halted: false, active: 'hull', dryRun: false });
  });
  it('CSRF header required on POST with a session', async () => {
    const { app: a } = app();
    const agent = await login(a);
    await agent.post('/api/control/pause').expect(403);
    await agent.post('/api/control/pause').set('X-Requested-With', 'fetch').expect(200);
  });
  it('ctl token accepted on loopback, rejected when X-Forwarded-For is present or wrong', async () => {
    const { app: a, halt } = app();
    await request(a).post('/api/control/pause').set('X-Ctl-Token', TOKEN).expect(200);
    expect(halt.state().kind).toBe('manual');
    await request(a).post('/api/control/resume').set('X-Ctl-Token', TOKEN).set('X-Forwarded-For', '1.2.3.4').expect(401);
    await request(a).post('/api/control/resume').set('X-Ctl-Token', 'y'.repeat(40)).expect(401);
  });
  it('control close returns 409 when flat', async () => {
    const { app: a } = app();
    await request(a).post('/api/control/close').set('X-Ctl-Token', TOKEN).expect(409);
  });
});

describe('login delay', () => {
  it('returns 429 with Retry-After = remaining delay, and never locks out', async () => {
    let t = 1_000_000;
    const auth = new Auth({ user: 'admin', passwordHash: hash, ctlToken: TOKEN, now: () => t });
    const fail = async () => {
      const res = { status: 0, headers: {} as Record<string, string>, set(k: string, v: string) { this.headers[k] = v; return this; }, json() { return this; } };
      (res as unknown as { status: (n: number) => unknown }).status = function (this: typeof res, n: number) { (this as unknown as { code: number }).code = n; return this; } as never;
      await auth.login({ ip: '9.9.9.9', body: { user: 'admin', password: 'nope' }, session: {} } as never, res as never);
      return res as unknown as { code: number; headers: Record<string, string> };
    };
    expect((await fail()).code).toBe(401); // 1 failure → next attempt waits 1 s
    expect(auth.retryAfter('9.9.9.9')).toBe(1);
    t += 1000;
    expect((await fail()).code).toBe(401); // 2 failures → 2 s
    t += 500;
    const r = await fail();
    expect(r.code).toBe(429);
    expect(r.headers['Retry-After']).toBe('2'); // ceil(1.5)
    t += 60 * 60_000; // window passes: counter resets, no lockout
    expect(auth.retryAfter('9.9.9.9')).toBe(0);
  });
});

describe('/health', () => {
  it('200 normally', async () => {
    await request(app().app).get('/health').expect(200);
  });
  it('503 when halted', async () => {
    const { app: a, halt } = app();
    halt.halt('x', 'manual');
    const r = await request(a).get('/health').expect(503);
    expect(r.body.reason).toContain('halted');
  });
  it('503 when the cycle is stale', async () => {
    const { app: a, repo, c } = app();
    repo.kvSet('last_cycle_at', c.now() - 66 * 60);
    await request(a).get('/health').expect(503);
  });
  it('503 when exchange calls keep failing', async () => {
    await request(app(3).app).get('/health').expect(503);
  });
  it('503 when a position lacks a confirmed bracket', async () => {
    const { app: a, fx, engine } = app();
    fx.position = { side: 'buy', size: 10, entryPrice: 2000 };
    fx.placeBracketNoop = true;
    await engine.reconcile();
    const r = await request(a).get('/health').expect(503);
    expect(r.body.reason).toContain('bracket');
  });
});
