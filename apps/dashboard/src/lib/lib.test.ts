import { BUNDLED_LOCALES, DEFAULT_LOCALE } from '@mnm/shared-types';
import { bundledCatalogs, findMissingKeys, flattenMessages } from '@mnm/translations';
import { describe, expect, it } from 'vitest';
import { isSupportedLocale, isValidTimeZone } from '@/i18n/config';
import { ApiError, errorKey } from './api';
import { formatBytes } from './utils';

describe('i18n config', () => {
  it('only accepts bundled locales', () => {
    expect(isSupportedLocale('en-US')).toBe(true);
    expect(isSupportedLocale('de-DE')).toBe(true);
    expect(isSupportedLocale('xx-XX')).toBe(false);
    expect(isSupportedLocale(undefined)).toBe(false);
  });

  it('validates time zones', () => {
    expect(isValidTimeZone('Europe/Berlin')).toBe(true);
    expect(isValidTimeZone('Nope/Nowhere')).toBe(false);
  });

  it('ships a complete catalogue for every bundled locale', () => {
    for (const locale of BUNDLED_LOCALES) {
      expect(bundledCatalogs[locale], locale).toBeDefined();
      expect(findMissingKeys(bundledCatalogs[DEFAULT_LOCALE], bundledCatalogs[locale]), locale).toEqual([]);
    }
  });

  it('keeps English as the default locale', () => {
    expect(DEFAULT_LOCALE).toBe('en-US');
    expect(Object.keys(flattenMessages(bundledCatalogs['en-US'])).length).toBeGreaterThan(100);
  });
});

describe('formatBytes', () => {
  it('formats with locale-aware separators', () => {
    expect(formatBytes('536870912', 'en-US')).toBe('512 MB');
    expect(formatBytes(1536, 'de-DE')).toBe('1,5 KB');
    expect(formatBytes(null, 'en-US')).toBeNull();
  });
});

describe('errorKey', () => {
  it('maps API errors to translation keys', () => {
    expect(errorKey(new ApiError(403, 'FORBIDDEN', 'x'))).toBe('forbidden');
    expect(errorKey(new ApiError(0, 'NETWORK_ERROR', 'x'))).toBe('network');
    expect(errorKey(new ApiError(409, 'CONFLICT', 'x'))).toBe('conflict');
    expect(errorKey(new Error('x'))).toBe('generic');
  });
});
