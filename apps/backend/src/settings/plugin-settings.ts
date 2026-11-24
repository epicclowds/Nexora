import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isValidLocaleCode } from '@mnm/shared-types';
import { DEFAULT_LOCALE, messagePlaceholders, parseMinecraftCatalog } from '@mnm/translations';
import { z } from 'zod';

/**
 * Settings managed centrally in the dashboard and pushed to connected plugins.
 * Every field is optional: `null` keeps the value from the server's own
 * config.properties. All of them apply live (no restart); options that only
 * the server owner should control (backend URL, AntiCheat allow-list, IP
 * collection, buffers) stay local on purpose.
 */
export const STATISTIC_CATEGORIES = ['movement', 'combat', 'blocks', 'general'] as const;

/** Tags that could make a message run commands or leak data when clicked. */
const UNSAFE_MINIMESSAGE = /<\s*\/?\s*(click|insert|insertion|nbt|data|selector|sel|score)\b/i;
export const MAX_PLUGIN_MESSAGE_LENGTH = 1000;

const localeKey = z.string().refine(isValidLocaleCode, 'Invalid locale code');

export const managedPluginSettingsSchema = z
  .object({
    language: localeKey.nullable().default(null),
    statisticsEnabled: z.boolean().nullable().default(null),
    statisticsCategories: z.array(z.enum(STATISTIC_CATEGORIES)).max(STATISTIC_CATEGORIES.length).nullable().default(null),
    statisticsIntervalSeconds: z.number().int().min(60).max(3600).nullable().default(null),
    inventorySync: z.boolean().nullable().default(null),
    enderChestSync: z.boolean().nullable().default(null),
    inventorySyncIntervalSeconds: z.number().int().min(30).max(3600).nullable().default(null),
    /** Shown on ban screens (https only); null = no appeal line. */
    appealUrl: z
      .string()
      .trim()
      .max(200)
      .regex(/^https:\/\/[^\s]+$/, 'Must be an https:// URL')
      .nullable()
      .default(null),
    /** locale → message key → MiniMessage template overriding the bundled text. */
    messages: z.record(localeKey, z.record(z.string().max(128), z.string().max(MAX_PLUGIN_MESSAGE_LENGTH))).default({}),
  })
  .strict();

export type ManagedPluginSettings = z.infer<typeof managedPluginSettingsSchema>;
export interface StoredPluginSettings {
  revision: number;
  settings: ManagedPluginSettings;
  updatedAt: string | null;
}

export const EMPTY_PLUGIN_SETTINGS: ManagedPluginSettings = managedPluginSettingsSchema.parse({});

// ── Bundled plugin message catalogues ────────────────────────────────

let catalogs: Record<string, Record<string, string>> | null = null;

/** Bundled plugin messages (packages/translations/minecraft/*.yml), loaded once. */
export function pluginCatalogs(): Record<string, Record<string, string>> {
  if (catalogs) return catalogs;
  const dir = join(dirname(require.resolve('@mnm/translations/package.json')), 'minecraft');
  const loaded: Record<string, Record<string, string>> = {};
  for (const locale of ['en-US', 'de-DE']) {
    try {
      loaded[locale] = parseMinecraftCatalog(readFileSync(join(dir, `${locale}.yml`), 'utf8'));
    } catch {
      // A missing optional catalogue only means no bundled defaults for it.
    }
  }
  if (!loaded[DEFAULT_LOCALE]) throw new Error(`Bundled plugin messages (${DEFAULT_LOCALE}.yml) not found in ${dir}`);
  catalogs = loaded;
  return catalogs;
}

export interface MessageIssue {
  locale: string;
  key: string;
  problem: 'unknown-key' | 'unsafe-content' | 'unknown-placeholder' | 'empty';
}

/** Validates message overrides against the bundled en-US catalogue. */
export function validatePluginMessages(messages: ManagedPluginSettings['messages']): MessageIssue[] {
  const reference = pluginCatalogs()[DEFAULT_LOCALE];
  const issues: MessageIssue[] = [];
  for (const [locale, entries] of Object.entries(messages)) {
    for (const [key, text] of Object.entries(entries)) {
      const base = reference[key];
      if (base === undefined) {
        issues.push({ locale, key, problem: 'unknown-key' });
        continue;
      }
      if (!text.trim() && key !== 'prefix') issues.push({ locale, key, problem: 'empty' });
      if (UNSAFE_MINIMESSAGE.test(text)) issues.push({ locale, key, problem: 'unsafe-content' });
      const allowed = new Set(messagePlaceholders(base));
      if (messagePlaceholders(text).some((p) => !allowed.has(p))) issues.push({ locale, key, problem: 'unknown-placeholder' });
    }
  }
  return issues;
}

/** Drops empty locale maps so the stored document stays small. */
export function normalizePluginSettings(settings: ManagedPluginSettings): ManagedPluginSettings {
  const messages = Object.fromEntries(Object.entries(settings.messages).filter(([, entries]) => Object.keys(entries).length > 0));
  const categories = settings.statisticsCategories ? [...new Set(settings.statisticsCategories)].sort() : null;
  return { ...settings, statisticsCategories: categories as ManagedPluginSettings['statisticsCategories'], messages };
}

// ── Moderation presets (ban reasons and durations) ───────────────────

export const PRESET_TYPES = ['BAN', 'TEMP_BAN', 'MUTE', 'TEMP_MUTE', 'KICK', 'WARNING', 'BLACKLIST'] as const;
const TEMPORARY = new Set(['TEMP_BAN', 'TEMP_MUTE']);

export const moderationPresetSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{1,40}$/),
    name: z.string().trim().min(1).max(64),
    type: z.enum(PRESET_TYPES),
    reason: z.string().trim().min(1).max(500),
    durationSeconds: z.number().int().min(60).max(10 * 365 * 86_400).nullable().default(null),
  })
  .strict()
  .refine((p) => TEMPORARY.has(p.type) === (p.durationSeconds !== null), { message: 'Temporary presets need a duration, others must not have one', path: ['durationSeconds'] });

export const moderationSettingsSchema = z
  .object({
    presets: z
      .array(moderationPresetSchema)
      .max(50)
      .refine((list) => new Set(list.map((p) => p.id)).size === list.length, 'Preset IDs must be unique')
      .default([]),
    /** Flag active punishments without evidence for review (they stay in force). */
    requireEvidence: z.boolean().default(false),
  })
  .strict();
export type ModerationSettings = z.infer<typeof moderationSettingsSchema>;
