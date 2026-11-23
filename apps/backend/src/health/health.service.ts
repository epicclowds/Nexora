import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import type { HealthReport } from '@mnm/shared-types';
import { AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

export interface DatabaseStatus {
  connected: boolean;
  version: string | null;
  latencyMs: number | null;
  migrationsApplied: number | null;
  migrationsAvailable: number | null;
  pendingMigrations: boolean | null;
  error?: string;
}

@Injectable()
export class HealthService {
  private readonly startedAt = Date.now();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: AppConfig,
  ) {}

  async database(): Promise<DatabaseStatus> {
    try {
      const started = performance.now();
      const [row] = await this.prisma.$queryRaw<{ version: string }[]>`SELECT VERSION() AS version`;
      const latencyMs = Math.round(performance.now() - started);
      const [applied] = await this.prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*) AS count FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
      const available = await this.countBundledMigrations();
      const appliedCount = Number(applied?.count ?? 0);
      return {
        connected: true,
        version: row?.version ?? null,
        latencyMs,
        migrationsApplied: appliedCount,
        migrationsAvailable: available,
        pendingMigrations: available === null ? null : appliedCount < available,
      };
    } catch (err) {
      return {
        connected: false,
        version: null,
        latencyMs: null,
        migrationsApplied: null,
        migrationsAvailable: null,
        pendingMigrations: null,
        error: err instanceof Error ? err.message.split('\n')[0] : 'unknown error',
      };
    }
  }

  async redisStatus(): Promise<{ connected: boolean; latencyMs: number | null; error?: string }> {
    try {
      return { connected: true, latencyMs: await this.redis.ping() };
    } catch (err) {
      return { connected: false, latencyMs: null, error: err instanceof Error ? err.message : 'unknown error' };
    }
  }

  async report(): Promise<HealthReport> {
    const [db, redis] = await Promise.all([this.database(), this.redisStatus()]);
    return {
      status: db.connected && redis.connected ? 'ok' : 'degraded',
      version: this.config.version,
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
      components: {
        database: { state: db.connected ? 'up' : 'down', version: db.version ?? undefined, latencyMs: db.latencyMs ?? undefined, error: db.error },
        redis: { state: redis.connected ? 'up' : 'down', latencyMs: redis.latencyMs ?? undefined, error: redis.error },
      },
    };
  }

  private async countBundledMigrations(): Promise<number | null> {
    try {
      const entries = await readdir(join(process.cwd(), 'prisma', 'migrations'), { withFileTypes: true });
      return entries.filter((e) => e.isDirectory()).length;
    } catch {
      return null;
    }
  }
}
