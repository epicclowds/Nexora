'use client';

import { RotateCcw, Search, Zap } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useToast } from '@/components/toaster';
import { Alert, Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input, Select, Textarea } from '@/components/ui/primitives';
import { api, ApiError, errorKey, type Language, type ManagedPluginSettings, type StoredPluginSettings } from '@/lib/api';
import { RANGES, STATISTIC_CATEGORIES } from '@/lib/plugin-config';
import { cn } from '@/lib/utils';

type Tri = 'inherit' | 'on' | 'off';
const toTri = (v: boolean | null): Tri => (v === null ? 'inherit' : v ? 'on' : 'off');
const fromTri = (v: Tri): boolean | null => (v === 'inherit' ? null : v === 'on');

/**
 * Settings → Plugin settings: values pushed to every connected plugin with
 * managed-settings=true. They apply live within one heartbeat; "Server
 * setting" keeps each server's own config.properties value.
 */
export function PluginSettingsEditor() {
  const t = useTranslations();
  const format = useFormatter();
  const toast = useToast();
  const [stored, setStored] = useState<StoredPluginSettings | null>(null);
  const [draft, setDraft] = useState<ManagedPluginSettings | null>(null);
  const [defaults, setDefaults] = useState<Record<string, Record<string, string>>>({});
  const [languages, setLanguages] = useState<Language[]>([]);
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);
  const [issues, setIssues] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const [settings, messages, langs] = await Promise.all([
      api<StoredPluginSettings>('/settings/plugins'),
      api<Record<string, Record<string, string>>>('/settings/plugins/messages'),
      api<Language[]>('/i18n/languages').catch(() => [] as Language[]),
    ]);
    setStored(settings);
    setDraft(settings.settings);
    setDefaults(messages);
    setLanguages(langs);
    setStale(false);
    setIssues({});
  }, []);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  if (!stored || !draft) return null;
  const set = <K extends keyof ManagedPluginSettings>(key: K, value: ManagedPluginSettings[K]) => setDraft({ ...draft, [key]: value });
  const dirty = JSON.stringify(draft) !== JSON.stringify(stored.settings);

  async function save() {
    if (!stored || !draft) return;
    setBusy(true);
    try {
      const next = await api<StoredPluginSettings>('/settings/plugins', { method: 'PUT', body: { baseRevision: stored.revision, settings: draft } });
      setStored(next);
      setDraft(next.settings);
      setIssues({});
      toast(t('pluginSettings.saved'));
    } catch (err) {
      if (err instanceof ApiError && err.code === 'STALE_SETTINGS') setStale(true);
      else if (err instanceof ApiError && err.code === 'INVALID_MESSAGES') {
        setIssues(Object.fromEntries((err.issues ?? []).map((i) => [i.path, i.message])));
        toast(t('pluginSettings.invalidMessages'), 'error');
      } else toast(t(`errors.${errorKey(err)}`), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="grid gap-1.5">
              <CardTitle>{t('pluginSettings.title')}</CardTitle>
              <CardDescription>{t('pluginSettings.description')}</CardDescription>
            </div>
            <Badge variant="info" className="gap-1">
              <Zap aria-hidden className="size-3" />
              {t('pluginSettings.live')}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="grid gap-5">
          {stale && (
            <Alert variant="destructive" className="flex flex-wrap items-center justify-between gap-2">
              {t('pluginSettings.stale')}
              <Button size="sm" variant="outline" onClick={() => void load()}>
                {t('pluginSettings.reload')}
              </Button>
            </Alert>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('pluginSettings.language')} hint={t('pluginSettings.languageHint')} htmlFor="ps-lang">
              <Select id="ps-lang" value={draft.language ?? ''} onChange={(e) => set('language', e.target.value || null)}>
                <option value="">{t('pluginSettings.inherit')}</option>
                {languages.map((l) => (
                  <option key={l.locale} value={l.locale}>
                    {l.nativeName} ({l.locale})
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <fieldset className="grid gap-4 rounded-lg border p-4">
            <legend className="px-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t('integration.statistics')}</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <TriField id="ps-stats" label={t('integration.statisticsEnabled')} value={draft.statisticsEnabled} onChange={(v) => set('statisticsEnabled', v)} />
              <IntervalField id="ps-stat-int" label={t('integration.statisticsInterval')} value={draft.statisticsIntervalSeconds} range={RANGES.statisticsIntervalSeconds} fallback={300} onChange={(v) => set('statisticsIntervalSeconds', v)} />
            </div>
            <div className="grid gap-2">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" className="size-4 accent-primary" checked={draft.statisticsCategories !== null} onChange={(e) => set('statisticsCategories', e.target.checked ? [...STATISTIC_CATEGORIES] : null)} />
                {t('pluginSettings.manageCategories')}
              </label>
              {draft.statisticsCategories !== null && (
                <div className="flex flex-wrap gap-x-5 gap-y-2 pl-6">
                  {STATISTIC_CATEGORIES.map((c) => (
                    <label key={c} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="size-4 accent-primary"
                        checked={draft.statisticsCategories?.includes(c) ?? false}
                        onChange={(e) => set('statisticsCategories', e.target.checked ? [...(draft.statisticsCategories ?? []), c] : (draft.statisticsCategories ?? []).filter((x) => x !== c))}
                      />
                      {t(`integration.category.${c}`)}
                    </label>
                  ))}
                </div>
              )}
            </div>
          </fieldset>

          <fieldset className="grid gap-4 rounded-lg border p-4">
            <legend className="px-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t('integration.inventories')}</legend>
            <div className="grid gap-4 sm:grid-cols-3">
              <TriField id="ps-inv" label={t('integration.inventorySync')} value={draft.inventorySync} onChange={(v) => set('inventorySync', v)} />
              <TriField id="ps-ec" label={t('integration.enderChestSync')} value={draft.enderChestSync} onChange={(v) => set('enderChestSync', v)} />
              <IntervalField id="ps-inv-int" label={t('integration.inventoryInterval')} value={draft.inventorySyncIntervalSeconds} range={RANGES.inventorySyncIntervalSeconds} fallback={300} onChange={(v) => set('inventorySyncIntervalSeconds', v)} />
            </div>
          </fieldset>

          <fieldset className="grid gap-4 rounded-lg border p-4">
            <legend className="px-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t('pluginSettings.punishments')}</legend>
            <Field
              label={t('pluginSettings.appealUrl')}
              hint={t('pluginSettings.appealUrlHint')}
              error={draft.appealUrl && !/^https:\/\/\S+$/.test(draft.appealUrl) ? t('pluginSettings.appealUrlInvalid') : null}
              htmlFor="ps-appeal"
            >
              <Input id="ps-appeal" type="url" inputMode="url" placeholder="https://" maxLength={200} value={draft.appealUrl ?? ''} onChange={(e) => set('appealUrl', e.target.value.trim() || null)} />
            </Field>
          </fieldset>

          <Alert>{t('pluginSettings.localOnly')}</Alert>
        </CardContent>
      </Card>

      <MessageEditor
        messages={draft.messages}
        defaults={defaults}
        languages={languages}
        preferredLocale={draft.language}
        issues={issues}
        onChange={(messages) => set('messages', messages)}
      />

      <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-end gap-3 rounded-lg border bg-background/95 p-3 shadow-sm backdrop-blur">
        <span className="mr-auto text-xs text-muted-foreground">
          {stored.updatedAt ? t('pluginSettings.revision', { revision: stored.revision, time: format.dateTime(new Date(stored.updatedAt), { dateStyle: 'medium', timeStyle: 'short' }) }) : t('pluginSettings.neverSaved')}
        </span>
        <Button variant="ghost" disabled={!dirty || busy} onClick={() => setDraft(stored.settings)}>
          {t('pluginSettings.discard')}
        </Button>
        <Button disabled={!dirty || busy || stale} onClick={() => void save()}>
          {busy ? t('common.saving') : t('pluginSettings.saveAndPush')}
        </Button>
      </div>
    </div>
  );
}

function TriField({ id, label, value, onChange }: { id: string; label: string; value: boolean | null; onChange: (v: boolean | null) => void }) {
  const t = useTranslations();
  return (
    <Field label={label} htmlFor={id}>
      <Select id={id} value={toTri(value)} onChange={(e) => onChange(fromTri(e.target.value as Tri))}>
        <option value="inherit">{t('pluginSettings.inherit')}</option>
        <option value="on">{t('pluginSettings.on')}</option>
        <option value="off">{t('pluginSettings.off')}</option>
      </Select>
    </Field>
  );
}

function IntervalField({ id, label, value, range, fallback, onChange }: { id: string; label: string; value: number | null; range: readonly [number, number]; fallback: number; onChange: (v: number | null) => void }) {
  const t = useTranslations();
  const invalid = value !== null && (!Number.isInteger(value) || value < range[0] || value > range[1]);
  return (
    <Field label={label} hint={t('integration.range', { min: range[0], max: range[1] })} error={invalid ? t('integration.problems.range') : null} htmlFor={id}>
      <div className="flex gap-2">
        <Select aria-label={label} className="w-40 shrink-0" value={value === null ? 'inherit' : 'set'} onChange={(e) => onChange(e.target.value === 'inherit' ? null : fallback)}>
          <option value="inherit">{t('pluginSettings.inherit')}</option>
          <option value="set">{t('pluginSettings.custom')}</option>
        </Select>
        {value !== null && <Input id={id} type="number" min={range[0]} max={range[1]} value={Number.isFinite(value) ? value : ''} onChange={(e) => onChange(e.target.valueAsNumber)} />}
      </div>
    </Field>
  );
}

function MessageEditor({
  messages,
  defaults,
  languages,
  preferredLocale,
  issues,
  onChange,
}: {
  messages: Record<string, Record<string, string>>;
  defaults: Record<string, Record<string, string>>;
  languages: Language[];
  preferredLocale: string | null;
  issues: Record<string, string>;
  onChange: (messages: Record<string, Record<string, string>>) => void;
}) {
  const t = useTranslations();
  const locales = useMemo(
    () => [...new Set(['en-US', ...Object.keys(defaults), ...languages.map((l) => l.locale), ...Object.keys(messages)])].sort(),
    [defaults, languages, messages],
  );
  const [locale, setLocale] = useState(preferredLocale ?? 'en-US');
  const [query, setQuery] = useState('');
  const [onlyChanged, setOnlyChanged] = useState(false);
  const reference = defaults['en-US'] ?? {};
  const base = { ...reference, ...(defaults[locale] ?? {}) };
  const overrides = messages[locale] ?? {};
  const keys = Object.keys(reference)
    .sort()
    .filter((k) => (!onlyChanged || k in overrides) && (!query || k.includes(query.toLowerCase()) || (overrides[k] ?? base[k]).toLowerCase().includes(query.toLowerCase())));

  function update(key: string, value: string | null) {
    const next = { ...overrides };
    if (value === null || value === base[key]) delete next[key];
    else next[key] = value;
    onChange({ ...messages, [locale]: next });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('pluginSettings.messagesTitle')}</CardTitle>
        <CardDescription>{t('pluginSettings.messagesDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-[200px_1fr_auto] sm:items-end">
          <Field label={t('pluginSettings.messageLanguage')} htmlFor="pm-locale">
            <Select id="pm-locale" value={locale} onChange={(e) => setLocale(e.target.value)}>
              {locales.map((l) => (
                <option key={l} value={l}>
                  {languages.find((x) => x.locale === l)?.nativeName ?? l} {messages[l] && Object.keys(messages[l]).length ? `(${Object.keys(messages[l]).length})` : ''}
                </option>
              ))}
            </Select>
          </Field>
          <div className="relative">
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input aria-label={t('pluginSettings.search')} placeholder={t('pluginSettings.search')} className="pl-9" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <label className="flex h-9 items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-primary" checked={onlyChanged} onChange={(e) => setOnlyChanged(e.target.checked)} />
            {t('pluginSettings.onlyChanged')}
          </label>
        </div>
        {!defaults[locale] && <Alert>{t('pluginSettings.noBundled', { locale })}</Alert>}
        <p className="text-xs text-muted-foreground">{t('pluginSettings.formatHint')}</p>
        <ul className="grid gap-3">
          {keys.map((key) => {
            const changed = key in overrides;
            const problem = issues[`${locale}.${key}`];
            return (
              <li key={key} className={cn('grid gap-1.5 rounded-lg border p-3', changed && 'border-primary/50 bg-primary/5', problem && 'border-destructive')}>
                <div className="flex flex-wrap items-center gap-2">
                  <code className="text-xs font-medium">{key}</code>
                  {changed && <Badge variant="info">{t('pluginSettings.overridden')}</Badge>}
                  {changed && (
                    <Button variant="ghost" size="sm" className="ml-auto h-7" onClick={() => update(key, null)}>
                      <RotateCcw aria-hidden />
                      {t('pluginSettings.resetMessage')}
                    </Button>
                  )}
                </div>
                <Textarea
                  aria-label={key}
                  rows={Math.min(5, Math.max(1, (overrides[key] ?? base[key] ?? '').split('\n').length))}
                  className="font-mono text-xs"
                  value={overrides[key] ?? base[key] ?? ''}
                  onChange={(e) => update(key, e.target.value)}
                  maxLength={1000}
                />
                {problem && <span className="text-xs text-destructive">{t(`pluginSettings.problems.${problem as 'unsafe-content'}`)}</span>}
              </li>
            );
          })}
          {keys.length === 0 && <li className="text-sm text-muted-foreground">{t('pluginSettings.noMatches')}</li>}
        </ul>
      </CardContent>
    </Card>
  );
}
