/**
 * Returns the UTC instant at which the current calendar day began in `timeZone`.
 * Handles DST transitions by measuring the zone offset at the computed instant.
 */
export function startOfDayInTimezone(timeZone: string, now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const midnightAsUtc = Date.UTC(get('year'), get('month') - 1, get('day'));
  // Offset of the zone at (approximately) local midnight.
  const offset = zoneOffsetMs(timeZone, new Date(midnightAsUtc));
  const candidate = new Date(midnightAsUtc - offset);
  // Re-check in case the offset changed between UTC midnight and local midnight.
  const offset2 = zoneOffsetMs(timeZone, candidate);
  return offset2 === offset ? candidate : new Date(midnightAsUtc - offset2);
}

function zoneOffsetMs(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}
