'use client';

import { PERMISSIONS } from '@mnm/shared-types';
import { Check, Copy, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/app-shell';
import { useAuth } from '@/components/auth-provider';
import { LanguageSwitcher, ThemeToggle } from '@/components/preference-controls';
import { useToast } from '@/components/toaster';
import { Alert, Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input, Label, Select, Textarea } from '@/components/ui/primitives';
import { Switch } from '@/components/ui/switch';
import { api, errorKey, type Language, type RegistrationTokenResult } from '@/lib/api';
import { browserTimeZone, storeTimeZone } from '@/lib/preferences';

export default function SettingsPage() {
  const t = useTranslations();
  const { can } = useAuth();
  return (
    <>
      <PageHeader title={t('settings.title')} subtitle={t('settings.subtitle')} />
      <div className="grid gap-6">
        <PreferencesCard />
        {can(PERMISSIONS.SETTINGS_MANAGE) && <NetworkCard />}
        {can(PERMISSIONS.TRANSLATIONS_MANAGE) && <LanguagesCard />}
        {can(PERMISSIONS.SERVERS_MANAGE) && <MinecraftCard />}
      </div>
    </>
  );
}

function PreferencesCard() {
  const t = useTranslations();
  const toast = useToast();
  const router = useRouter();
  const { user } = useAuth();
  const [timezone, setTimezone] = useState(user.timezone ?? browserTimeZone());
  const zones = useMemo(() => (typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : ['UTC']), []);

  async function saveTimezone(next: string) {
    setTimezone(next);
    try {
      await api('/auth/me', { method: 'PATCH', body: { timezone: next } });
      if (storeTimeZone(next)) router.refresh();
      toast(t('settings.saved'));
    } catch (err) {
      toast(t(`errors.${errorKey(err)}`), 'error');
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.preferences')}</CardTitle>
        <CardDescription>{t('settings.preferencesDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-3">
        <div className="grid gap-1.5">
          <Label>{t('settings.language')}</Label>
          <LanguageSwitcher persist className="w-full [&_select]:w-full" />
        </div>
        <div className="grid gap-1.5">
          <Label>{t('settings.theme')}</Label>
          <ThemeToggle persist />
        </div>
        <Field label={t('settings.timezone')} htmlFor="pref-tz">
          <Select id="pref-tz" value={timezone} onChange={(e) => void saveTimezone(e.target.value)}>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </Select>
        </Field>
      </CardContent>
    </Card>
  );
}

interface NetworkSettings {
  name: string;
  description: string;
  minecraftDomain: string;
  dashboardUrl: string;
  defaultTimezone: string;
  defaultTheme: 'dark' | 'light' | 'system';
}

function NetworkCard() {
  const t = useTranslations();
  const toast = useToast();
  const [form, setForm] = useState<NetworkSettings | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<NetworkSettings>('/settings/network').then(setForm).catch(() => undefined);
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setBusy(true);
    try {
      setForm(await api<NetworkSettings>('/settings/network', { method: 'PATCH', body: form }));
      toast(t('settings.saved'));
    } catch (err) {
      toast(t(`errors.${errorKey(err)}`), 'error');
    } finally {
      setBusy(false);
    }
  }

  if (!form) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.network')}</CardTitle>
        <CardDescription>{t('settings.networkDescription')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('setup.network.name')} htmlFor="n-name">
              <Input id="n-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={64} required />
            </Field>
            <Field label={t('setup.network.domain')} htmlFor="n-domain">
              <Input id="n-domain" value={form.minecraftDomain} onChange={(e) => setForm({ ...form, minecraftDomain: e.target.value })} />
            </Field>
          </div>
          <Field label={t('setup.network.description')} htmlFor="n-desc">
            <Textarea id="n-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={500} />
          </Field>
          <Field label={t('setup.network.dashboardUrl')} htmlFor="n-url">
            <Input id="n-url" type="url" value={form.dashboardUrl} onChange={(e) => setForm({ ...form, dashboardUrl: e.target.value })} />
          </Field>
          <div className="flex justify-end">
            <Button type="submit" disabled={busy}>
              {busy ? t('common.saving') : t('common.save')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function LanguagesCard() {
  const t = useTranslations();
  const toast = useToast();
  const [languages, setLanguages] = useState<Language[]>([]);

  const load = useCallback(() => api<Language[]>('/i18n/languages').then(setLanguages).catch(() => undefined), []);
  useEffect(() => {
    void load();
  }, [load]);

  async function update(locale: string, body: { enabled?: boolean; isDefault?: true }) {
    try {
      await api(`/i18n/languages/${locale}`, { method: 'PATCH', body });
      toast(t('settings.saved'));
      await load();
    } catch (err) {
      toast(t(`errors.${errorKey(err)}`), 'error');
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.languages')}</CardTitle>
        <CardDescription>{t('settings.languagesDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2">
        {languages.map((l) => (
          <div key={l.locale} className="flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3">
            <div className="min-w-40 flex-1">
              <div className="font-medium">{l.nativeName}</div>
              <div className="font-mono text-xs text-muted-foreground">{l.locale}</div>
            </div>
            {typeof l.missingKeys === 'number' && <Badge variant={l.missingKeys === 0 ? 'default' : 'warning'}>{t('settings.missingKeys', { count: l.missingKeys })}</Badge>}
            {l.isDefault ? (
              <Badge variant="info">{t('settings.default')}</Badge>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => void update(l.locale, { isDefault: true })}>
                {t('settings.setDefault')}
              </Button>
            )}
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={l.enabled} disabled={l.isDefault} onCheckedChange={(v) => void update(l.locale, { enabled: v })} aria-label={t('settings.enabled')} />
              {t('settings.enabled')}
            </label>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

interface PendingToken {
  id: string;
  serverType: 'VELOCITY' | 'PAPER';
  serverName: string;
  expiresAt: string;
}

function MinecraftCard() {
  const t = useTranslations();
  const format = useFormatter();
  const now = useNow({ updateInterval: 30_000 });
  const toast = useToast();
  const [type, setType] = useState<'VELOCITY' | 'PAPER'>('PAPER');
  const [name, setName] = useState('');
  const [created, setCreated] = useState<RegistrationTokenResult | null>(null);
  const [pending, setPending] = useState<PendingToken[]>([]);
  const [copied, setCopied] = useState(false);

  const load = useCallback(() => api<PendingToken[]>('/servers/registration-tokens').then(setPending).catch(() => undefined), []);
  useEffect(() => {
    void load();
  }, [load]);

  async function create(e: FormEvent) {
    e.preventDefault();
    try {
      setCreated(await api<RegistrationTokenResult>('/servers/registration-tokens', { method: 'POST', body: { type, name } }));
      setName('');
      await load();
    } catch (err) {
      toast(t(`errors.${errorKey(err)}`), 'error');
    }
  }

  async function revoke(id: string) {
    await api(`/servers/registration-tokens/${id}`, { method: 'DELETE' }).catch(() => undefined);
    if (created?.id === id) setCreated(null);
    await load();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.minecraft')}</CardTitle>
        <CardDescription>{t('settings.minecraftDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <form onSubmit={create} className="grid gap-3 sm:grid-cols-[160px_1fr_auto] sm:items-end">
          <Field label={t('settings.serverType')} htmlFor="tok-type">
            <Select id="tok-type" value={type} onChange={(e) => setType(e.target.value as 'VELOCITY' | 'PAPER')}>
              <option value="VELOCITY">Velocity</option>
              <option value="PAPER">Paper</option>
            </Select>
          </Field>
          <Field label={t('settings.serverName')} htmlFor="tok-name">
            <Input id="tok-name" placeholder="lobby-1" value={name} onChange={(e) => setName(e.target.value)} pattern="[A-Za-z0-9_.\-]+" maxLength={64} required />
          </Field>
          <Button type="submit" disabled={name.trim().length < 2}>
            {t('settings.createToken')}
          </Button>
        </form>

        {created && (
          <Alert variant="success" className="grid gap-2">
            <span>{t('settings.tokenCreated', { time: format.relativeTime(new Date(created.expiresAt), now) })}</span>
            <div className="flex gap-2">
              <code className="flex-1 overflow-x-auto rounded-md border bg-background px-3 py-2 font-mono text-xs text-foreground">{created.token}</code>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void navigator.clipboard.writeText(created.token);
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

        {pending.length > 0 && (
          <ul className="grid gap-2">
            {pending.map((p) => (
              <li key={p.id} className="flex items-center gap-3 rounded-lg border px-4 py-2 text-sm">
                <Badge variant={p.serverType === 'VELOCITY' ? 'info' : 'default'}>{p.serverType === 'VELOCITY' ? 'Velocity' : 'Paper'}</Badge>
                <span className="flex-1 font-medium">{p.serverName}</span>
                <span className="text-xs text-muted-foreground">{t('setup.velocity.expires', { time: format.relativeTime(new Date(p.expiresAt), now) })}</span>
                <Button variant="ghost" size="icon" onClick={() => void revoke(p.id)} title={t('common.delete')}>
                  <Trash2 aria-hidden />
                  <span className="sr-only">{t('common.delete')}</span>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
