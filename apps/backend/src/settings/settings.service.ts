import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { Prisma } from '../generated/prisma/client';
import { themeSchema, timezoneSchema } from '../common/validation';
import { PrismaService } from '../prisma/prisma.service';

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

export const SETTING_KEYS = {
  NETWORK: 'network',
  SETUP_COMPLETED: 'setup.completed',
  SETUP_CODE_HASH: 'setup.codeHash',
  PLAYER_RECORD: 'stats.playerRecord',
} as const;

const DEFAULT_NETWORK: NetworkSettings = networkSettingsSchema.parse({ name: 'Minecraft Network' });

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get<T>(key: string): Promise<T | null> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key } });
    return (row?.value as T | undefined) ?? null;
  }

  async set(key: string, value: Prisma.InputJsonValue, userId: string | null, tx?: Prisma.TransactionClient): Promise<void> {
    const client = tx ?? this.prisma;
    await client.systemSetting.upsert({
      where: { key },
      create: { key, value, updatedByUserId: userId },
      update: { value, updatedByUserId: userId },
    });
  }

  async getNetwork(): Promise<NetworkSettings> {
    const stored = await this.get<unknown>(SETTING_KEYS.NETWORK);
    const parsed = networkSettingsSchema.safeParse(stored ?? {});
    return parsed.success ? parsed.data : DEFAULT_NETWORK;
  }
}
