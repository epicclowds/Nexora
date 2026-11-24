import { PERMISSIONS } from '@mnm/shared-types';
import { describe, expect, it } from 'vitest';
import { PunishmentStatus, PunishmentType } from '../src/generated/prisma/client';
import { createEvidenceSchema, evidenceUrlProblem, expiryFromCreation, planEdit, updateEvidenceSchema } from '../src/punishments/punishment-editing';

const DAY = 86_400_000;
const created = new Date('2026-11-24T18:00:00.000Z');
const now = new Date(created.getTime() + 2 * DAY);
type Current = Parameters<typeof planEdit>[0];
const ban: Current = {
  type: PunishmentType.TEMP_BAN,
  status: PunishmentStatus.ACTIVE,
  reason: 'Cheating',
  createdAt: created,
  expiresAt: new Date(created.getTime() + 7 * DAY),
  staffNote: null,
};

const plan = (patch: Parameters<typeof planEdit>[1], current = ban) => planEdit(current, patch, now);

describe('planEdit – durations are counted from the creation time', () => {
  it('extends and shortens temporary punishments', () => {
    const extended = plan({ expiresAt: expiryFromCreation(created, 30 * 86_400) });
    expect(extended).toMatchObject({ ok: true, data: { expiresAt: new Date('2026-12-24T18:00:00.000Z') }, history: [{ action: 'DURATION_EXTENDED' }] });
    const shortened = plan({ expiresAt: expiryFromCreation(created, 3 * 86_400) });
    expect(shortened).toMatchObject({ ok: true, history: [{ action: 'DURATION_SHORTENED', previousValues: { expiresAt: '2026-12-01T18:00:00.000Z' } }] });
  });

  it('converts temporary → permanent and back, changing the type', () => {
    const permanent = plan({ expiresAt: null });
    expect(permanent).toMatchObject({ ok: true, data: { type: 'BAN', expiresAt: null }, history: [{ action: 'MADE_PERMANENT' }] });
    if (permanent.ok) expect(permanent.permissions).toContain(PERMISSIONS.PUNISHMENTS_EDIT_PERMANENT);
    const temporary = plan({ expiresAt: expiryFromCreation(created, 14 * 86_400) }, { ...ban, type: PunishmentType.MUTE, expiresAt: null });
    expect(temporary).toMatchObject({ ok: true, data: { type: 'TEMP_MUTE' }, history: [{ action: 'MADE_TEMPORARY' }] });
  });

  it('rejects durations that have already elapsed instead of silently ending the ban', () => {
    expect(plan({ expiresAt: expiryFromCreation(created, 86_400) })).toMatchObject({ ok: false, code: 'DURATION_ALREADY_ELAPSED' });
    expect(plan({ expiresAt: expiryFromCreation(created, 30) })).toMatchObject({ ok: false, code: 'INVALID_DURATION' });
  });

  it('never changes the duration of expired or revoked punishments (no silent reactivation)', () => {
    const expired = { ...ban, expiresAt: new Date(now.getTime() - 1000) };
    expect(plan({ expiresAt: expiryFromCreation(created, 30 * 86_400) }, expired)).toMatchObject({ ok: false, code: 'NOT_ACTIVE' });
    const revoked = { ...ban, status: PunishmentStatus.REVOKED };
    expect(plan({ expiresAt: null }, revoked)).toMatchObject({ ok: false, code: 'NOT_ACTIVE' });
    // Corrections of the reason stay possible and keep the status.
    const corrected = plan({ reason: 'Typo fixed' }, revoked);
    expect(corrected.ok && corrected.data).toEqual({ reason: 'Typo fixed' });
  });

  it('records reason and note changes with previous values and required permissions', () => {
    const result = plan({ reason: '  Repeated cheating ', staffNote: 'Clip reviewed' });
    expect(result).toMatchObject({
      ok: true,
      notifyPlugins: true,
      history: [
        { action: 'REASON_CHANGED', previousValues: { reason: 'Cheating' }, newValues: { reason: 'Repeated cheating' } },
        { action: 'NOTE_CHANGED', previousValues: { staffNote: null }, newValues: { staffNote: 'Clip reviewed' } },
      ],
    });
    if (result.ok) expect(result.permissions.sort()).toEqual([PERMISSIONS.PUNISHMENTS_EDIT, PERMISSIONS.PUNISHMENTS_EDIT_REASON].sort());
    // A note alone is not shown to players: no plugin refresh needed.
    expect(plan({ staffNote: 'x' })).toMatchObject({ ok: true, notifyPlugins: false });
  });

  it('reports no-ops and non-editable types', () => {
    expect(plan({ reason: 'Cheating', expiresAt: ban.expiresAt })).toMatchObject({ ok: false, code: 'NO_CHANGES' });
    expect(plan({ expiresAt: null }, { ...ban, type: PunishmentType.WARNING, expiresAt: null })).toMatchObject({ ok: false, code: 'NO_CHANGES' });
    expect(plan({ expiresAt: expiryFromCreation(created, 30 * 86_400) }, { ...ban, type: PunishmentType.BLACKLIST, expiresAt: null })).toMatchObject({ ok: false, code: 'DURATION_NOT_EDITABLE' });
  });
});

describe('evidence validation', () => {
  it('accepts https links only', () => {
    expect(evidenceUrlProblem('https://youtu.be/abc?t=12')).toBeNull();
    for (const bad of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'http://example.com/clip', 'ftp://x.example/y', 'https://user:pw@example.com/x', 'https://localhost/x', 'https://exa mple.com', 'not a url']) {
      expect(evidenceUrlProblem(bad), bad).not.toBeNull();
    }
  });

  it('requires a URL for link types and a description for text types', () => {
    expect(createEvidenceSchema.safeParse({ type: 'VIDEO', title: 'KillAura', url: 'https://medal.tv/clips/1' }).success).toBe(true);
    expect(createEvidenceSchema.safeParse({ type: 'VIDEO', title: 'KillAura' }).success).toBe(false);
    expect(createEvidenceSchema.safeParse({ type: 'TEXT', title: 'Report', description: 'Line 1\nLine 2' }).success).toBe(true);
    expect(createEvidenceSchema.safeParse({ type: 'TEXT', title: 'Report', url: 'https://example.com', description: 'x' }).success).toBe(false);
    expect(createEvidenceSchema.safeParse({ type: 'SCREENSHOT', title: 'x', url: 'javascript:alert(1)' }).success).toBe(false);
  });

  it('defaults to staff-only and keeps internal notes private', () => {
    const parsed = createEvidenceSchema.parse({ type: 'LINK', title: 'Forum report', url: 'https://example.com/report' });
    expect(parsed.visibility).toBe('STAFF');
    expect(createEvidenceSchema.safeParse({ type: 'NOTE', title: 'Internal', description: 'x', visibility: 'PUBLIC' }).success).toBe(false);
  });

  it('requires the version for updates and rejects unknown fields', () => {
    expect(updateEvidenceSchema.safeParse({ title: 'x' }).success).toBe(false);
    expect(updateEvidenceSchema.safeParse({ version: 1, punishmentId: 'other' }).success).toBe(false);
    expect(updateEvidenceSchema.safeParse({ version: 2, url: 'https://example.com/better' }).success).toBe(true);
  });
});
