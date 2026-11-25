import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../src/config/app-config';
import type { PrismaService } from '../src/prisma/prisma.service';
import type { SettingsService } from '../src/settings/settings.service';
import { componentState, latestRelease, parseCompatibility, parseReleases, pluginCompatibility } from '../src/updates/releases';
import { compareVersions, parseSemVer } from '../src/updates/semver';
import { type FetchLike, updateSettingsSchema, UpdatesService } from '../src/updates/updates.service';

function release(tag: string, extra: Partial<Record<string, unknown>> = {}) {
  const v = tag.replace(/^v/, '');
  return {
    tag_name: tag,
    name: `Nexora ${v}`,
    html_url: `https://github.com/epicclowds/Nexora/releases/tag/${tag}`,
    published_at: '2026-11-25T12:00:00Z',
    draft: false,
    prerelease: false,
    body: `Release ${v}`,
    assets: [
      { name: `Nexora-Velocity-${v}.jar`, size: 1, browser_download_url: `https://github.com/epicclowds/Nexora/releases/download/${tag}/Nexora-Velocity-${v}.jar` },
      { name: `Nexora-Paper-${v}.jar`, size: 1, browser_download_url: `https://github.com/epicclowds/Nexora/releases/download/${tag}/Nexora-Paper-${v}.jar` },
    ],
    ...extra,
  };
}

function json(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(body), { status: init.status ?? 200, headers: { 'content-type': 'application/json', ...init.headers } });
}

/** UpdatesService with in-memory settings, a fake GitHub and fake users/servers. */
function setup(installed: string, responses: Array<Response | Error>, servers: Array<{ name: string; type: string; pluginVersion: string | null }> = []) {
  const store = new Map<string, unknown>();
  const users = new Map<string, { dismissedUpdateVersion: string | null }>([['u1', { dismissedUpdateVersion: null }]]);
  const requests: Array<{ url: string; headers: Record<string, string> }> = [];
  const fetchImpl: FetchLike = async (url, init) => {
    requests.push({ url, headers: init.headers as Record<string, string> });
    const next = responses.shift();
    if (!next) throw new Error('no response configured');
    if (next instanceof Error) throw next;
    return next;
  };
  const settings = {
    get: async (key: string) => (store.has(key) ? structuredClone(store.get(key)) : null),
    set: async (key: string, value: unknown) => void store.set(key, structuredClone(value)),
  } as unknown as SettingsService;
  const prisma = {
    server: { findMany: async () => servers.map((s, i) => ({ id: `s${i}`, status: 'ONLINE', enabled: true, ...s })) },
    dashboardUser: {
      findUnique: async ({ where }: { where: { id: string } }) => users.get(where.id) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: { dismissedUpdateVersion: string } }) => users.set(where.id, { dismissedUpdateVersion: data.dismissedUpdateVersion }),
    },
  } as unknown as PrismaService;
  const config = { version: installed, env: {} } as unknown as AppConfig;
  return { service: new UpdatesService(prisma, settings, config, fetchImpl), requests, store };
}

describe('semantic versions', () => {
  it('compares numerically, not as strings', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBe(1);
    expect(compareVersions('v2.0.0', '1.99.99')).toBe(1);
    expect(compareVersions('1.2.0', '1.2.0')).toBe(0);
    expect(compareVersions('1.2.0-rc.1', '1.2.0')).toBe(-1);
    expect(compareVersions('1.2.0-rc.10', '1.2.0-rc.9')).toBe(1);
    expect(compareVersions('1.2.0-alpha', '1.2.0-alpha.1')).toBe(-1);
    expect(compareVersions('1.2.0-alpha.1', '1.2.0-beta')).toBe(-1);
    expect(compareVersions('dev', '1.0.0')).toBeNull();
    expect(parseSemVer('01.2.3')).toBeNull();
    expect(parseSemVer('1.2.3+build.5')?.raw).toBe('1.2.3');
  });
});

describe('release selection', () => {
  const releases = parseReleases([
    release('v1.9.0'),
    release('v1.10.0'),
    release('v1.11.0-rc.1', { prerelease: true }),
    release('v1.12.0-beta.1'), // suffix without the GitHub flag is still a pre-release
    release('v2.0.0', { draft: true }),
    { garbage: true },
    release('not-a-version'),
  ]);

  it('ignores drafts, invalid entries and non-semver tags', () => {
    expect(releases.map((r) => r.version).sort()).toEqual(['1.10.0', '1.11.0-rc.1', '1.12.0-beta.1', '1.9.0']);
  });

  it('stable channel never returns pre-releases', () => {
    expect(latestRelease(releases, 'stable')?.version).toBe('1.10.0');
    expect(latestRelease(releases, 'prerelease')?.version).toBe('1.12.0-beta.1');
  });

  it('links plugin jars only when the exact asset exists', () => {
    const [withoutPaper] = parseReleases([release('v1.3.0', { assets: [{ name: 'Nexora-Velocity-1.3.0.jar', size: 1, browser_download_url: 'https://example.com/v.jar' }] })]);
    expect(withoutPaper.pluginAssets.velocity?.url).toBe('https://example.com/v.jar');
    expect(withoutPaper.pluginAssets.paper).toBeNull();
    const [renamed] = parseReleases([release('v1.3.0', { assets: [{ name: 'nexora-velocity.jar', size: 1, browser_download_url: 'https://example.com/x.jar' }] })]);
    expect(renamed.pluginAssets).toEqual({ velocity: null, paper: null });
  });

  it('reads optional compatibility metadata from the release notes', () => {
    expect(parseCompatibility('Notes\n<!-- nexora-compatibility {"minPluginVersion":"1.2.0","minUpgradeFrom":"1.1.0"} -->')).toEqual({ minPluginVersion: '1.2.0', minUpgradeFrom: '1.1.0' });
    expect(parseCompatibility('<!-- nexora-compatibility {broken} -->')).toBeNull();
    expect(parseCompatibility('<!-- nexora-compatibility {"minPluginVersion":"latest"} -->')).toBeNull();
    expect(parseCompatibility('no metadata')).toBeNull();
  });

  it('classifies components and plugin compatibility without guessing', () => {
    expect(componentState('1.1.0', '1.2.0')).toBe('outdated');
    expect(componentState('1.2.0', '1.2.0')).toBe('current');
    expect(componentState(null, '1.2.0')).toBe('unknown');
    expect(componentState('1.2.0', null)).toBe('unknown');
    expect(pluginCompatibility('1.2.0', '1.2.0', null)).toBe('compatible');
    expect(pluginCompatibility('1.2.0', '1.2.3', null)).toBe('recommended');
    expect(pluginCompatibility('1.1.0', '1.2.0', null)).toBe('incompatible');
    expect(pluginCompatibility('1.2.0', '2.0.0', null)).toBe('incompatible');
    expect(pluginCompatibility('1.2.1', '1.2.5', { minPluginVersion: '1.2.3' })).toBe('incompatible');
    expect(pluginCompatibility('dev-build', '1.2.0', null)).toBe('unknown');
  });
});

describe('update checker', () => {
  it('checks GitHub, caches the result and uses conditional requests', async () => {
    const { service, requests } = setup('1.1.0', [json([release('v1.1.0'), release('v1.2.0')], { headers: { etag: '"abc"' } }), new Response(null, { status: 304 })]);
    const first = await service.check(new Date('2026-11-25T10:00:00Z'));
    expect(first.releases.map((r) => r.version)).toEqual(['1.2.0', '1.1.0']);
    expect(requests[0].headers['if-none-match']).toBeUndefined();
    expect(requests[0].headers['user-agent']).toMatch(/^Nexora\/1\.1\.0/);
    expect(requests[0].headers.authorization).toBeUndefined();

    const second = await service.check(new Date('2026-11-25T16:00:00Z'));
    expect(requests[1].headers['if-none-match']).toBe('"abc"');
    expect(second.releases).toHaveLength(2); // 304 keeps the cached releases
    expect(second.lastSuccessAt).toBe('2026-11-25T16:00:00.000Z');
    expect((await service.status()).updateAvailable).toBe(true);
  });

  it('keeps the last known result when GitHub fails', async () => {
    const timeout = Object.assign(new Error('timeout'), { name: 'TimeoutError' });
    const { service } = setup('1.1.0', [json([release('v1.2.0')]), new Error('ECONNREFUSED'), timeout, new Response('oops', { status: 500 }), new Response('not json', { status: 200 })]);
    await service.check(new Date('2026-11-25T10:00:00Z'));
    for (const [hour, code] of [[11, 'NETWORK'], [12, 'TIMEOUT'], [13, 'HTTP_ERROR'], [14, 'INVALID_RESPONSE']] as const) {
      const state = await service.check(new Date(`2026-11-25T${hour}:00:00Z`));
      expect(state.lastError?.code).toBe(code);
      expect(state.releases.map((r) => r.version)).toEqual(['1.2.0']);
      expect(state.lastSuccessAt).toBe('2026-11-25T10:00:00.000Z');
    }
    const status = await service.status();
    expect(status.latest?.version).toBe('1.2.0');
    expect(status.lastError?.code).toBe('INVALID_RESPONSE');
  });

  it('respects GitHub rate limits and sends no request before the reset', async () => {
    const reset = Math.floor(Date.parse('2026-11-25T11:00:00Z') / 1000);
    const { service, requests } = setup('1.1.0', [json({ message: 'API rate limit exceeded' }, { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) } }), json([release('v1.2.0')])]);
    const limited = await service.check(new Date('2026-11-25T10:00:00Z'));
    expect(limited.lastError?.code).toBe('RATE_LIMITED');
    expect(limited.rateLimitedUntil).toBe('2026-11-25T11:00:00.000Z');
    await service.check(new Date('2026-11-25T10:30:00Z'));
    expect(requests).toHaveLength(1);
    const after = await service.check(new Date('2026-11-25T11:01:00Z'));
    expect(requests).toHaveLength(2);
    expect(after.lastError).toBeNull();
  });

  it('runs scheduled checks only when enabled and due; manual checks are rate-limited', async () => {
    const { service, requests } = setup('1.1.0', [json([release('v1.2.0')]), json([release('v1.2.0')]), json([release('v1.2.0')])]);
    expect(await service.checkIfDue(new Date('2026-11-25T10:00:00Z'))).not.toBeNull();
    expect(await service.checkIfDue(new Date('2026-11-25T15:59:00Z'))).toBeNull(); // 6 h interval
    expect(await service.checkIfDue(new Date('2026-11-25T16:00:00Z'))).not.toBeNull();
    expect((await service.checkNow(new Date('2026-11-25T16:00:30Z'))).refreshed).toBe(false);
    expect((await service.checkNow(new Date('2026-11-25T16:01:30Z'))).refreshed).toBe(true);
    expect(requests).toHaveLength(3);

    await service.saveSettings({ ...(await service.getSettings()), enabled: false }, 'u1');
    expect(await service.checkIfDue(new Date('2026-11-26T10:00:00Z'))).toBeNull();
    expect(await service.pluginInfo('1.1.0')).toBeNull();
  });

  it('validates settings with the documented defaults', () => {
    expect(updateSettingsSchema.parse({})).toEqual({ enabled: true, checkIntervalHours: 6, channel: 'stable', dashboardNotifications: true, minecraftNotifications: true, notificationCooldownHours: 24, manualChecks: true });
    expect(updateSettingsSchema.safeParse({ checkIntervalHours: 0 }).success).toBe(false);
    expect(updateSettingsSchema.safeParse({ channel: 'nightly' }).success).toBe(false);
    expect(updateSettingsSchema.safeParse({ autoInstall: true }).success).toBe(false);
  });

  it('notifies dashboard users until they dismiss the version, and again for a newer one', async () => {
    const { service } = setup('1.1.0', [json([release('v1.2.0')]), json([release('v1.2.0'), release('v1.3.0')])]);
    await service.check(new Date('2026-11-25T10:00:00Z'));
    expect((await service.notificationFor('u1'))?.latestVersion).toBe('1.2.0');
    await service.dismiss('u1', '1.2.0');
    expect(await service.notificationFor('u1')).toBeNull();
    await service.check(new Date('2026-11-25T17:00:00Z'));
    expect((await service.notificationFor('u1'))?.latestVersion).toBe('1.3.0');
    await service.saveSettings({ ...(await service.getSettings()), dashboardNotifications: false }, 'u1');
    expect(await service.notificationFor('u1')).toBeNull();
  });

  it('does not notify when up to date or when the installed version is unknown', async () => {
    const current = setup('1.2.0', [json([release('v1.2.0')])]);
    await current.service.check();
    expect(await current.service.notificationFor('u1')).toBeNull();
    const dev = setup('dev', [json([release('v1.2.0')])]);
    await dev.service.check();
    expect(await dev.service.notificationFor('u1')).toBeNull();
    expect((await dev.service.status()).backend.state).toBe('unknown');
  });

  it('reports plugin versions, update availability and compatibility warnings', async () => {
    const notes = 'Notes <!-- nexora-compatibility {"minUpgradeFrom":"1.1.0","minPluginVersion":"1.2.0"} -->';
    const { service } = setup(
      '1.0.3',
      [json([release('v1.0.3'), release('v1.2.0', { body: notes })])],
      [
        { name: 'Proxy-01', type: 'VELOCITY', pluginVersion: '1.0.3' },
        { name: 'Survival-01', type: 'PAPER', pluginVersion: '1.2.0' },
        { name: 'Survival-02', type: 'PAPER', pluginVersion: null },
      ],
    );
    await service.check();
    const status = await service.status();
    expect(status.servers.map((s) => [s.name, s.state, s.compatibility])).toEqual([
      ['Proxy-01', 'outdated', 'compatible'],
      ['Survival-01', 'current', 'incompatible'],
      ['Survival-02', 'unknown', 'unknown'],
    ]);
    expect(status.warnings).toContainEqual({ code: 'UPGRADE_PATH', version: '1.1.0' });
    expect(status.warnings).toContainEqual({ code: 'PLUGIN_VERSION_UNKNOWN', server: 'Survival-02' });

    const info = await service.pluginInfo('1.0.3');
    expect(info).toMatchObject({ latestVersion: '1.2.0', updateAvailable: true, notify: true, cooldownMinutes: 1440 });
    expect((await service.pluginInfo('1.2.0'))?.updateAvailable).toBe(false);
    expect((await service.pluginInfo(null))?.updateAvailable).toBe(false);
  });
});
