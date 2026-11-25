'use client';

import { Radio, Search } from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { useDuration } from '@/lib/format';
import { api, errorKey, type Page, type PlayerListItem } from '@/lib/api';
import { PageHeader } from './app-shell';
import { PlayerHead } from './player-skin';
import { RankBadge } from './rank-badge';
import { useLiveRefresh } from './realtime-provider';
import { Alert, Badge, Button, Card, Input, Select, Skeleton, StatusDot } from './ui/primitives';
import { TBody, TD, TH, THead, TR, Table } from './ui/table';

const PAGE_SIZE = 25;
type Sort = 'lastSeen' | 'firstSeen' | 'username' | 'playtime';

/** Player search and listing. `onlineOnly` turns it into the live "Online Players" view. */
export function PlayerList({ onlineOnly }: { onlineOnly: boolean }) {
  const t = useTranslations();
  const format = useFormatter();
  const now = useNow({ updateInterval: 30_000 });
  const duration = useDuration();
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<Sort>(onlineOnly ? 'username' : 'lastSeen');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<PlayerListItem> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), sort });
    if (search) params.set('search', search);
    if (onlineOnly) params.set('online', 'true');
    try {
      setData(await api<Page<PlayerListItem>>(`/players?${params}`));
      setError(null);
    } catch (err) {
      setError(t(`errors.${errorKey(err)}`));
    }
  }, [page, sort, search, onlineOnly, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const id = setTimeout(() => {
      setPage(1);
      setSearch(query.trim());
    }, 300);
    return () => clearTimeout(id);
  }, [query]);

  const live = useLiveRefresh(['player.online', 'player.offline', 'player.updated'], load, onlineOnly ? 30_000 : 120_000);
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <>
      <PageHeader
        title={onlineOnly ? t('players.onlineTitle') : t('players.title')}
        subtitle={onlineOnly ? t('players.onlineSubtitle') : t('players.subtitle')}
        actions={
          <div className="flex items-center gap-2">
            {data && <Badge variant="muted">{t('players.count', { count: data.total })}</Badge>}
            {live && (
              <Badge>
                <Radio className="size-3" aria-hidden /> {t('players.live')}
              </Badge>
            )}
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap gap-3">
        <label className="relative min-w-64 flex-1">
          <span className="sr-only">{t('players.search')}</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input className="pl-9" placeholder={t('players.search')} value={query} onChange={(e) => setQuery(e.target.value)} maxLength={36} />
        </label>
        <Select aria-label={t('players.sort')} className="w-48" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
          <option value="lastSeen">{t('players.sortLastSeen')}</option>
          <option value="firstSeen">{t('players.sortFirstSeen')}</option>
          <option value="username">{t('players.sortUsername')}</option>
          <option value="playtime">{t('players.sortPlaytime')}</option>
        </Select>
      </div>

      {error && <Alert variant="destructive" className="mb-4">{error}</Alert>}

      <Card>
        {!data ? (
          <div className="grid gap-2 p-5">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : data.items.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">{onlineOnly && !search ? t('players.emptyOnline') : t('players.empty')}</p>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>{t('players.player')}</TH>
                <TH>{t('players.server')}</TH>
                <TH>{t('players.lastSeen')}</TH>
                <TH className="hidden md:table-cell">{t('players.firstSeen')}</TH>
                <TH className="text-right">{t('players.playtime')}</TH>
              </TR>
            </THead>
            <TBody>
              {data.items.map((p) => (
                <TR key={p.uuid}>
                  <TD>
                    <Link href={`/players/${p.uuid}`} className="flex items-center gap-3 hover:underline">
                      <PlayerHead uuid={p.uuid} username={p.username} />
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{p.username}</span>
                          <RankBadge rank={p.minecraftRank} />
                        </span>
                        <span className="block truncate font-mono text-xs text-muted-foreground">{p.uuid}</span>
                      </span>
                    </Link>
                  </TD>
                  <TD>
                    <span className="flex items-center gap-2 whitespace-nowrap">
                      <StatusDot state={p.online ? 'up' : 'down'} />
                      {p.online ? (p.currentServer?.name ?? t('common.online')) : t('common.offline')}
                    </span>
                  </TD>
                  <TD className="text-muted-foreground">{p.online ? t('common.online') : format.relativeTime(new Date(p.lastSeenAt), now)}</TD>
                  <TD className="hidden text-muted-foreground md:table-cell">{format.dateTime(new Date(p.firstSeenAt), { dateStyle: 'medium' })}</TD>
                  <TD className="text-right tabular-nums">{duration(p.totalPlaytimeSeconds)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      {data && pages > 1 && (
        <div className="mt-4 flex items-center justify-end gap-3 text-sm">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            {t('common.previous')}
          </Button>
          <span className="text-muted-foreground">{t('common.page', { page, pages })}</span>
          <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>
            {t('common.next')}
          </Button>
        </div>
      )}
    </>
  );
}
