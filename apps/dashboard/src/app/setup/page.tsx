'use client';

import { Check, Copy, Database, KeyRound, Network, PartyPopper, Server, Sparkles } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Logo } from '@/components/logo';
import { LanguageSwitcher, ThemeToggle } from '@/components/preference-controls';
import { Alert, Badge, Button, Card, CardContent, Field, Input, Select, Skeleton, StatusDot, Textarea } from '@/components/ui/primitives';
import { api, ApiError, errorKey, type Language, type RegistrationTokenResult, type SetupStatus } from '@/lib/api';
import { browserTimeZone, storeLocale } from '@/lib/preferences';
import { cn } from '@/lib/utils';

const STEPS = ['welcome', 'database', 'owner', 'network', 'velocity', 'finish'] as const;
type Step = (typeof STEPS)[number];
const ICONS: Record<Step, typeof Database> = { welcome: Sparkles, database: Database, owner: KeyRound, network: Network, velocity: Server, finish: PartyPopper };

function StatusRow({ label, up, detail }: { label: string; up: boolean; detail?: ReactNode }) {
  const t = useTranslations('common');
  return (
    <div className="flex items-center justify-between rounded-lg border px-4 py-3">
      <span className="flex items-center gap-3 text-sm font-medium">
        <StatusDot state={up ? 'up' : 'down'} />
        {label}
      </span>
      <span className="text-sm text-muted-foreground">{detail ?? (up ? t('up') : t('down'))}</span>
    </div>
  );
}

export default function SetupPage() {
  const t = useTranslations();
  const format = useFormatter();
  const now = useNow({ updateInterval: 30_000 });
  const router = useRouter();
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [statusError, setStatusError] = useState(false);
  const [step, setStep] = useState<Step>('welcome');
  const [languages, setLanguages] = useState<Language[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const completed = useRef(false);

  const [owner, setOwner] = useState({ setupCode: '', username: '', email: '', password: '', confirm: '' });
  const [network, setNetwork] = useState({
    name: '',
    description: '',
    minecraftDomain: '',
    dashboardUrl: '',
    defaultLocale: 'en-US',
    defaultTimezone: 'UTC',
    defaultTheme: 'dark' as 'dark' | 'light' | 'system',
  });
  const [proxyName, setProxyName] = useState('proxy');
  const [token, setToken] = useState<RegistrationTokenResult | null>(null);
  const [copied, setCopied] = useState(false);

  const timeZones = useMemo(() => (typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : ['UTC']), []);

  const loadStatus = useCallback(async () => {
    setStatusError(false);
    try {
      const s = await api<SetupStatus>('/setup/status');
      setStatus(s);
      if (s.initialized && !completed.current) router.replace('/login');
    } catch {
      setStatusError(true);
    }
  }, [router]);

  useEffect(() => {
    void loadStatus();
    api<Language[]>('/i18n/languages').then(setLanguages).catch(() => undefined);
    setNetwork((n) => ({ ...n, defaultTimezone: browserTimeZone(), dashboardUrl: window.location.origin }));
  }, [loadStatus]);

  const index = STEPS.indexOf(step);
  const dbReady = !!status?.database.connected && status.database.pendingMigrations === false;
  const servicesUp = !!status?.database.connected && !!status?.redis.connected;

  const passwordError = owner.password && owner.password.length < 12 ? t('setup.owner.passwordTooShort') : null;
  const confirmError = owner.confirm && owner.password !== owner.confirm ? t('setup.owner.passwordMismatch') : null;
  const ownerValid = owner.setupCode.trim() && owner.username.length >= 3 && owner.email.includes('@') && owner.password.length >= 12 && owner.password === owner.confirm;

  async function initialize(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/setup/initialize', {
        method: 'POST',
        body: {
          setupCode: owner.setupCode,
          owner: { username: owner.username, email: owner.email, password: owner.password },
          network,
        },
      });
      completed.current = true;
      storeLocale(network.defaultLocale);
      setStep('velocity');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'INVALID_SETUP_CODE') {
        setError(t('setup.invalidSetupCode'));
        setStep('owner');
      } else if (err instanceof ApiError && err.code === 'ALREADY_INITIALIZED') setError(t('setup.alreadyInitialized'));
      else setError(t(`errors.${errorKey(err)}`));
    } finally {
      setBusy(false);
    }
  }

  async function generateToken() {
    setBusy(true);
    setError(null);
    try {
      setToken(await api<RegistrationTokenResult>('/servers/registration-tokens', { method: 'POST', body: { type: 'VELOCITY', name: proxyName } }));
    } catch (err) {
      setError(t(`errors.${errorKey(err)}`));
    } finally {
      setBusy(false);
    }
  }

  async function copyToken() {
    if (!token) return;
    await navigator.clipboard.writeText(token.token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="bg-blocks flex min-h-dvh flex-col">
      <header className="flex items-center gap-3 p-4">
        <Logo />
        <span className="font-semibold">{t('setup.title')}</span>
        <div className="ml-auto flex gap-2">
          <LanguageSwitcher persist={false} />
          <ThemeToggle persist={false} />
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-4xl flex-1 gap-6 p-4 md:grid-cols-[200px_1fr]">
        <ol className="flex gap-2 overflow-x-auto md:flex-col" aria-label={t('setup.title')}>
          {STEPS.map((s, i) => {
            const Icon = ICONS[s];
            return (
              <li
                key={s}
                aria-current={s === step ? 'step' : undefined}
                className={cn(
                  'flex shrink-0 items-center gap-3 rounded-md px-3 py-2 text-sm',
                  s === step ? 'bg-accent font-medium text-accent-foreground' : i < index ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {i < index ? <Check className="size-4 text-primary" aria-hidden /> : <Icon className="size-4" aria-hidden />}
                {t(`setup.steps.${s}`)}
              </li>
            );
          })}
        </ol>

        <Card>
          <CardContent className="grid gap-5 p-6">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{t('setup.stepOf', { current: index + 1, total: STEPS.length })}</p>
            {error && <Alert variant="destructive">{error}</Alert>}

            {step === 'welcome' && (
              <>
                <div>
                  <h1 className="text-2xl font-semibold">{t('setup.welcome.heading', { appName: t('common.appName') })}</h1>
                  <p className="mt-2 text-sm text-muted-foreground">{t('setup.welcome.description')}</p>
                </div>
                {status ? (
                  <div className="grid gap-2">
                    <StatusRow label={t('setup.welcome.backend')} up detail={t('common.version', { version: status.version })} />
                    <StatusRow label={t('setup.welcome.database')} up={status.database.connected} />
                    <StatusRow label={t('setup.welcome.redis')} up={status.redis.connected} />
                  </div>
                ) : statusError ? (
                  <Alert variant="destructive">{t('errors.network')}</Alert>
                ) : (
                  <div className="grid gap-2">
                    <Skeleton className="h-12" />
                    <Skeleton className="h-12" />
                    <Skeleton className="h-12" />
                  </div>
                )}
                <div className="flex justify-between">
                  <Button variant="outline" onClick={() => void loadStatus()}>
                    {t('common.retry')}
                  </Button>
                  <Button onClick={() => setStep('database')} disabled={!servicesUp}>
                    {t('common.next')}
                  </Button>
                </div>
              </>
            )}

            {step === 'database' && status && (
              <>
                <div>
                  <h2 className="text-xl font-semibold">{t('setup.database.heading')}</h2>
                  <p className="mt-2 text-sm text-muted-foreground">{t('setup.database.description')}</p>
                </div>
                <div className="grid gap-2">
                  <StatusRow label={t('setup.database.connectivity')} up={status.database.connected} />
                  <StatusRow label={t('setup.database.version')} up={!!status.database.version} detail={status.database.version ?? t('common.unknown')} />
                  <StatusRow label={t('setup.database.migrations')} up={dbReady} detail={String(status.database.migrationsApplied ?? '–')} />
                </div>
                {dbReady ? <Alert variant="success">{t('setup.database.upToDate')}</Alert> : <Alert variant="destructive">{t('setup.database.notReady')}</Alert>}
                <div className="flex justify-between">
                  <Button variant="outline" onClick={() => setStep('welcome')}>
                    {t('common.back')}
                  </Button>
                  <Button onClick={() => setStep('owner')} disabled={!dbReady}>
                    {t('common.next')}
                  </Button>
                </div>
              </>
            )}

            {step === 'owner' && (
              <form
                className="grid gap-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  setError(null);
                  if (ownerValid) setStep('network');
                }}
              >
                <div>
                  <h2 className="text-xl font-semibold">{t('setup.owner.heading')}</h2>
                  <p className="mt-2 text-sm text-muted-foreground">{t('setup.owner.description')}</p>
                </div>
                <Field label={t('setup.owner.setupCode')} hint={t('setup.owner.setupCodeHint')} htmlFor="setupCode">
                  <Input id="setupCode" className="font-mono uppercase" autoComplete="off" value={owner.setupCode} onChange={(e) => setOwner({ ...owner, setupCode: e.target.value })} required />
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t('setup.owner.username')} htmlFor="username">
                    <Input id="username" autoComplete="username" value={owner.username} onChange={(e) => setOwner({ ...owner, username: e.target.value })} minLength={3} maxLength={32} required />
                  </Field>
                  <Field label={t('setup.owner.email')} htmlFor="email">
                    <Input id="email" type="email" autoComplete="email" value={owner.email} onChange={(e) => setOwner({ ...owner, email: e.target.value })} required />
                  </Field>
                  <Field label={t('setup.owner.password')} htmlFor="password" error={passwordError}>
                    <Input id="password" type="password" autoComplete="new-password" value={owner.password} onChange={(e) => setOwner({ ...owner, password: e.target.value })} aria-invalid={!!passwordError} minLength={12} required />
                  </Field>
                  <Field label={t('setup.owner.confirmPassword')} htmlFor="confirm" error={confirmError}>
                    <Input id="confirm" type="password" autoComplete="new-password" value={owner.confirm} onChange={(e) => setOwner({ ...owner, confirm: e.target.value })} aria-invalid={!!confirmError} required />
                  </Field>
                </div>
                <div className="flex justify-between">
                  <Button variant="outline" onClick={() => setStep('database')}>
                    {t('common.back')}
                  </Button>
                  <Button type="submit" disabled={!ownerValid}>
                    {t('common.next')}
                  </Button>
                </div>
              </form>
            )}

            {step === 'network' && (
              <form className="grid gap-4" onSubmit={initialize}>
                <h2 className="text-xl font-semibold">{t('setup.network.heading')}</h2>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t('setup.network.name')} htmlFor="netName">
                    <Input id="netName" value={network.name} onChange={(e) => setNetwork({ ...network, name: e.target.value })} maxLength={64} required />
                  </Field>
                  <Field label={t('setup.network.domain')} htmlFor="domain">
                    <Input id="domain" placeholder="play.example.net" value={network.minecraftDomain} onChange={(e) => setNetwork({ ...network, minecraftDomain: e.target.value })} />
                  </Field>
                </div>
                <Field label={t('setup.network.description')} htmlFor="desc">
                  <Textarea id="desc" value={network.description} onChange={(e) => setNetwork({ ...network, description: e.target.value })} maxLength={500} />
                </Field>
                <Field label={t('setup.network.dashboardUrl')} htmlFor="dashUrl">
                  <Input id="dashUrl" type="url" value={network.dashboardUrl} onChange={(e) => setNetwork({ ...network, dashboardUrl: e.target.value })} />
                </Field>
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label={t('setup.network.defaultLanguage')} htmlFor="lang">
                    <Select id="lang" value={network.defaultLocale} onChange={(e) => setNetwork({ ...network, defaultLocale: e.target.value })}>
                      {(languages.length ? languages : [{ locale: 'en-US', nativeName: 'English (US)' }]).map((l) => (
                        <option key={l.locale} value={l.locale}>
                          {l.nativeName}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label={t('setup.network.defaultTimezone')} htmlFor="tz">
                    <Select id="tz" value={network.defaultTimezone} onChange={(e) => setNetwork({ ...network, defaultTimezone: e.target.value })}>
                      {timeZones.map((z) => (
                        <option key={z} value={z}>
                          {z}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label={t('setup.network.defaultTheme')} htmlFor="theme">
                    <Select id="theme" value={network.defaultTheme} onChange={(e) => setNetwork({ ...network, defaultTheme: e.target.value as typeof network.defaultTheme })}>
                      <option value="dark">{t('theme.dark')}</option>
                      <option value="light">{t('theme.light')}</option>
                      <option value="system">{t('theme.system')}</option>
                    </Select>
                  </Field>
                </div>
                <div className="flex justify-between">
                  <Button variant="outline" onClick={() => setStep('owner')} disabled={busy}>
                    {t('common.back')}
                  </Button>
                  <Button type="submit" disabled={busy || !network.name.trim()}>
                    {busy ? t('common.saving') : t('setup.network.submit')}
                  </Button>
                </div>
              </form>
            )}

            {step === 'velocity' && (
              <>
                <div>
                  <h2 className="text-xl font-semibold">{t('setup.velocity.heading')}</h2>
                  <p className="mt-2 text-sm text-muted-foreground">{t('setup.velocity.description')}</p>
                </div>
                {!token ? (
                  <Field label={t('setup.velocity.proxyName')} htmlFor="proxyName">
                    <div className="flex gap-2">
                      <Input id="proxyName" value={proxyName} onChange={(e) => setProxyName(e.target.value)} maxLength={64} />
                      <Button onClick={() => void generateToken()} disabled={busy || proxyName.trim().length < 2}>
                        {t('setup.velocity.generate')}
                      </Button>
                    </div>
                  </Field>
                ) : (
                  <div className="grid gap-2">
                    <span className="text-sm font-medium">{t('setup.velocity.token')}</span>
                    <div className="flex gap-2">
                      <code className="flex-1 overflow-x-auto rounded-md border bg-muted px-3 py-2 font-mono text-sm">{token.token}</code>
                      <Button variant="outline" onClick={() => void copyToken()}>
                        {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                        {copied ? t('common.copied') : t('common.copy')}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">{t('setup.velocity.expires', { time: format.relativeTime(new Date(token.expiresAt), now) })}</p>
                  </div>
                )}
                <div className="flex justify-end gap-2">
                  {!token && (
                    <Button variant="ghost" onClick={() => setStep('finish')}>
                      {t('setup.velocity.skip')}
                    </Button>
                  )}
                  {token && <Button onClick={() => setStep('finish')}>{t('common.next')}</Button>}
                </div>
              </>
            )}

            {step === 'finish' && (
              <>
                <div>
                  <h2 className="text-xl font-semibold">{t('setup.finish.heading')}</h2>
                  <p className="mt-2 text-sm text-muted-foreground">{t('setup.finish.description')}</p>
                </div>
                <dl className="grid gap-2 text-sm">
                  {[
                    [t('setup.finish.summaryNetwork'), network.name],
                    [t('setup.finish.summaryOwner'), `${owner.username} (${owner.email})`],
                    [t('setup.finish.summaryLanguage'), languages.find((l) => l.locale === network.defaultLocale)?.nativeName ?? network.defaultLocale],
                  ].map(([k, v]) => (
                    <div key={k} className="flex justify-between rounded-lg border px-4 py-3">
                      <dt className="text-muted-foreground">{k}</dt>
                      <dd className="font-medium">{v}</dd>
                    </div>
                  ))}
                  <div className="flex justify-between rounded-lg border px-4 py-3">
                    <dt className="text-muted-foreground">{t('setup.finish.summaryVelocity')}</dt>
                    <dd>{token ? <Badge>{t('setup.finish.generated')}</Badge> : <Badge variant="muted">{t('setup.finish.skipped')}</Badge>}</dd>
                  </div>
                </dl>
                <div className="flex justify-end">
                  <Button
                    onClick={() => {
                      router.replace('/');
                      router.refresh();
                    }}
                  >
                    {t('setup.finish.openDashboard')}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
