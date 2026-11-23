/**
 * End-to-end test against real MySQL + Redis. Runs only when E2E_DATABASE_URL
 * and E2E_REDIS_URL are set (CI provides service containers). The database
 * must be empty and migrated (`prisma migrate deploy`).
 */
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const enabled = Boolean(process.env.E2E_DATABASE_URL && process.env.E2E_REDIS_URL);
const SETUP_CODE = 'E2E-SETUP-CODE-0123456789';

describe.skipIf(!enabled)('backend e2e (MySQL + Redis)', () => {
  let app: INestApplication;
  let base: string;
  const jar = new Map<string, string>();

  async function call(method: string, path: string, body?: unknown, extraHeaders: Record<string, string> = {}) {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-mnm-csrf': '1',
        cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
        ...extraHeaders,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const [k, v] = pair.split('=');
      if (v) jar.set(k, v);
      else jar.delete(k);
    }
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }

  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: process.env.E2E_DATABASE_URL,
      REDIS_URL: process.env.E2E_REDIS_URL,
      JWT_SECRET: 'e2e-secret-that-is-long-enough-for-validation',
      SETUP_TOKEN: SETUP_CODE,
      COOKIE_SECURE: 'false',
      NODE_ENV: 'test',
    });
    const { AppModule } = await import('../src/app.module.js');
    app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    await app.listen(0, '127.0.0.1');
    base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  it('reports readiness', async () => {
    const res = await call('GET', '/api/health/ready');
    expect(res.status).toBe(200);
  });

  it('reports an uninitialized installation with migrations applied', async () => {
    const res = await call('GET', '/api/setup/status');
    expect(res.body.initialized).toBe(false);
    expect(res.body.database.connected).toBe(true);
    expect(res.body.database.pendingMigrations).toBe(false);
    expect(res.body.redis.connected).toBe(true);
  });

  const owner = { username: 'owner', email: 'owner@example.test', password: 'correct-horse-battery' };
  const network = { name: 'E2E Network', defaultLocale: 'en-US', defaultTimezone: 'Europe/Berlin', defaultTheme: 'dark' };

  it('rejects an invalid setup code', async () => {
    const res = await call('POST', '/api/setup/initialize', { setupCode: 'WRONG', owner, network });
    expect(res.status).toBe(403);
  });

  it('rejects mutating requests without the CSRF header', async () => {
    const res = await call('POST', '/api/setup/initialize', { setupCode: SETUP_CODE, owner, network }, { 'x-mnm-csrf': '' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('CSRF_HEADER_MISSING');
  });

  it('initializes exactly once and signs the owner in', async () => {
    const res = await call('POST', '/api/setup/initialize', { setupCode: SETUP_CODE, owner, network });
    expect(res.status).toBe(201);
    expect(jar.has('mnm_access')).toBe(true);
    const again = await call('POST', '/api/setup/initialize', { setupCode: SETUP_CODE, owner, network });
    expect(again.status).toBe(409);
  });

  it('returns the current user with owner permissions', async () => {
    const res = await call('GET', '/api/auth/me');
    expect(res.status).toBe(200);
    expect(res.body.roleKey).toBe('owner');
    expect(res.body.permissions).toContain('*');
    expect(res.body.locale).toBe('en-US');
  });

  it('serves the dashboard summary from real data', async () => {
    const res = await call('GET', '/api/dashboard/summary');
    expect(res.status).toBe(200);
    expect(res.body.totalPlayers).toBe(0);
    expect(res.body.servers).toEqual([]);
    expect(res.body.recentActivity[0].action).toBe('setup.initialized');
  });

  it('issues a single-use registration token that a plugin can redeem once', async () => {
    const created = await call('POST', '/api/servers/registration-tokens', { type: 'VELOCITY', name: 'proxy-1' });
    expect(created.status).toBe(201);
    const token = created.body.token as string;
    expect(token.startsWith('mnm_reg_')).toBe(true);

    const register = await call('POST', '/api/plugin/v1/register', { token, pluginVersion: '0.1.0' }, { 'x-mnm-csrf': '' });
    expect(register.status).toBe(201);
    expect(register.body.secret).toMatch(/^mnm_sk_/);

    const reuse = await call('POST', '/api/plugin/v1/register', { token, pluginVersion: '0.1.0' }, { 'x-mnm-csrf': '' });
    expect(reuse.status).toBe(401);

    const servers = await call('GET', '/api/servers');
    expect(servers.body).toHaveLength(1);
    expect(servers.body[0].name).toBe('proxy-1');
  });

  it('enforces RBAC for lower roles', async () => {
    const roles = await call('GET', '/api/roles');
    const viewer = roles.body.find((r: { key: string }) => r.key === 'viewer');
    const created = await call('POST', '/api/users', { username: 'viewer1', email: 'viewer@example.test', password: 'viewer-password-123', roleId: viewer.id });
    expect(created.status).toBe(201);

    await call('POST', '/api/auth/logout');
    jar.clear();
    const login = await call('POST', '/api/auth/login', { identifier: 'viewer1', password: 'viewer-password-123' });
    expect(login.status).toBe(200);

    expect((await call('GET', '/api/audit-logs')).status).toBe(403);
    expect((await call('GET', '/api/users')).status).toBe(403);
    expect((await call('GET', '/api/servers')).status).toBe(200);
  });

  it('switches the language preference per user', async () => {
    const res = await call('PATCH', '/api/auth/me', { locale: 'de-DE' });
    expect(res.status).toBe(200);
    expect((await call('GET', '/api/auth/me')).body.locale).toBe('de-DE');
    expect((await call('PATCH', '/api/auth/me', { locale: 'xx-XX' })).status).toBe(400);
  });

  it('rotates refresh tokens and rejects reuse', async () => {
    const before = jar.get('mnm_refresh');
    const res = await fetch(`${base}/api/auth/refresh`, { method: 'POST', headers: { 'x-mnm-csrf': '1', cookie: `mnm_refresh=${before}` } });
    expect(res.status).toBe(200);
    const reuse = await fetch(`${base}/api/auth/refresh`, { method: 'POST', headers: { 'x-mnm-csrf': '1', cookie: `mnm_refresh=${before}` } });
    expect(reuse.status).toBe(401);
  });
});
