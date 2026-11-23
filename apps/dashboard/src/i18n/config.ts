import { BUNDLED_LOCALES } from '@mnm/shared-types';

export const LOCALE_COOKIE = 'NEXT_LOCALE';
export const TIMEZONE_COOKIE = 'mnm_tz';

export type AppLocale = (typeof BUNDLED_LOCALES)[number];

export function isSupportedLocale(value: string | undefined | null): value is AppLocale {
  return !!value && (BUNDLED_LOCALES as readonly string[]).includes(value);
}

export function isValidTimeZone(value: string | undefined | null): value is string {
  if (!value) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
