'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { AntiCheatEvents } from '@/components/anticheat-events';
import { AntiCheatRules } from '@/components/anticheat-rules';
import { PageHeader } from '@/components/app-shell';
import { useLiveRefresh } from '@/components/realtime-provider';
import { Badge, Card, CardContent, Select, Skeleton } from '@/components/ui/primitives';
import { Switch } from '@/components/ui/switch';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

interface Summary {
  since: string;
  events: number;
  punished: number;
  topCheatTypes: { cheatType: string; count: number }[];
  providers: string[];
}

export default function AntiCheatPage() {
  const t = useTranslations('anticheat');
  const format = useFormatter();
  const [tab, setTab] = useState<'events' | 'rules'>('events');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [provider, setProvider] = useState('');
  const [punishedOnly, setPunishedOnly] = useState(false);

  const load = useCallback(async () => {
    setSummary(await api<Summary>('/anticheat/summary').catch(() => null));
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useLiveRefresh(['anticheat.event'], load);

  const query = new URLSearchParams({ ...(provider ? { provider } : {}), ...(punishedOnly ? { punished: 'true' } : {}) }).toString();

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      {!summary ? (
        <Skeleton className="mb-6 h-24" />
      ) : (
        <div className="mb-6 grid gap-4 md:grid-cols-3">
          <Card className="p-4">
            <div className="text-sm text-muted-foreground">{t('eventsToday')}</div>
            <div className="mt-2 text-3xl font-semibold tabular-nums">{format.number(summary.events)}</div>
          </Card>
          <Card className="p-4">
            <div className="text-sm text-muted-foreground">{t('punishedToday')}</div>
            <div className="mt-2 text-3xl font-semibold tabular-nums">{format.number(summary.punished)}</div>
          </Card>
          <Card className="p-4">
            <div className="text-sm text-muted-foreground">{t('topTypes')}</div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {summary.topCheatTypes.length === 0 ? (
                <span className="text-sm text-muted-foreground">–</span>
              ) : (
                summary.topCheatTypes.map((c) => (
                  <Badge key={c.cheatType} variant="outline">
                    {c.cheatType} · {c.count}
                  </Badge>
                ))
              )}
            </div>
          </Card>
        </div>
      )}

      <nav className="mb-4 flex gap-1 border-b">
        {(['events', 'rules'] as const).map((key) => (
          <button
            key={key}
            type="button"
            aria-current={tab === key ? 'page' : undefined}
            onClick={() => setTab(key)}
            className={cn('-mb-px border-b-2 px-3 py-2 text-sm text-muted-foreground hover:text-foreground', tab === key ? 'border-primary font-medium text-foreground' : 'border-transparent')}
          >
            {t(`tabs.${key}`)}
          </button>
        ))}
      </nav>

      {tab === 'events' ? (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-4">
            <Select aria-label={t('provider')} className="w-52" value={provider} onChange={(e) => setProvider(e.target.value)}>
              <option value="">{t('allProviders')}</option>
              {summary?.providers.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Select>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={punishedOnly} onCheckedChange={setPunishedOnly} aria-label={t('onlyPunished')} />
              {t('onlyPunished')}
            </label>
          </div>
          <Card>
            <CardContent className="px-0 py-0">
              <AntiCheatEvents endpoint="/anticheat/events" query={query} showPlayer />
            </CardContent>
          </Card>
        </>
      ) : (
        <AntiCheatRules />
      )}
    </>
  );
}
