import { describe, expect, it } from 'vitest';
import { expiryFromDuration, resolveExpiry, safeHref, splitSeconds, totalSeconds, utcToZonedLocal, zonedLocalToUtc } from './punishment-edit';

const created = '2026-11-24T18:00:00.000Z';

describe('punishment edit helpers', () => {
  it('counts durations from the creation time', () => {
    expect(expiryFromDuration(created, 30, 'days')).toBe('2026-12-24T18:00:00.000Z');
    expect(totalSeconds(created, '2026-12-01T18:00:00.000Z')).toBe(7 * 86_400);
    expect(totalSeconds(created, null)).toBeNull();
    expect(splitSeconds(30 * 86_400)).toEqual({ amount: 30, unit: 'days' });
    expect(splitSeconds(14 * 86_400)).toEqual({ amount: 2, unit: 'weeks' });
    expect(splitSeconds(90 * 60)).toEqual({ amount: 90, unit: 'minutes' });
  });

  it('converts wall times in the user time zone to UTC, including DST', () => {
    expect(zonedLocalToUtc('2026-12-24T18:00', 'Europe/Berlin')).toBe('2026-12-24T17:00:00.000Z'); // CET
    expect(zonedLocalToUtc('2026-07-01T18:00', 'Europe/Berlin')).toBe('2026-07-01T16:00:00.000Z'); // CEST
    expect(zonedLocalToUtc('2026-07-01T18:00', 'America/New_York')).toBe('2026-07-01T22:00:00.000Z');
    expect(zonedLocalToUtc('2026-07-01T18:00', 'UTC')).toBe('2026-07-01T18:00:00.000Z');
    expect(utcToZonedLocal('2026-12-24T17:00:00.000Z', 'Europe/Berlin')).toBe('2026-12-24T18:00');
    expect(zonedLocalToUtc('not a date', 'UTC')).toBeNull();
  });

  it('resolves the expiry choice (undefined = unchanged, null = permanent)', () => {
    expect(resolveExpiry({ mode: 'keep' }, created, 'UTC')).toBeUndefined();
    expect(resolveExpiry({ mode: 'permanent' }, created, 'UTC')).toBeNull();
    expect(resolveExpiry({ mode: 'duration', amount: 7, unit: 'days' }, created, 'UTC')).toBe('2026-12-01T18:00:00.000Z');
    expect(resolveExpiry({ mode: 'duration', amount: 0, unit: 'days' }, created, 'UTC')).toBeUndefined();
    expect(resolveExpiry({ mode: 'date', local: '2027-01-01T00:00' }, created, 'Europe/Berlin')).toBe('2026-12-31T23:00:00.000Z');
  });

  it('only links https URLs', () => {
    expect(safeHref('https://medal.tv/clips/1')).toBe('https://medal.tv/clips/1');
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('data:text/html,x')).toBeNull();
    expect(safeHref('http://example.com')).toBeNull();
    expect(safeHref(null)).toBeNull();
  });
});
