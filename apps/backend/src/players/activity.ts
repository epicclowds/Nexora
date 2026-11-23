/**
 * Player activity aggregation from recorded sessions, in a given time zone.
 * Only real session time is counted; nothing is interpolated.
 */
export interface SessionSpan {
  startedAt: Date;
  endedAt: Date | null;
}

export interface ActivityReport {
  timezone: string;
  from: string;
  to: string;
  /** One entry per local calendar day in the range (oldest first), seconds played. */
  daily: { date: string; seconds: number }[];
  /** 7 × 24 matrix [weekday 0=Mon … 6=Sun][hour], seconds played. */
  heatmap: number[][];
  totalSeconds: number;
  sessions: number;
  averageSessionSeconds: number | null;
}

const SLICE_MS = 5 * 60_000;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function formatterFor(timeZone: string) {
  return new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short' });
}

/**
 * Splits sessions into 5-minute slices and assigns each slice to its local day
 * and weekday/hour bucket. Accurate to the slice size, also across DST changes.
 */
export function buildActivity(sessions: SessionSpan[], options: { timezone: string; days: number; now?: Date }): ActivityReport {
  const now = options.now ?? new Date();
  const fmt = formatterFor(options.timezone);
  const partsOf = (ms: number) => {
    const parts = fmt.formatToParts(new Date(ms));
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')), weekday: WEEKDAYS.indexOf(get('weekday')) };
  };

  // Local calendar days covering the range, newest = today.
  const dayKeys: string[] = [];
  for (let i = options.days - 1; i >= 0; i--) dayKeys.push(partsOf(now.getTime() - i * 86_400_000).date);
  const uniqueDays = [...new Set(dayKeys)];
  const daily = new Map(uniqueDays.map((d) => [d, 0]));
  const heatmap = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  const fromMs = now.getTime() - options.days * 86_400_000;

  let total = 0;
  let counted = 0;
  let countedSeconds = 0;
  for (const s of sessions) {
    const start = Math.max(s.startedAt.getTime(), fromMs);
    const end = Math.min((s.endedAt ?? now).getTime(), now.getTime());
    if (end <= start) continue;
    counted++;
    countedSeconds += Math.floor(((s.endedAt ?? now).getTime() - s.startedAt.getTime()) / 1000);
    for (let t = start; t < end; t += SLICE_MS) {
      const seconds = Math.min(SLICE_MS, end - t) / 1000;
      const p = partsOf(t);
      if (daily.has(p.date)) daily.set(p.date, (daily.get(p.date) ?? 0) + seconds);
      if (p.weekday >= 0) heatmap[p.weekday][p.hour] += seconds;
      total += seconds;
    }
  }

  return {
    timezone: options.timezone,
    from: new Date(fromMs).toISOString(),
    to: now.toISOString(),
    daily: uniqueDays.map((date) => ({ date, seconds: Math.round(daily.get(date) ?? 0) })),
    heatmap: heatmap.map((row) => row.map((v) => Math.round(v))),
    totalSeconds: Math.round(total),
    sessions: counted,
    averageSessionSeconds: counted ? Math.round(countedSeconds / counted) : null,
  };
}
