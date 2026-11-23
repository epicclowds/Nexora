'use client';

import { Download, Plus, RotateCcw, Trash2, Upload } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { useToast } from '@/components/toaster';
import { Alert, Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input } from '@/components/ui/primitives';
import { Switch } from '@/components/ui/switch';
import { api, ApiError, errorKey, type Language } from '@/lib/api';
import { downloadFile } from '@/lib/zip';

const LOCALE_PATTERN = /^[a-z]{2,3}-[A-Z]{2}$/;
const MAX_IMPORT_BYTES = 90_000;

/**
 * Settings → Languages: enable languages, choose the default, add languages
 * and import/export dashboard catalogues. Imports are validated by the
 * backend (no markup, known keys); missing keys fall back to English.
 */
export function LanguagesManager() {
  const t = useTranslations();
  const format = useFormatter();
  const toast = useToast();
  const [languages, setLanguages] = useState<Language[]>([]);
  const [locale, setLocale] = useState('');
  const [name, setName] = useState('');
  const [importErrors, setImportErrors] = useState<{ locale: string; issues: string[] } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const importTarget = useRef<string>('');

  const load = useCallback(() => api<Language[]>('/i18n/languages').then(setLanguages).catch(() => undefined), []);
  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<unknown>, success = t('settings.saved')) {
    try {
      await action();
      toast(success);
      await load();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'LANGUAGE_EXISTS') toast(t('languages.exists'), 'error');
      else toast(t(`errors.${errorKey(err)}`), 'error');
    }
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    await run(() => api('/i18n/languages', { method: 'POST', body: { locale, name: name.trim() } }), t('languages.created'));
    setLocale('');
    setName('');
  }

  async function exportCatalog(code: string) {
    try {
      const catalog = await api<unknown>(`/i18n/catalogs/${code}`);
      downloadFile(`${code}.json`, `${JSON.stringify(catalog, null, 2)}\n`, 'application/json');
    } catch (err) {
      toast(t(`errors.${errorKey(err)}`), 'error');
    }
  }

  function chooseFile(code: string) {
    importTarget.current = code;
    setImportErrors(null);
    fileInput.current?.click();
  }

  async function importFile(file: File | undefined) {
    const code = importTarget.current;
    if (!file || !code) return;
    if (file.size > MAX_IMPORT_BYTES) {
      toast(t('languages.tooLarge'), 'error');
      return;
    }
    let messages: unknown;
    try {
      messages = JSON.parse(await file.text());
    } catch {
      toast(t('languages.invalidJson'), 'error');
      return;
    }
    try {
      const result = await api<{ missingKeys: number }>(`/i18n/catalogs/${code}`, { method: 'PUT', body: { messages } });
      toast(t('languages.imported', { count: result.missingKeys }));
      await load();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'INVALID_CATALOG') {
        setImportErrors({ locale: code, issues: (err.issues ?? []).map((i) => `${i.path}: ${t(`languages.problems.${i.message as 'unsafe-content'}`)}`) });
      } else toast(t(`errors.${errorKey(err)}`), 'error');
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.languages')}</CardTitle>
        <CardDescription>{t('languages.description')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            void importFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        {importErrors && (
          <Alert variant="destructive" className="grid gap-1">
            <span className="font-medium">{t('languages.importFailed', { locale: importErrors.locale })}</span>
            <ul className="list-inside list-disc text-xs">
              {importErrors.issues.slice(0, 10).map((issue) => (
                <li key={issue} className="break-all">
                  {issue}
                </li>
              ))}
            </ul>
          </Alert>
        )}
        <ul className="grid gap-2">
          {languages.map((l) => (
            <li key={l.locale} className="flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3">
              <div className="min-w-40 flex-1">
                <div className="flex items-center gap-2 font-medium">
                  {l.nativeName}
                  {!l.bundled && <Badge variant="info">{t('languages.added')}</Badge>}
                  {l.customized && <Badge>{t('languages.customized')}</Badge>}
                </div>
                <div className="font-mono text-xs text-muted-foreground">
                  {l.locale}
                  {l.customUpdatedAt && <span className="ml-2 font-sans">{t('languages.importedAt', { time: format.dateTime(new Date(l.customUpdatedAt), { dateStyle: 'medium' }) })}</span>}
                </div>
              </div>
              {typeof l.missingKeys === 'number' && <Badge variant={l.missingKeys === 0 ? 'default' : 'warning'}>{t('settings.missingKeys', { count: l.missingKeys })}</Badge>}
              {l.isDefault ? (
                <Badge variant="info">{t('settings.default')}</Badge>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => void run(() => api(`/i18n/languages/${l.locale}`, { method: 'PATCH', body: { isDefault: true } }))}>
                  {t('settings.setDefault')}
                </Button>
              )}
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={l.enabled}
                  disabled={l.isDefault}
                  onCheckedChange={(v) => void run(() => api(`/i18n/languages/${l.locale}`, { method: 'PATCH', body: { enabled: v } }))}
                  aria-label={t('settings.enabled')}
                />
                {t('settings.enabled')}
              </label>
              <div className="flex gap-1">
                <Button size="icon" variant="ghost" title={t('languages.export')} onClick={() => void exportCatalog(l.locale)}>
                  <Download aria-hidden />
                  <span className="sr-only">{t('languages.export')}</span>
                </Button>
                <Button size="icon" variant="ghost" title={t('languages.import')} onClick={() => chooseFile(l.locale)}>
                  <Upload aria-hidden />
                  <span className="sr-only">{t('languages.import')}</span>
                </Button>
                {l.customized && l.bundled && (
                  <ConfirmDialog
                    trigger={
                      <Button size="icon" variant="ghost" title={t('languages.reset')}>
                        <RotateCcw aria-hidden />
                        <span className="sr-only">{t('languages.reset')}</span>
                      </Button>
                    }
                    title={t('languages.resetTitle', { language: l.nativeName })}
                    description={t('languages.resetDescription')}
                    confirmLabel={t('languages.reset')}
                    onConfirm={() => run(() => api(`/i18n/catalogs/${l.locale}`, { method: 'DELETE' }))}
                  />
                )}
                {!l.bundled && !l.isDefault && (
                  <ConfirmDialog
                    trigger={
                      <Button size="icon" variant="ghost" title={t('common.delete')}>
                        <Trash2 aria-hidden />
                        <span className="sr-only">{t('common.delete')}</span>
                      </Button>
                    }
                    title={t('languages.deleteTitle', { language: l.nativeName })}
                    description={t('languages.deleteDescription')}
                    confirmLabel={t('common.delete')}
                    destructive
                    onConfirm={() => run(() => api(`/i18n/languages/${l.locale}`, { method: 'DELETE' }))}
                  />
                )}
              </div>
            </li>
          ))}
        </ul>

        <form onSubmit={create} className="grid gap-3 rounded-lg border border-dashed p-4 sm:grid-cols-[160px_1fr_auto] sm:items-end">
          <Field label={t('languages.code')} htmlFor="lang-code">
            <Input id="lang-code" placeholder="fr-FR" title={t('languages.codeHint')} value={locale} onChange={(e) => setLocale(e.target.value.trim())} maxLength={16} />
          </Field>
          <Field label={t('languages.name')} htmlFor="lang-name">
            <Input id="lang-name" placeholder="Français" value={name} onChange={(e) => setName(e.target.value)} maxLength={64} />
          </Field>
          <Button type="submit" disabled={!LOCALE_PATTERN.test(locale) || !name.trim()}>
            <Plus aria-hidden />
            {t('languages.add')}
          </Button>
        </form>
        <p className="text-xs text-muted-foreground">{t('languages.workflow')}</p>
      </CardContent>
    </Card>
  );
}
