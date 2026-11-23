'use client';

import { Ban, Gamepad2, LogIn, MicOff, ShieldAlert, Trophy, UserPlus, Users } from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '@/components/app-shell';
import { ServerCard } from '@/components/server-card';
import { Alert, Button, buttonVariants, Card, CardContent, CardHeader, CardTitle, Skeleton } from '@/components/ui/primitives';
import { api, type DashboardSummary, errorKey } from '@/lib/api';

const REFRESH_MS = 15_000;

function Stat({ label, value, icon: Icon, hint }: { label: string; value: string; icon: typeof Users; hint?: string }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        {label}
        <Icon className="size-4" aria-hidden />
      </div>
      <div className="mt-2 text-3xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </Card>
  );
}

export default function DashboardPage() {
  const t = useTranslations();
  const format = useFormatter();
  const now = useNow({ updateInterval: 30_000 });
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<DashboardSummary>('/dashboard/summary'));
      setError(null);
    } catch (err) {
      setError(t(`errors.${errorKey(err)}`));
    }
  }, [t]);

  useEffect(() => {
    void load();
    // Polling until the WebSocket gateway lands (Phase 2).
    const id = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  const n = (v: number) => format.number(v);

  return (
    <>
      <PageHeader title={t('dashboard.title')} subtitle={t('dashboard.subtitle')} />
      {error && (
        <Alert variant="destructive" className="mb-4 flex items-center justify-between">
          {error}
          <Button size="sm" variant="outline" onClick={() => void load()}>
            {t('common.retry')}
          </Button>
        </Alert>
      )}

      {!data ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label={t('dashboard.onlinePlayers')} value={n(data.onlinePlayers)} icon={Gamepad2} />
            <Stat label={t('dashboard.totalPlayers')} value={n(data.totalPlayers)} icon={Users} />
            <Stat label={t('dashboard.newPlayersToday')} value={n(data.newPlayersToday)} icon={UserPlus} />
            <Stat label={t('dashboard.connectionsToday')} value={n(data.connectionsToday)} icon={LogIn} />
            <Stat
              label={t('dashboard.playerRecord')}
              value={data.playerRecord ? n(data.playerRecord.count) : '–'}
              hint={data.playerRecord ? format.dateTime(new Date(data.playerRecord.at), { dateStyle: 'medium', timeStyle: 'short' }) : t('dashboard.notRecorded')}
              icon={Trophy}
            />
            <Stat label={t('dashboard.activeBans')} value={n(data.activeBans)} icon={Ban} />
            <Stat label={t('dashboard.activeMutes')} value={n(data.activeMutes)} icon={MicOff} />
            <Stat label={t('dashboard.anticheatToday')} value={n(data.anticheatToday)} icon={ShieldAlert} />
          </div>

          <div className="mt-6 grid gap-6 xl:grid-cols-3">
            {data.servers && (
              <Card className="xl:col-span-2">
                <CardHeader>
                  <CardTitle>{t('dashboard.servers')}</CardTitle>
                </CardHeader>
                <CardContent>
                  {data.servers.length === 0 ? (
                    <div className="rounded-lg border border-dashed p-8 text-center">
                      <p className="font-medium">{t('dashboard.serversEmpty')}</p>
                      <p className="mt-1 text-sm text-muted-foreground">{t('dashboard.serversEmptyHint')}</p>
                      <Link href="/settings" className={buttonVariants({ variant: 'outline', className: 'mt-4' })}>
                        {t('nav.settings')}
                      </Link>
                    </div>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {data.servers.map((s) => (
                        <ServerCard key={s.id} server={s} />
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
            {data.recentActivity && (
              <Card>
                <CardHeader>
                  <CardTitle>{t('dashboard.recentActivity')}</CardTitle>
                </CardHeader>
                <CardContent>
                  {data.recentActivity.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t('dashboard.recentActivityEmpty')}</p>
                  ) : (
                    <ul className="grid gap-3">
                      {data.recentActivity.map((a) => (
                        <li key={a.id} className="flex items-start justify-between gap-3 text-sm">
                          <div className="min-w-0">
                            <div className="truncate font-mono text-xs">{a.action}</div>
                            <div className="truncate text-xs text-muted-foreground">{a.actorName}</div>
                          </div>
                          <time className="shrink-0 text-xs text-muted-foreground" dateTime={a.createdAt}>
                            {format.relativeTime(new Date(a.createdAt), now)}
                          </time>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </>
      )}
    </>
  );
}
