'use client';

import { LEADERBOARD_STATS, STATS, type StatKey } from '@mnm/shared-types';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/app-shell';
import { PlayerHead } from '@/components/player-skin';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Select, Skeleton, StatusDot } from '@/components/ui/primitives';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { api } from '@/lib/api';
import { STAT_NAME, useStatFormatter } from '@/lib/stats';

interface Overview {
  trackedPlayers: number;
  coverageStart: string | null;
  totals: Partial<Record<StatKey, number>>;
}

interface LeaderboardEntry {
  rank: number;
  player: { uuid: string; username: string; online: boolean };
  value: number;
}

const HEADLINE: StatKey[] = [STATS.ACTIVE_TIME, STATS.BLOCKS_MINED, STATS.BLOCKS_PLACED, STATS.MOB_KILLS, STATS.PLAYER_KILLS, STATS.DEATHS, STATS.WALK, STATS.CHAT_MESSAGES];

export default function StatisticsPage() {
  const t = useTranslations('stats');
  const format = useFormatter();
  const formatStat = useStatFormatter();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [stat, setStat] = useState<StatKey>(STATS.ACTIVE_TIME);
  const [board, setBoard] = useState<LeaderboardEntry[] | null>(null);

  useEffect(() => {
    void api<Overview>('/statistics/overview').then(setOverview).catch(() => undefined);
  }, []);
  useEffect(() => {
    setBoard(null);
    void api<LeaderboardEntry[]>(`/statistics/leaderboard?stat=${encodeURIComponent(stat)}&limit=25`).then(setBoard).catch(() => setBoard([]));
  }, [stat]);

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      {!overview ? (
        <Skeleton className="h-40" />
      ) : overview.trackedPlayers === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">{t('networkNoData')}</div>
      ) : (
        <div className="grid gap-6 [&>*]:min-w-0">
          <Card>
            <CardHeader>
              <CardTitle>{t('networkTotals')}</CardTitle>
              <CardDescription>
                {t('trackedPlayers')}: {format.number(overview.trackedPlayers)}
                {overview.coverageStart && ` · ${t('collectedSince', { date: format.dateTime(new Date(overview.coverageStart), { dateStyle: 'medium' }) })}`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {HEADLINE.map((k) => (
                  <div key={k} className="rounded-lg border px-4 py-3">
                    <dt className="text-xs text-muted-foreground">{t(`labels.${STAT_NAME[k]}`)}</dt>
                    <dd className="mt-1 text-xl font-semibold tabular-nums">{overview.totals[k] === undefined ? t('notCollected') : formatStat(k, overview.totals[k]!)}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
              <CardTitle>{t('leaderboard')}</CardTitle>
              <Select aria-label={t('leaderboard')} className="w-60" value={stat} onChange={(e) => setStat(e.target.value as StatKey)}>
                {LEADERBOARD_STATS.map((k) => (
                  <option key={k} value={k}>
                    {t(`labels.${STAT_NAME[k]}`)}
                  </option>
                ))}
              </Select>
            </CardHeader>
            <CardContent className="px-0">
              {!board ? (
                <Skeleton className="mx-5 h-40" />
              ) : board.length === 0 ? (
                <p className="px-5 text-sm text-muted-foreground">{t('emptyList')}</p>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH className="w-16">{t('rank')}</TH>
                      <TH>{t('player')}</TH>
                      <TH className="text-right">{t('value')}</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {board.map((e) => (
                      <TR key={e.player.uuid}>
                        <TD className="font-semibold tabular-nums">#{e.rank}</TD>
                        <TD>
                          <Link href={`/players/${e.player.uuid}?tab=statistics`} className="flex items-center gap-3 hover:underline">
                            <PlayerHead uuid={e.player.uuid} username={e.player.username} size={28} />
                            <span className="font-medium">{e.player.username}</span>
                            <StatusDot state={e.player.online ? 'up' : 'down'} />
                          </Link>
                        </TD>
                        <TD className="text-right tabular-nums">{formatStat(stat, e.value)}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
