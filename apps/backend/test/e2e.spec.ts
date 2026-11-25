/**
 * End-to-end test against real MySQL + Redis. Runs only when E2E_DATABASE_URL
 * and E2E_REDIS_URL are set (CI provides service containers). The database
 * must be empty and migrated (`prisma migrate deploy`).
 */
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { randomBytes } from 'node:crypto';
import cookieParser from 'cookie-parser';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sha256Hex } from '../src/common/crypto';
import { base32Decode, hotp, totpStep } from '../src/auth/totp';
import { canonicalRequest, sign } from '../src/plugin-api/plugin-signature';
import { PrismaService } from '../src/prisma/prisma.service';

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
      JWT_SECRET: 'e2e-secret-that-is-long-enough-for-validation', // gitleaks:allow (test-only fixture)
      SETUP_TOKEN: SETUP_CODE,
      COOKIE_SECURE: 'false',
      NODE_ENV: 'test',
    });
    const { AppModule } = await import('../src/app.module.js');
    app = await NestFactory.create(AppModule, { logger: ['error', 'warn'], rawBody: true });
    // Same as main.ts with the default TRUST_PROXY (loopback): X-Forwarded-For from the test client is honoured.
    app.getHttpAdapter().getInstance().set('trust proxy', ['loopback']);
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

  it('starts fresh installations in hybrid mode with example reasons', async () => {
    expect((await call('GET', '/api/moderation/command-mode')).body.mode).toBe('HYBRID');
    const presets = await call('GET', '/api/moderation/presets');
    expect(presets.body.map((p: { category: string; numericId: number }) => `${p.category}:${p.numericId}`)).toEqual(['BAN:1', 'BAN:2', 'BAN:3', 'BAN:4', 'BAN:5', 'MUTE:1', 'MUTE:2', 'MUTE:3']);
    expect(presets.body[4]).toMatchObject({ name: 'Severe cheating', permanent: true, durationSeconds: null, permission: 'nexora.punishment.ban.5' });
    // The flows below use typed reasons (the behaviour of upgraded installations); presets are tested further down.
    expect((await call('PUT', '/api/moderation/command-mode', { mode: 'FREE_TEXT' })).status).toBe(200);
  });

  it('serves the dashboard summary from real data', async () => {
    const res = await call('GET', '/api/dashboard/summary');
    expect(res.status).toBe(200);
    expect(res.body.totalPlayers).toBe(0);
    expect(res.body.servers).toEqual([]);
    expect(res.body.recentActivity.map((a: { action: string }) => a.action)).toContain('setup.initialized');
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
    proxy = { keyId: register.body.keyId, secret: register.body.secret };

    const paperToken = await call('POST', '/api/servers/registration-tokens', { type: 'PAPER', name: 'lobby' });
    const paperReg = await call('POST', '/api/plugin/v1/register', { token: paperToken.body.token, pluginVersion: '0.2.0' }, { 'x-mnm-csrf': '' });
    expect(paperReg.status).toBe(201);
    paper = { keyId: paperReg.body.keyId, secret: paperReg.body.secret };
  });

  // ── Phase 2: signed plugin API ─────────────────────────────────

  let proxy: { keyId: string; secret: string };
  let paper: { keyId: string; secret: string };
  const steve = { uuid: '069a79f4-44e9-4726-a5be-fca90e38aaf5', username: 'Steve' };
  const sessionKey = '11111111-2222-4333-8444-555555555555';

  async function signed(creds: { keyId: string; secret: string }, method: string, path: string, body?: unknown, override: Record<string, string> = {}) {
    const raw = body === undefined ? '' : JSON.stringify(body);
    const timestamp = String(Date.now());
    const nonce = randomBytes(16).toString('hex');
    const signature = sign(sha256Hex(creds.secret), canonicalRequest(method, path, timestamp, nonce, raw));
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-mnm-key-id': creds.keyId,
      'x-mnm-timestamp': timestamp,
      'x-mnm-nonce': nonce,
      'x-mnm-signature': signature,
      ...override,
    };
    const res = await fetch(`${base}${path}`, { method, headers, body: raw || undefined });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null, headers };
  }

  it('authenticates plugins by signature and rejects tampering and replays', async () => {
    const ping = await signed(proxy, 'GET', '/api/plugin/v1/ping');
    expect(ping.status).toBe(200);
    expect(ping.body.serverName).toBe('proxy-1');

    const forged = await signed(proxy, 'GET', '/api/plugin/v1/ping', undefined, { 'x-mnm-signature': '0'.repeat(64) });
    expect(forged.status).toBe(401);

    // Replaying the exact same signed request must fail.
    const replay = await fetch(`${base}/api/plugin/v1/ping`, { headers: ping.headers });
    expect(replay.status).toBe(401);
    expect((await replay.json()).code).toBe('PLUGIN_AUTH_REPLAYED');
  });

  it('records heartbeats with server metrics', async () => {
    const hb = await signed(paper, 'POST', '/api/plugin/v1/heartbeat', {
      pluginVersion: '0.2.0',
      minecraftVersion: '26.3',
      onlinePlayers: 0,
      maxPlayers: 100,
      tps: 19.97,
      mspt: 12.5,
      memoryUsedBytes: 1_073_741_824,
      memoryMaxBytes: 4_294_967_296,
    });
    expect(hb.status).toBe(200);
    expect(hb.body.heartbeatIntervalSeconds).toBeGreaterThan(0);
    const servers = await call('GET', '/api/servers');
    const lobby = servers.body.find((s: { name: string }) => s.name === 'lobby');
    expect(lobby.status).toBe('ONLINE');
    expect(lobby.tps).toBeCloseTo(19.97);
    expect(lobby.memoryMaxBytes).toBe('4294967296');

    // Update status: no GitHub request in tests, so nothing is known yet – reported as such, never guessed.
    expect(hb.body).toHaveProperty('update', null);
    const updates = await call('GET', '/api/updates');
    expect(updates.status).toBe(200);
    expect(updates.body).toMatchObject({ latest: null, updateAvailable: false, verification: 'unable-to-verify', authenticated: false, lastSuccessAt: null, settings: { enabled: true, channel: 'stable', checkIntervalHours: 6 } });
    expect(updates.body.servers.find((s: { name: string }) => s.name === 'lobby')).toMatchObject({ pluginVersion: '0.2.0', state: 'unknown' });
    expect((await call('GET', '/api/updates/notification')).body).toEqual({ notification: null });
    expect((await call('PUT', '/api/updates/settings', { checkIntervalHours: 0 })).status).toBe(400);
    const saved = await call('PUT', '/api/updates/settings', { enabled: true, checkIntervalHours: 12, channel: 'stable', dashboardNotifications: true, minecraftNotifications: false, notificationCooldownHours: 48, manualChecks: true });
    expect(saved.status).toBe(200);
    expect((await call('GET', '/api/updates/settings')).body).toMatchObject({ checkIntervalHours: 12, minecraftNotifications: false });
    await call('PUT', '/api/updates/settings', {});
  });

  it('only accepts session events from proxies', async () => {
    const res = await signed(paper, 'POST', '/api/plugin/v1/events', {
      events: [{ type: 'player.join', sessionKey, uuid: steve.uuid, username: steve.username, at: Date.now() }],
    });
    expect(res.status).toBe(403);
  });

  it('tracks join, server switch and leave idempotently', async () => {
    const joinedAt = Date.now() - 120_000;
    const batch = {
      events: [
        { type: 'player.join', sessionKey, uuid: steve.uuid, username: steve.username, at: joinedAt, ip: '203.0.113.7', virtualHost: 'play.example.test', protocol: 775, clientVersion: '26.3' },
        { type: 'player.switch', sessionKey, uuid: steve.uuid, server: 'lobby', at: joinedAt + 1000 },
        { type: 'player.brand', sessionKey, uuid: steve.uuid, brand: 'vanilla' },
      ],
    };
    const first = await signed(proxy, 'POST', '/api/plugin/v1/events', batch);
    expect(first.body).toEqual({ applied: 3, skipped: 0 });
    // Retried batch (e.g. after a timeout) must not duplicate anything.
    const retry = await signed(proxy, 'POST', '/api/plugin/v1/events', batch);
    expect(retry.body.skipped).toBe(3);

    const online = await call('GET', '/api/players?online=true');
    expect(online.body.total).toBe(1);
    expect(online.body.items[0].currentServer.name).toBe('lobby');
    expect(online.body.items[0].totalPlaytimeSeconds).toBeGreaterThanOrEqual(119);

    const search = await call('GET', '/api/players?search=ste');
    expect(search.body.items[0].uuid).toBe(steve.uuid);
    const byUuid = await call('GET', `/api/players?search=${steve.uuid.replace(/-/g, '')}`);
    expect(byUuid.body.total).toBe(1);

    const profile = await call('GET', `/api/players/${steve.uuid}`);
    expect(profile.body.clientBrand).toBe('vanilla');
    expect(profile.body.sessions[0].servers[0].server.name).toBe('lobby');
    expect(profile.body.sessions[0].connection.ipAddress).toBe('203.0.113.7'); // owner has players.view.ip

    const summary = await call('GET', '/api/dashboard/summary');
    expect(summary.body.onlinePlayers).toBe(1);
    expect(summary.body.playerRecord.count).toBe(1);

    const leave = await signed(proxy, 'POST', '/api/plugin/v1/events', { events: [{ type: 'player.leave', sessionKey, uuid: steve.uuid, at: joinedAt + 60_000 }] });
    expect(leave.body.applied).toBe(1);
    const after = await call('GET', `/api/players/${steve.uuid}`);
    expect(after.body.online).toBe(false);
    expect(after.body.currentServer).toBeNull();
    expect(after.body.totalPlaytimeSeconds).toBe(60);
    expect(after.body.sessions[0].durationSeconds).toBe(60);
    expect(after.body.sessions[0].servers[0].leftAt).not.toBeNull();
  });

  // ── Phase 4: player profiles ───────────────────────────────────

  it('stores skins, serves activity and connection history with alt-account detection', async () => {
    const alt = { uuid: '9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d', username: 'SteveAlt' };
    const altSession = '33333333-4444-4555-8666-777777777777';
    const textures = Buffer.from(JSON.stringify({ textures: { SKIN: { url: 'http://textures.minecraft.net/texture/0123456789abcdef', metadata: { model: 'slim' } } } })).toString('base64');
    const at = Date.now() - 30 * 60_000;
    const res = await signed(proxy, 'POST', '/api/plugin/v1/events', {
      events: [
        { type: 'player.join', sessionKey: altSession, ...alt, at, ip: '203.0.113.7', textures },
        { type: 'player.leave', sessionKey: altSession, uuid: alt.uuid, at: at + 10 * 60_000 },
      ],
    });
    expect(res.body.applied).toBe(2);

    const profile = await call('GET', `/api/players/${alt.uuid}`);
    expect(profile.body.skinModel).toBe('slim');

    const activity = await call('GET', `/api/players/${alt.uuid}/activity?days=7`);
    expect(activity.status).toBe(200);
    expect(activity.body.totalSeconds).toBe(600);
    expect(activity.body.daily).toHaveLength(7);
    expect(activity.body.heatmap).toHaveLength(7);

    const connections = await call('GET', `/api/players/${alt.uuid}/connections`);
    expect(connections.body.total).toBe(1);
    expect(connections.body.items[0].ipAddress).toBe('203.0.113.7');
    expect(connections.body.ipSummary[0]).toMatchObject({ ipAddress: '203.0.113.7', connections: 1 });
    // Steve connected from the same address earlier.
    expect(connections.body.relatedAccounts.map((a: { username: string }) => a.username)).toContain('Steve');
    expect(connections.body.geoipEnabled).toBe(false);
  });

  it('anonymises IP addresses after the retention period', async () => {
    const privacy = await call('PATCH', '/api/settings/privacy', { ipRetentionDays: 7 });
    expect(privacy.status).toBe(200);
    const { MaintenanceService } = await import('../src/maintenance/maintenance.service.js');
    const result = await app.get(MaintenanceService).run(new Date(Date.now() + 8 * 86_400_000), true);
    expect(result.connections).toBeGreaterThanOrEqual(2);
    const connections = await call('GET', '/api/players/069a79f4-44e9-4726-a5be-fca90e38aaf5/connections');
    expect(connections.body.items.every((c: { ipAddress: string | null }) => c.ipAddress === null)).toBe(true);
    await call('PATCH', '/api/settings/privacy', { ipRetentionDays: 180 });
  });

  it('reconciles state from a proxy sync and closes sessions on shutdown', async () => {
    const alex = { uuid: 'ec561538-f3fd-461d-aff5-086b22154bce', username: 'Alex' };
    const alexSession = '22222222-3333-4444-8555-666666666666';
    const sync = await signed(proxy, 'POST', '/api/plugin/v1/sync', { sessions: [{ sessionKey: alexSession, ...alex, server: 'lobby' }] });
    expect(sync.body).toEqual({ closed: 0, opened: 1, moved: 1 });
    expect((await call('GET', '/api/players?online=true')).body.total).toBe(1);

    const shutdown = await signed(proxy, 'POST', '/api/plugin/v1/shutdown');
    expect(shutdown.body.closedSessions).toBe(1);
    expect((await call('GET', '/api/players?online=true')).body.total).toBe(0);
  });

  // ── Phase 7: inventories ───────────────────────────────────────

  it('queues inventory edits for offline players, applies them with compare-and-set and rolls back', async () => {
    const steve = '069a79f4-44e9-4726-a5be-fca90e38aaf5';
    const fp = (c: string) => c.repeat(64);
    const sword = { slot: 0, id: 'minecraft:diamond_sword', amount: 1, name: 'Excalibur', fp: fp('a'), data: 'U1dPUkQ=' };
    const dirt = { slot: 1, id: 'minecraft:dirt', amount: 64, fp: fp('b'), data: 'RElSVA==' };
    const ingest = await signed(paper, 'POST', '/api/plugin/v1/inventories', {
      capturedAt: Date.now(),
      players: [{ uuid: steve, inventory: { fp: fp('1'), items: [sword, dirt] }, enderChest: { fp: fp('2'), items: [] } }],
    });
    expect(ingest.body).toEqual({ changed: 2 });
    const again = await signed(paper, 'POST', '/api/plugin/v1/inventories', { capturedAt: Date.now(), players: [{ uuid: steve, inventory: { fp: fp('1'), items: [sword, dirt] } }] });
    expect(again.body).toEqual({ changed: 0 });

    const overview = await call('GET', `/api/players/${steve}/inventories`);
    expect(overview.body[0].serverName).toBe('lobby');
    const scope = overview.body[0].serverId as string;
    const view = await call('GET', `/api/players/${steve}/inventories/${scope}/inventory`);
    expect(view.body.revision).toBe(1);
    expect(view.body.items[0]).not.toHaveProperty('data');

    const base = `/api/players/${steve}/inventories/${scope}/inventory/revisions`;
    const move = { baseRevision: 1, reason: 'Support ticket #12', changes: [{ slot: 1, before: fp('b'), after: null }, { slot: 5, before: null, after: { id: 'minecraft:dirt', amount: 64, base: fp('b') } }] };
    expect((await call('POST', base, { ...move, baseRevision: 0 })).body.code).toBe('STALE_REVISION');
    expect((await call('POST', base, { ...move, changes: [{ slot: 2, before: null, after: { id: 'minecraft:dirt', amount: 1, base: fp('f') } }] })).body.code).toBe('UNKNOWN_BASE_ITEM');
    const created = await call('POST', base, move);
    expect(created.status).toBe(201);
    expect((await call('POST', base, move)).body.code).toBe('PENDING_EDIT');

    // Offline: nothing is delivered until the player is on that server.
    expect((await signed(paper, 'GET', '/api/plugin/v1/inventories/pending')).body.revisions).toEqual([]);
    const session = '44444444-5555-4666-8777-888888888888';
    await signed(proxy, 'POST', '/api/plugin/v1/events', {
      events: [
        { type: 'player.join', sessionKey: session, uuid: steve, username: 'Steve', at: Date.now() },
        { type: 'player.switch', sessionKey: session, uuid: steve, server: 'lobby', at: Date.now() },
      ],
    });
    const pending = await signed(paper, 'GET', '/api/plugin/v1/inventories/pending');
    expect(pending.body.revisions).toHaveLength(1);
    expect(pending.body.revisions[0].changes[1].after).toMatchObject({ id: 'minecraft:dirt', data: 'RElSVA==' });

    const movedDirt = { ...dirt, slot: 5, fp: fp('d') };
    const applied = await signed(paper, 'POST', `/api/plugin/v1/inventories/revisions/${created.body.id}/result`, {
      status: 'APPLIED',
      appliedFps: { '1': null, '5': fp('d') },
      snapshot: { fp: fp('3'), items: [sword, movedDirt] },
    });
    expect(applied.body.status).toBe('APPLIED');
    const afterApply = await call('GET', `/api/players/${steve}/inventories/${scope}/inventory`);
    expect(afterApply.body.revision).toBe(2);
    expect(afterApply.body.revisions[0]).toMatchObject({ status: 'APPLIED', reason: 'Support ticket #12' });

    // Rollback: the exact previous item comes back via the same compare-and-set path.
    const rollback = await call('POST', `/api/players/${steve}/inventories/revisions/${created.body.id}/rollback`, { reason: 'Undo' });
    expect(rollback.status).toBe(201);
    const pendingRollback = (await signed(paper, 'GET', '/api/plugin/v1/inventories/pending')).body.revisions[0];
    expect(pendingRollback.changes).toEqual(
      expect.arrayContaining([
        { slot: 1, before: null, after: expect.objectContaining({ id: 'minecraft:dirt', data: 'RElSVA==' }) },
        { slot: 5, before: fp('d'), after: null },
      ]),
    );
    const conflict = await signed(paper, 'POST', `/api/plugin/v1/inventories/revisions/${pendingRollback.id}/result`, { status: 'CONFLICT', message: 'Slot 5 changed' });
    expect(conflict.body.status).toBe('CONFLICT');
    const final = await call('GET', `/api/players/${steve}/inventories/${scope}/inventory`);
    expect(final.body.revisions[0]).toMatchObject({ status: 'CONFLICT', resultMessage: 'Slot 5 changed' });
    expect(final.body.revisions[1].status).toBe('APPLIED');

    const audit = await call('GET', '/api/audit-logs?action=inventory.');
    expect(audit.body.items.map((e: { action: string }) => e.action)).toEqual(expect.arrayContaining(['inventory.edit_requested', 'inventory.revision_applied', 'inventory.rollback_requested', 'inventory.revision_conflict']));

    await signed(proxy, 'POST', '/api/plugin/v1/events', { events: [{ type: 'player.leave', sessionKey: session, uuid: steve, at: Date.now() }] });
  });

  // ── Phase 8: configuration and setup ───────────────────────────

  it('reports registration progress for the add-server flow', async () => {
    const created = await call('POST', '/api/servers/registration-tokens', { type: 'PAPER', name: 'survival' });
    expect((await call('GET', `/api/servers/registration-tokens/${created.body.id}`)).body).toMatchObject({ status: 'PENDING', server: null });
    await call('POST', '/api/plugin/v1/register', { token: created.body.token, pluginVersion: '0.8.0' }, { 'x-mnm-csrf': '' });
    const done = await call('GET', `/api/servers/registration-tokens/${created.body.id}`);
    expect(done.body).toMatchObject({ status: 'REGISTERED', server: { name: 'survival', pluginVersion: '0.8.0' } });
    expect((await call('GET', '/api/servers/registration-tokens/unknown')).status).toBe(404);
  });

  it('pushes managed plugin settings with revisions and validated messages', async () => {
    const initial = await call('GET', '/api/settings/plugins');
    expect(initial.body).toMatchObject({ revision: 0, settings: { language: null, messages: {} } });
    expect((await signed(paper, 'GET', '/api/plugin/v1/ping')).body.configRevision).toBe(0);
    expect((await call('GET', '/api/settings/plugins/messages')).body['en-US']['command.ban.success']).toContain('{player}');

    const unsafe = await call('PUT', '/api/settings/plugins', { baseRevision: 0, settings: { messages: { 'en-US': { 'command.kick.success': '<click:run_command:/op x>{player}' } } } });
    expect(unsafe.status).toBe(400);
    expect(unsafe.body.issues[0]).toEqual({ path: 'en-US.command.kick.success', message: 'unsafe-content' });

    const settings = { language: 'de-DE', statisticsEnabled: false, inventorySyncIntervalSeconds: 120, messages: { 'de-DE': { 'command.kick.success': '<green>{player} wurde entfernt.' } } };
    const saved = await call('PUT', '/api/settings/plugins', { baseRevision: 0, settings });
    expect(saved.status).toBe(200);
    expect(saved.body.revision).toBe(1);
    expect((await call('PUT', '/api/settings/plugins', { baseRevision: 0, settings })).body.code).toBe('STALE_SETTINGS');

    const hb = await signed(paper, 'POST', '/api/plugin/v1/heartbeat', { pluginVersion: '0.8.0', platformVersion: 'Paper', onlinePlayers: 0 });
    expect(hb.body.configRevision).toBe(1);
    const config = await signed(paper, 'GET', '/api/plugin/v1/config');
    expect(config.body).toMatchObject({ revision: 1, language: 'de-DE', statisticsEnabled: false, inventorySync: null, inventorySyncIntervalSeconds: 120 });
    expect(config.body.messages['de-DE']['command.kick.success']).toContain('{player}');

    const audit = await call('GET', '/api/audit-logs?action=settings.plugins_updated');
    expect(audit.body.items[0].metadata).toMatchObject({ revision: 1, messageOverrides: 1 });
  });

  it('stores punishment presets', async () => {
    const presets = [{ id: 'hacking', name: 'Hacking', type: 'TEMP_BAN', reason: 'Unfair advantage', durationSeconds: 2_592_000 }];
    expect((await call('PUT', '/api/settings/moderation', { presets: [{ ...presets[0], durationSeconds: null }] })).status).toBe(400);
    expect((await call('PUT', '/api/settings/moderation', { presets })).status).toBe(200);
    expect((await call('GET', '/api/settings/moderation')).body.presets).toEqual(presets);
  });

  it('adds languages and imports validated dashboard catalogues', async () => {
    expect((await call('POST', '/api/i18n/languages', { locale: 'fr-FR', name: 'French' })).status).toBe(201);
    expect((await call('POST', '/api/i18n/languages', { locale: 'fr-FR', name: 'French' })).status).toBe(409);
    // Disabled languages are not served publicly.
    expect((await call('GET', '/api/i18n/messages/fr-FR')).status).toBe(404);

    const bad = await call('PUT', '/api/i18n/catalogs/fr-FR', { messages: { common: { save: '<img src=x onerror=alert(1)>' }, nope: { key: 'x' } } });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('INVALID_CATALOG');

    const imported = await call('PUT', '/api/i18n/catalogs/fr-FR', { messages: { meta: { nativeName: 'Français' }, common: { save: 'Enregistrer' } } });
    expect(imported.status).toBe(200);
    expect(imported.body.missingKeys).toBeGreaterThan(0);
    await call('PATCH', '/api/i18n/languages/fr-FR', { enabled: true });

    const served = await call('GET', '/api/i18n/messages/fr-FR');
    expect(served.body).toMatchObject({ locale: 'fr-FR', messages: { common: { save: 'Enregistrer' }, meta: { locale: 'fr-FR' } } });
    expect(served.body.revision).toBeGreaterThan(0);
    const languages = await call('GET', '/api/i18n/languages');
    expect(languages.body.find((l: { locale: string }) => l.locale === 'fr-FR')).toMatchObject({ nativeName: 'Français', customized: true, bundled: false });

    // Overrides for a bundled language merge over the shipped catalogue.
    await call('PUT', '/api/i18n/catalogs/de-DE', { messages: { common: { save: 'Sichern' } } });
    const exported = await call('GET', '/api/i18n/catalogs/de-DE');
    expect(exported.body.common.save).toBe('Sichern');
    expect(exported.body.common.cancel).toBeTruthy();
    expect((await call('DELETE', '/api/i18n/catalogs/de-DE')).status).toBe(200);
    expect((await call('DELETE', '/api/i18n/languages/de-DE')).body.code).toBe('BUNDLED_LANGUAGE');

    expect((await call('DELETE', '/api/i18n/languages/fr-FR')).status).toBe(200);
    expect((await call('GET', '/api/i18n/messages/fr-FR')).status).toBe(404);
  });

  it('rotates and revokes server credentials', async () => {
    const servers = await call('GET', '/api/servers');
    const proxyId = servers.body.find((s: { name: string }) => s.name === 'proxy-1').id;
    const rotated = await call('POST', `/api/servers/${proxyId}/credentials/rotate`);
    expect(rotated.status).toBe(201);
    expect((await signed(proxy, 'GET', '/api/plugin/v1/ping')).status).toBe(401);
    const next = { keyId: rotated.body.keyId, secret: rotated.body.secret };
    expect((await signed(next, 'GET', '/api/plugin/v1/ping')).status).toBe(200);

    const disabled = await call('PATCH', `/api/servers/${proxyId}`, { enabled: false });
    expect(disabled.body.status).toBe('DISABLED');
    expect((await signed(next, 'GET', '/api/plugin/v1/ping')).status).toBe(403);
  });

  // ── Phase 3: punishments ───────────────────────────────────────

  it('bans via plugin command idempotently, feeds the change to plugins and prevents duplicates', async () => {
    const snapshot = await signed(paper, 'GET', '/api/plugin/v1/punishments/active');
    expect(snapshot.status).toBe(200);
    expect(snapshot.body.punishments).toEqual([]);
    const cursor = snapshot.body.cursor as string;

    const ban = { type: 'TEMP_BAN', target: 'steve', reason: 'Griefing spawn', durationSeconds: 86_400, issuer: { uuid: '00000000-0000-4000-8000-000000000001', name: 'ModAnna' }, idempotencyKey: 'cmd-0001' };
    const first = await signed(paper, 'POST', '/api/plugin/v1/punishments', ban);
    expect(first.status).toBe(201);
    expect(first.body.target.username).toBe('Steve');
    expect(first.body.status).toBe('ACTIVE');
    expect(first.body.issuer.name).toBe('ModAnna');

    const retry = await signed(paper, 'POST', '/api/plugin/v1/punishments', ban);
    expect(retry.body.id).toBe(first.body.id);

    const duplicate = await signed(paper, 'POST', '/api/plugin/v1/punishments', { ...ban, type: 'BAN', durationSeconds: undefined, idempotencyKey: 'cmd-0002' });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.code).toBe('ALREADY_BANNED');

    const feed = await signed(paper, 'GET', `/api/plugin/v1/punishments/changes?after=${cursor}`);
    expect(feed.body.changes).toHaveLength(1);
    expect(feed.body.changes[0].kind).toBe('CREATED');
    expect(feed.body.changes[0].punishment).toMatchObject({ type: 'TEMP_BAN', targetName: 'Steve', reason: 'Griefing spawn' });
    expect((await signed(paper, 'GET', `/api/plugin/v1/punishments/changes?after=${feed.body.cursor}`)).body.changes).toEqual([]);

    const lookup = await signed(paper, 'GET', '/api/plugin/v1/players/lookup?target=Steve');
    expect(lookup.body.active.ban.id).toBe(first.body.id);
    expect(lookup.body.active.mute).toBeNull();
  });

  it('rejects invalid durations, kicks of offline players and unknown targets', async () => {
    const base = { issuer: { name: 'console' }, reason: 'x' };
    expect((await signed(paper, 'POST', '/api/plugin/v1/punishments', { ...base, type: 'TEMP_MUTE', target: 'Steve', idempotencyKey: 'cmd-0003' })).status).toBe(400);
    const kick = await signed(paper, 'POST', '/api/plugin/v1/punishments', { ...base, type: 'KICK', target: 'Steve', idempotencyKey: 'cmd-0004' });
    expect(kick.status).toBe(409);
    expect(kick.body.code).toBe('PLAYER_OFFLINE');
    const unknown = await signed(paper, 'POST', '/api/plugin/v1/punishments', { ...base, type: 'WARNING', target: 'Nobody', idempotencyKey: 'cmd-0005' });
    expect(unknown.status).toBe(404);
  });

  it('manages punishments and notes from the dashboard with an audit trail', async () => {
    const mute = await call('POST', '/api/punishments', { type: 'MUTE', target: 'ec561538-f3fd-461d-aff5-086b22154bce', reason: 'Spam' });
    expect(mute.status).toBe(201);
    expect(mute.body.issuer).toMatchObject({ type: 'USER', name: 'owner' });

    const active = await call('GET', '/api/punishments?status=active');
    expect(active.body.total).toBe(2);
    const steveHistory = await call('GET', '/api/players/069a79f4-44e9-4726-a5be-fca90e38aaf5/punishments');
    expect(steveHistory.body.active.ban.reason).toBe('Griefing spawn');

    const unban = await call('POST', `/api/punishments/${steveHistory.body.active.ban.id}/revoke`, { reason: 'Appeal accepted' });
    expect(unban.status).toBe(200);
    expect(unban.body.status).toBe('REVOKED');
    expect(unban.body.revokedBy).toBe('owner');
    expect((await call('POST', `/api/punishments/${steveHistory.body.active.ban.id}/revoke`, {})).status).toBe(409);

    // Revocation is visible to plugins via the feed.
    const snapshot = await signed(paper, 'GET', '/api/plugin/v1/punishments/active');
    expect(snapshot.body.punishments.map((p: { type: string }) => p.type)).toEqual(['MUTE']);

    const unmute = await signed(paper, 'POST', '/api/plugin/v1/punishments/revoke', { kind: 'MUTE', target: 'Alex', revoker: { name: 'console' } });
    expect(unmute.status).toBe(200);
    expect(unmute.body.revokedBy).toBe('console@lobby');

    const note = await call('POST', '/api/players/069a79f4-44e9-4726-a5be-fca90e38aaf5/notes', { content: 'Promised to rebuild the spawn.' });
    expect(note.status).toBe(201);
    expect((await call('GET', '/api/players/069a79f4-44e9-4726-a5be-fca90e38aaf5/notes')).body).toHaveLength(1);

    const audit = await call('GET', '/api/audit-logs?action=punishments.');
    expect(audit.body.items.map((e: { action: string }) => e.action)).toEqual(
      expect.arrayContaining(['punishments.temp_ban', 'punishments.mute', 'punishments.revoked']),
    );
  });

  // ── 1.1: punishment editing and evidence ──────────────────────

  it('edits punishments, manages evidence and keeps an immutable history', async () => {
    const steve = '069a79f4-44e9-4726-a5be-fca90e38aaf5';
    const day = 86_400;
    const cursor = (await signed(paper, 'GET', '/api/plugin/v1/punishments/active')).body.cursor as string;

    // 1. In-game ban without evidence.
    const ban = await signed(paper, 'POST', '/api/plugin/v1/punishments', {
      type: 'TEMP_BAN', target: 'Steve', reason: 'Cheating', durationSeconds: 7 * day, issuer: { uuid: '0f0e0d0c-0b0a-4908-8706-050403020100', name: 'Mod123' }, idempotencyKey: 'edit-flow-0001',
    });
    expect(ban.status).toBe(201);
    const id = ban.body.id as string;
    const createdAt = Date.parse(ban.body.createdAt);
    await call('PUT', '/api/settings/moderation', { presets: [], requireEvidence: true });
    let detail = await call('GET', `/api/punishments/${id}`);
    expect(detail.body).toMatchObject({ evidenceCount: 0, version: 1, needsReview: true, status: 'ACTIVE' });

    // 2. Evidence, added later from the dashboard.
    for (const url of ['javascript:alert(1)', 'http://insecure.example/clip', 'https://user:pw@example.com/x']) {
      expect((await call('POST', `/api/punishments/${id}/evidence`, { type: 'VIDEO', title: 'x', url })).status, url).toBe(400);
    }
    expect((await call('POST', `/api/punishments/${id}/evidence`, { type: 'NOTE', title: 'n', description: 'x', visibility: 'PUBLIC' })).status).toBe(400);
    const video = await call('POST', `/api/punishments/${id}/evidence`, { type: 'VIDEO', title: 'KillAura detection', url: 'https://medal.tv/clips/abc', description: 'Attacks without\nline of sight.' });
    expect(video.status).toBe(201);
    expect(video.body).toMatchObject({ type: 'VIDEO', visibility: 'STAFF', createdBy: 'owner', version: 1 });
    const shot = await call('POST', `/api/punishments/${id}/evidence`, { type: 'SCREENSHOT', title: 'Suspicious combat', url: 'https://example.com/shot.png' });
    expect((await call('GET', `/api/punishments/${id}/evidence`)).body.map((e: { title: string }) => e.title)).toEqual(['KillAura detection', 'Suspicious combat']);
    detail = await call('GET', `/api/punishments/${id}`);
    expect(detail.body).toMatchObject({ evidenceCount: 2, needsReview: false, status: 'ACTIVE' });
    await call('PUT', '/api/settings/moderation', { presets: [], requireEvidence: false });

    // Edit evidence (optimistic lock) and remove one (soft delete).
    expect((await call('PATCH', `/api/punishments/${id}/evidence/${video.body.id}`, { version: 9, title: 'x' })).body.code).toBe('STALE_EVIDENCE');
    const renamed = await call('PATCH', `/api/punishments/${id}/evidence/${video.body.id}`, { version: 1, title: 'KillAura (confirmed)', visibility: 'PUBLIC' });
    expect(renamed.body).toMatchObject({ title: 'KillAura (confirmed)', visibility: 'PUBLIC', version: 2, updatedBy: 'owner' });
    expect((await call('DELETE', `/api/punishments/${id}/evidence/${shot.body.id}`, { version: 1, reason: 'Duplicate' })).status).toBe(200);
    expect((await call('GET', `/api/punishments/${id}/evidence`)).body).toHaveLength(1);

    // 3. Edits from the dashboard: one punishment, never a second active ban.
    const thirtyDays = new Date(createdAt + 30 * day * 1000).toISOString();
    const edited = await call('PATCH', `/api/punishments/${id}`, { version: 1, reason: 'Repeated cheating', expiresAt: thirtyDays, note: 'Video confirms repeated violations.' });
    expect(edited.status).toBe(200);
    expect(edited.body.changes).toEqual(['REASON_CHANGED', 'DURATION_EXTENDED']);
    expect(edited.body.previous).toMatchObject({ reason: 'Cheating', expiresAt: ban.body.expiresAt });
    expect(edited.body.punishment).toMatchObject({ id, reason: 'Repeated cheating', expiresAt: thirtyDays, version: 2, type: 'TEMP_BAN' });
    // A stale page cannot overwrite newer changes.
    expect((await call('PATCH', `/api/punishments/${id}`, { version: 1, reason: 'Stale' })).body.code).toBe('STALE_PUNISHMENT');
    expect((await call('PATCH', `/api/punishments/${id}`, { version: 2, expiresAt: new Date(createdAt - 1000).toISOString() })).body.code).toBe('INVALID_DURATION');
    expect((await call('PATCH', `/api/punishments/${id}`, { version: 2, reason: 'Repeated cheating' })).body.code).toBe('NO_CHANGES');
    const shorter = await call('PATCH', `/api/punishments/${id}`, { version: 2, expiresAt: new Date(createdAt + 3 * day * 1000).toISOString() });
    expect(shorter.body.changes).toEqual(['DURATION_SHORTENED']);
    const permanent = await call('PATCH', `/api/punishments/${id}`, { version: 3, expiresAt: null });
    expect(permanent.body.punishment).toMatchObject({ type: 'BAN', expiresAt: null });
    const temporary = await call('PATCH', `/api/punishments/${id}`, { version: 4, expiresAt: thirtyDays });
    expect(temporary.body.punishment).toMatchObject({ type: 'TEMP_BAN', expiresAt: thirtyDays });
    const actives = await call('GET', `/api/punishments?status=active&search=${steve}`);
    expect(actives.body.items.filter((p: { type: string }) => ['BAN', 'TEMP_BAN'].includes(p.type))).toHaveLength(1);

    // 4. /editban from the game: by player and by id; the plugins receive the update.
    const editban = await signed(paper, 'POST', '/api/plugin/v1/punishments/edit', { kind: 'BAN', target: 'Steve', durationSeconds: 14 * day, reason: 'Repeated cheating (KillAura)', editor: { name: 'Admin123', uuid: '1f0e0d0c-0b0a-4908-8706-050403020100' } });
    expect(editban.status).toBe(200);
    expect(editban.body.punishment).toMatchObject({ id, reason: 'Repeated cheating (KillAura)', expiresAt: new Date(createdAt + 14 * day * 1000).toISOString() });
    expect((await signed(paper, 'POST', '/api/plugin/v1/punishments/edit', { kind: 'BAN', id, durationSeconds: null, editor: { name: 'console' } })).body.code).toBe('PERMANENT_NOT_ALLOWED');
    expect((await signed(paper, 'POST', '/api/plugin/v1/punishments/edit', { kind: 'MUTE', id, reason: 'x', editor: { name: 'console' } })).body.code).toBe('WRONG_PUNISHMENT_TYPE');
    const byId = await signed(paper, 'POST', '/api/plugin/v1/punishments/edit', { kind: 'BAN', id, durationSeconds: null, editor: { name: 'console' }, allowPermanentChange: true });
    expect(byId.body.punishment).toMatchObject({ type: 'BAN', expiresAt: null });
    expect((await signed(paper, 'POST', '/api/plugin/v1/punishments/edit', { kind: 'MUTE', target: 'Steve', durationSeconds: day, editor: { name: 'console' } })).body.code).toBe('NOT_MUTED');
    const feed = await signed(paper, 'GET', `/api/plugin/v1/punishments/changes?after=${cursor}`);
    const kinds = feed.body.changes.filter((c: { punishment: { id: string } }) => c.punishment.id === id).map((c: { kind: string }) => c.kind);
    expect(kinds[0]).toBe('CREATED');
    expect(kinds.filter((k: string) => k === 'UPDATED').length).toBeGreaterThanOrEqual(5);
    // Evidence and notes are never sent to the game servers.
    expect(JSON.stringify(feed.body)).not.toContain('medal.tv');
    const lookup = await signed(paper, 'GET', '/api/plugin/v1/players/lookup?target=Steve');
    expect(lookup.body.active.ban).toMatchObject({ id, reason: 'Repeated cheating (KillAura)', expiresAt: null });

    // 5. Expired punishments: corrections keep them expired; reactivation is explicit.
    const mute = await call('POST', '/api/punishments', { type: 'TEMP_MUTE', target: 'Alex', reason: 'Spam', durationSeconds: day });
    const prisma = app.get(PrismaService);
    await prisma.punishment.update({ where: { id: mute.body.id }, data: { expiresAt: new Date(Date.now() - 60_000) } });
    const corrected = await call('PATCH', `/api/punishments/${mute.body.id}`, { version: 1, reason: 'Spam in chat' });
    expect(corrected.body.punishment).toMatchObject({ status: 'EXPIRED', reason: 'Spam in chat' });
    expect((await call('PATCH', `/api/punishments/${mute.body.id}`, { version: 2, expiresAt: new Date(Date.now() + day * 1000).toISOString() })).body.code).toBe('NOT_ACTIVE');
    const reactivated = await call('POST', `/api/punishments/${mute.body.id}/reactivate`, { version: 2, expiresAt: new Date(Date.now() + day * 1000).toISOString(), note: 'Expired by mistake' });
    expect(reactivated.status).toBe(200);
    expect(reactivated.body.status).toBe('ACTIVE');
    // Revoked punishments stay revoked when corrected.
    await call('POST', `/api/punishments/${mute.body.id}/revoke`, { reason: 'Cleanup' });
    const revokedEdit = await call('PATCH', `/api/punishments/${mute.body.id}`, { version: 4, reason: 'Spam (corrected)' });
    expect(revokedEdit.body.punishment).toMatchObject({ status: 'REVOKED', reason: 'Spam (corrected)' });
    expect((await call('PATCH', `/api/punishments/${mute.body.id}`, { version: 5, expiresAt: null })).body.code).toBe('NOT_ACTIVE');
    // Corrections of inactive punishments never reach the plugins' caches.
    const muteFeed = (await signed(paper, 'GET', `/api/plugin/v1/punishments/changes?after=${cursor}`)).body.changes.filter((c: { punishment: { id: string } }) => c.punishment.id === mute.body.id);
    expect(muteFeed.map((c: { kind: string }) => c.kind)).toEqual(['CREATED', 'REACTIVATED', 'REVOKED']);

    // 6. Complete, ordered history with actors and previous values.
    await call('POST', `/api/punishments/${id}/revoke`, { reason: 'Test cleanup' });
    const history = await call('GET', `/api/punishments/${id}/history`);
    expect(history.body.map((h: { action: string }) => h.action)).toEqual([
      'CREATED', 'EVIDENCE_ADDED', 'EVIDENCE_ADDED', 'EVIDENCE_UPDATED', 'EVIDENCE_REMOVED', 'REASON_CHANGED', 'DURATION_EXTENDED',
      'DURATION_SHORTENED', 'MADE_PERMANENT', 'MADE_TEMPORARY', 'REASON_CHANGED', 'DURATION_SHORTENED', 'MADE_PERMANENT', 'REVOKED',
    ]);
    expect(history.body[0]).toMatchObject({ actor: { type: 'PLAYER', name: 'Mod123' }, newValues: { reason: 'Cheating' } });
    expect(history.body[3]).toMatchObject({ previousValues: { title: 'KillAura detection', visibility: 'STAFF' }, newValues: { title: 'KillAura (confirmed)', visibility: 'PUBLIC' } });
    expect(history.body[5]).toMatchObject({ previousValues: { reason: 'Cheating' }, note: 'Video confirms repeated violations.', actor: { name: 'owner' } });
    expect(history.body[10]).toMatchObject({ actor: { type: 'PLAYER', name: 'Admin123' } });
    const muteHistory = await call('GET', `/api/punishments/${mute.body.id}/history`);
    expect(muteHistory.body.map((h: { action: string }) => h.action)).toEqual(['CREATED', 'REASON_CHANGED', 'REACTIVATED', 'REVOKED', 'REASON_CHANGED']);
    const audit = await call('GET', '/api/audit-logs?action=punishments.');
    expect(audit.body.items.map((e: { action: string }) => e.action)).toEqual(
      expect.arrayContaining(['punishments.edited', 'punishments.evidence_added', 'punishments.evidence_updated', 'punishments.evidence_removed', 'punishments.reactivated']),
    );
  });

  // ── 1.3: reason presets and the global command mode ─────────────

  it('manages reason presets and the network-wide command mode with the same permissions in-game and in the dashboard', async () => {
    const day = 86_400;
    const mod = { uuid: '0f0e0d0c-0b0a-4908-8706-050403020100', name: 'Mod123' };
    const revision0 = (await signed(paper, 'POST', '/api/plugin/v1/heartbeat', { pluginVersion: '1.3.0', platformVersion: 'Paper', onlinePlayers: 0 })).body.moderationRevision as number;

    // Create, reject a duplicate reason ID, validate.
    const created = await call('POST', '/api/moderation/presets', { category: 'BAN', numericId: 6, name: 'Alt account', reason: 'Ban evasion with an alt account', durationSeconds: 14 * day });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ numericId: 6, permission: 'nexora.punishment.ban.6', canonicalPermission: true, enabled: true, version: 1 });
    expect((await call('POST', '/api/moderation/presets', { category: 'BAN', numericId: 6, name: 'Other', reason: 'Other' })).body.code).toBe('DUPLICATE_PRESET_ID');
    expect((await call('POST', '/api/moderation/presets', { category: 'MUTE', numericId: 6, name: 'Same ID, other category', reason: 'Spam', durationSeconds: 600 })).status).toBe(201);
    expect((await call('POST', '/api/moderation/presets', { category: 'KICK', numericId: 1, name: 'x', reason: 'x', durationSeconds: 600 })).status).toBe(400);

    // Global mode: the plugins see a new revision and the usable presets.
    expect((await call('PUT', '/api/moderation/command-mode', { mode: 'HYBRID' })).status).toBe(200);
    const revision1 = (await signed(paper, 'POST', '/api/plugin/v1/heartbeat', { pluginVersion: '1.3.0', platformVersion: 'Paper', onlinePlayers: 0 })).body.moderationRevision as number;
    expect(revision1).toBeGreaterThan(revision0);
    const catalog = await signed(paper, 'GET', '/api/plugin/v1/moderation');
    expect(catalog.body.mode).toBe('HYBRID');
    expect(catalog.body.presets).toContainEqual(expect.objectContaining({ category: 'BAN', numericId: 6, durationSeconds: 14 * day, permission: 'nexora.punishment.ban.6' }));

    // Dashboard: reason ID → preset reason and duration, snapshot on the punishment.
    const usable = await call('GET', '/api/moderation/presets/usable');
    expect(usable.body).toMatchObject({ mode: 'HYBRID', permissionSource: 'ROLE', customReasons: true, durationOverride: true });
    const viaDashboard = await call('POST', '/api/punishments', { type: 'BAN', target: 'Steve', presetNumericId: 6 });
    expect(viaDashboard.status).toBe(201);
    expect(viaDashboard.body).toMatchObject({ type: 'TEMP_BAN', reason: 'Ban evasion with an alt account', preset: { category: 'BAN', numericId: 6, name: 'Alt account' } });
    expect(viaDashboard.body.id).not.toBe('6'); // reason ID ≠ punishment ID
    // The expiry is computed a few milliseconds before the creation time is stored.
    expect(Math.abs(Date.parse(viaDashboard.body.expiresAt) - Date.parse(viaDashboard.body.createdAt) - 14 * day * 1000)).toBeLessThan(1000);

    // Editing the preset later never changes issued punishments.
    expect((await call('PATCH', `/api/moderation/presets/${created.body.id}`, { version: 1, name: 'Alt account', reason: 'Changed text', durationSeconds: 30 * day })).status).toBe(200);
    expect((await call('PATCH', `/api/moderation/presets/${created.body.id}`, { version: 1, name: 'x', reason: 'x' })).body.code).toBe('STALE_PRESET');
    expect((await call('GET', `/api/punishments/${viaDashboard.body.id}`)).body).toMatchObject({ reason: 'Ban evasion with an alt account', preset: { numericId: 6 } });
    await call('POST', `/api/punishments/${viaDashboard.body.id}/revoke`, {});

    // In-game: the plugin reports the permissions it verified (LuckPerms on the proxy).
    const cmd = (key: string, extra: Record<string, unknown>) => signed(paper, 'POST', '/api/plugin/v1/punishments', { type: 'BAN', target: 'Steve', issuer: mod, idempotencyKey: key, ...extra });
    expect((await cmd('preset-0001', { reason: '6' })).body).toMatchObject({ code: 'PRESET_FORBIDDEN', reasonId: 6 });
    const viaCommand = await cmd('preset-0002', { reason: '6', granted: ['nexora.punishment.ban.6'] });
    expect(viaCommand.status).toBe(201);
    expect(viaCommand.body).toMatchObject({ type: 'TEMP_BAN', reason: 'Changed text', preset: { numericId: 6 } });
    expect(Math.abs(Date.parse(viaCommand.body.expiresAt) - Date.parse(viaCommand.body.createdAt) - 30 * day * 1000)).toBeLessThan(1000);
    await signed(paper, 'POST', '/api/plugin/v1/punishments/revoke', { kind: 'BAN', target: 'Steve', revoker: mod });
    expect((await cmd('preset-0003', { reason: '6', durationSeconds: 3600, granted: ['nexora.punishment.ban.6'] })).body.code).toBe('DURATION_OVERRIDE_FORBIDDEN');
    expect((await cmd('preset-0004', { reason: 'Typed reason' })).body.code).toBe('CUSTOM_REASON_FORBIDDEN');
    expect((await cmd('preset-0005', { reason: '42', granted: ['nexora.punishment.custom'] })).body.code).toBe('UNKNOWN_PRESET');

    // Preset only: typed reasons are rejected everywhere, also when editing.
    expect((await call('PUT', '/api/moderation/command-mode', { mode: 'PRESET_ONLY' })).status).toBe(200);
    expect((await call('POST', '/api/punishments', { type: 'WARNING', target: 'Steve', reason: 'Typed' })).body.code).toBe('PRESET_REQUIRED');
    expect((await cmd('preset-0006', { reason: 'Typed', granted: ['nexora.punishment.custom'] })).body.code).toBe('PRESET_REQUIRED');

    // Archived reasons disappear but keep their ID reserved.
    expect((await call('POST', `/api/moderation/presets/${created.body.id}/archive`, { archived: true })).body).toMatchObject({ archived: true, enabled: false });
    expect((await cmd('preset-0007', { reason: '6', granted: ['nexora.punishment.ban.6'] })).body.code).toBe('UNKNOWN_PRESET');
    expect((await call('POST', '/api/moderation/presets', { category: 'BAN', numericId: 6, name: 'Reuse', reason: 'Reuse' })).body.code).toBe('DUPLICATE_PRESET_ID');
    expect((await call('GET', '/api/moderation/presets')).body.some((p: { numericId: number; category: string }) => p.category === 'BAN' && p.numericId === 6)).toBe(false);
    expect((await call('GET', '/api/moderation/presets?archived=true')).body.some((p: { numericId: number; archived: boolean }) => p.numericId === 6 && p.archived)).toBe(true);
    const copy = await call('POST', `/api/moderation/presets/${created.body.id}/duplicate`);
    expect(copy.body).toMatchObject({ category: 'BAN', numericId: 7, enabled: false });

    const audit = await call('GET', '/api/audit-logs?action=moderation.');
    expect(audit.body.items.map((e: { action: string }) => e.action)).toEqual(expect.arrayContaining(['moderation.preset_created', 'moderation.preset_updated', 'moderation.preset_archived', 'moderation.command_mode_changed']));
    expect((await call('PUT', '/api/moderation/command-mode', { mode: 'FREE_TEXT' })).status).toBe(200);
  });

  // ── 1.3: LuckPerms integration, account linking, managed staff accounts ──

  it('links staff through /nexora link, applies LuckPerms permissions and revokes access when the group is removed', async () => {
    const alex = 'ec561538-f3fd-461d-aff5-086b22154bce';
    const tokenRes = await call('POST', '/api/servers/registration-tokens', { type: 'VELOCITY', name: 'proxy-lp' });
    const reg = await call('POST', '/api/plugin/v1/register', { token: tokenRes.body.token, pluginVersion: '1.3.0' }, { 'x-mnm-csrf': '' });
    const lpProxy = { keyId: reg.body.keyId, secret: reg.body.secret };
    const roles = await call('GET', '/api/roles');
    const roleId = (key: string) => roles.body.find((r: { key: string }) => r.key === key).id as string;
    const snapshot = (groups: string[], permissions: Record<string, boolean>) =>
      signed(lpProxy, 'POST', '/api/plugin/v1/luckperms/sync', { luckPermsVersion: '5.4.150', snapshots: [{ uuid: alex, username: 'Alex', primaryGroup: groups[groups.length - 1], groupDisplay: 'Moderator', groups, prefix: '&c[Mod] ', permissions }] });

    // Disabled by default: no codes; only the Owner may configure the integration.
    expect((await signed(lpProxy, 'POST', '/api/plugin/v1/link-codes', { uuid: alex, username: 'Alex' })).body.code).toBe('LINKING_DISABLED');
    expect((await call('PUT', '/api/integrations/luckperms/settings', { mode: 'MANAGED', staleAfterMinutes: 30, linking: { enabled: true, allowRegistration: true } })).status).toBe(200);
    expect((await call('POST', '/api/integrations/luckperms/mappings', { groupName: 'moderator', roleId: roleId('moderator'), priority: 50 })).status).toBe(201);
    expect((await call('POST', '/api/integrations/luckperms/mappings', { groupName: 'retired', deny: true })).status).toBe(201);
    expect((await call('POST', '/api/integrations/luckperms/mappings', { groupName: 'owners', roleId: roleId('owner') })).body.code).toBe('OWNER_NOT_MAPPABLE');
    expect((await call('PUT', '/api/moderation/command-mode', { mode: 'HYBRID' })).status).toBe(200);

    // The proxy reports Alex's LuckPerms data; Paper servers may not.
    expect((await signed(paper, 'POST', '/api/plugin/v1/luckperms/sync', { snapshots: [] })).status).toBe(403);
    const sync = await snapshot(['default', 'moderator'], { 'nexora.punishment.ban.1': true, 'nexora.punishment.ban.2': false, 'nexora.punishment.custom': false });
    expect(sync.status).toBe(200);
    expect(sync.body.trackedPermissions).toEqual(expect.arrayContaining(['nexora.punishment.ban.1', 'nexora.punishment.custom', 'nexora.dashboard.register']));
    expect((await call('GET', `/api/players/${alex}`)).body.minecraftRank).toMatchObject({ primaryGroup: 'moderator', displayName: 'Moderator', prefix: '[Mod]', color: '#FF5555' });

    // /nexora link → one-time code → staff registration (eligible through the group mapping).
    const code = await signed(lpProxy, 'POST', '/api/plugin/v1/link-codes', { uuid: alex, username: 'Alex' });
    expect(code.status).toBe(201);
    expect(code.body.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect((await call('GET', '/api/auth/registration')).body).toEqual({ enabled: true });
    const registered = await call('POST', '/api/auth/register-linked', { code: code.body.code, username: 'alexmod', email: 'alex@example.test', password: 'alex-password-123' });
    expect(registered.status).toBe(201);
    expect((await call('POST', '/api/auth/register-linked', { code: code.body.code, username: 'other', email: 'other@example.test', password: 'other-password-123' })).body.code).toBe('INVALID_LINK_CODE');
    expect((await call('POST', '/api/auth/register-linked', { code: 'ZZZZ-ZZZZ', username: 'guesser', email: 'guesser@example.test', password: 'x-password-1234' })).body.code).toBe('INVALID_LINK_CODE');

    const staff = await call('GET', `/api/users/${registered.body.id}/staff`);
    expect(staff.body).toMatchObject({ managedBy: 'LUCKPERMS', status: 'ACTIVE', role: { key: 'moderator' }, permissionSource: 'LUCKPERMS', link: { minecraftUsername: 'Alex' } });
    expect(staff.body.reasons.filter((r: { allowed: boolean }) => r.allowed).map((r: { category: string; numericId: number }) => `${r.category}:${r.numericId}`)).toEqual(['BAN:1']);

    // The same permissions apply in the dashboard as in-game.
    const login = async (identifier: string, password: string) => {
      await call('POST', '/api/auth/logout');
      jar.clear();
      // Own client address: these sign-ins must not use up the login throttle of later tests.
      return call('POST', '/api/auth/login', { identifier, password }, { 'x-forwarded-for': '198.51.100.20' });
    };
    expect((await login('alexmod', 'alex-password-123')).status).toBe(200);
    const usable = await call('GET', '/api/moderation/presets/usable');
    expect(usable.body).toMatchObject({ permissionSource: 'LUCKPERMS', customReasons: false });
    expect(usable.body.presets.map((p: { numericId: number; category: string }) => `${p.category}:${p.numericId}`)).toEqual(['BAN:1']);
    expect((await call('POST', '/api/punishments', { type: 'BAN', target: 'Steve', presetNumericId: 2 })).body.code).toBe('PRESET_FORBIDDEN');
    expect((await call('POST', '/api/punishments', { type: 'BAN', target: 'Steve', reason: 'Typed' })).body.code).toBe('CUSTOM_REASON_FORBIDDEN');
    const banned = await call('POST', '/api/punishments', { type: 'BAN', target: 'Steve', presetNumericId: 1 });
    expect(banned.status).toBe(201);
    await call('POST', `/api/punishments/${banned.body.id}/revoke`, {});

    // Losing the qualifying group disables the account and revokes its sessions immediately.
    await snapshot(['default'], { 'nexora.punishment.ban.1': false });
    expect((await call('GET', '/api/auth/me')).status).toBe(401);
    expect((await login('alexmod', 'alex-password-123')).status).toBe(403);

    // Eligible again → reactivated; the old session stays revoked, a fresh sign-in works.
    await snapshot(['default', 'moderator'], { 'nexora.punishment.ban.1': true });
    expect((await login('alexmod', 'alex-password-123')).status).toBe(200);
    // A denied group wins over the moderator group.
    expect((await login('owner', 'correct-horse-battery')).status).toBe(200);
    await snapshot(['default', 'moderator', 'retired'], { 'nexora.punishment.ban.1': true });
    const history = await call('GET', `/api/users/${registered.body.id}/staff`);
    expect(history.body.status).toBe('DISABLED');
    expect(history.body.history.map((h: { newStatus: string }) => h.newStatus)).toEqual(['DISABLED', 'ACTIVE', 'DISABLED', 'ACTIVE']);

    // The protected Owner is never affected by LuckPerms.
    expect((await call('GET', '/api/auth/me')).body.roleKey).toBe('owner');
    const audit = await call('GET', '/api/audit-logs?action=users.');
    expect(audit.body.items.map((e: { action: string }) => e.action)).toEqual(expect.arrayContaining(['users.registered_by_link', 'users.disabled_by_luckperms', 'users.reactivated_by_luckperms']));

    // Restore the defaults for the following tests.
    expect((await call('PUT', '/api/integrations/luckperms/settings', { mode: 'DISABLED', staleAfterMinutes: 30, linking: { enabled: true, allowRegistration: false } })).status).toBe(200);
    expect((await call('PUT', '/api/moderation/command-mode', { mode: 'FREE_TEXT' })).status).toBe(200);
  });

  // ── Phase 5: statistics ────────────────────────────────────────

  it('ingests statistics from Paper and serves totals, ranges, series and leaderboards', async () => {
    const steve = '069a79f4-44e9-4726-a5be-fca90e38aaf5';
    const hour = 3_600_000;
    const first = await signed(paper, 'POST', '/api/plugin/v1/statistics', {
      capturedAt: Date.now() - 3 * hour,
      players: [{ uuid: steve, stats: { 'mnm:blocks_mined': 100, 'mined:minecraft:diamond_ore': 4, 'mnm:active_time': 3000, 'mnm:afk_time': 600, 'custom:minecraft:deaths': 2 } }],
    });
    expect(first.body).toEqual({ players: 1, changed: 5 });
    const unchanged = await signed(paper, 'POST', '/api/plugin/v1/statistics', {
      capturedAt: Date.now() - 3 * hour,
      players: [{ uuid: steve, stats: { 'mnm:blocks_mined': 100 } }, { uuid: '00000000-0000-4000-8000-0000000000ff', stats: { 'mnm:blocks_mined': 1 } }],
    });
    expect(unchanged.body).toEqual({ players: 1, changed: 0 });
    await signed(paper, 'POST', '/api/plugin/v1/statistics', {
      capturedAt: Date.now() - hour,
      players: [{ uuid: steve, stats: { 'mnm:blocks_mined': 160, 'mined:minecraft:diamond_ore': 6, 'mnm:active_time': 4200, 'mnm:afk_time': 600, 'custom:minecraft:deaths': 3 } }],
    });

    const invalidKey = await signed(paper, 'POST', '/api/plugin/v1/statistics', { capturedAt: Date.now(), players: [{ uuid: steve, stats: { 'drop table': 1 } }] });
    expect(invalidKey.status).toBe(400);
    const fromProxy = await signed(proxy, 'POST', '/api/plugin/v1/statistics', { capturedAt: Date.now(), players: [{ uuid: steve, stats: { 'mnm:blocks_mined': 1 } }] });
    expect([401, 403]).toContain(fromProxy.status); // proxy is rotated/disabled or not a Paper server

    const all = await call('GET', `/api/players/${steve}/statistics?range=all`);
    expect(all.body.collected).toBe(true);
    expect(all.body.values['mnm:blocks_mined']).toBe(160);
    expect(all.body.ores).toEqual([{ id: 'minecraft:diamond_ore', value: 6 }]);
    expect(all.body.topMined[0]).toEqual({ id: 'minecraft:diamond_ore', value: 6 });

    const day = await call('GET', `/api/players/${steve}/statistics?range=24h`);
    expect(day.body.values['mnm:blocks_mined']).toBe(60); // first snapshot has no known start
    expect(day.body.partial).toBe(true);

    const series = await call('GET', `/api/players/${steve}/statistics/series?keys=mnm:blocks_mined&days=7`);
    expect(series.body.series['mnm:blocks_mined'].reduce((a: number, b: number) => a + b, 0)).toBe(60);

    const profile = await call('GET', `/api/players/${steve}`);
    expect(profile.body.activePlaytimeSeconds).toBe(4200);
    expect(profile.body.afkSeconds).toBe(600);

    const board = await call('GET', '/api/statistics/leaderboard?stat=mnm:blocks_mined');
    expect(board.body[0]).toMatchObject({ rank: 1, value: 160, player: { username: 'Steve' } });
    expect((await call('GET', '/api/statistics/leaderboard?stat=mined:minecraft:stone')).status).toBe(400);
    const overview = await call('GET', '/api/statistics/overview');
    expect(overview.body.trackedPlayers).toBe(1);
  });

  // ── Phase 6: AntiCheat ─────────────────────────────────────────

  it('applies AntiCheat rules with thresholds, cooldowns, idempotency and evidence', async () => {
    const alex = 'ec561538-f3fd-461d-aff5-086b22154bce';
    const defaults = await call('GET', '/api/anticheat/settings');
    expect(defaults.body.settings.defaultRule.action).toBe('NONE');
    expect(defaults.body.examples).toHaveLength(3);

    const put = await call('PUT', '/api/anticheat/settings', {
      ...defaults.body.settings,
      rules: [{ cheatType: 'Speed', action: 'TEMP_BAN', durationSeconds: 2_592_000, minViolationLevel: 10, cooldownSeconds: 300, enabled: true }],
    });
    expect(put.status).toBe(200);

    const report = (body: Record<string, unknown>) => signed(paper, 'POST', '/api/plugin/v1/anticheat/reports', { provider: 'Grim', target: 'Alex', ...body });

    expect((await report({ cheatType: 'Speed', violationLevel: 4, eventKey: 'ac-event-0001' })).body.outcome).toBe('SKIPPED_THRESHOLD');
    expect((await report({ cheatType: 'Reach', violationLevel: 50, eventKey: 'ac-event-0002' })).body.outcome).toBe('LOGGED');

    const ban = await report({ cheatType: 'speed', violationLevel: 15, evidence: 'moved 12.3 b/s', metadata: { ping: 42 }, eventKey: 'ac-event-0003' });
    expect(ban.body.outcome).toBe('TEMP_BAN');
    expect(ban.body.punishmentId).toBeTruthy();
    const retry = await report({ cheatType: 'speed', violationLevel: 15, eventKey: 'ac-event-0003' });
    expect(retry.body).toEqual(ban.body);

    expect((await report({ cheatType: 'Speed', violationLevel: 20, eventKey: 'ac-event-0004' })).body.outcome).toBe('SKIPPED_COOLDOWN');
    // Explicit request without a rule → fallback ban, but Alex is already banned.
    expect((await report({ cheatType: 'Fly', explicit: true, eventKey: 'ac-event-0005' })).body.outcome).toBe('SKIPPED_DUPLICATE');

    const punishments = await call('GET', `/api/players/${alex}/punishments`);
    expect(punishments.body.active.ban).toMatchObject({ source: 'ANTICHEAT', issuer: { type: 'SERVER', name: 'AntiCheat (Grim)' } });

    const events = await call('GET', `/api/players/${alex}/anticheat`);
    expect(events.body.total).toBe(5);
    const summary = await call('GET', '/api/anticheat/summary');
    expect(summary.body).toMatchObject({ events: 5, punished: 1, providers: ['Grim'] });
    expect((await call('GET', '/api/anticheat/events?punished=true')).body.total).toBe(1);

    // Unban Alex again so later tests are unaffected.
    await call('POST', `/api/punishments/${ban.body.punishmentId}/revoke`, { reason: 'test cleanup' });
  });

  // ── Phase 9: two-factor authentication ─────────────────────────

  it('enrols TOTP two-factor authentication and requires it at login', async () => {
    expect((await call('GET', '/api/auth/me/2fa')).body).toEqual({ enabled: false, recoveryCodesRemaining: 0 });
    expect((await call('POST', '/api/auth/me/2fa/setup', { password: 'wrong-password' })).body.code).toBe('INVALID_PASSWORD');

    const setup = await call('POST', '/api/auth/me/2fa/setup', { password: owner.password });
    expect(setup.body.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
    const secret = base32Decode(setup.body.secret);
    expect((await call('POST', '/api/auth/me/2fa/enable', { code: hotp(secret, totpStep() + 5) })).body.code).toBe('INVALID_TWO_FACTOR_CODE');
    const enrolCode = hotp(secret, totpStep());
    const enabled = await call('POST', '/api/auth/me/2fa/enable', { code: enrolCode });
    expect(enabled.status).toBe(200);
    const recoveryCodes = enabled.body.recoveryCodes as string[];
    expect(recoveryCodes).toHaveLength(10);
    expect((await call('GET', '/api/auth/me/2fa')).body).toEqual({ enabled: true, recoveryCodesRemaining: 10 });

    // Password alone no longer creates a session.
    await call('POST', '/api/auth/logout');
    jar.clear();
    const first = await call('POST', '/api/auth/login', { identifier: owner.username, password: owner.password });
    expect(first.body).toMatchObject({ twoFactorRequired: true });
    expect(jar.has('mnm_access')).toBe(false);
    expect((await call('POST', '/api/auth/login/2fa', { challenge: first.body.challenge, code: '000000' })).body.code).toBe('INVALID_TWO_FACTOR_CODE');
    // The code used for enrolment cannot be replayed.
    expect((await call('POST', '/api/auth/login/2fa', { challenge: first.body.challenge, code: enrolCode })).status).toBe(401);
    const second = await call('POST', '/api/auth/login/2fa', { challenge: first.body.challenge, code: recoveryCodes[0].toLowerCase() });
    expect(second.status).toBe(200);
    expect(jar.has('mnm_access')).toBe(true);
    expect((await call('GET', '/api/auth/me/2fa')).body.recoveryCodesRemaining).toBe(9);

    // Recovery codes and challenges are single-use.
    expect((await call('POST', '/api/auth/login/2fa', { challenge: first.body.challenge, code: recoveryCodes[1] })).body.code).toBe('TWO_FACTOR_CHALLENGE_EXPIRED');
    const retry = await call('POST', '/api/auth/login', { identifier: owner.username, password: owner.password });
    expect((await call('POST', '/api/auth/login/2fa', { challenge: retry.body.challenge, code: recoveryCodes[0] })).status).toBe(401);

    expect((await call('POST', '/api/auth/me/2fa/disable', { password: owner.password, code: recoveryCodes[1] })).status).toBe(200);
    expect((await call('GET', '/api/auth/me/2fa')).body.enabled).toBe(false);
    const audit = await call('GET', '/api/audit-logs?action=auth.2fa');
    expect(audit.body.items.map((e: { action: string }) => e.action)).toEqual(expect.arrayContaining(['auth.2fa_enabled', 'auth.2fa_disabled']));
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
    // Viewers may not see or issue punishments (server-side check, not just hidden UI).
    expect((await call('GET', '/api/punishments')).status).toBe(403);
    expect((await call('POST', '/api/punishments', { type: 'WARNING', target: 'Steve', reason: 'x' })).status).toBe(403);
    expect((await call('GET', '/api/anticheat/events')).status).toBe(403);

    // Write paths added in later phases are server-side protected as well.
    const forbidden: [string, string, unknown?][] = [
      ['PUT', '/api/anticheat/settings', {}],
      ['GET', '/api/settings/plugins'],
      ['PUT', '/api/settings/plugins', { baseRevision: 0, settings: {} }],
      ['PUT', '/api/settings/moderation', { presets: [] }],
      ['PATCH', '/api/settings/network', { name: 'Hijacked' }],
      ['POST', '/api/i18n/languages', { locale: 'it-IT', name: 'Italian' }],
      ['PUT', '/api/i18n/catalogs/en-US', { messages: {} }],
      ['POST', '/api/servers/registration-tokens', { type: 'PAPER', name: 'rogue' }],
      ['POST', '/api/roles', { name: 'Root', permissions: ['*'] }],
      ['POST', `/api/players/${steve.uuid}/inventories/lobby/inventory/revisions`, { baseRevision: 1, changes: [] }],
      ['PATCH', '/api/punishments/any-id', { version: 1, reason: 'x' }],
      ['POST', '/api/punishments/any-id/reactivate', { version: 1, expiresAt: null }],
      ['GET', '/api/punishments/any-id/history'],
      ['GET', '/api/punishments/any-id/evidence'],
      ['POST', '/api/punishments/any-id/evidence', { type: 'TEXT', title: 'x', description: 'x' }],
      ['PATCH', '/api/punishments/any-id/evidence/e', { version: 1, title: 'x' }],
      ['DELETE', '/api/punishments/any-id/evidence/e', { version: 1 }],
      ['GET', '/api/moderation/presets'],
      ['GET', '/api/integrations/luckperms'],
      ['PUT', '/api/integrations/luckperms/settings', { mode: 'MANAGED' }],
      ['POST', '/api/integrations/luckperms/mappings', { groupName: 'x' }],
      ['POST', '/api/moderation/presets', { category: 'BAN', numericId: 99, name: 'x', reason: 'x' }],
      ['PUT', '/api/moderation/command-mode', { mode: 'PRESET_ONLY' }],
      ['GET', '/api/updates'],
      ['GET', '/api/updates/notification'],
      ['POST', '/api/updates/notification/dismiss', { version: '9.9.9' }],
      ['POST', '/api/updates/check'],
      ['PUT', '/api/updates/settings', {}],
    ];
    for (const [method, path, body] of forbidden) {
      expect((await call(method, path, body)).status, `${method} ${path}`).toBe(403);
    }
    expect((await call('GET', '/api/settings/moderation')).status).toBe(200);
    // Plugin endpoints never accept dashboard sessions.
    expect((await call('GET', '/api/plugin/v1/config')).status).toBe(401);
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
