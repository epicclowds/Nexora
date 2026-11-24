import 'reflect-metadata';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { beforeAll, describe, expect, it } from 'vitest';
import { IS_PUBLIC_KEY, PERMISSIONS_KEY } from '../src/common/auth-context';

/**
 * Permission audit: every HTTP route must be deliberately public, signed
 * (plugins), or require a session – and session routes without a specific
 * permission must be on the allowlist below. The generated matrix is
 * committed as docs/architecture/permission-matrix.md; regenerate it with
 * UPDATE_PERMISSION_MATRIX=1 npx vitest run test/route-permissions.spec.ts
 */
const SRC = join(__dirname, '..', 'src');
const MATRIX = join(__dirname, '..', '..', '..', 'docs', 'architecture', 'permission-matrix.md');

/** Session routes intentionally open to every signed-in user (own data or harmless reads). */
const SESSION_ONLY_ALLOWLIST = new Set([
  'GET /api/auth/me',
  'PATCH /api/auth/me',
  'POST /api/auth/me/password',
  'POST /api/auth/logout',
  'GET /api/dashboard/summary',
  'GET /api/settings/network',
  'GET /api/settings/moderation',
  'GET /api/events',
]);

/** Session routes whose permission depends on the request and is checked inside the handler. */
const IN_HANDLER: Record<string, string> = {
  'POST /api/punishments': 'per punishment type, checked in handler (e.g. `punishments.ban`)',
  'POST /api/punishments/:id/revoke': 'per punishment type, checked in handler (e.g. `punishments.unban`)',
};

/** Routes reachable without a session or signature. */
const PUBLIC_ALLOWLIST = new Set([
  'GET /api/health/live',
  'GET /api/health/ready',
  'GET /api/setup/status',
  'POST /api/setup/initialize',
  'POST /api/auth/login',
  'POST /api/auth/refresh',
  'GET /api/i18n/languages',
  'GET /api/i18n/messages/:locale',
  'POST /api/plugin/v1/register',
]);

interface Route {
  method: string;
  path: string;
  access: 'public' | 'plugin' | 'session' | 'permission';
  permissions: string[];
  controller: string;
}

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === 'generated' ? [] : files(full);
    return name.endsWith('.controller.ts') ? [full] : [];
  });
}

const join2 = (...parts: (string | undefined)[]) =>
  '/' +
  parts
    .flatMap((p) => (p ?? '').split('/'))
    .filter(Boolean)
    .join('/');

async function collectRoutes(): Promise<Route[]> {
  const routes: Route[] = [];
  for (const file of files(SRC)) {
    const mod = (await import(file)) as Record<string, unknown>;
    for (const exported of Object.values(mod)) {
      if (typeof exported !== 'function') continue;
      const controllerPath = Reflect.getMetadata(PATH_METADATA, exported) as string | string[] | undefined;
      if (controllerPath === undefined) continue;
      const base = Array.isArray(controllerPath) ? controllerPath[0] : controllerPath;
      const classPublic = Reflect.getMetadata(IS_PUBLIC_KEY, exported) === true;
      const classPermissions = (Reflect.getMetadata(PERMISSIONS_KEY, exported) as string[] | undefined) ?? [];
      const classGuards = (Reflect.getMetadata(GUARDS_METADATA, exported) as { name?: string }[] | undefined) ?? [];
      const proto = (exported as { prototype: Record<string, unknown> }).prototype;
      for (const key of Object.getOwnPropertyNames(proto)) {
        const handler = proto[key];
        if (key === 'constructor' || typeof handler !== 'function') continue;
        const methodPath = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
        const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
        if (methodPath === undefined || method === undefined) continue;
        const isPublic = classPublic || Reflect.getMetadata(IS_PUBLIC_KEY, handler) === true;
        const permissions = [...classPermissions, ...((Reflect.getMetadata(PERMISSIONS_KEY, handler) as string[] | undefined) ?? [])];
        const guards = [...classGuards, ...((Reflect.getMetadata(GUARDS_METADATA, handler) as { name?: string }[] | undefined) ?? [])];
        const signed = guards.some((g) => g.name === 'PluginAuthGuard');
        routes.push({
          method: RequestMethod[method],
          path: join2('api', base, methodPath),
          access: signed ? 'plugin' : isPublic ? 'public' : permissions.length ? 'permission' : 'session',
          permissions,
          controller: `${(exported as { name: string }).name} (${relative(SRC, file).replace(/\\/g, '/')})`,
        });
      }
    }
  }
  return routes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

function renderMatrix(routes: Route[]): string {
  const label = (r: Route) =>
    r.access === 'public' ? 'public' : r.access === 'plugin' ? 'plugin signature' : r.access === 'session' ? (IN_HANDLER[`${r.method} ${r.path}`] ?? 'session') : r.permissions.map((p) => `\`${p}\``).join(' + ');
  return [
    '# Permission matrix',
    '',
    '<!-- Generated by apps/backend/test/route-permissions.spec.ts – do not edit by hand. -->',
    '',
    'Every backend route and what it requires. Permissions are checked on the server for every request; hiding UI elements is only cosmetic.',
    '"session" = any signed-in dashboard user; "plugin signature" = HMAC-signed request from a registered Minecraft server.',
    'The `owner` role holds every permission (`*`).',
    '',
    `Routes: ${routes.length} · public: ${routes.filter((r) => r.access === 'public').length} · plugin: ${routes.filter((r) => r.access === 'plugin').length} · session only: ${routes.filter((r) => r.access === 'session' && !(`${r.method} ${r.path}` in IN_HANDLER)).length} · checked in handler: ${Object.keys(IN_HANDLER).length} · permission-protected: ${routes.filter((r) => r.access === 'permission').length}`,
    '',
    '| Method | Path | Requires |',
    '| --- | --- | --- |',
    ...routes.map((r) => `| ${r.method} | \`${r.path}\` | ${label(r)} |`),
    '',
  ].join('\n');
}

describe('route permissions', () => {
  let routes: Route[] = [];
  // Importing every controller loads the whole application graph once.
  beforeAll(async () => {
    routes = await collectRoutes();
  }, 120_000);

  it('protects every route deliberately', () => {
    expect(routes.length).toBeGreaterThan(80);

    const id = (r: Route) => `${r.method} ${r.path}`;
    const unexpectedPublic = routes.filter((r) => r.access === 'public' && !PUBLIC_ALLOWLIST.has(id(r))).map(id);
    const unexpectedSession = routes.filter((r) => r.access === 'session' && !SESSION_ONLY_ALLOWLIST.has(id(r)) && !(id(r) in IN_HANDLER)).map(id);
    expect(unexpectedPublic, 'new public route: add it to PUBLIC_ALLOWLIST only if it must be reachable without login').toEqual([]);
    expect(unexpectedSession, 'session route without permission: add @RequirePermissions or allowlist it').toEqual([]);

    // Plugin routes are machine-to-machine only.
    for (const r of routes.filter((x) => x.path.startsWith('/api/plugin/v1/') && id(x) !== 'POST /api/plugin/v1/register')) {
      expect(r.access, id(r)).toBe('plugin');
    }
    // Every allowlisted route still exists (keeps the lists honest).
    const all = new Set(routes.map(id));
    expect([...PUBLIC_ALLOWLIST, ...SESSION_ONLY_ALLOWLIST, ...Object.keys(IN_HANDLER)].filter((r) => !all.has(r))).toEqual([]);
  });

  it('matches the committed permission matrix', () => {
    const matrix = renderMatrix(routes);
    if (process.env.UPDATE_PERMISSION_MATRIX === '1') writeFileSync(MATRIX, matrix);
    const committed = readFileSync(MATRIX, 'utf8').replace(/\r\n/g, '\n');
    expect(committed, 'routes changed: regenerate docs/architecture/permission-matrix.md (see header of this test)').toBe(matrix);
  });
});
