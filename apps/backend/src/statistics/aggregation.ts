/**
 * Statistic aggregation from hourly snapshots. Statistics are cumulative per
 * server ("scope"); a value lower than its predecessor means the counter was
 * reset (e.g. a new world), so only positive increments are summed.
 */
export interface Snapshot {
  scope: string;
  statKey: string;
  value: bigint;
  capturedAt: Date;
}

export const HOUR_MS = 3_600_000;

export function truncateToHour(date: Date): Date {
  return new Date(Math.floor(date.getTime() / HOUR_MS) * HOUR_MS);
}

/** Groups snapshots by scope+key, each list sorted by time. */
function seriesByScopeAndKey(snapshots: Snapshot[]): Map<string, Snapshot[]> {
  const map = new Map<string, Snapshot[]>();
  for (const s of snapshots) {
    const id = `${s.scope}\u0000${s.statKey}`;
    const list = map.get(id) ?? [];
    list.push(s);
    map.set(id, list);
  }
  for (const list of map.values()) list.sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime());
  return map;
}

/** Increment contributed by `current` relative to `previous` (resets count from zero). */
function increment(previous: bigint | null, current: bigint): bigint {
  if (previous === null) return 0n;
  return current >= previous ? current - previous : current;
}

/**
 * Sum of increments per key inside [from, to]. `snapshots` must include, per
 * scope+key, the last snapshot before `from` (baseline) when one exists.
 * Without a baseline the first snapshot in range only serves as starting point.
 */
export function rangeTotals(snapshots: Snapshot[], from: Date, to: Date): Map<string, bigint> {
  const totals = new Map<string, bigint>();
  for (const list of seriesByScopeAndKey(snapshots).values()) {
    let previous: bigint | null = null;
    for (const s of list) {
      const t = s.capturedAt.getTime();
      if (t > to.getTime()) break;
      if (t >= from.getTime()) totals.set(s.statKey, (totals.get(s.statKey) ?? 0n) + increment(previous, s.value));
      previous = s.value;
    }
  }
  return totals;
}

/** Daily increments per key, bucketed by local calendar day in `timeZone`. */
export function dailySeries(snapshots: Snapshot[], keys: string[], days: string[], timeZone: string): Record<string, number[]> {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const index = new Map(days.map((d, i) => [d, i]));
  const out: Record<string, number[]> = Object.fromEntries(keys.map((k) => [k, days.map(() => 0)]));
  for (const list of seriesByScopeAndKey(snapshots.filter((s) => keys.includes(s.statKey))).values()) {
    let previous: bigint | null = null;
    for (const s of list) {
      // Value at the end of hour H was reached during hour H → attribute to that hour's local day.
      const day = fmt.format(s.capturedAt);
      const i = index.get(day);
      const inc = increment(previous, s.value);
      if (i !== undefined) out[s.statKey][i] += Number(inc);
      previous = s.value;
    }
  }
  return out;
}

/** Sums current values per key across scopes. */
export function sumByKey(rows: { statKey: string; value: bigint }[]): Map<string, bigint> {
  const totals = new Map<string, bigint>();
  for (const r of rows) totals.set(r.statKey, (totals.get(r.statKey) ?? 0n) + r.value);
  return totals;
}
