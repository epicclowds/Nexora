'use client';

import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '@/lib/api';
import { useDuration } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Skeleton } from './ui/primitives';

interface ActivityReport {
  timezone: string;
  daily: { date: string; seconds: number }[];
  heatmap: number[][];
  totalSeconds: number;
  sessions: number;
  averageSessionSeconds: number | null;
}

const RANGES = [7, 30, 90] as const;

/** Locale-correct short weekday names, Monday first (2024-01-01 was a Monday). */
function useWeekdays() {
  const locale = useLocale();
  return useMemo(() => Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, 1 + i)))), [locale]);
}

export function PlayerActivity({ uuid }: { uuid: string }) {
  const t = useTranslations();
  const format = useFormatter();
  const duration = useDuration();
  const weekdays = useWeekdays();
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  const [data, setData] = useState<ActivityReport | null>(null);

  useEffect(() => {
    setData(null);
    void api<ActivityReport>(`/players/${uuid}/activity?days=${days}`).then(setData).catch(() => undefined);
  }, [uuid, days]);

  const chart = useMemo(
    () => (data?.daily ?? []).map((d) => ({ label: format.dateTime(new Date(`${d.date}T12:00:00Z`), { month: 'short', day: 'numeric', timeZone: 'UTC' }), hours: Math.round((d.seconds / 3600) * 10) / 10, seconds: d.seconds })),
    [data, format],
  );
  const maxCell = Math.max(1, ...(data?.heatmap.flat() ?? [0]));

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="radiogroup" className="inline-flex rounded-md border p-0.5">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={days === r}
              onClick={() => setDays(r)}
              className={cn('rounded px-3 py-1 text-sm text-muted-foreground', days === r && 'bg-accent text-accent-foreground')}
            >
              {t('activity.range', { days: r })}
            </button>
          ))}
        </div>
        {data && <p className="text-xs text-muted-foreground">{t('activity.timezone', { timezone: data.timezone })}</p>}
      </div>

      {!data ? (
        <Skeleton className="h-72" />
      ) : (
        <>
          <dl className="grid gap-3 sm:grid-cols-3">
            {[
              [t('activity.total'), duration(data.totalSeconds)],
              [t('activity.sessions'), format.number(data.sessions)],
              [t('activity.average'), data.averageSessionSeconds === null ? '–' : duration(data.averageSessionSeconds)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border px-4 py-3">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="mt-1 text-xl font-semibold tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>

          <Card>
            <CardHeader>
              <CardTitle>{t('activity.dailyPlaytime')}</CardTitle>
              {data.sessions === 0 && <CardDescription>{t('activity.noData')}</CardDescription>}
            </CardHeader>
            <CardContent className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chart} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="label" tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={16} />
                  <YAxis tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip
                    cursor={{ fill: 'var(--accent)' }}
                    contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--foreground)' }}
                    formatter={(_value, _name, item) => [duration((item.payload as { seconds: number }).seconds), t('players.playtime')]}
                  />
                  <Bar dataKey="hours" fill="var(--primary)" radius={[3, 3, 0, 0]} maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('activity.heatmap')}</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="border-separate border-spacing-0.5 text-[10px] text-muted-foreground">
                <thead>
                  <tr>
                    <th />
                    {Array.from({ length: 24 }, (_, h) => (
                      <th key={h} className="w-5 font-normal">
                        {h % 3 === 0 ? h : ''}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.heatmap.map((row, d) => (
                    <tr key={d}>
                      <th scope="row" className="pr-2 text-right font-normal">
                        {weekdays[d]}
                      </th>
                      {row.map((seconds, h) => (
                        <td
                          key={h}
                          title={`${weekdays[d]} ${String(h).padStart(2, '0')}:00 · ${duration(seconds)}`}
                          className="size-5 rounded-sm"
                          style={{ background: seconds ? `color-mix(in oklch, var(--primary) ${Math.round(15 + (seconds / maxCell) * 85)}%, transparent)` : 'var(--muted)' }}
                        />
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
