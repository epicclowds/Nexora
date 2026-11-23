import type enUS from '@mnm/translations/locales/en-US.json';
import type { AppLocale } from './i18n/config';

// Type-safe translation keys: using an unknown key is a compile error.
declare module 'next-intl' {
  interface AppConfig {
    Locale: AppLocale;
    Messages: typeof enUS;
  }
}
