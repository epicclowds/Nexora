'use client';

import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { api, type Page } from '@/lib/api';
import { useDuration } from '@/lib/format';
import { PlayerHead } from './player-skin';
import { Alert, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Skeleton, StatusDot } from './ui/primitives';
import { TBody, TD, TH, THead, TR, Table } from './ui/table';

interface Location {
  countryCode: string | null;
  region: string | null;
  city: string | null;
  isp: string | null;
  asn: number | null;
}

interface ConnectionsResponse extends Page<{
  id: string;
  connectedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  proxy: string | null;
  clientProtocol: number | null;
  clientBrand: string | null;
  ipAddress?: string | null;
  virtualHost?: string | null;
  location?: Location;
}> {
  canViewIp: boolean;
  canViewLocation: boolean;
  geoipEnabled: boolean;
  ipSummary?: { ipAddress: string; connections: number; firstSeenAt: string; lastSeenAt: string; location?: Location }[];
  relatedAccounts?: { uuid: string; username: string; online: boolean; connections: number; lastSeenAt: string }[];
}

const PAGE_SIZE = 20;

/** Localized country name from an ISO code, e.g. "DE" → "Germany" / "Deutschland". */
function countryNameFor(code: string | null, locale: string): string | null {
  if (!code) return null;
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

function describe(loc: Location | undefined, countryName: (code: string | null) => string | null): string {
  if (!loc) return '–';
  return [loc.city, loc.region, countryName(loc.countryCode)].filter(Boolean).join(', ') || '–';
}

export function PlayerConnections({ uuid, locale }: { uuid: string; locale: string }) {
  const t = useTranslations();
  const format = useFormatter();
  const duration = useDuration();
  const countryName = (code: string | null) => countryNameFor(code, locale);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ConnectionsResponse | null>(null);

  useEffect(() => {
    void api<ConnectionsResponse>(`/players/${uuid}/connections?page=${page}&pageSize=${PAGE_SIZE}`).then(setData).catch(() => undefined);
  }, [uuid, page]);

  if (!data) return <Skeleton className="h-64" />;
  const pages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <div className="grid gap-6 [&>*]:min-w-0">
      {!data.canViewIp && <Alert>{t('connections.ipPermission')}</Alert>}
      {data.canViewIp && !data.canViewLocation && <Alert>{t('connections.locationPermission')}</Alert>}
      {data.canViewLocation && !data.geoipEnabled && <Alert>{t('connections.geoipDisabled')}</Alert>}

      {data.ipSummary && (
        <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
          <Card>
            <CardHeader>
              <CardTitle>{t('connections.ipAddresses')}</CardTitle>
              {data.canViewLocation && <CardDescription>{t('connections.approximate')}</CardDescription>}
            </CardHeader>
            <CardContent className="px-0">
              <Table>
                <THead>
                  <TR>
                    <TH>IP</TH>
                    {data.canViewLocation && <TH>{t('connections.location')}</TH>}
                    <TH className="text-right">{t('players.connections')}</TH>
                    <TH>{t('players.lastSeen')}</TH>
                  </TR>
                </THead>
                <TBody>
                  {data.ipSummary.map((ip) => (
                    <TR key={ip.ipAddress}>
                      <TD className="font-mono text-xs">{ip.ipAddress}</TD>
                      {data.canViewLocation && (
                        <TD className="text-xs">
                          {describe(ip.location, countryName)}
                          {ip.location?.isp && <span className="block text-muted-foreground">{ip.location.isp}</span>}
                        </TD>
                      )}
                      <TD className="text-right tabular-nums">{ip.connections}</TD>
                      <TD className="whitespace-nowrap text-muted-foreground">{date(ip.lastSeenAt)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('connections.relatedAccounts')}</CardTitle>
              <CardDescription>{t('connections.relatedHint')}</CardDescription>
            </CardHeader>
            <CardContent>
              {!data.relatedAccounts?.length ? (
                <p className="text-sm text-muted-foreground">{t('connections.noRelated')}</p>
              ) : (
                <ul className="grid gap-2">
                  {data.relatedAccounts.map((a) => (
                    <li key={a.uuid}>
                      <Link href={`/players/${a.uuid}`} className="flex items-center gap-3 rounded-md border px-3 py-2 hover:bg-accent">
                        <PlayerHead uuid={a.uuid} username={a.username} size={28} />
                        <span className="flex-1 font-medium">{a.username}</span>
                        <StatusDot state={a.online ? 'up' : 'down'} />
                        <span className="text-xs text-muted-foreground">{t('connections.count', { count: a.connections })}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t('connections.history')}</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <THead>
              <TR>
                <TH>{t('connections.connected')}</TH>
                <TH>{t('profile.duration')}</TH>
                <TH>{t('profile.proxy')}</TH>
                <TH>{t('connections.client')}</TH>
                {data.canViewIp && <TH>IP</TH>}
                {data.canViewIp && <TH>{t('connections.joinedVia')}</TH>}
                {data.canViewLocation && <TH>{t('connections.location')}</TH>}
              </TR>
            </THead>
            <TBody>
              {data.items.map((c) => (
                <TR key={c.id}>
                  <TD className="whitespace-nowrap">{date(c.connectedAt)}</TD>
                  <TD className="whitespace-nowrap tabular-nums">{c.endedAt ? duration(c.durationSeconds ?? 0) : t('profile.ongoing')}</TD>
                  <TD>{c.proxy ?? '–'}</TD>
                  <TD className="whitespace-nowrap text-xs">
                    {c.clientBrand ?? '–'}
                    {c.clientProtocol !== null && <span className="block text-muted-foreground">protocol {c.clientProtocol}</span>}
                  </TD>
                  {data.canViewIp && <TD className="font-mono text-xs">{c.ipAddress ?? <span className="text-muted-foreground">{t('connections.anonymised')}</span>}</TD>}
                  {data.canViewIp && <TD className="text-xs">{c.virtualHost ?? '–'}</TD>}
                  {data.canViewLocation && <TD className="text-xs">{describe(c.location, countryName)}</TD>}
                </TR>
              ))}
            </TBody>
          </Table>
          {pages > 1 && (
            <div className="mt-4 flex items-center justify-end gap-3 px-5 text-sm">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                {t('common.previous')}
              </Button>
              <span className="text-muted-foreground">{t('common.page', { page, pages })}</span>
              <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                {t('common.next')}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
