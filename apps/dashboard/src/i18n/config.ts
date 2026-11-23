import { BUNDLED_LOCALES, isValidLocaleCode } from '@mnm/shared-types';

export const LOCALE_COOKIE = 'NEXT_LOCALE';
export const TIMEZONE_COOKIE = 'mnm_tz';

/** BCP 47 code (ll-RR). Besides the bundled locales, administrators can add languages at runtime. */
export type AppLocale = string;

/** Locales whose catalogue ships with the dashboard. */
export function isSupportedLocale(value: string | undefined | null): value is AppLocale {
  return !!value && (BUNDLED_LOCALES as readonly string[]).includes(value);
}

/** Syntactically valid locale code (bundled or possibly added at runtime). */
export function isLocaleCode(value: string | undefined | null): value is AppLocale {
  return !!value && isValidLocaleCode(value);
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
