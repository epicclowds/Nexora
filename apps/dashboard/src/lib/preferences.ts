import { LOCALE_COOKIE, TIMEZONE_COOKIE } from '@/i18n/config';

const ONE_YEAR = 60 * 60 * 24 * 365;

function writeCookie(name: string, value: string): void {
  const secure = window.location.protocol === 'https:' ? '; secure' : '';
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${ONE_YEAR}; samesite=lax${secure}`;
}

function readCookie(name: string): string | null {
  const match = document.cookie.split('; ').find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

/** Stores the UI locale for server rendering. Returns true when it changed. */
export function storeLocale(locale: string): boolean {
  if (readCookie(LOCALE_COOKIE) === locale) return false;
  writeCookie(LOCALE_COOKIE, locale);
  return true;
}

/** Stores the display time zone used for formatting timestamps. Returns true when it changed. */
export function storeTimeZone(timeZone: string): boolean {
  if (readCookie(TIMEZONE_COOKIE) === timeZone) return false;
  writeCookie(TIMEZONE_COOKIE, timeZone);
  return true;
}

export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}
