import { useLocale } from 'next-intl';
import { useCallback } from 'react';

/** Compact, locale-aware duration such as "3 h 12 min" / "3 Std. 12 Min.". */
export function formatDuration(totalSeconds: number, locale: string): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const unit = (value: number, u: 'day' | 'hour' | 'minute' | 'second') =>
    new Intl.NumberFormat(locale, { style: 'unit', unit: u, unitDisplay: 'short' }).format(value);

  if (days > 0) return `${unit(days, 'day')} ${unit(hours, 'hour')}`;
  if (hours > 0) return `${unit(hours, 'hour')} ${unit(minutes, 'minute')}`;
  if (minutes > 0) return unit(minutes, 'minute');
  return unit(seconds, 'second');
}

export function useDuration() {
  const locale = useLocale();
  return useCallback((seconds: number) => formatDuration(seconds, locale), [locale]);
}
