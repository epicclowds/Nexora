import { STAT_DEFINITIONS, STATS, type StatCategory, type StatKey, type StatUnit } from '@mnm/shared-types';
import { useFormatter, useTranslations } from 'next-intl';
import { useCallback } from 'react';
import { useDuration } from './format';

export type StatName = keyof typeof STATS;

/** Reverse lookup: "custom:minecraft:jump" → "JUMPS" (translation key). */
export const STAT_NAME: Record<StatKey, StatName> = Object.fromEntries(Object.entries(STATS).map(([name, key]) => [key, name])) as Record<StatKey, StatName>;

export const STATS_BY_CATEGORY: Record<StatCategory, StatKey[]> = {
  movement: STAT_DEFINITIONS.filter((d) => d.category === 'movement').map((d) => d.key),
  combat: STAT_DEFINITIONS.filter((d) => d.category === 'combat').map((d) => d.key),
  blocks: STAT_DEFINITIONS.filter((d) => d.category === 'blocks').map((d) => d.key),
  general: STAT_DEFINITIONS.filter((d) => d.category === 'general').map((d) => d.key),
};

const UNIT: Record<string, StatUnit> = Object.fromEntries(STAT_DEFINITIONS.map((d) => [d.key, d.unit]));

/** "minecraft:deepslate_diamond_ore" → "Deepslate Diamond Ore" (game ids are not translated). */
export function prettyId(id: string): string {
  return id
    .replace(/^minecraft:/, '')
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Formats a raw statistic value according to its unit (cm → km, damage → hearts, ticks/seconds → duration). */
export function useStatFormatter() {
  const t = useTranslations('stats');
  const format = useFormatter();
  const duration = useDuration();
  return useCallback(
    (key: StatKey, value: number) => {
      switch (UNIT[key]) {
        case 'cm':
          return t('km', { value: format.number(value / 100_000, { maximumFractionDigits: value < 100_000 ? 2 : 1 }) });
        case 'damage':
          // Minecraft records damage in tenths of a health point; one heart is two health points.
          return t('hearts', { value: format.number(value / 20, { maximumFractionDigits: 1 }) });
        case 'ticks':
          return duration(value / 20);
        case 'seconds':
          return duration(value);
        default:
          return format.number(value);
      }
    },
    [t, format, duration],
  );
}
