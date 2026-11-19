import bcrypt from 'bcryptjs';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/api/server.js';
import { makeEngine } from './fakes/setup.js';

const PW = 'correct horse battery';
const hash = bcrypt.hashSync(PW, 4);
const DAY = 86_400_000;

function dist() {
  const d = mkdtempSync(join(tmpdir(), 'ethweb-'));
  mkdirSync(join(d, 'assets'));
  writeFileSync(join(d, 'index.html'), '<!doctype html><title>ETH Bot</title>');
  writeFileSync(join(d, 'sw.js'), "self.addEventListener('install', () => self.skipWaiting());");
  writeFileSync(join(d, 'manifest.webmanifest'), '{"name":"ETH Bot"}');
  writeFileSync(join(d, 'assets', 'index-abc123.js'), 'console.log(1)');
  return d;
}

function app(opts: { passwordHash?: string; clock?: { t: number }; webDist?: string } = {}) {
  const env = makeEngine();
  env.repo.kvSet('last_cycle_at', env.c.now());
  const clock = opts.clock ?? { t: Date.UTC(2026, 10, 19, 10) };
  return createApp({
    engine: env.engine,
    user: 'admin',
    passwordHash: opts.passwordHash ?? hash,
    ctlToken: 'x'.repeat(40),
    sessionSecret: 's'.repeat(40),
    cookieSecure: false,
    consecutiveFailures: () => 0,
    nextCycleAt: () => null,
    webDist: opts.webDist ?? '/nonexistent',
    now: () => clock.t,
  });
}

const cookies = (r: request.Response) => ([] as string[]).concat(r.headers['set-cookie'] ?? []);
const expiresOf = (r: request.Response) => {
  const c = cookies(r).find((x) => x.startsWith('ethbot='));
  const m = c && /expires=([^;]+)/i.exec(c);
  return m ? Date.parse(m[1]) : NaN;
};

describe('long login session', () => {
  it('login cookie lasts about a year', async () => {
    const r = await request(app()).post('/api/login').send({ user: 'admin', password: PW }).expect(200);
    const days = (expiresOf(r) - Date.now()) / DAY;
    expect(days).toBeGreaterThan(364);
    expect(days).toBeLessThan(366);
  });

  it('renews the cookie on the first request of a new day, not again the same day', async () => {
    const clock = { t: Date.UTC(2026, 10, 19, 10) };
    const agent = request.agent(app({ clock }));
    await agent.post('/api/login').send({ user: 'admin', password: PW }).expect(200);
    await agent.get('/api/status').expect(200); // first request stamps today's day
    expect(cookies(await agent.get('/api/status').expect(200)).some((c) => c.startsWith('ethbot='))).toBe(false);
    clock.t += DAY;
    const next = await agent.get('/api/status').expect(200);
    expect(cookies(next).some((c) => c.startsWith('ethbot='))).toBe(true);
    expect(cookies(await agent.get('/api/status').expect(200)).some((c) => c.startsWith('ethbot='))).toBe(false);
  });

  it('a cookie from before a password change is refused', async () => {
    const r = await request(app()).post('/api/login').send({ user: 'admin', password: PW }).expect(200);
    const jar = cookies(r).map((c) => c.split(';')[0]).join('; ');
    await request(app()).get('/api/status').set('Cookie', jar).expect(200);
    const changed = app({ passwordHash: bcrypt.hashSync('a new password here', 4) });
    await request(changed).get('/api/status').set('Cookie', jar).expect(401);
  });

  it('several devices stay logged in at once; logging out one leaves the others', async () => {
    const a = app();
    const phone = request.agent(a);
    const laptop = request.agent(a);
    await phone.post('/api/login').send({ user: 'admin', password: PW }).expect(200);
    await laptop.post('/api/login').send({ user: 'admin', password: PW }).expect(200);
    await phone.get('/api/status').expect(200);
    await laptop.get('/api/status').expect(200);
    await laptop.post('/api/logout').set('X-Requested-With', 'fetch').expect(200);
    await laptop.get('/api/status').expect(401);
    await phone.get('/api/status').expect(200);
  });

  it('logout still ends the session', async () => {
    const agent = request.agent(app());
    await agent.post('/api/login').send({ user: 'admin', password: PW }).expect(200);
    await agent.post('/api/logout').set('X-Requested-With', 'fetch').expect(200);
    await agent.get('/api/status').expect(401);
  });

  it('anonymous requests get no cookie', async () => {
    const a = app({ webDist: dist() });
    expect(cookies(await request(a).get('/health'))).toEqual([]);
    expect(cookies(await request(a).get('/sw.js'))).toEqual([]);
    expect(cookies(await request(a).get('/'))).toEqual([]);
  });
});

describe('PWA files', () => {
  it('serves sw.js and the manifest as files, not the app page', async () => {
    const a = app({ webDist: dist() });
    const sw = await request(a).get('/sw.js').expect(200);
    expect(sw.headers['content-type']).toMatch(/javascript/);
    expect(sw.text).toContain('skipWaiting');
    const mf = await request(a).get('/manifest.webmanifest').expect(200);
    expect(mf.text).toContain('ETH Bot');
  });

  it('hashed assets are cached for a year; a missing asset is 404, not index.html', async () => {
    const a = app({ webDist: dist() });
    const r = await request(a).get('/assets/index-abc123.js').expect(200);
    expect(r.headers['cache-control']).toMatch(/max-age=31536000/);
    expect(r.headers['cache-control']).toMatch(/immutable/);
    await request(a).get('/assets/missing.js').expect(404);
    expect((await request(a).get('/index.html')).headers['cache-control'] ?? '').not.toMatch(/immutable/);
  });
});
