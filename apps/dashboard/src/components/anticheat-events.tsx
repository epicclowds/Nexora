'use client';

import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { api, type Page } from '@/lib/api';
import { useLiveRefresh } from './realtime-provider';
import { Badge, Button, Skeleton } from './ui/primitives';
import { TBody, TD, TH, THead, TR, Table } from './ui/table';

export interface AntiCheatEvent {
  id: string;
  player: { uuid: string; username: string; online: boolean };
  server: { id: string; name: string } | null;
  provider: string;
  cheatType: string;
  violationLevel: number | null;
  outcome: string;
  explicit: boolean;
  reason: string | null;
  punishmentId: string | null;
  createdAt: string;
}

const OUTCOMES = ['WARNING', 'KICK', 'TEMP_BAN', 'BAN', 'LOGGED', 'DISABLED', 'SKIPPED_THRESHOLD', 'SKIPPED_COOLDOWN', 'SKIPPED_RATE_LIMIT', 'SKIPPED_DUPLICATE', 'SKIPPED_OFFLINE'] as const;
type Outcome = (typeof OUTCOMES)[number];

function outcomeVariant(outcome: string) {
  if (outcome === 'BAN' || outcome === 'TEMP_BAN') return 'danger' as const;
  if (outcome === 'KICK' || outcome === 'WARNING') return 'warning' as const;
  return 'muted' as const;
}

/** Paginated AntiCheat events. `query` adds filters (e.g. "provider=Grim&punished=true"). */
export function AntiCheatEvents({ endpoint, query = '', showPlayer }: { endpoint: string; query?: string; showPlayer: boolean }) {
  const t = useTranslations('anticheat');
  const tc = useTranslations('common');
  const format = useFormatter();
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<AntiCheatEvent> | null>(null);
  const PAGE_SIZE = 25;

  const load = useCallback(async () => {
    setData(await api<Page<AntiCheatEvent>>(`${endpoint}?page=${page}&pageSize=${PAGE_SIZE}${query ? `&${query}` : ''}`).catch(() => null));
  }, [endpoint, page, query]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => setPage(1), [query]);
  useLiveRefresh(['anticheat.event'], load);

  if (!data) return <Skeleton className="m-5 h-32" />;
  if (data.items.length === 0) return <p className="p-6 text-center text-sm text-muted-foreground">{t('empty')}</p>;
  const pages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));

  return (
    <>
      <Table>
        <THead>
          <TR>
            <TH>{t('time')}</TH>
            {showPlayer && <TH>{t('player')}</TH>}
            <TH>{t('provider')}</TH>
            <TH>{t('cheatType')}</TH>
            <TH className="text-right">{t('violationLevel')}</TH>
            <TH>{t('outcome')}</TH>
          </TR>
        </THead>
        <TBody>
          {data.items.map((e) => (
            <TR key={e.id}>
              <TD className="whitespace-nowrap text-muted-foreground">{format.dateTime(new Date(e.createdAt), { dateStyle: 'medium', timeStyle: 'medium' })}</TD>
              {showPlayer && (
                <TD>
                  <Link href={`/players/${e.player.uuid}?tab=moderation`} className="font-medium hover:underline">
                    {e.player.username}
                  </Link>
                </TD>
              )}
              <TD className="whitespace-nowrap">
                {e.provider}
                {e.server && <span className="block text-xs text-muted-foreground">{e.server.name}</span>}
              </TD>
              <TD className="min-w-40">
                <span className="font-medium">{e.cheatType}</span>
                {e.reason && <span className="block text-xs text-muted-foreground">{e.reason}</span>}
              </TD>
              <TD className="text-right tabular-nums">{e.violationLevel === null ? '–' : format.number(e.violationLevel, { maximumFractionDigits: 1 })}</TD>
              <TD className="whitespace-nowrap">
                <Badge variant={outcomeVariant(e.outcome)}>{OUTCOMES.includes(e.outcome as Outcome) ? t(`outcomes.${e.outcome as Outcome}`) : e.outcome}</Badge>
                {e.explicit && <span className="ml-2 text-xs text-muted-foreground">{t('explicit')}</span>}
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
      {pages > 1 && (
        <div className="flex items-center justify-end gap-3 p-4 text-sm">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            {tc('previous')}
          </Button>
          <span className="text-muted-foreground">{tc('page', { page, pages })}</span>
          <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>
            {tc('next')}
          </Button>
        </div>
      )}
    </>
  );
}
