'use client';

import { ArrowLeft, Check, Copy } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { PERMISSIONS } from '@mnm/shared-types';
import { useAuth } from '@/components/auth-provider';
import { PlayerAvatar } from '@/components/player-avatar';
import { PlayerModeration, PlayerNotes } from '@/components/player-moderation';
import { useLiveRefresh } from '@/components/realtime-provider';
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, Skeleton, StatusDot } from '@/components/ui/primitives';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { api, ApiError, errorKey, type PlayerProfile } from '@/lib/api';
import { useDuration } from '@/lib/format';

const GAMEMODES = ['SURVIVAL', 'CREATIVE', 'ADVENTURE', 'SPECTATOR'] as const;
type Gamemode = (typeof GAMEMODES)[number];

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border px-4 py-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-medium">{children}</dd>
    </div>
  );
}

export default function PlayerProfilePage() {
  const { uuid } = useParams<{ uuid: string }>();
  const t = useTranslations();
  const format = useFormatter();
  const now = useNow({ updateInterval: 30_000 });
  const duration = useDuration();
  const [player, setPlayer] = useState<PlayerProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { can } = useAuth();

  const load = useCallback(async () => {
    try {
      setPlayer(await api<PlayerProfile>(`/players/${encodeURIComponent(uuid)}`));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 404 ? t('profile.notFound') : t(`errors.${errorKey(err)}`));
    }
  }, [uuid, t]);

  useEffect(() => {
    void load();
  }, [load]);
  useLiveRefresh(['player.online', 'player.offline', 'player.updated'], load, 60_000);

  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' });
  const notCollected = <span className="text-muted-foreground">{t('profile.notCollected')}</span>;

  return (
    <>
      <Link href="/players" className="mb-4 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> {t('profile.backToList')}
      </Link>
      {error && <Alert variant="destructive">{error}</Alert>}
      {!player && !error && <Skeleton className="h-64" />}

      {player && (
        <div className="grid min-w-0 gap-6 [&>*]:min-w-0">
          <Card className="overflow-hidden">
            <div className="bg-blocks flex flex-wrap items-center gap-5 p-6">
              <PlayerAvatar uuid={player.uuid} username={player.username} className="size-20 rounded-xl text-4xl" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="text-3xl font-semibold tracking-tight">{player.username}</h1>
                  <Badge variant={player.online ? 'default' : 'muted'}>
                    <StatusDot state={player.online ? 'up' : 'down'} /> {player.online ? t('common.online') : t('common.offline')}
                  </Badge>
                </div>
                <div className="mt-2 flex items-center gap-2 font-mono text-xs text-muted-foreground">
                  {player.uuid}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    title={t('profile.copyUuid')}
                    onClick={() => {
                      void navigator.clipboard.writeText(player.uuid);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    }}
                  >
                    {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                    <span className="sr-only">{t('profile.copyUuid')}</span>
                  </Button>
                </div>
              </div>
            </div>
            <CardContent className="pt-5">
              <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Fact label={t('profile.currentServer')}>{player.online ? (player.currentServer?.name ?? t('common.unknown')) : '–'}</Fact>
                <Fact label={t('players.lastSeen')}>{player.online ? t('common.online') : format.relativeTime(new Date(player.lastSeenAt), now)}</Fact>
                <Fact label={t('players.firstSeen')}>{date(player.firstSeenAt)}</Fact>
                <Fact label={t('players.playtime')}>{duration(player.totalPlaytimeSeconds)}</Fact>
                <Fact label={t('profile.activePlaytime')}>{player.activePlaytimeSeconds === null ? notCollected : duration(player.activePlaytimeSeconds)}</Fact>
                <Fact label={t('profile.afkTime')}>{player.afkSeconds === null ? notCollected : duration(player.afkSeconds)}</Fact>
                <Fact label={t('players.connections')}>{format.number(player.connectionCount)}</Fact>
                <Fact label={t('profile.gamemode')}>
                  {player.gamemode && GAMEMODES.includes(player.gamemode as Gamemode) ? t(`profile.gamemodes.${player.gamemode as Gamemode}`) : (player.gamemode ?? notCollected)}
                </Fact>
                <Fact label={t('profile.clientVersion')}>{player.clientVersion ?? notCollected}</Fact>
                <Fact label={t('profile.clientBrand')}>{player.clientBrand ?? notCollected}</Fact>
              </dl>
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle>{t('profile.nameHistory')}</CardTitle>
              </CardHeader>
              <CardContent>
                <ol className="grid gap-2">
                  {player.names.map((n) => (
                    <li key={n.username} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                      <span className="font-medium">{n.username}</span>
                      <span className="text-xs text-muted-foreground">{format.dateTime(new Date(n.firstSeenAt), { dateStyle: 'medium' })}</span>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>{t('profile.recentSessions')}</CardTitle>
              </CardHeader>
              <CardContent className="px-0">
                {!player.canViewConnectionData && <p className="px-5 pb-3 text-xs text-muted-foreground">{t('profile.ipHidden')}</p>}
                <Table>
                  <THead>
                    <TR>
                      <TH>{t('profile.started')}</TH>
                      <TH>{t('profile.duration')}</TH>
                      <TH>{t('profile.servers')}</TH>
                      {player.canViewConnectionData && <TH>{t('profile.ipAddress')}</TH>}
                    </TR>
                  </THead>
                  <TBody>
                    {player.sessions.map((s) => (
                      <TR key={s.id}>
                        <TD className="whitespace-nowrap">{date(s.startedAt)}</TD>
                        <TD className="whitespace-nowrap tabular-nums">
                          {s.endedAt ? duration(s.durationSeconds ?? 0) : <Badge>{t('profile.ongoing')}</Badge>}
                        </TD>
                        <TD className="text-muted-foreground">{s.servers.map((v) => v.server.name).join(' → ') || '–'}</TD>
                        {player.canViewConnectionData && (
                          <TD className="font-mono text-xs">
                            {s.connection?.ipAddress ?? '–'}
                            {s.connection?.virtualHost && <span className="block text-muted-foreground">{s.connection.virtualHost}</span>}
                          </TD>
                        )}
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </CardContent>
            </Card>
          </div>

          {can(PERMISSIONS.PUNISHMENTS_HISTORY) && <PlayerModeration uuid={player.uuid} username={player.username} />}
          {can(PERMISSIONS.PLAYERS_NOTES) && <PlayerNotes uuid={player.uuid} />}
        </div>
      )}
    </>
  );
}
