'use client';

import { PERMISSIONS } from '@mnm/shared-types';
import { Download, ExternalLink, FileText, RefreshCw, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { usePlatformVersion } from '@/components/plugin-version';
import { ReleaseNotes } from '@/components/release-notes';
import { useToast } from '@/components/toaster';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Alert, Badge, Button, buttonVariants, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input, Select, Skeleton } from '@/components/ui/primitives';
import { Switch } from '@/components/ui/switch';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { api, ApiError, type ComponentState, errorKey, type ReleaseAsset, type UpdateSettings, type UpdateStatus } from '@/lib/api';
import { safeHref } from '@/lib/punishment-edit';
import { componentState } from '@/lib/semver';

function stateVariant(state: ComponentState) {
  return state === 'current' ? ('default' as const) : state === 'outdated' ? ('warning' as const) : ('muted' as const);
}

/** Settings → Updates: versions of all components, connected plugins, actions and settings. */
export function UpdatesPanel() {
  const t = useTranslations();
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const toast = useToast();
  const { can } = useAuth();
  const dashboardVersion = usePlatformVersion();
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const load = useCallback(async () => {
    try {
      setStatus(await api<UpdateStatus>('/updates'));
      setError(null);
    } catch (err) {
      setError(t(`errors.${errorKey(err)}`));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function check() {
    setChecking(true);
    try {
      const result = await api<{ refreshed: boolean; outcome: 'checked' | 'recent' | 'rate-limited' | 'busy'; status: UpdateStatus }>('/updates/check', { method: 'POST' });
      setStatus(result.status);
      if (result.outcome === 'rate-limited') toast(t('updates.rateLimitedWait', { time: dateTime(result.status.rateLimitedUntil) }), 'error');
      else if (result.outcome === 'busy') toast(t('updates.checkInProgress'));
      else if (!result.refreshed) toast(t('updates.checkedRecently'));
      else if (result.status.lastError) toast(t(`updates.errors.${result.status.lastError.code}`), 'error');
      else toast(t(`updates.verification.${result.status.verification}`));
    } catch (err) {
      toast(err instanceof ApiError && err.code === 'MANUAL_CHECKS_DISABLED' ? t('updates.manualDisabled') : err instanceof ApiError && err.status === 429 ? t('updates.tooManyChecks') : t(`errors.${errorKey(err)}`), 'error');
    } finally {
      setChecking(false);
    }
  }

  function dateTime(iso: string | null) {
    return iso ? format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' }) : t('updates.never');
  }

  if (error) return <Alert variant="destructive">{error}</Alert>;
  if (!status) return <Skeleton className="h-64" />;

  const latest = status.latest;
  const date = dateTime;
  const limited = Boolean(status.rateLimitedUntil && Date.parse(status.rateLimitedUntil) > now.getTime());
  const dashboardState = componentState(dashboardVersion, latest?.version);
  const releasesHref = safeHref(latest?.url ?? null) ?? safeHref(status.releasesPage);
  const lastError = status.lastError;

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="grid gap-1">
              <CardTitle>{t('updates.title')}</CardTitle>
              <CardDescription>{t('updates.description')}</CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              {can(PERMISSIONS.UPDATES_CHECK) && status.settings.manualChecks && (
                <Button variant="outline" size="sm" onClick={() => void check()} disabled={checking}>
                  <RefreshCw aria-hidden className={checking ? 'animate-spin' : undefined} />
                  {t('updates.checkNow')}
                </Button>
              )}
              {latest?.notes.trim() && <ReleaseNotesDialog version={latest.version} notes={latest.notes} />}
              {releasesHref && (
                <a href={releasesHref} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                  <ExternalLink aria-hidden />
                  {t('updates.openReleases')}
                </a>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          {!status.settings.enabled && <Alert>{t('updates.disabledHint')}</Alert>}
          {status.updateAvailable && latest && <Alert variant="success">{t('updates.availableHint', { version: latest.version })}</Alert>}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">{t('updates.statusLabel')}</span>
            <Badge variant={status.verification === 'up-to-date' ? 'default' : status.verification === 'update-available' ? 'warning' : 'muted'}>{t(`updates.verification.${status.verification}`)}</Badge>
          </div>
          {lastError && (
            <Alert variant={status.lastSuccessAt ? 'default' : 'destructive'} className="flex items-start gap-2">
              <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span className="grid gap-1">
                <span>
                  {t(`updates.errors.${lastError.code}`)}{' '}
                  {status.lastSuccessAt ? t('updates.lastKnown', { time: date(status.lastSuccessAt) }) : t('updates.noSuccessYet')}
                </span>
                {limited && <span>{t('updates.retryAt', { time: date(status.rateLimitedUntil) })}</span>}
                {!limited && status.nextCheckAt && <span>{t('updates.nextAttempt', { time: date(status.nextCheckAt) })}</span>}
                {lastError.code === 'RATE_LIMITED' && !status.authenticated && <span className="text-xs opacity-90">{t('updates.rateLimitHint')}</span>}
                {lastError.code === 'TOKEN_INVALID' && <span className="text-xs opacity-90">{t('updates.tokenInvalidHint')}</span>}
              </span>
            </Alert>
          )}
          {status.warnings.map((w, i) => (
            <Alert key={i} variant={w.code === 'PLUGIN_VERSION_UNKNOWN' ? 'default' : 'destructive'} className="flex items-start gap-2">
              <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
              {t(`updates.warnings.${w.code}`, { version: w.version ?? '', server: w.server ?? '' })}
            </Alert>
          ))}
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <Fact label={t('updates.latestVersion')}>
              {latest ? (
                <span className="flex flex-wrap items-center gap-2">
                  {latest.version}
                  {latest.prerelease && <Badge variant="warning">{t('updates.prerelease')}</Badge>}
                </span>
              ) : (
                <span className="text-muted-foreground">{t('updates.notVerified')}</span>
              )}
            </Fact>
            <Fact label={t('updates.releaseDate')}>{latest?.publishedAt ? format.dateTime(new Date(latest.publishedAt), { dateStyle: 'long' }) : '–'}</Fact>
            <Fact label={t('updates.lastChecked')}>{status.lastSuccessAt ? date(status.lastSuccessAt) : <span className="text-muted-foreground">{t('updates.noSuccessfulCheck')}</span>}</Fact>
            <Fact label={t('updates.lastAttempt')}>{date(status.lastAttemptAt)}</Fact>
            <Fact label={t('updates.nextCheck')}>{status.settings.enabled && status.nextCheckAt ? date(status.nextCheckAt) : '–'}</Fact>
            <Fact label={t('updates.source')}>{status.authenticated ? t('updates.sourceToken') : t('updates.sourceAnonymous')}</Fact>
            <Fact label={t('updates.backend')}>
              <VersionState version={status.backend.version} state={status.backend.state} />
            </Fact>
            <Fact label={t('updates.dashboard')}>
              <VersionState version={dashboardVersion || null} state={dashboardState} />
            </Fact>
            <Fact label={t('updates.channel')}>{t(`updates.channels.${status.settings.channel}`)}</Fact>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="grid gap-1">
              <CardTitle>{t('updates.pluginsTitle')}</CardTitle>
              <CardDescription>{t('updates.pluginsDescription')}</CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <AssetLink asset={latest?.pluginAssets.velocity ?? null} label={t('updates.downloadVelocity')} />
              <AssetLink asset={latest?.pluginAssets.paper ?? null} label={t('updates.downloadPaper')} />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {latest && (!latest.pluginAssets.velocity || !latest.pluginAssets.paper) && <p className="mb-3 text-xs text-muted-foreground">{t('updates.assetMissing')}</p>}
          {status.servers.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('updates.noServers')}</p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>{t('updates.server')}</TH>
                  <TH>{t('updates.type')}</TH>
                  <TH>{t('updates.installedVersion')}</TH>
                  <TH>{t('updates.latestVersion')}</TH>
                  <TH>{t('updates.status')}</TH>
                </TR>
              </THead>
              <TBody>
                {status.servers.map((s) => (
                  <TR key={s.id}>
                    <TD className="font-medium">{s.name}</TD>
                    <TD>{s.type === 'VELOCITY' ? 'Velocity' : 'Paper'}</TD>
                    <TD>{s.pluginVersion ?? <span className="text-muted-foreground">{t('updates.unknown')}</span>}</TD>
                    <TD>{latest?.version ?? '–'}</TD>
                    <TD>
                      <span className="flex flex-wrap gap-1">
                        <Badge variant={stateVariant(s.state)}>{t(`updates.states.${s.state}`)}</Badge>
                        {s.compatibility === 'incompatible' && <Badge variant="danger">{t('updates.versionMismatch')}</Badge>}
                      </span>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <UpdateSettingsCard settings={status.settings} editable={can(PERMISSIONS.UPDATES_MANAGE)} onSaved={load} />
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}

function VersionState({ version, state }: { version: string | null; state: ComponentState }) {
  const t = useTranslations();
  return (
    <span className="flex flex-wrap items-center gap-2">
      {version ?? <span className="text-muted-foreground">{t('updates.unknown')}</span>}
      <Badge variant={stateVariant(state)}>{t(`updates.states.${state}`)}</Badge>
    </span>
  );
}

function AssetLink({ asset, label }: { asset: ReleaseAsset | null; label: string }) {
  const href = safeHref(asset?.url ?? null);
  if (!asset || !href) return null;
  return (
    <a href={href} rel="noopener noreferrer" className={buttonVariants({ variant: 'outline', size: 'sm' })} title={asset.name}>
      <Download aria-hidden />
      {label}
    </a>
  );
}

function ReleaseNotesDialog({ version, notes }: { version: string; notes: string }) {
  const t = useTranslations();
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <FileText aria-hidden />
          {t('updates.viewReleaseNotes')}
        </Button>
      </DialogTrigger>
      <DialogContent title={t('updates.releaseNotesTitle', { version })} closeLabel={t('common.close')} className="max-w-3xl">
        <div className="max-h-[65vh] overflow-y-auto pr-1">
          <ReleaseNotes markdown={notes} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function UpdateSettingsCard({ settings, editable, onSaved }: { settings: UpdateSettings; editable: boolean; onSaved: () => Promise<void> | void }) {
  const t = useTranslations();
  const toast = useToast();
  const [draft, setDraft] = useState(settings);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);
  const set = <K extends keyof UpdateSettings>(key: K, value: UpdateSettings[K]) => setDraft({ ...draft, [key]: value });
  const invalid = !(draft.checkIntervalHours >= 1 && draft.checkIntervalHours <= 168) || !(draft.notificationCooldownHours >= 1 && draft.notificationCooldownHours <= 720);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/updates/settings', { method: 'PUT', body: draft });
      toast(t('settings.saved'));
      await onSaved();
    } catch (err) {
      toast(t(`errors.${errorKey(err)}`), 'error');
    } finally {
      setBusy(false);
    }
  }

  const toggle = (key: 'enabled' | 'dashboardNotifications' | 'minecraftNotifications' | 'manualChecks') => (
    <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
      <div className="grid gap-0.5">
        <span className="text-sm font-medium">{t(`updates.settings.${key}`)}</span>
        <span className="text-xs text-muted-foreground">{t(`updates.settings.${key}Hint`)}</span>
      </div>
      <Switch aria-label={t(`updates.settings.${key}`)} checked={draft[key]} disabled={!editable} onCheckedChange={(v) => set(key, v)} />
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('updates.settingsTitle')}</CardTitle>
        <CardDescription>{editable ? t('updates.settingsDescription') : t('updates.settingsReadOnly')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="grid gap-4">
          <div className="grid gap-3 md:grid-cols-2">
            {toggle('enabled')}
            {toggle('manualChecks')}
            {toggle('dashboardNotifications')}
            {toggle('minecraftNotifications')}
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t('updates.channel')} htmlFor="upd-channel" hint={t('updates.channelHint')}>
              <Select id="upd-channel" value={draft.channel} disabled={!editable} onChange={(e) => set('channel', e.target.value as UpdateSettings['channel'])}>
                <option value="stable">{t('updates.channels.stable')}</option>
                <option value="prerelease">{t('updates.channels.prerelease')}</option>
              </Select>
            </Field>
            <Field label={t('updates.settings.checkIntervalHours')} htmlFor="upd-interval" hint={t('updates.settings.range', { min: 1, max: 168 })}>
              <Input id="upd-interval" type="number" min={1} max={168} value={draft.checkIntervalHours} disabled={!editable} onChange={(e) => set('checkIntervalHours', e.target.valueAsNumber)} />
            </Field>
            <Field label={t('updates.settings.notificationCooldownHours')} htmlFor="upd-cooldown" hint={t('updates.settings.cooldownHint')}>
              <Input id="upd-cooldown" type="number" min={1} max={720} value={draft.notificationCooldownHours} disabled={!editable} onChange={(e) => set('notificationCooldownHours', e.target.valueAsNumber)} />
            </Field>
          </div>
          <p className="text-xs text-muted-foreground">{t('updates.noAutoInstall')}</p>
          {editable && (
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" disabled={!dirty || busy} onClick={() => setDraft(settings)}>
                {t('pluginSettings.discard')}
              </Button>
              <Button type="submit" disabled={!dirty || busy || invalid}>
                {busy ? t('common.saving') : t('common.save')}
              </Button>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

/** Servers page: plugins older than the latest Nexora release (users with updates.view). */
export function ServerUpdatesAlert() {
  const t = useTranslations();
  const { can } = useAuth();
  const allowed = can(PERMISSIONS.UPDATES_VIEW);
  const [status, setStatus] = useState<UpdateStatus | null>(null);

  useEffect(() => {
    if (allowed) api<UpdateStatus>('/updates').then(setStatus).catch(() => undefined);
  }, [allowed]);

  if (!status?.latest) return null;
  const outdated = status.servers.filter((s) => s.state === 'outdated');
  if (outdated.length === 0) return null;
  return (
    <Alert className="mb-4 flex flex-wrap items-center justify-between gap-2">
      <span>
        {t('updates.outdatedPlugins', { count: outdated.length, version: status.latest.version })}{' '}
        <span className="text-muted-foreground">{outdated.map((s) => `${s.name} (${s.pluginVersion ?? '?'})`).join(', ')}</span>
      </span>
      <Link href="/settings?section=updates" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
        {t('updates.openSettings')}
      </Link>
    </Alert>
  );
}
