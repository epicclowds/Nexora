'use client';

import { Languages, Monitor, Moon, Sun } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { useEffect, useState, useTransition } from 'react';
import { api, type Language } from '@/lib/api';
import { storeLocale } from '@/lib/preferences';
import { cn } from '@/lib/utils';

/**
 * Language selector. Switching is immediate: the locale cookie is updated and
 * the server components re-render with the new catalogue (no reload/restart).
 * When signed in the preference is also saved to the account.
 */
export function LanguageSwitcher({ persist, className }: { persist: boolean; className?: string }) {
  const t = useTranslations('language');
  const locale = useLocale();
  const router = useRouter();
  const [languages, setLanguages] = useState<Language[]>([]);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    api<Language[]>('/i18n/languages')
      .then((list) => setLanguages(list.filter((l) => l.enabled)))
      .catch(() => setLanguages([]));
  }, []);

  async function change(next: string) {
    if (persist) await api('/auth/me', { method: 'PATCH', body: { locale: next } }).catch(() => undefined);
    storeLocale(next);
    startTransition(() => router.refresh());
  }

  const options = languages.length ? languages : [{ locale, nativeName: locale }];

  return (
    <label className={cn('relative inline-flex min-w-0 max-w-full items-center', className)}>
      <span className="sr-only">{t('label')}</span>
      <Languages className="pointer-events-none absolute left-2.5 size-4 text-muted-foreground" aria-hidden />
      <select
        value={locale}
        title={options.find((l) => l.locale === locale)?.nativeName}
        disabled={pending}
        onChange={(e) => void change(e.target.value)}
        className="h-9 min-w-0 max-w-full truncate rounded-md border border-input bg-background pl-8 pr-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {options.map((l) => (
          <option key={l.locale} value={l.locale}>
            {l.nativeName}
          </option>
        ))}
      </select>
    </label>
  );
}

const THEMES = [
  { value: 'dark', icon: Moon },
  { value: 'light', icon: Sun },
  { value: 'system', icon: Monitor },
] as const;

export function ThemeToggle({ persist }: { persist: boolean }) {
  const t = useTranslations('theme');
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  function change(next: (typeof THEMES)[number]['value']) {
    setTheme(next);
    if (persist) void api('/auth/me', { method: 'PATCH', body: { theme: next } }).catch(() => undefined);
  }

  return (
    <div role="radiogroup" aria-label={t('label')} className="inline-flex h-9 w-fit shrink-0 items-center rounded-md border border-input p-0.5">
      {THEMES.map(({ value, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={mounted && theme === value}
          title={t(value)}
          onClick={() => change(value)}
          className={cn(
            'inline-flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground',
            mounted && theme === value && 'bg-accent text-accent-foreground',
          )}
        >
          <Icon className="size-4" aria-hidden />
          <span className="sr-only">{t(value)}</span>
        </button>
      ))}
    </div>
  );
}
