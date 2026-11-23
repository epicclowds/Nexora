'use client';

import { PERMISSIONS } from '@mnm/shared-types';
import { ArrowLeft, Check, Copy, KeyRound, Power, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useFormatter, useLocale, useNow, useTranslations } from 'next-intl';
import { type FormEvent, type ReactNode, useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { useLiveRefresh } from '@/components/realtime-provider';
import { useToast } from '@/components/toaster';
import { Alert, Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input, Skeleton, StatusDot } from '@/components/ui/primitives';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { api, errorKey, type RotatedCredentials, type ServerDetail } from '@/lib/api';
import { formatBytes } from '@/lib/utils';

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border px-4 py-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-medium">{children}</dd>
    </div>
  );
}

export default function ServerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations();
  const format = useFormatter();
  const locale = useLocale();
  const now = useNow({ updateInterval: 15_000 });
  const router = useRouter();
  const toast = useToast();
  const { can } = useAuth();
  const canManage = can(PERMISSIONS.SERVERS_MANAGE);
  const [server, setServer] = useState<ServerDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [rotated, setRotated] = useState<RotatedCredentials | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const detail = await api<ServerDetail>(`/servers/${encodeURIComponent(id)}`);
      setServer(detail);
      setName((current) => current || detail.name);
      setError(null);
    } catch (err) {
      setError(t(`errors.${errorKey(err)}`));
    }
  }, [id, t]);

  useEffect(() => {
    void load();
  }, [load]);
  useLiveRefresh(['server.updated', 'player.online', 'player.offline'], load, 30_000);

  async function run(action: () => Promise<unknown>, success?: string) {
    try {
      await action();
      if (success) toast(success);
      await load();
    } catch (err) {
      toast(t(`errors.${errorKey(err)}`), 'error');
    }
  }

  async function rename(e: FormEvent) {
    e.preventDefault();
    await run(() => api(`/servers/${id}`, { method: 'PATCH', body: { name } }), t('settings.saved'));
  }

  if (error) return <Alert variant="destructive">{error}</Alert>;
  if (!server) return <Skeleton className="h-72" />;

  const credentialsFile = rotated
    ? `key-id=${rotated.keyId}\nsecret=${rotated.secret}\nserver-id=${rotated.serverId}\nserver-name=${rotated.serverName}\n`
    : '';
  const state = server.status === 'ONLINE' ? 'up' : server.status === 'PENDING' ? 'pending' : 'down';

  return (
    <>
      <Link href="/servers" className="mb-4 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> {t('servers.title')}
      </Link>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{server.name}</h1>
        <Badge variant={server.type === 'VELOCITY' ? 'info' : 'default'}>{server.type === 'VELOCITY' ? 'Velocity' : 'Paper'}</Badge>
        <Badge variant={state === 'up' ? 'default' : state === 'pending' ? 'warning' : 'muted'}>
          <StatusDot state={state} /> {t(`servers.status.${server.status}`)}
        </Badge>
      </div>

      <div className="grid gap-6">
        <Card>
          <CardContent className="pt-5">
            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Fact label={t('servers.heartbeat')}>{server.lastHeartbeatAt ? format.relativeTime(new Date(server.lastHeartbeatAt), now) : t('common.never')}</Fact>
              <Fact label={server.type === 'VELOCITY' ? t('servers.openSessions') : t('servers.connectedPlayers')}>
                {format.number(server.type === 'VELOCITY' ? server.openProxySessions : server.connectedPlayers)}
              </Fact>
              <Fact label="TPS">{server.tps === null ? '–' : format.number(server.tps, { maximumFractionDigits: 2 })}</Fact>
              <Fact label="MSPT">{server.mspt === null ? '–' : format.number(server.mspt, { maximumFractionDigits: 2 })}</Fact>
              <Fact label="RAM">
                {server.memoryUsedBytes && server.memoryMaxBytes ? `${formatBytes(server.memoryUsedBytes, locale)} / ${formatBytes(server.memoryMaxBytes, locale)}` : '–'}
              </Fact>
              <Fact label="CPU">{server.cpuLoad === null ? '–' : format.number(server.cpuLoad, { style: 'percent', maximumFractionDigits: 0 })}</Fact>
              <Fact label={t('servers.version')}>{server.minecraftVersion ?? '–'}</Fact>
              <Fact label={t('servers.plugin')}>{server.pluginVersion ?? '–'}</Fact>
            </dl>
            {server.platformVersion && <p className="mt-3 text-xs text-muted-foreground">{t('servers.platform')}: {server.platformVersion}</p>}
          </CardContent>
        </Card>

        {canManage && (
          <Card>
            <CardHeader>
              <CardTitle>{t('common.actions')}</CardTitle>
              <CardDescription>{server.type === 'PAPER' ? t('servers.nameHint') : t('servers.disabledHint')}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5">
              <form onSubmit={rename} className="flex flex-wrap items-end gap-3">
                <div className="min-w-64 flex-1">
                  <Field label={t('servers.name')} htmlFor="srv-name">
                    <Input id="srv-name" value={name} onChange={(e) => setName(e.target.value)} pattern="[A-Za-z0-9_.\-]+" minLength={2} maxLength={64} required />
                  </Field>
                </div>
                <Button type="submit" variant="outline" disabled={name === server.name}>
                  {t('servers.rename')}
                </Button>
              </form>

              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => void run(() => api(`/servers/${id}`, { method: 'PATCH', body: { enabled: !server.enabled } }), t('settings.saved'))}>
                  <Power aria-hidden /> {server.enabled ? t('servers.disable') : t('servers.enable')}
                </Button>
                <ConfirmDialog
                  trigger={
                    <Button variant="outline">
                      <KeyRound aria-hidden /> {t('servers.rotate')}
                    </Button>
                  }
                  title={t('servers.rotate')}
                  description={t('servers.rotateConfirm')}
                  confirmLabel={t('servers.rotate')}
                  onConfirm={() => run(async () => setRotated(await api<RotatedCredentials>(`/servers/${id}/credentials/rotate`, { method: 'POST' })))}
                />
                <ConfirmDialog
                  trigger={<Button variant="outline">{t('servers.revoke')}</Button>}
                  title={t('servers.revoke')}
                  description={t('servers.revokeConfirm')}
                  confirmLabel={t('servers.revoke')}
                  destructive
                  onConfirm={() => run(() => api(`/servers/${id}/credentials/revoke`, { method: 'POST' }), t('settings.saved'))}
                />
                <ConfirmDialog
                  trigger={
                    <Button variant="destructive">
                      <Trash2 aria-hidden /> {t('servers.remove')}
                    </Button>
                  }
                  title={t('servers.remove')}
                  description={t('servers.removeConfirm', { server: server.name })}
                  confirmLabel={t('common.delete')}
                  destructive
                  onConfirm={async () => {
                    try {
                      await api(`/servers/${id}`, { method: 'DELETE' });
                      toast(t('servers.removed', { server: server.name }));
                      router.replace('/servers');
                    } catch (err) {
                      toast(t(`errors.${errorKey(err)}`), 'error');
                    }
                  }}
                />
              </div>

              {rotated && (
                <Alert variant="success" className="grid gap-2">
                  <span>{t('servers.rotated', { server: rotated.serverName })}</span>
                  <div className="flex items-start gap-2">
                    <pre className="flex-1 overflow-x-auto rounded-md border bg-background p-3 font-mono text-xs text-foreground">{credentialsFile}</pre>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        void navigator.clipboard.writeText(credentialsFile);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      }}
                    >
                      {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                      {copied ? t('common.copied') : t('common.copy')}
                    </Button>
                  </div>
                </Alert>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>{t('servers.credentials')}</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            <Table>
              <THead>
                <TR>
                  <TH>{t('servers.keyId')}</TH>
                  <TH>{t('common.status')}</TH>
                  <TH>{t('servers.created')}</TH>
                  <TH>{t('servers.lastUsed')}</TH>
                </TR>
              </THead>
              <TBody>
                {server.credentials.map((c) => (
                  <TR key={c.id}>
                    <TD className="font-mono text-xs">{c.keyId}</TD>
                    <TD>{c.revokedAt ? <Badge variant="muted">{t('servers.revoked')}</Badge> : <Badge>{t('servers.active')}</Badge>}</TD>
                    <TD className="text-muted-foreground">{format.dateTime(new Date(c.createdAt), { dateStyle: 'medium', timeStyle: 'short' })}</TD>
                    <TD className="text-muted-foreground">{c.lastUsedAt ? format.relativeTime(new Date(c.lastUsedAt), now) : t('common.never')}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
