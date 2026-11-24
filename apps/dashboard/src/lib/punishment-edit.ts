/**
 * Helpers for the punishment edit form. Durations are counted from the
 * original creation time (createdAt + duration), matching /editban. All values
 * sent to the backend are UTC ISO timestamps.
 */
export const UNIT_SECONDS = { minutes: 60, hours: 3600, days: 86_400, weeks: 604_800 } as const;
export type DurationUnit = keyof typeof UNIT_SECONDS;

export function expiryFromDuration(createdAt: string, amount: number, unit: DurationUnit): string {
  return new Date(Date.parse(createdAt) + amount * UNIT_SECONDS[unit] * 1000).toISOString();
}

/** Total duration (seconds) of a punishment from its creation, or null when permanent. */
export function totalSeconds(createdAt: string, expiresAt: string | null): number | null {
  return expiresAt === null ? null : Math.round((Date.parse(expiresAt) - Date.parse(createdAt)) / 1000);
}

/** Largest whole unit that represents the duration exactly, e.g. 2592000 → 30 days. */
export function splitSeconds(seconds: number): { amount: number; unit: DurationUnit } {
  for (const unit of ['weeks', 'days', 'hours', 'minutes'] as const) {
    if (seconds % UNIT_SECONDS[unit] === 0) return { amount: seconds / UNIT_SECONDS[unit], unit };
  }
  return { amount: Math.max(1, Math.round(seconds / 60)), unit: 'minutes' };
}

/** Offset (ms) of a time zone from UTC at the given instant. */
function zoneOffset(instant: number, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date(instant))
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, Number(p.value)]),
  );
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** "2026-12-24T18:00" in `timeZone` → UTC ISO string (handles DST transitions). */
export function zonedLocalToUtc(local: string, timeZone: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!match) return null;
  const [, y, mo, d, h, mi] = match.map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  // Two passes converge across DST changes.
  let guess = wall - zoneOffset(wall, timeZone);
  guess = wall - zoneOffset(guess, timeZone);
  return new Date(guess).toISOString();
}

/** UTC ISO → "YYYY-MM-DDTHH:mm" wall time in `timeZone` (for datetime-local inputs). */
export function utcToZonedLocal(iso: string, timeZone: string): string {
  const instant = Date.parse(iso);
  const local = new Date(instant + zoneOffset(instant, timeZone));
  return local.toISOString().slice(0, 16);
}

export type ExpiryChoice = { mode: 'keep' } | { mode: 'permanent' } | { mode: 'duration'; amount: number; unit: DurationUnit } | { mode: 'date'; local: string };

/** Resolves the form choice to the expiry to send (undefined = unchanged, null = permanent). */
export function resolveExpiry(choice: ExpiryChoice, createdAt: string, timeZone: string): string | null | undefined {
  switch (choice.mode) {
    case 'keep':
      return undefined;
    case 'permanent':
      return null;
    case 'duration':
      return Number.isFinite(choice.amount) && choice.amount > 0 ? expiryFromDuration(createdAt, choice.amount, choice.unit) : undefined;
    case 'date':
      return zonedLocalToUtc(choice.local, timeZone) ?? undefined;
  }
}

/** A change that needs an explicit confirmation step (anything but a pure note change). */
export function isMaterialChange(changes: { reason: boolean; expiry: boolean }): boolean {
  return changes.reason || changes.expiry;
}

/** Only https:// links are rendered as clickable links (defence in depth; the backend enforces it too). */
export function safeHref(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' ? parsed.href : null;
  } catch {
    return null;
  }
}
