import { parseReasonReference, presetPermission } from '@mnm/shared-types';
import { describe, expect, it } from 'vitest';
import { PunishmentType } from '../src/generated/prisma/client';
import { categoryOf, createPresetSchema, type PresetRecord, resolveReason, typeFor, updatePresetSchema } from '../src/presets/presets';

const day = 86_400;
const preset = (category: PresetRecord['category'], numericId: number, extra: Partial<PresetRecord> = {}): PresetRecord => ({
  id: `${category}-${numericId}`,
  category,
  numericId,
  name: `${category} ${numericId}`,
  reason: `Reason ${category} ${numericId}`,
  durationSeconds: 30 * day,
  permanent: false,
  permission: presetPermission(category, numericId),
  enabled: true,
  archivedAt: null,
  ...extra,
});
const presets = [
  preset('BAN', 1, { name: 'Hacking', reason: 'Hacking', durationSeconds: 30 * day }),
  preset('BAN', 5, { name: 'Severe cheating', reason: 'Severe cheating', durationSeconds: null, permanent: true }),
  preset('BAN', 6, { enabled: false }),
  preset('BAN', 7, { archivedAt: new Date() }),
  preset('MUTE', 1, { name: 'Spam', reason: 'Spam', durationSeconds: 3600 }),
  preset('WARN', 1, { name: 'Language', reason: 'Language', durationSeconds: null }),
];
const find = (category: PresetRecord['category'], id: number) => presets.find((p) => p.category === category && p.numericId === id) ?? null;
const grants = (...permissions: string[]) => (p: string) => permissions.includes(p);

describe('reason references', () => {
  it('treats exactly one number as a reason ID, anything else as text', () => {
    expect(parseReasonReference('1')).toBe(1);
    expect(parseReasonReference(' 12 ')).toBe(12);
    expect(parseReasonReference('1 hour of spam')).toBeNull();
    expect(parseReasonReference('Cheating')).toBeNull();
    expect(parseReasonReference('12345')).toBeNull(); // above the ID range
  });

  it('maps categories and types', () => {
    expect(categoryOf(PunishmentType.TEMP_BAN)).toBe('BAN');
    expect(categoryOf(PunishmentType.WARNING)).toBe('WARN');
    expect(categoryOf(PunishmentType.BLACKLIST)).toBeNull();
    expect(typeFor('BAN', null)).toBe(PunishmentType.BAN);
    expect(typeFor('BAN', 60)).toBe(PunishmentType.TEMP_BAN);
    expect(typeFor('MUTE', 60)).toBe(PunishmentType.TEMP_MUTE);
    expect(typeFor('KICK', null)).toBe(PunishmentType.KICK);
  });
});

describe('command modes', () => {
  it('preset only: resolves IDs with their duration and reason, rejects typed reasons', () => {
    const r = resolveReason('PRESET_ONLY', { type: PunishmentType.BAN, reason: '1' }, find, grants('nexora.punishment.ban.1'));
    expect(r).toMatchObject({ ok: true, type: PunishmentType.TEMP_BAN, reason: 'Hacking', durationSeconds: 30 * day, preset: { numericId: 1 } });
    expect(resolveReason('PRESET_ONLY', { type: PunishmentType.BAN, reason: 'Cheating' }, find, () => true)).toEqual({ ok: false, code: 'PRESET_REQUIRED' });
    const perm = resolveReason('PRESET_ONLY', { type: PunishmentType.BAN, presetNumericId: 5 }, find, grants('nexora.punishment.ban.5'));
    expect(perm).toMatchObject({ ok: true, type: PunishmentType.BAN, durationSeconds: undefined });
  });

  it('free text only: keeps the old behaviour and ignores numbers as references', () => {
    expect(resolveReason('FREE_TEXT', { type: PunishmentType.BAN, reason: 'Cheating' }, find, () => false)).toMatchObject({ ok: true, type: PunishmentType.BAN, reason: 'Cheating', preset: null });
    expect(resolveReason('FREE_TEXT', { type: PunishmentType.BAN, reason: '1' }, find, () => false)).toMatchObject({ ok: true, reason: '1', preset: null });
    expect(resolveReason('FREE_TEXT', { type: PunishmentType.BAN, presetNumericId: 1 }, find, () => true)).toEqual({ ok: false, code: 'PRESETS_DISABLED' });
  });

  it('hybrid: IDs use presets, typed reasons need nexora.punishment.custom', () => {
    expect(resolveReason('HYBRID', { type: PunishmentType.BAN, reason: '1' }, find, grants('nexora.punishment.ban.1'))).toMatchObject({ ok: true, preset: { numericId: 1 } });
    expect(resolveReason('HYBRID', { type: PunishmentType.BAN, reason: 'Using an auto-clicker' }, find, grants())).toEqual({ ok: false, code: 'CUSTOM_REASON_FORBIDDEN' });
    expect(resolveReason('HYBRID', { type: PunishmentType.BAN, reason: 'Using an auto-clicker' }, find, grants('nexora.punishment.custom'))).toMatchObject({ ok: true, reason: 'Using an auto-clicker' });
    // A typed number never falls back to free text – no way around the preset permission.
    expect(resolveReason('HYBRID', { type: PunishmentType.BAN, reason: '5' }, find, grants('nexora.punishment.custom'))).toEqual({ ok: false, code: 'PRESET_FORBIDDEN', numericId: 5 });
    expect(resolveReason('HYBRID', { type: PunishmentType.BAN, reason: '42' }, find, grants('nexora.punishment.custom'))).toEqual({ ok: false, code: 'UNKNOWN_PRESET', numericId: 42 });
  });

  it('blacklist entries are always typed reasons', () => {
    expect(resolveReason('PRESET_ONLY', { type: PunishmentType.BLACKLIST, reason: 'Ban evasion' }, find, () => false)).toMatchObject({ ok: true, type: PunishmentType.BLACKLIST });
  });
});

describe('preset permissions and state', () => {
  it('rejects unknown, disabled, archived and unauthorised presets', () => {
    const all = () => true;
    expect(resolveReason('HYBRID', { type: PunishmentType.BAN, presetNumericId: 99 }, find, all)).toMatchObject({ ok: false, code: 'UNKNOWN_PRESET' });
    expect(resolveReason('HYBRID', { type: PunishmentType.BAN, presetNumericId: 6 }, find, all)).toMatchObject({ ok: false, code: 'PRESET_DISABLED' });
    expect(resolveReason('HYBRID', { type: PunishmentType.BAN, presetNumericId: 7 }, find, all)).toMatchObject({ ok: false, code: 'UNKNOWN_PRESET' });
    expect(resolveReason('HYBRID', { type: PunishmentType.BAN, presetNumericId: 1 }, find, grants('nexora.punishment.mute.1'))).toMatchObject({ ok: false, code: 'PRESET_FORBIDDEN' });
    // Mute reason 1 is a different preset than ban reason 1 (separate namespaces).
    expect(resolveReason('HYBRID', { type: PunishmentType.MUTE, presetNumericId: 1 }, find, grants('nexora.punishment.mute.1'))).toMatchObject({ ok: true, type: PunishmentType.TEMP_MUTE, reason: 'Spam', durationSeconds: 3600 });
  });

  it('duration overrides and permanent conversions need their own permissions', () => {
    const base = 'nexora.punishment.ban.1';
    expect(resolveReason('HYBRID', { type: PunishmentType.BAN, presetNumericId: 1, durationSeconds: 7 * day }, find, grants(base))).toMatchObject({ ok: false, code: 'DURATION_OVERRIDE_FORBIDDEN' });
    expect(resolveReason('HYBRID', { type: PunishmentType.BAN, presetNumericId: 1, durationSeconds: 7 * day }, find, grants(base, 'nexora.punishment.duration-override'))).toMatchObject({ ok: true, type: PunishmentType.TEMP_BAN, durationSeconds: 7 * day });
    expect(resolveReason('HYBRID', { type: PunishmentType.BAN, presetNumericId: 1, durationSeconds: null }, find, grants(base, 'nexora.punishment.duration-override'))).toMatchObject({ ok: false, code: 'PERMANENT_FORBIDDEN' });
    expect(resolveReason('HYBRID', { type: PunishmentType.BAN, presetNumericId: 1, durationSeconds: null }, find, grants(base, 'nexora.punishment.duration-override', 'nexora.punishment.permanent'))).toMatchObject({ ok: true, type: PunishmentType.BAN });
    // Sending the preset's own duration is not an override.
    expect(resolveReason('HYBRID', { type: PunishmentType.BAN, presetNumericId: 1, durationSeconds: 30 * day }, find, grants(base))).toMatchObject({ ok: true });
    // Kicks and warnings ignore durations.
    expect(resolveReason('HYBRID', { type: PunishmentType.WARNING, presetNumericId: 1, durationSeconds: 60 }, find, grants('nexora.punishment.warn.1'))).toMatchObject({ ok: true, type: PunishmentType.WARNING, durationSeconds: undefined });
  });

  it('wildcards in the canonical permissions behave like LuckPerms wildcards', async () => {
    const { hasPermission } = await import('@mnm/shared-types');
    expect(hasPermission(['nexora.punishment.*'], 'nexora.punishment.ban.5')).toBe(true);
    expect(hasPermission(['nexora.punishment.ban.*'], 'nexora.punishment.ban.5')).toBe(true);
    expect(hasPermission(['nexora.punishment.ban.*'], 'nexora.punishment.mute.1')).toBe(false);
    expect(hasPermission(['nexora.punishment.ban.*'], 'nexora.punishment.custom')).toBe(false);
  });
});

describe('preset validation', () => {
  it('validates presets', () => {
    expect(createPresetSchema.safeParse({ category: 'BAN', numericId: 1, name: 'Hacking', reason: 'Hacking', durationSeconds: 30 * day }).success).toBe(true);
    expect(createPresetSchema.safeParse({ category: 'BAN', numericId: 0, name: 'x', reason: 'x' }).success).toBe(false);
    expect(createPresetSchema.safeParse({ category: 'BAN', numericId: 1, name: 'x', reason: 'x', permanent: true, durationSeconds: 60 }).success).toBe(false);
    expect(createPresetSchema.safeParse({ category: 'KICK', numericId: 1, name: 'x', reason: 'x', durationSeconds: 3600 }).success).toBe(false);
    expect(createPresetSchema.safeParse({ category: 'BAN', numericId: 1, name: 'x', reason: 'x', permission: 'Nexora.Ban;DROP' }).success).toBe(false);
    expect(updatePresetSchema.safeParse({ version: 1, name: 'x', reason: 'x' }).success).toBe(true);
    expect(updatePresetSchema.safeParse({ name: 'x', reason: 'x' }).success).toBe(false);
  });
});
