import { describe, expect, it } from 'vitest';
import { computeExpiry, effectiveStatus, ISSUE_PERMISSION, isRevocable, REVOKE_PERMISSION } from '../src/punishments/punishment-rules';

const now = new Date('2026-11-25T12:00:00Z');

describe('computeExpiry', () => {
  it('requires a duration for temporary punishments', () => {
    expect(computeExpiry('TEMP_BAN', undefined, now)).toEqual({ ok: false, reason: expect.stringContaining('required') });
    expect(computeExpiry('TEMP_MUTE', 3600, now)).toEqual({ ok: true, expiresAt: new Date('2026-11-25T13:00:00Z') });
  });

  it('rejects durations for permanent types and out-of-range values', () => {
    expect(computeExpiry('BAN', 3600, now).ok).toBe(false);
    expect(computeExpiry('KICK', 60, now).ok).toBe(false);
    expect(computeExpiry('TEMP_BAN', 10, now).ok).toBe(false);
    expect(computeExpiry('TEMP_BAN', 11 * 365 * 86_400, now).ok).toBe(false);
    expect(computeExpiry('BAN', undefined, now)).toEqual({ ok: true, expiresAt: null });
  });
});

describe('effectiveStatus', () => {
  it('treats active punishments past their expiry as expired', () => {
    const t = now.getTime();
    expect(effectiveStatus({ status: 'ACTIVE', expiresAt: new Date(t - 1) }, t)).toBe('EXPIRED');
    expect(effectiveStatus({ status: 'ACTIVE', expiresAt: new Date(t + 1) }, t)).toBe('ACTIVE');
    expect(effectiveStatus({ status: 'ACTIVE', expiresAt: null }, t)).toBe('ACTIVE');
    expect(effectiveStatus({ status: 'REVOKED', expiresAt: null }, t)).toBe('REVOKED');
  });

  it('never considers kicks revocable', () => {
    expect(isRevocable({ type: 'KICK', status: 'ACTIVE', expiresAt: null })).toBe(false);
    expect(isRevocable({ type: 'BAN', status: 'ACTIVE', expiresAt: null })).toBe(true);
    expect(isRevocable({ type: 'BAN', status: 'REVOKED', expiresAt: null })).toBe(false);
  });
});

describe('permission mapping', () => {
  it('maps each type to issue and revoke permissions', () => {
    expect(ISSUE_PERMISSION.TEMP_BAN).toBe('punishments.ban');
    expect(ISSUE_PERMISSION.BLACKLIST).toBe('punishments.blacklist');
    expect(REVOKE_PERMISSION.BAN).toBe('punishments.unban');
    expect(REVOKE_PERMISSION.TEMP_MUTE).toBe('punishments.unmute');
  });
});
