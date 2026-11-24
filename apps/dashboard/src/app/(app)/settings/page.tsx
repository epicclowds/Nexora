'use client';

import { PERMISSIONS } from '@mnm/shared-types';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type FormEvent, Suspense, useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/app-shell';
import { useAuth } from '@/components/auth-provider';
import { LanguagesManager } from '@/components/languages-manager';
import { MinecraftIntegration } from '@/components/minecraft-integration';
import { ModerationPresets } from '@/components/moderation-presets';
import { PluginSettingsEditor } from '@/components/plugin-settings-editor';
import { LanguageSwitcher, ThemeToggle } from '@/components/preference-controls';
import { useToast } from '@/components/toaster';
import { TwoFactorCard } from '@/components/two-factor-card';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input, Label, Select, Skeleton, Textarea } from '@/components/ui/primitives';
import { api, errorKey } from '@/lib/api';
import { browserTimeZone, storeTimeZone } from '@/lib/preferences';
import { cn } from '@/lib/utils';

const SECTIONS = [
  { key: 'general', permission: null },
  { key: 'minecraft', permission: PERMISSIONS.SERVERS_MANAGE },
  { key: 'plugins', permission: PERMISSIONS.SETTINGS_MANAGE },
  { key: 'moderation', permission: PERMISSIONS.SETTINGS_MANAGE },
  { key: 'languages', permission: PERMISSIONS.TRANSLATIONS_MANAGE },
  { key: 'privacy', permission: PERMISSIONS.SETTINGS_MANAGE },
] as const;
type Section = (typeof SECTIONS)[number]['key'];

export default function SettingsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64" />}>
      <Settings />
    </Suspense>
  );
}

function Settings() {
  const t = useTranslations();
  const { can } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const visible = SECTIONS.filter((s) => s.permission === null || can(s.permission)).map((s) => s.key);
  const requested = params.get('section') as Section | null;
  const section: Section = requested && visible.includes(requested) ? requested : 'general';

  return (
    <>
      <PageHeader title={t('settings.title')} subtitle={t('settings.subtitle')} />
      <nav aria-label={t('settings.title')} className="mb-6 flex gap-1 overflow-x-auto border-b [scrollbar-width:none]">
        {visible.map((key) => (
          <button
            key={key}
            type="button"
            aria-current={section === key ? 'page' : undefined}
            onClick={() => router.replace(`${pathname}${key === 'general' ? '' : `?section=${key}`}`, { scroll: false })}
            className={cn(
              '-mb-px shrink-0 border-b-2 px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground',
              section === key ? 'border-primary font-medium text-foreground' : 'border-transparent',
            )}
          >
            {t(`settings.sections.${key}`)}
          </button>
        ))}
      </nav>
      <div className="grid gap-6">
        {section === 'general' && (
          <>
            <PreferencesCard />
            <TwoFactorCard />
            {can(PERMISSIONS.SETTINGS_MANAGE) && <NetworkCard />}
          </>
        )}
        {section === 'minecraft' && <MinecraftIntegration />}
        {section === 'plugins' && <PluginSettingsEditor />}
        {section === 'moderation' && <ModerationPresets />}
        {section === 'languages' && <LanguagesManager />}
        {section === 'privacy' && <PrivacyCard />}
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

const RETENTION_OPTIONS = [30, 90, 180, 365, 730] as const;

function PrivacyCard() {
  const t = useTranslations();
  const toast = useToast();
  const [days, setDays] = useState<number | null | undefined>(undefined);

  useEffect(() => {
    api<{ ipRetentionDays: number | null }>('/settings/privacy').then((p) => setDays(p.ipRetentionDays)).catch(() => undefined);
  }, []);

  async function save(next: number | null) {
    setDays(next);
    try {
      await api('/settings/privacy', { method: 'PATCH', body: { ipRetentionDays: next } });
      toast(t('settings.saved'));
    } catch (err) {
      toast(t(`errors.${errorKey(err)}`), 'error');
    }
  }

  if (days === undefined) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('privacy.title')}</CardTitle>
        <CardDescription>{t('privacy.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <Field label={t('privacy.ipRetention')} hint={t('privacy.ipRetentionHint')} htmlFor="ip-retention">
          <Select id="ip-retention" className="max-w-xs" value={days === null ? 'forever' : String(days)} onChange={(e) => void save(e.target.value === 'forever' ? null : Number(e.target.value))}>
            {[...new Set([...RETENTION_OPTIONS, ...(days === null ? [] : [days])])].sort((a, b) => a - b).map((d) => (
              <option key={d} value={d}>
                {t('privacy.days', { count: d })}
              </option>
            ))}
            <option value="forever">{t('privacy.keepForever')}</option>
          </Select>
        </Field>
      </CardContent>
    </Card>
  );
}
