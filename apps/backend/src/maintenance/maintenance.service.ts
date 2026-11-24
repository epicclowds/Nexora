import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { SettingsService } from '../settings/settings.service';

const INTERVAL_MS = 60 * 60_000;
const EXPIRED_SESSION_GRACE_DAYS = 30;

/**
 * Periodic housekeeping (one replica at a time):
 * - removes IP addresses older than the configured retention period from
 *   connection records and the audit log (approximate country/ASN are kept),
 * - deletes dashboard sessions that expired more than 30 days ago.
 * Blacklist entries keep their IP because enforcement depends on it.
 */
@Injectable()
export class MaintenanceService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(MaintenanceService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly settings: SettingsService,
  ) {}

  onApplicationBootstrap(): void {
    if (process.env.NODE_ENV === 'test') return;
    const run = () => void this.run().catch((err: Error) => this.logger.warn(`Maintenance failed: ${err.message}`));
    setTimeout(run, 60_000);
    this.timer = setInterval(run, INTERVAL_MS);
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async run(now = new Date(), force = false): Promise<{ connections: number; auditLogs: number; sessions: number; evidence: number }> {
    if (!force) {
      const lock = await this.redis.client.set('mnm:lock:maintenance', '1', 'PX', INTERVAL_MS - 60_000, 'NX');
      if (lock !== 'OK') return { connections: 0, auditLogs: 0, sessions: 0, evidence: 0 };
    }
    const { ipRetentionDays } = await this.settings.getPrivacy();
    let connections = 0;
    let auditLogs = 0;
    if (ipRetentionDays !== null) {
      const cutoff = new Date(now.getTime() - ipRetentionDays * 86_400_000);
      connections = (await this.prisma.playerConnection.updateMany({ where: { connectedAt: { lt: cutoff }, ipAddress: { not: null } }, data: { ipAddress: null, virtualHost: null } })).count;
      auditLogs = (await this.prisma.auditLog.updateMany({ where: { createdAt: { lt: cutoff }, ipAddress: { not: null } }, data: { ipAddress: null } })).count;
    }
    const sessions = (
      await this.prisma.dashboardSession.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - EXPIRED_SESSION_GRACE_DAYS * 86_400_000) } } })
    ).count;
    const evidence = await this.purgeRemovedEvidence(now);
    if (connections || auditLogs || sessions || evidence) {
      this.logger.log(`Retention: anonymised ${connections} connection(s) and ${auditLogs} audit entr(y/ies), removed ${sessions} expired session(s), purged ${evidence} removed evidence entr(y/ies)`);
    }
    return { connections, auditLogs, sessions, evidence };
  }

  /**
   * Permanently deletes evidence that was removed (soft-deleted) longer ago than
   * the retention period, and redacts its content in the change history.
   */
  private async purgeRemovedEvidence(now: Date): Promise<number> {
    const { deletedEvidenceRetentionDays } = await this.settings.getPrivacy();
    if (deletedEvidenceRetentionDays === null) return 0;
    const cutoff = new Date(now.getTime() - deletedEvidenceRetentionDays * 86_400_000);
    const expired = await this.prisma.punishmentEvidence.findMany({ where: { deletedAt: { lt: cutoff } }, select: { id: true }, take: 1000 });
    if (expired.length === 0) return 0;
    const ids = expired.map((e) => e.id);
    await this.prisma.$transaction(async (tx) => {
      // Fixed column names (not user input); the ids are bound parameters.
      for (const column of [Prisma.raw('previous_values'), Prisma.raw('new_values')]) {
        await tx.$executeRaw`UPDATE punishment_history SET ${column} = JSON_REPLACE(${column}, '$.title', '[purged]', '$.url', NULL, '$.description', NULL)
          WHERE ${column} IS NOT NULL AND JSON_UNQUOTE(JSON_EXTRACT(${column}, '$.evidenceId')) IN (${Prisma.join(ids)})`;
      }
      await tx.punishmentEvidence.deleteMany({ where: { id: { in: ids } } });
    });
    return ids.length;
  }
}
