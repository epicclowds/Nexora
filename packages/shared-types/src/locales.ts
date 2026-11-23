export const DEFAULT_LOCALE = 'en-US' as const;

/** Locales shipped with the platform. Additional locales can be registered at runtime. */
export const BUNDLED_LOCALES = ['en-US', 'de-DE'] as const;
export type BundledLocale = (typeof BUNDLED_LOCALES)[number];

/** BCP 47 tag of form ll-RR, e.g. en-US. Used to validate user-supplied locale codes. */
export const LOCALE_PATTERN = /^[a-z]{2,3}-[A-Z]{2}$/;

export function isValidLocaleCode(value: string): boolean {
  return LOCALE_PATTERN.test(value);
}
