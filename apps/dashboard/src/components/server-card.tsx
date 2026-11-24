'use client';

import Link from 'next/link';
import { useFormatter, useNow, useLocale, useTranslations } from 'next-intl';
import type { ServerInfo } from '@/lib/api';
import { formatBytes } from '@/lib/utils';
import { PluginVersionBadge } from './plugin-version';
import { Badge, Card, StatusDot } from './ui/primitives';

export function ServerCard({ server, href }: { server: ServerInfo; href?: string }) {
  const t = useTranslations();
  const format = useFormatter();
  const now = useNow({ updateInterval: 30_000 });
  const locale = useLocale();
  const state = server.status === 'ONLINE' ? 'up' : server.status === 'PENDING' ? 'pending' : 'down';
  const memory =
    server.memoryUsedBytes && server.memoryMaxBytes ? `${formatBytes(server.memoryUsedBytes, locale)} / ${formatBytes(server.memoryMaxBytes, locale)}` : null;

  // Only render metrics that were actually reported; never show placeholders as data.
  const metrics: [string, string][] = [];
  if (server.tps !== null) metrics.push(['TPS', format.number(server.tps, { maximumFractionDigits: 1 })]);
  if (server.mspt !== null) metrics.push(['MSPT', format.number(server.mspt, { maximumFractionDigits: 1 })]);
  if (memory) metrics.push(['RAM', memory]);
  if (server.cpuLoad !== null) metrics.push(['CPU', format.number(server.cpuLoad, { style: 'percent', maximumFractionDigits: 0 })]);

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <StatusDot state={state} />
            {href ? (
              <Link href={href} className="truncate font-medium hover:underline">
                {server.name}
              </Link>
            ) : (
              <span className="truncate font-medium">{server.name}</span>
            )}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {[server.minecraftVersion, server.pluginVersion && t('dashboard.pluginVersion', { version: server.pluginVersion })].filter(Boolean).join(' · ') || t('common.unknown')}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge variant={server.type === 'VELOCITY' ? 'info' : 'default'}>{server.type === 'VELOCITY' ? 'Velocity' : 'Paper'}</Badge>
          <span className="text-xs text-muted-foreground">{t(`servers.status.${server.status}`)}</span>
          <PluginVersionBadge pluginVersion={server.pluginVersion} />
        </div>
      </div>
      <div className="mt-3 text-sm">{server.onlinePlayers !== null ? t('dashboard.serverPlayers', { count: server.onlinePlayers }) : t('dashboard.notRecorded')}</div>
      {metrics.length > 0 && (
        <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
          {metrics.map(([k, v]) => (
            <div key={k} className="rounded-md bg-muted px-2 py-1.5">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="font-medium">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="mt-3 text-xs text-muted-foreground">
        {t('dashboard.lastHeartbeat', { time: server.lastHeartbeatAt ? format.relativeTime(new Date(server.lastHeartbeatAt), now) : t('common.never') })}
      </div>
    </Card>
  );
}
