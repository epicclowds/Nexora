import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { Prisma } from '../generated/prisma/client';
import { themeSchema, timezoneSchema } from '../common/validation';
import { PrismaService } from '../prisma/prisma.service';
import { EMPTY_PLUGIN_SETTINGS, managedPluginSettingsSchema, type ModerationSettings, moderationSettingsSchema, type StoredPluginSettings } from './plugin-settings';

export const networkSettingsSchema = z.object({
  name: z.string().trim().min(1).max(64),
  description: z.string().trim().max(500).default(''),
  minecraftDomain: z
    .string()
    .trim()
    .max(253)
    .regex(/^$|^[A-Za-z0-9.-]+(:\d{1,5})?$/, 'Invalid domain')
    .default(''),
  dashboardUrl: z.union([z.literal(''), z.url({ protocol: /^https?$/ }).max(2048)]).default(''),
  defaultTimezone: timezoneSchema.default('UTC'),
  defaultTheme: themeSchema.default('dark'),
});

export type NetworkSettings = z.infer<typeof networkSettingsSchema>;

/** Data minimisation. IP addresses older than the retention period are removed (null = keep). */
export const privacySettingsSchema = z.object({
  ipRetentionDays: z.number().int().min(7).max(3650).nullable().default(180),
  /** Removed (soft-deleted) evidence is purged after this many days (null = keep). */
  deletedEvidenceRetentionDays: z.number().int().min(1).max(3650).nullable().default(90),
});
export type PrivacySettings = z.infer<typeof privacySettingsSchema>;

export const SETTING_KEYS = {
  NETWORK: 'network',
  SETUP_COMPLETED: 'setup.completed',
  SETUP_CODE_HASH: 'setup.codeHash',
  PLAYER_RECORD: 'stats.playerRecord',
  PRIVACY: 'privacy',
  PLUGINS: 'plugins.managed',
  MODERATION: 'moderation',
} as const;

const DEFAULT_NETWORK: NetworkSettings = networkSettingsSchema.parse({ name: 'Minecraft Network' });

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get<T>(key: string, tx?: Prisma.TransactionClient): Promise<T | null> {
    const row = await (tx ?? this.prisma).systemSetting.findUnique({ where: { key } });
    return (row?.value as T | undefined) ?? null;
  }

  async set(key: string, value: Prisma.InputJsonValue, userId: string | null, tx?: Prisma.TransactionClient): Promise<void> {
    const client = tx ?? this.prisma;
    await client.systemSetting.upsert({
      where: { key },
      create: { key, value, updatedByUserId: userId },
      update: { value, updatedByUserId: userId },
    });
    if (key === SETTING_KEYS.PLUGINS) this.revisionCache = null;
  }

  async getPrivacy(): Promise<PrivacySettings> {
    const parsed = privacySettingsSchema.safeParse((await this.get<unknown>(SETTING_KEYS.PRIVACY)) ?? {});
    return parsed.success ? parsed.data : privacySettingsSchema.parse({});
  }

  async getNetwork(): Promise<NetworkSettings> {
    const stored = await this.get<unknown>(SETTING_KEYS.NETWORK);
    const parsed = networkSettingsSchema.safeParse(stored ?? {});
    return parsed.success ? parsed.data : DEFAULT_NETWORK;
  }

  /** Centrally managed plugin settings with their revision (0 = never saved). */
  async getPluginSettings(tx?: Prisma.TransactionClient): Promise<StoredPluginSettings> {
    const stored = await this.get<{ revision?: unknown; settings?: unknown; updatedAt?: unknown }>(SETTING_KEYS.PLUGINS, tx);
    const parsed = managedPluginSettingsSchema.safeParse(stored?.settings ?? {});
    return {
      revision: typeof stored?.revision === 'number' ? stored.revision : 0,
      settings: parsed.success ? parsed.data : EMPTY_PLUGIN_SETTINGS,
      updatedAt: typeof stored?.updatedAt === 'string' ? stored.updatedAt : null,
    };
  }

  private revisionCache: { value: number; at: number } | null = null;

  /** Current plugin settings revision, cached briefly (asked on every heartbeat). */
  async pluginSettingsRevision(): Promise<number> {
    const now = Date.now();
    if (this.revisionCache && now - this.revisionCache.at < 5_000) return this.revisionCache.value;
    const rows = await this.prisma.$queryRaw<{ revision: bigint | number | null }[]>`
      SELECT CAST(JSON_EXTRACT(value, '$.revision') AS UNSIGNED) AS revision FROM system_settings WHERE \`key\` = ${SETTING_KEYS.PLUGINS}`;
    const value = Number(rows[0]?.revision ?? 0);
    this.revisionCache = { value, at: now };
    return value;
  }

  async getModeration(): Promise<ModerationSettings> {
    const parsed = moderationSettingsSchema.safeParse((await this.get<unknown>(SETTING_KEYS.MODERATION)) ?? {});
    return parsed.success ? parsed.data : { presets: [], requireEvidence: false };
  }
}
