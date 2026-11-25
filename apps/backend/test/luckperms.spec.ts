import { describe, expect, it } from 'vitest';
import { generateCode, hashCode, normalizeCode } from '../src/luckperms/linking.service';
import { freshness, luckPermsSettingsSchema, mappingSchema, parsePrefix, resolveRole, snapshotSchema } from '../src/luckperms/luckperms';

const roles = [
  { id: 'r-owner', key: 'owner', priority: 1000 },
  { id: 'r-admin', key: 'administrator', priority: 900 },
  { id: 'r-mod', key: 'moderator', priority: 500 },
  { id: 'r-sup', key: 'supporter', priority: 300 },
];
const mappings = [
  { groupName: 'admin', roleId: 'r-admin', dashboardAccess: true, deny: false, priority: 100 },
  { groupName: 'moderator', roleId: 'r-mod', dashboardAccess: true, deny: false, priority: 50 },
  { groupName: 'supporter', roleId: 'r-sup', dashboardAccess: true, deny: false, priority: 10 },
  { groupName: 'trial', roleId: 'r-sup', dashboardAccess: false, deny: false, priority: 5 },
  { groupName: 'banned-staff', roleId: null, dashboardAccess: false, deny: true, priority: 0 },
  { groupName: 'owner-group', roleId: 'r-owner', dashboardAccess: true, deny: false, priority: 1000 },
];

describe('LuckPerms group → role mapping', () => {
  it('picks the eligible mapping with the highest priority (inherited groups included)', () => {
    expect(resolveRole(['default', 'supporter', 'moderator'], mappings, roles)).toEqual({ access: true, roleId: 'r-mod', group: 'moderator' });
    expect(resolveRole(['Admin'], mappings, roles)).toMatchObject({ access: true, roleId: 'r-admin' });
  });

  it('partial removal keeps the next eligible role; no eligible group means no access', () => {
    expect(resolveRole(['default', 'supporter'], mappings, roles)).toMatchObject({ access: true, roleId: 'r-sup' });
    expect(resolveRole(['default'], mappings, roles)).toEqual({ access: false, reason: 'NO_ELIGIBLE_GROUP' });
    expect(resolveRole(['trial'], mappings, roles)).toEqual({ access: false, reason: 'NO_ELIGIBLE_GROUP' });
  });

  it('an explicit deny wins over every other group', () => {
    expect(resolveRole(['admin', 'banned-staff'], mappings, roles)).toEqual({ access: false, reason: 'DENIED_GROUP', group: 'banned-staff' });
  });

  it('never grants the protected Owner role', () => {
    expect(resolveRole(['owner-group'], mappings, roles)).toEqual({ access: false, reason: 'NO_ELIGIBLE_GROUP' });
    expect(resolveRole(['owner-group', 'moderator'], mappings, roles)).toMatchObject({ access: true, roleId: 'r-mod' });
  });
});

describe('snapshot freshness', () => {
  const now = new Date('2026-11-25T12:00:00Z');
  it('treats old or expired snapshots as untrusted', () => {
    expect(freshness({ synchronizedAt: new Date('2026-11-25T11:45:00Z'), expiresAt: null }, 30, now)).toBe('FRESH');
    expect(freshness({ synchronizedAt: new Date('2026-11-25T11:00:00Z'), expiresAt: null }, 30, now)).toBe('STALE');
    // A temporary group ran out after the last snapshot.
    expect(freshness({ synchronizedAt: new Date('2026-11-25T11:59:00Z'), expiresAt: new Date('2026-11-25T11:59:30Z') }, 30, now)).toBe('EXPIRED');
  });
});

describe('prefixes', () => {
  it('extracts text and the first colour without markup', () => {
    expect(parsePrefix('&c[Mod] ')).toEqual({ text: '[Mod]', color: '#FF5555' });
    expect(parsePrefix('§6§l[Admin]')).toEqual({ text: '[Admin]', color: '#FFAA00' });
    expect(parsePrefix('&#1E90FF[Dev]')).toEqual({ text: '[Dev]', color: '#1E90FF' });
    expect(parsePrefix('<gradient:red:blue>[Owner]</gradient>')).toEqual({ text: '[Owner]', color: null });
    expect(parsePrefix('<green>[Helper]</green>')).toEqual({ text: '[Helper]', color: '#55FF55' });
    expect(parsePrefix('<script>alert(1)</script>[X]')).toEqual({ text: 'alert(1)[X]', color: null });
    expect(parsePrefix('')).toBeNull();
    expect(parsePrefix('&7')).toBeNull();
  });
});

describe('settings and payloads', () => {
  it('defaults to disabled and validates input', () => {
    expect(luckPermsSettingsSchema.parse({})).toEqual({ mode: 'DISABLED', staleAfterMinutes: 30, linking: { enabled: true, allowRegistration: false } });
    expect(luckPermsSettingsSchema.safeParse({ mode: 'ON' }).success).toBe(false);
    expect(mappingSchema.parse({ groupName: 'Moderator', roleId: 'r-mod' })).toMatchObject({ groupName: 'moderator', dashboardAccess: true, deny: false });
    expect(mappingSchema.safeParse({ groupName: 'bad group!' }).success).toBe(false);
    expect(snapshotSchema.safeParse({ uuid: 'not-a-uuid', groups: [], permissions: {} }).success).toBe(false);
    expect(snapshotSchema.safeParse({ uuid: '069a79f4-44e9-4726-a5be-fca90e38aaf5', groups: ['default'], permissions: { 'nexora.punishment.ban.1': true, 'nexora.punishment.ban.5': false } }).success).toBe(true);
  });
});

describe('link codes', () => {
  it('are random, unambiguous and stored as hashes', () => {
    const codes = new Set(Array.from({ length: 500 }, generateCode));
    expect(codes.size).toBe(500);
    for (const c of codes) expect(c).toMatch(/^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
    expect(normalizeCode('abcd 2345')).toBe('ABCD2345');
    expect(hashCode('ABCD-2345')).toBe(hashCode('abcd2345'));
    expect(hashCode('ABCD-2345')).toMatch(/^[0-9a-f]{64}$/);
    expect(hashCode('ABCD-2345')).not.toContain('ABCD');
  });
});
