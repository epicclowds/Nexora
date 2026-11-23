'use client';

import { STATS, type StatCategory, type StatKey } from '@mnm/shared-types';
import { useFormatter, useTranslations } from 'next-intl';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '@/lib/api';
import { prettyId, STAT_NAME, STATS_BY_CATEGORY, useStatFormatter } from '@/lib/stats';
import { cn } from '@/lib/utils';
import { Alert, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Select, Skeleton } from './ui/primitives';

interface PlayerStats {
  range: { from: string | null; to: string };
  collected: boolean;
  coverageStart: string | null;
  partial: boolean;
  values: Partial<Record<StatKey, number>>;
  topMined: { id: string; value: number }[];
  topPlaced: { id: string; value: number }[];
  topKilled: { id: string; value: number }[];
  ores: { id: string; value: number }[];
}

interface Series {
  timezone: string;
  days: string[];
  series: Record<string, number[]>;
}

type Range = '24h' | '7d' | '30d' | 'all' | 'custom';
const RANGE_LABEL = { '24h': 'h24', '7d': 'd7', '30d': 'd30', all: 'all', custom: 'custom' } as const;
const CATEGORIES: StatCategory[] = ['movement', 'combat', 'blocks', 'general'];
const CHART_KEYS: StatKey[] = [STATS.BLOCKS_MINED, STATS.BLOCKS_PLACED, STATS.MOB_KILLS, STATS.DEATHS, STATS.WALK, STATS.ACTIVE_TIME];

function TopList({ title, items, empty }: { title: string; items: { id: string; value: number }[]; empty: string }) {
  const format = useFormatter();
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{empty}</p>
        ) : (
          <ul className="grid gap-2">
            {items.map((i) => (
              <li key={i.id} className="grid gap-1 text-sm">
                <div className="flex justify-between gap-2">
                  <span className="truncate">{prettyId(i.id)}</span>
                  <span className="tabular-nums text-muted-foreground">{format.number(i.value)}</span>
                </div>
                <div className="h-1.5 rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${(i.value / max) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function PlayerStatistics({ uuid }: { uuid: string }) {
  const t = useTranslations('stats');
  const format = useFormatter();
  const formatStat = useStatFormatter();
  const [range, setRange] = useState<Range>('all');
  const [custom, setCustom] = useState({ from: '', to: '' });
  const [query, setQuery] = useState('range=all');
  const [data, setData] = useState<PlayerStats | null>(null);
  const [chartKey, setChartKey] = useState<StatKey>(STATS.BLOCKS_MINED);
  const [series, setSeries] = useState<Series | null>(null);

  useEffect(() => {
    setData(null);
    void api<PlayerStats>(`/players/${uuid}/statistics?${query}`).then(setData).catch(() => undefined);
  }, [uuid, query]);

  useEffect(() => {
    void api<Series>(`/players/${uuid}/statistics/series?keys=${encodeURIComponent(CHART_KEYS.join(','))}&days=30`).then(setSeries).catch(() => undefined);
  }, [uuid]);

  function selectRange(next: Range) {
    setRange(next);
    if (next !== 'custom') setQuery(`range=${next}`);
  }

  function applyCustom(e: FormEvent) {
    e.preventDefault();
    if (!custom.from) return;
    const params = new URLSearchParams({ range: 'custom', from: new Date(custom.from).toISOString() });
    if (custom.to) params.set('to', new Date(`${custom.to}T23:59:59`).toISOString());
    setQuery(params.toString());
  }

  const chart = useMemo(() => {
    if (!series) return [];
    const values = series.series[chartKey] ?? [];
    return series.days.map((d, i) => ({ label: format.dateTime(new Date(`${d}T12:00:00Z`), { month: 'short', day: 'numeric', timeZone: 'UTC' }), value: values[i] ?? 0 }));
  }, [series, chartKey, format]);

  const v = data?.values ?? {};
  // K/D: PvP kills per death (only when deaths were recorded).
  const deaths = v[STATS.DEATHS];
  const kd = deaths ? (v[STATS.PLAYER_KILLS] ?? 0) / deaths : null;

  return (
    <div className="grid gap-6 [&>*]:min-w-0">
      <div className="flex flex-wrap items-center gap-3">
        <div role="radiogroup" className="inline-flex rounded-md border p-0.5">
          {(Object.keys(RANGE_LABEL) as Range[]).map((r) => (
            <button key={r} type="button" role="radio" aria-checked={range === r} onClick={() => selectRange(r)} className={cn('rounded px-3 py-1 text-sm text-muted-foreground', range === r && 'bg-accent text-accent-foreground')}>
              {t(`ranges.${RANGE_LABEL[r]}`)}
            </button>
          ))}
        </div>
        {range === 'custom' && (
          <form onSubmit={applyCustom} className="flex flex-wrap items-center gap-2">
            <Input type="date" aria-label={t('from')} className="w-40" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} required />
            <Input type="date" aria-label={t('to')} className="w-40" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} />
            <Button type="submit" size="sm" variant="outline">
              {t('apply')}
            </Button>
          </form>
        )}
      </div>

      {!data ? (
        <Skeleton className="h-64" />
      ) : !data.collected ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">{t('noData')}</div>
      ) : (
        <>
          {data.partial && data.coverageStart && <Alert>{t('partial', { date: format.dateTime(new Date(data.coverageStart), { dateStyle: 'medium', timeStyle: 'short' }) })}</Alert>}

          <div className="grid gap-4 md:grid-cols-2 [&>*]:min-w-0">
            {CATEGORIES.map((category) => {
              const keys = STATS_BY_CATEGORY[category].filter((k) => v[k] !== undefined);
              return (
                <Card key={category}>
                  <CardHeader>
                    <CardTitle className="text-base">{t(`categories.${category}`)}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {keys.length === 0 ? (
                      <p className="text-sm text-muted-foreground">{t('emptyList')}</p>
                    ) : (
                      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                        {keys.map((k) => (
                          <div key={k}>
                            <dt className="text-xs text-muted-foreground">{t(`labels.${STAT_NAME[k]}`)}</dt>
                            <dd className="font-medium tabular-nums">{formatStat(k, v[k] ?? 0)}</dd>
                          </div>
                        ))}
                        {category === 'combat' && kd !== null && (
                          <div>
                            <dt className="text-xs text-muted-foreground">{t('kd')}</dt>
                            <dd className="font-medium tabular-nums">{format.number(kd, { maximumFractionDigits: 2 })}</dd>
                          </div>
                        )}
                      </dl>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <Card>
            <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>{t('daily')}</CardTitle>
                {series && <CardDescription>{series.timezone}</CardDescription>}
              </div>
              <Select aria-label={t('daily')} className="w-56" value={chartKey} onChange={(e) => setChartKey(e.target.value as StatKey)}>
                {CHART_KEYS.map((k) => (
                  <option key={k} value={k}>
                    {t(`labels.${STAT_NAME[k]}`)}
                  </option>
                ))}
              </Select>
            </CardHeader>
            <CardContent className="h-60">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chart} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="label" tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={16} />
                  <YAxis tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} tickFormatter={(n: number) => format.number(n, { notation: 'compact' })} />
                  <Tooltip
                    cursor={{ fill: 'var(--accent)' }}
                    contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--foreground)' }}
                    formatter={(value) => [formatStat(chartKey, Number(value)), t(`labels.${STAT_NAME[chartKey]}`)]}
                  />
                  <Bar dataKey="value" fill="var(--primary)" radius={[3, 3, 0, 0]} maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <div>
            <p className="mb-3 text-xs uppercase tracking-wide text-muted-foreground">{t('allTimeOnly')}</p>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4 [&>*]:min-w-0">
              <TopList title={t('ores')} items={data.ores} empty={t('emptyList')} />
              <TopList title={t('topMined')} items={data.topMined} empty={t('emptyList')} />
              <TopList title={t('topPlaced')} items={data.topPlaced} empty={t('emptyList')} />
              <TopList title={t('topKilled')} items={data.topKilled} empty={t('emptyList')} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
