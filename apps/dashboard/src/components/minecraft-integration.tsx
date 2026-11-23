'use client';

import { Check, CheckCircle2, Copy, Download, FileArchive, Loader2, Server, ShieldAlert, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { useToast } from '@/components/toaster';
import { Alert, Badge, Button, buttonVariants, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input, Select } from '@/components/ui/primitives';
import { Switch } from '@/components/ui/switch';
import { api, errorKey, type Language, type RegistrationStatus, type RegistrationTokenResult, type SetupStatus } from '@/lib/api';
import {
  configPath,
  defaultOptions,
  generateConfig,
  installGuide,
  isInsecureUrl,
  type PluginConfigOptions,
  type PluginKind,
  RANGES,
  STATISTIC_CATEGORIES,
  validateOptions,
} from '@/lib/plugin-config';
import { cn } from '@/lib/utils';
import { createZip, downloadFile } from '@/lib/zip';

const NAME_PATTERN = /^[A-Za-z0-9_.-]{2,64}$/;

/**
 * Settings → Minecraft integration: add a server step by step (type and name,
 * plugin options, registration token, install, confirmation) and generate
 * configurations for existing servers without a token.
 */
export function MinecraftIntegration() {
  const t = useTranslations();
  const toast = useToast();
  const [version, setVersion] = useState('');
  const [languages, setLanguages] = useState<Language[]>([]);
  const [name, setName] = useState('');
  const [options, setOptions] = useState<PluginConfigOptions>(() => defaultOptions('PAPER', ''));
  const [token, setToken] = useState<RegistrationTokenResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingKey, setPendingKey] = useState(0);

  useEffect(() => {
    api<SetupStatus>('/setup/status').then((s) => setVersion(s.version)).catch(() => undefined);
    api<Language[]>('/i18n/languages').then(setLanguages).catch(() => undefined);
    api<{ dashboardUrl: string }>('/settings/network')
      .then((n) => setOptions((o) => ({ ...o, backendUrl: o.backendUrl || n.dashboardUrl || window.location.origin })))
      .catch(() => setOptions((o) => ({ ...o, backendUrl: o.backendUrl || window.location.origin })));
  }, []);

  const set = <K extends keyof PluginConfigOptions>(key: K, value: PluginConfigOptions[K]) => setOptions((o) => ({ ...o, [key]: value }));
  const problems = validateOptions(options);
  const nameValid = NAME_PATTERN.test(name.trim());
  const effective = useMemo(() => ({ ...options, registrationToken: token?.token ?? '' }), [options, token]);
  const config = useMemo(() => generateConfig(effective), [effective]);

  function switchKind(kind: PluginKind) {
    if (token) return;
    setOptions((o) => ({ ...defaultOptions(kind, o.backendUrl), language: o.language, debug: o.debug, managedSettings: o.managedSettings }));
  }

  async function createToken() {
    setBusy(true);
    try {
      setToken(await api<RegistrationTokenResult>('/servers/registration-tokens', { method: 'POST', body: { type: options.kind, name: name.trim() } }));
      setPendingKey((k) => k + 1);
    } catch (err) {
      toast(t(`errors.${errorKey(err)}`), 'error');
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setToken(null);
    setName('');
    setPendingKey((k) => k + 1);
  }

  const fileBase = (name.trim() || options.kind.toLowerCase()).replace(/[^A-Za-z0-9_.-]/g, '_');

  function downloadZip() {
    const folder = configPath(options.kind).replace(/\/config\.properties$/, '');
    const zip = createZip([
      { name: `${folder}/config.properties`, content: config },
      { name: 'INSTALL.md', content: installGuide(effective, name.trim() || options.kind, version || 'x.y.z', token?.expiresAt ?? null) },
    ]);
    downloadFile(`networkmanager-${fileBase}.zip`, zip, 'application/zip');
  }

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('integration.title')}</CardTitle>
          <CardDescription>{t('integration.description')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6">
          <Steps current={token ? 3 : nameValid ? 2 : 1} />

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="grid content-start gap-5">
              <Section title={t('integration.server')}>
                <div className="grid gap-3 sm:grid-cols-[220px_1fr]">
                  <Field label={t('settings.serverType')} htmlFor="int-kind">
                    <Select id="int-kind" value={options.kind} disabled={Boolean(token)} onChange={(e) => switchKind(e.target.value as PluginKind)}>
                      <option value="VELOCITY">{t('integration.velocity')}</option>
                      <option value="PAPER">{t('integration.paper')}</option>
                    </Select>
                  </Field>
                  <Field label={options.kind === 'VELOCITY' ? t('integration.proxyName') : t('settings.serverName')} hint={t('integration.nameHint')} htmlFor="int-name">
                    <Input id="int-name" placeholder={options.kind === 'VELOCITY' ? 'proxy-1' : 'lobby-1'} value={name} disabled={Boolean(token)} onChange={(e) => setName(e.target.value)} maxLength={64} />
                  </Field>
                </div>
              </Section>

              <Section title={t('integration.connection')}>
                <Field
                  label={t('integration.backendUrl')}
                  hint={t('integration.backendUrlHint')}
                  error={problems.includes('backendUrl') ? t('integration.problems.backendUrl') : problems.includes('backendUrlPath') ? t('integration.problems.backendUrlPath') : null}
                  htmlFor="int-url"
                >
                  <Input id="int-url" value={options.backendUrl} onChange={(e) => set('backendUrl', e.target.value)} />
                </Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={t('integration.connectionMode')} htmlFor="int-mode">
                    <Select
                      id="int-mode"
                      value={options.backendUrl.startsWith('https://') ? 'https' : 'http'}
                      onChange={(e) => set('backendUrl', options.backendUrl.replace(/^https?:\/\//, `${e.target.value}://`))}
                    >
                      <option value="https">{t('integration.modeHttps')}</option>
                      <option value="http">{t('integration.modeHttp')}</option>
                    </Select>
                  </Field>
                  <Field label={t('integration.language')} hint={t('integration.languageHint')} htmlFor="int-lang">
                    <Select id="int-lang" value={options.language} onChange={(e) => set('language', e.target.value)}>
                      {(languages.length ? languages : [{ locale: 'en-US', nativeName: 'English (US)' }]).map((l) => (
                        <option key={l.locale} value={l.locale}>
                          {l.nativeName}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
                {isInsecureUrl(options.backendUrl) && (
                  <Alert variant="destructive" className="flex gap-2">
                    <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                    {t('integration.insecure')}
                  </Alert>
                )}
                <NumberField id="int-hb" label={t('integration.heartbeat')} value={options.heartbeatIntervalSeconds} range={RANGES.heartbeatIntervalSeconds} onChange={(v) => set('heartbeatIntervalSeconds', v)} />
              </Section>

              <Section title={t('integration.moderation')}>
                <Toggle label={t('integration.punishments')} hint={t('integration.punishmentsHint')} checked={options.punishmentsEnabled} onChange={(v) => set('punishmentsEnabled', v)} />
                {options.kind === 'VELOCITY' && (
                  <Toggle label={t('integration.commands')} hint={t('integration.commandsHint')} checked={options.moderationCommands} disabled={!options.punishmentsEnabled} onChange={(v) => set('moderationCommands', v)} />
                )}
              </Section>

              {options.kind === 'VELOCITY' ? (
                <Section title={t('integration.proxy')}>
                  <NumberField id="int-sync" label={t('integration.syncInterval')} hint={t('integration.syncIntervalHint')} value={options.syncIntervalSeconds} range={RANGES.syncIntervalSeconds} onChange={(v) => set('syncIntervalSeconds', v)} />
                  <Toggle label={t('integration.collectIps')} hint={t('integration.collectIpsHint')} checked={options.collectIpAddresses} onChange={(v) => set('collectIpAddresses', v)} />
                </Section>
              ) : (
                <>
                  <Section title={t('integration.statistics')}>
                    <Toggle label={t('integration.statisticsEnabled')} checked={options.statisticsEnabled} onChange={(v) => set('statisticsEnabled', v)} />
                    <fieldset className="grid gap-2" disabled={!options.statisticsEnabled}>
                      <legend className="mb-1 text-sm font-medium">{t('integration.categories')}</legend>
                      <div className="flex flex-wrap gap-x-5 gap-y-2">
                        {STATISTIC_CATEGORIES.map((c) => (
                          <label key={c} className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              className="size-4 accent-primary"
                              checked={options.statisticsCategories.includes(c)}
                              onChange={(e) => set('statisticsCategories', e.target.checked ? [...options.statisticsCategories, c] : options.statisticsCategories.filter((x) => x !== c))}
                            />
                            {t(`integration.category.${c}`)}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <NumberField id="int-stat" label={t('integration.statisticsInterval')} value={options.statisticsIntervalSeconds} range={RANGES.statisticsIntervalSeconds} onChange={(v) => set('statisticsIntervalSeconds', v)} />
                      <NumberField id="int-afk" label={t('integration.afkTimeout')} value={options.afkTimeoutSeconds} range={RANGES.afkTimeoutSeconds} onChange={(v) => set('afkTimeoutSeconds', v)} />
                    </div>
                  </Section>
                  <Section title={t('integration.inventories')}>
                    <Toggle label={t('integration.inventorySync')} checked={options.inventorySync} onChange={(v) => set('inventorySync', v)} />
                    <Toggle label={t('integration.enderChestSync')} checked={options.enderChestSync} onChange={(v) => set('enderChestSync', v)} />
                    <NumberField id="int-inv" label={t('integration.inventoryInterval')} value={options.inventorySyncIntervalSeconds} range={RANGES.inventorySyncIntervalSeconds} onChange={(v) => set('inventorySyncIntervalSeconds', v)} />
                  </Section>
                  <Section title={t('integration.anticheat')}>
                    <Field label={t('integration.integrations')} hint={t('integration.integrationsHint')} error={problems.includes('integrations') ? t('integration.problems.integrations') : null} htmlFor="int-ac">
                      <Input id="int-ac" placeholder="Grim, Vulcan" value={options.anticheatIntegrations} onChange={(e) => set('anticheatIntegrations', e.target.value)} />
                    </Field>
                    <NumberField id="int-acr" label={t('integration.maxReports')} value={options.anticheatMaxReportsPerMinute} range={RANGES.anticheatMaxReportsPerMinute} onChange={(v) => set('anticheatMaxReportsPerMinute', v)} />
                  </Section>
                </>
              )}

              <Section title={t('integration.advanced')}>
                <Toggle label={t('integration.managed')} hint={t('integration.managedHint')} checked={options.managedSettings} onChange={(v) => set('managedSettings', v)} />
                <Toggle label={t('integration.debug')} checked={options.debug} onChange={(v) => set('debug', v)} />
              </Section>
            </div>

            <div className="grid content-start gap-4 xl:sticky xl:top-20">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-medium">
                  {t('integration.preview')} <code className="ml-1 text-xs text-muted-foreground">{configPath(options.kind)}</code>
                </div>
                <CopyButton text={config} disabled={problems.length > 0} />
              </div>
              <pre className="max-h-[480px] overflow-auto rounded-lg border bg-muted/40 p-4 font-mono text-xs leading-relaxed" aria-label={t('integration.preview')}>
                {config}
              </pre>
              {problems.includes('range') && <Alert variant="destructive">{t('integration.problems.range')}</Alert>}

              {!token ? (
                <Alert className="grid gap-3">
                  <span>{t('integration.tokenExplanation')}</span>
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => void createToken()} disabled={busy || !nameValid || problems.length > 0}>
                      {busy ? <Loader2 aria-hidden className="animate-spin" /> : <Server aria-hidden />}
                      {t('integration.createToken')}
                    </Button>
                    <Button variant="outline" onClick={() => downloadFile('config.properties', config, 'text/plain')} disabled={problems.length > 0}>
                      <Download aria-hidden />
                      {t('integration.downloadWithoutToken')}
                    </Button>
                  </div>
                  {!nameValid && name.length > 0 && <span className="text-xs text-destructive">{t('integration.problems.name')}</span>}
                </Alert>
              ) : (
                <>
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={downloadZip}>
                      <FileArchive aria-hidden />
                      {t('integration.downloadZip')}
                    </Button>
                    <Button variant="outline" onClick={() => downloadFile('config.properties', config, 'text/plain')}>
                      <Download aria-hidden />
                      {t('integration.downloadConfig')}
                    </Button>
                  </div>
                  <RegistrationProgress token={token} onReset={reset} />
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <PendingTokens refreshKey={pendingKey} />
    </div>
  );
}

function Steps({ current }: { current: number }) {
  const t = useTranslations();
  const steps = [t('integration.steps.server'), t('integration.steps.options'), t('integration.steps.install')];
  return (
    <ol className="flex flex-wrap gap-2 text-sm">
      {steps.map((label, i) => (
        <li
          key={label}
          aria-current={i + 1 === current ? 'step' : undefined}
          className={cn('flex items-center gap-2 rounded-full border px-3 py-1', i + 1 === current ? 'border-primary bg-primary/10 font-medium' : i + 1 < current ? 'text-foreground' : 'text-muted-foreground')}
        >
          <span className={cn('grid size-5 place-items-center rounded-full text-xs', i + 1 < current ? 'bg-primary text-primary-foreground' : 'bg-muted')}>{i + 1 < current ? <Check aria-hidden className="size-3" /> : i + 1}</span>
          {label}
        </li>
      ))}
    </ol>
  );
}

function RegistrationProgress({ token, onReset }: { token: RegistrationTokenResult; onReset: () => void }) {
  const t = useTranslations();
  const format = useFormatter();
  const now = useNow({ updateInterval: 15_000 });
  const [status, setStatus] = useState<RegistrationStatus | null>(null);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await api<RegistrationStatus>(`/servers/registration-tokens/${token.id}`);
        if (stopped) return;
        setStatus(next);
        // Keep polling until the server sent its first heartbeat (or the token expired).
        if (next.status === 'EXPIRED' || next.server?.lastHeartbeatAt) return;
      } catch {
        // retry below
      }
      if (!stopped) timer = setTimeout(() => void poll(), 3_000);
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [token.id]);

  const registered = status?.status === 'REGISTERED';
  const connected = Boolean(status?.server?.lastHeartbeatAt);
  const expired = status?.status === 'EXPIRED';

  return (
    <div className="grid gap-3 rounded-lg border p-4" aria-live="polite">
      <div className="flex items-center justify-between gap-2">
        <div className="font-medium">{t('integration.progress.title', { name: token.serverName })}</div>
        <Button variant="ghost" size="sm" onClick={onReset}>
          {t('integration.addAnother')}
        </Button>
      </div>
      <ProgressItem done>{t('integration.progress.token', { time: format.relativeTime(new Date(token.expiresAt), now) })}</ProgressItem>
      <ProgressItem done={registered} waiting={!registered && !expired}>
        {t('integration.progress.install', { path: configPath(token.serverType) })}
      </ProgressItem>
      <ProgressItem done={registered} waiting={!registered && !expired}>
        {registered ? t('integration.progress.registered', { version: status?.server?.pluginVersion ?? '?' }) : t('integration.progress.waitingRegistration')}
      </ProgressItem>
      <ProgressItem done={connected} waiting={registered && !connected}>
        {connected ? t('integration.progress.connected') : t('integration.progress.waitingHeartbeat')}
      </ProgressItem>
      {expired && <Alert variant="destructive">{t('integration.progress.expired')}</Alert>}
      {registered && status?.server && (
        <Link href={`/servers/${status.server.id}`} className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'justify-self-start')}>
          {t('integration.openServer')}
        </Link>
      )}
    </div>
  );
}

function ProgressItem({ done, waiting, children }: { done: boolean; waiting?: boolean; children: ReactNode }) {
  return (
    <div className={cn('flex items-start gap-2 text-sm', !done && !waiting && 'text-muted-foreground')}>
      {done ? (
        <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-emerald-500" />
      ) : waiting ? (
        <Loader2 aria-hidden className="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground" />
      ) : (
        <span aria-hidden className="mt-1 ml-1 size-2 shrink-0 rounded-full bg-muted-foreground/40" />
      )}
      <span>{children}</span>
    </div>
  );
}

interface PendingToken {
  id: string;
  serverType: 'VELOCITY' | 'PAPER';
  serverName: string;
  expiresAt: string;
}

function PendingTokens({ refreshKey }: { refreshKey: number }) {
  const t = useTranslations();
  const format = useFormatter();
  const now = useNow({ updateInterval: 30_000 });
  const [pending, setPending] = useState<PendingToken[]>([]);

  const load = useCallback(() => api<PendingToken[]>('/servers/registration-tokens').then(setPending).catch(() => undefined), []);
  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  async function revoke(id: string) {
    await api(`/servers/registration-tokens/${id}`, { method: 'DELETE' }).catch(() => undefined);
    await load();
  }

  if (pending.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('integration.pendingTitle')}</CardTitle>
        <CardDescription>{t('integration.pendingDescription')}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-2">
          {pending.map((p) => (
            <li key={p.id} className="flex items-center gap-3 rounded-lg border px-4 py-2 text-sm">
              <Badge variant={p.serverType === 'VELOCITY' ? 'info' : 'default'}>{p.serverType === 'VELOCITY' ? 'Velocity' : 'Paper'}</Badge>
              <span className="flex-1 font-medium">{p.serverName}</span>
              <span className="text-xs text-muted-foreground">{t('setup.velocity.expires', { time: format.relativeTime(new Date(p.expiresAt), now) })}</span>
              <Button variant="ghost" size="icon" onClick={() => void revoke(p.id)} title={t('integration.revokeToken')}>
                <Trash2 aria-hidden />
                <span className="sr-only">{t('integration.revokeToken')}</span>
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="grid gap-3 rounded-lg border p-4">
      <legend className="px-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</legend>
      {children}
    </fieldset>
  );
}

export function Toggle({ label, hint, checked, disabled, onChange }: { label: string; hint?: string; checked: boolean; disabled?: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className={cn('flex items-start justify-between gap-4 text-sm', disabled && 'opacity-50')}>
      <span className="grid gap-0.5">
        <span className="font-medium">{label}</span>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </span>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} aria-label={label} />
    </label>
  );
}

function NumberField({ id, label, hint, value, range, onChange }: { id: string; label: string; hint?: string; value: number; range: readonly [number, number]; onChange: (value: number) => void }) {
  const t = useTranslations();
  return (
    <Field label={label} hint={hint ?? t('integration.range', { min: range[0], max: range[1] })} htmlFor={id}>
      <Input id={id} type="number" min={range[0]} max={range[1]} value={Number.isFinite(value) ? value : ''} onChange={(e) => onChange(e.target.valueAsNumber)} />
    </Field>
  );
}

function CopyButton({ text, disabled }: { text: string; disabled?: boolean }) {
  const t = useTranslations();
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={disabled}
      onClick={() => {
        void navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
      {copied ? t('common.copied') : t('common.copy')}
    </Button>
  );
}

