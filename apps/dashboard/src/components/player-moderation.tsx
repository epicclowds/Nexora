'use client';

import { PERMISSIONS } from '@mnm/shared-types';
import { Gavel, Trash2 } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { api, errorKey, type PlayerNote, type PlayerPunishments } from '@/lib/api';
import { useAuth } from './auth-provider';
import { PunishDialog, useIssuableTypes } from './punishment-dialogs';
import { PunishmentTable } from './punishment-table';
import { useLiveRefresh } from './realtime-provider';
import { useToast } from './toaster';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Skeleton, Textarea } from './ui/primitives';

/** Moderation section of a player profile: active status, punish action and full history. */
export function PlayerModeration({ uuid, username }: { uuid: string; username: string }) {
  const t = useTranslations();
  const issuable = useIssuableTypes();
  const [data, setData] = useState<PlayerPunishments | null>(null);

  const load = useCallback(async () => {
    setData(await api<PlayerPunishments>(`/players/${uuid}/punishments?pageSize=50`).catch(() => null));
  }, [uuid]);
  useEffect(() => {
    void load();
  }, [load]);
  useLiveRefresh(['punishment.changed'], load, 120_000);

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>{t('moderation.history')}</CardTitle>
          {data?.active.ban && <Badge variant="danger">{t('moderation.activeBan')}</Badge>}
          {data?.active.mute && <Badge variant="warning">{t('moderation.activeMute')}</Badge>}
          {data && !data.active.ban && !data.active.mute && <Badge variant="muted">{t('moderation.clean')}</Badge>}
        </div>
        {issuable.length > 0 && (
          <PunishDialog
            target={uuid}
            targetName={username}
            onIssued={load}
            trigger={
              <Button variant="outline" size="sm">
                <Gavel aria-hidden /> {t('moderation.punish')}
              </Button>
            }
          />
        )}
      </CardHeader>
      <CardContent className="px-0">
        {!data ? (
          <Skeleton className="mx-5 h-16" />
        ) : data.items.length === 0 ? (
          <p className="px-5 text-sm text-muted-foreground">{t('moderation.empty')}</p>
        ) : (
          <PunishmentTable items={data.items} showTarget={false} onChange={load} />
        )}
      </CardContent>
    </Card>
  );
}

/** Internal staff notes. Authors can delete their own notes. */
export function PlayerNotes({ uuid }: { uuid: string }) {
  const t = useTranslations();
  const format = useFormatter();
  const toast = useToast();
  const { user, can } = useAuth();
  const [notes, setNotes] = useState<PlayerNote[] | null>(null);
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setNotes(await api<PlayerNote[]>(`/players/${uuid}/notes`).catch(() => []));
  }, [uuid]);
  useEffect(() => {
    void load();
  }, [load]);

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/players/${uuid}/notes`, { method: 'POST', body: { content: content.trim() } });
      setContent('');
      await load();
    } catch (err) {
      toast(t(`errors.${errorKey(err)}`), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    try {
      await api(`/players/${uuid}/notes/${id}`, { method: 'DELETE' });
      toast(t('notes.deleted'));
      await load();
    } catch (err) {
      toast(t(`errors.${errorKey(err)}`), 'error');
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('notes.title')}</CardTitle>
        <CardDescription>{t('notes.description')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <form onSubmit={add} className="grid gap-2">
          <Textarea aria-label={t('notes.add')} placeholder={t('notes.placeholder')} value={content} onChange={(e) => setContent(e.target.value)} maxLength={4000} />
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={busy || !content.trim()}>
              {t('notes.add')}
            </Button>
          </div>
        </form>
        {!notes ? (
          <Skeleton className="h-12" />
        ) : notes.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('notes.empty')}</p>
        ) : (
          <ul className="grid gap-2">
            {notes.map((n) => (
              <li key={n.id} className="rounded-lg border px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="whitespace-pre-wrap text-sm">{n.content}</p>
                  {(n.author?.id === user.id || can(PERMISSIONS.DASHBOARD_MANAGE)) && (
                    <Button variant="ghost" size="icon" className="size-7 shrink-0" title={t('common.delete')} onClick={() => void remove(n.id)}>
                      <Trash2 aria-hidden />
                      <span className="sr-only">{t('common.delete')}</span>
                    </Button>
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {n.author?.username ?? t('common.unknown')} · {format.dateTime(new Date(n.createdAt), { dateStyle: 'medium', timeStyle: 'short' })}
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
