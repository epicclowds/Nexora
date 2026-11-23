import { describe, expect, it } from 'vitest';
import { DEFAULT_ROLES, hasPermission, PERMISSIONS } from '@mnm/shared-types';
import { getMessages, mergeWithFallback, validateCatalog } from '@mnm/translations';
import { randomCode, safeEqual, sha256Hex } from '../src/common/crypto';
import { startOfDayInTimezone } from '../src/common/time';
import { isValidTimezone } from '../src/common/validation';
import { parseEnv } from '../src/config/env';
import { canManagePriority, ungrantablePermissions } from '../src/rbac/rbac.policy';
import { effectiveStatus } from '../src/servers/servers.service';

describe('hasPermission', () => {
  it('matches exact, global and namespace wildcards', () => {
    expect(hasPermission(['players.view'], 'players.view')).toBe(true);
    expect(hasPermission(['players.view'], 'players.view.ip')).toBe(false);
    expect(hasPermission(['*'], 'audit.view')).toBe(true);
    expect(hasPermission(['players.*'], 'players.view.ip')).toBe(true);
    expect(hasPermission(['players.*'], 'punishments.ban')).toBe(false);
    expect(hasPermission([], 'players.view')).toBe(false);
  });

  it('gives the default viewer role no moderation rights', () => {
    const viewer = DEFAULT_ROLES.find((r) => r.key === 'viewer')!;
    expect(hasPermission(viewer.permissions, PERMISSIONS.PUNISHMENTS_BAN)).toBe(false);
    expect(hasPermission(viewer.permissions, PERMISSIONS.PLAYERS_VIEW_IP)).toBe(false);
  });
});

describe('RBAC policy', () => {
  const admin = { roleKey: 'administrator', rolePriority: 900, permissions: ['users.manage', 'players.view'] };
  const owner = { roleKey: 'owner', rolePriority: 1000, permissions: ['*'] };

  it('only allows managing strictly lower priorities (owner exempt)', () => {
    expect(canManagePriority(admin, 500)).toBe(true);
    expect(canManagePriority(admin, 900)).toBe(false);
    expect(canManagePriority(admin, 1000)).toBe(false);
    expect(canManagePriority(owner, 1000)).toBe(true);
  });

  it('prevents granting permissions the actor does not hold', () => {
    expect(ungrantablePermissions(admin, ['players.view'])).toEqual([]);
    expect(ungrantablePermissions(admin, ['players.view', 'audit.view'])).toEqual(['audit.view']);
    expect(ungrantablePermissions(admin, ['*'])).toEqual(['*']);
    expect(ungrantablePermissions(owner, ['audit.view', '*'])).toEqual([]);
  });
});

describe('crypto helpers', () => {
  it('generates grouped setup codes without ambiguous characters', () => {
    const code = randomCode();
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){3}$/);
  });

  it('compares secrets in constant time', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(sha256Hex('a')).toHaveLength(64);
  });
});

describe('startOfDayInTimezone', () => {
  it('returns UTC midnight for UTC', () => {
    expect(startOfDayInTimezone('UTC', new Date('2026-11-23T17:00:00Z')).toISOString()).toBe('2026-11-23T00:00:00.000Z');
  });

  it('accounts for the zone offset (winter, CET = UTC+1)', () => {
    expect(startOfDayInTimezone('Europe/Berlin', new Date('2026-11-23T17:00:00Z')).toISOString()).toBe('2026-11-22T23:00:00.000Z');
  });

  it('accounts for the zone offset (summer, CEST = UTC+2)', () => {
    expect(startOfDayInTimezone('Europe/Berlin', new Date('2026-07-01T12:00:00Z')).toISOString()).toBe('2026-06-30T22:00:00.000Z');
  });

  it('uses the local date, not the UTC date', () => {
    // 2026-11-23 23:30 in New York is already 2026-11-24 in UTC.
    expect(startOfDayInTimezone('America/New_York', new Date('2026-11-24T04:30:00Z')).toISOString()).toBe('2026-11-23T05:00:00.000Z');
  });
});

describe('validation', () => {
  it('validates IANA time zones', () => {
    expect(isValidTimezone('Europe/Berlin')).toBe(true);
    expect(isValidTimezone('Mars/Olympus')).toBe(false);
  });
});

describe('environment parsing', () => {
  const base = { DATABASE_URL: 'mysql://u:p@db:3306/mnm', REDIS_URL: 'redis://redis:6379', JWT_SECRET: 'x'.repeat(48) };

  it('applies secure defaults', () => {
    const env = parseEnv(base);
    expect(env.PORT).toBe(4000);
    expect(env.COOKIE_SECURE).toBe('auto');
    expect(env.SETUP_TOKEN).toBeUndefined();
    expect(env.REGISTRATION_TOKEN_TTL_MINUTES).toBe(30);
  });

  it('rejects weak secrets and wrong URLs', () => {
    expect(() => parseEnv({ ...base, JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
    expect(() => parseEnv({ ...base, DATABASE_URL: 'postgres://x' })).toThrow(/DATABASE_URL/);
    expect(() => parseEnv({ ...base, SETUP_TOKEN: 'too-short' })).toThrow(/SETUP_TOKEN/);
  });
});

describe('server status', () => {
  const now = Date.parse('2026-11-23T12:00:00Z');
  it('treats stale heartbeats as offline', () => {
    expect(effectiveStatus({ status: 'ONLINE', enabled: true, lastHeartbeatAt: new Date(now - 10_000) }, now)).toBe('ONLINE');
    expect(effectiveStatus({ status: 'ONLINE', enabled: true, lastHeartbeatAt: new Date(now - 120_000) }, now)).toBe('OFFLINE');
    expect(effectiveStatus({ status: 'ONLINE', enabled: false, lastHeartbeatAt: new Date(now) }, now)).toBe('DISABLED');
  });
});

describe('translations', () => {
  it('rejects markup and script injection in catalogues', () => {
    const issues = validateCatalog({ a: { b: '<script>alert(1)</script>', c: 'ok {name}', d: 'javascript:void(0)', e: 'broken {' } });
    expect(issues.map((i) => `${i.key}:${i.problem}`).sort()).toEqual(['a.b:unsafe-content', 'a.d:unsafe-content', 'a.e:unbalanced-braces']);
  });

  it('falls back to English for missing keys', () => {
    const merged = mergeWithFallback({ a: 'A', n: { b: 'B', c: 'C' } }, { n: { b: 'Bde' } });
    expect(merged).toEqual({ a: 'A', n: { b: 'Bde', c: 'C' } });
    expect((getMessages('xx-XX').common as Record<string, string>).save).toBe('Save');
  });
});
