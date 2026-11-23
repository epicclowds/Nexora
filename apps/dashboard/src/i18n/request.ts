import { getMessages, mergeWithFallback, type MessageTree } from '@mnm/translations';
import { DEFAULT_LOCALE } from '@mnm/shared-types';
import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { isLocaleCode, isSupportedLocale, isValidTimeZone, LOCALE_COOKIE, TIMEZONE_COOKIE } from './config';

const BACKEND = (process.env.BACKEND_INTERNAL_URL ?? 'http://localhost:4000').replace(/\/$/, '');
const CACHE_MS = 30_000;
const cache = new Map<string, { at: number; messages: MessageTree | null }>();

/**
 * Messages imported in the dashboard (Settings → Languages) for an enabled
 * language, cached briefly per server process. `null` = language not
 * available. A backend outage keeps serving the last known value.
 */
async function importedMessages(locale: string): Promise<MessageTree | null> {
  const cached = cache.get(locale);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.messages;
  try {
    const res = await fetch(`${BACKEND}/api/i18n/messages/${encodeURIComponent(locale)}`, { cache: 'no-store', signal: AbortSignal.timeout(2_000) });
    const messages = res.ok ? ((await res.json()) as { messages: MessageTree }).messages : res.status === 404 ? null : (cached?.messages ?? null);
    cache.set(locale, { at: Date.now(), messages });
    return messages;
  } catch {
    return cached?.messages ?? null;
  }
}

/**
 * Resolves the locale per request: the explicit preference cookie (set from the
 * user's saved preference or the language switcher), otherwise en-US. The
 * browser language is deliberately not used: English is the system default.
 * Messages are merged over English, so missing keys always fall back.
 */
export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const fromCookie = cookieStore.get(LOCALE_COOKIE)?.value;
  const tz = cookieStore.get(TIMEZONE_COOKIE)?.value;

  // Bundled languages always work; added ones only while enabled (imported messages exist).
  let locale: string = isLocaleCode(fromCookie) ? fromCookie : DEFAULT_LOCALE;
  let imported = await importedMessages(locale);
  if (!isSupportedLocale(locale) && !imported) {
    locale = DEFAULT_LOCALE;
    imported = await importedMessages(locale);
  }
  const messages = mergeWithFallback(getMessages(locale), imported ?? undefined);

  return {
    locale,
    messages: messages as Record<string, unknown>,
    timeZone: isValidTimeZone(tz) ? tz : 'UTC',
    onError(error) {
      if (process.env.NODE_ENV !== 'production') console.error(error.message);
    },
    getMessageFallback({ namespace, key }) {
      return [namespace, key].filter(Boolean).join('.');
    },
  };
});
