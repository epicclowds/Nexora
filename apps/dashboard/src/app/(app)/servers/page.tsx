'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '@/components/app-shell';
import { useLiveRefresh } from '@/components/realtime-provider';
import { ServerCard } from '@/components/server-card';
import { Alert, buttonVariants, Skeleton } from '@/components/ui/primitives';
import { api, errorKey, type ServerInfo } from '@/lib/api';

export default function ServersPage() {
  const t = useTranslations();
  const [servers, setServers] = useState<ServerInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setServers(await api<ServerInfo[]>('/servers'));
      setError(null);
    } catch (err) {
      setError(t(`errors.${errorKey(err)}`));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);
  useLiveRefresh(['server.updated', 'server.removed', 'player.online', 'player.offline'], load);

  return (
    <>
      <PageHeader title={t('servers.title')} subtitle={t('servers.subtitle')} />
      {error && <Alert variant="destructive">{error}</Alert>}
      {!servers && !error && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      )}
      {servers && servers.length === 0 && (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <p className="font-medium">{t('dashboard.serversEmpty')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('dashboard.serversEmptyHint')}</p>
          <Link href="/settings" className={buttonVariants({ variant: 'outline', className: 'mt-4' })}>
            {t('nav.settings')}
          </Link>
        </div>
      )}
      {servers && servers.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {servers.map((s) => (
            <ServerCard key={s.id} server={s} href={`/servers/${s.id}`} />
          ))}
        </div>
      )}
    </>
  );
}
