import { getMessages } from '@mnm/translations';
import { DEFAULT_LOCALE } from '@mnm/shared-types';
import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { isSupportedLocale, isValidTimeZone, LOCALE_COOKIE, TIMEZONE_COOKIE } from './config';

/**
 * Resolves the locale per request: the explicit preference cookie (set from the
 * user's saved preference or the language switcher), otherwise en-US. The
 * browser language is deliberately not used: English is the system default.
 * Messages are merged over English, so missing keys always fall back.
 */
export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const fromCookie = cookieStore.get(LOCALE_COOKIE)?.value;
  const locale = isSupportedLocale(fromCookie) ? fromCookie : DEFAULT_LOCALE;
  const tz = cookieStore.get(TIMEZONE_COOKIE)?.value;

  return {
    locale,
    messages: getMessages(locale) as Record<string, unknown>,
    timeZone: isValidTimeZone(tz) ? tz : 'UTC',
    onError(error) {
      if (process.env.NODE_ENV !== 'production') console.error(error.message);
    },
    getMessageFallback({ namespace, key }) {
      return [namespace, key].filter(Boolean).join('.');
    },
  };
});
