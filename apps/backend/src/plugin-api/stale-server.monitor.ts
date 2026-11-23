import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { ServerStatus, ServerType } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { RedisService } from '../redis/redis.service';
import { HEARTBEAT_TIMEOUT_MS } from '../servers/servers.service';
import { PlayerTrackingService } from './player-tracking.service';

const INTERVAL_MS = 30_000;
/** A proxy silent for this long is considered crashed; its sessions are closed at its last heartbeat. */
export const PROXY_SESSION_TIMEOUT_MS = 3 * 60_000;

/**
 * Detects servers that stopped sending heartbeats without a graceful shutdown.
 * Runs on one replica at a time (Redis lock).
 */
@Injectable()
export class StaleServerMonitor implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(StaleServerMonitor.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly tracking: PlayerTrackingService,
    private readonly realtime: RealtimeService,
  ) {}

  onApplicationBootstrap(): void {
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.run().catch((err: Error) => this.logger.warn(`Stale server check failed: ${err.message}`)), INTERVAL_MS);
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async run(now = new Date()): Promise<{ markedOffline: number; closedSessions: number }> {
    const lock = await this.redis.client.set('mnm:lock:stale-servers', '1', 'PX', INTERVAL_MS - 1000, 'NX');
    if (lock !== 'OK') return { markedOffline: 0, closedSessions: 0 };

    const stale = await this.prisma.server.findMany({
      where: { status: ServerStatus.ONLINE, lastHeartbeatAt: { lt: new Date(now.getTime() - HEARTBEAT_TIMEOUT_MS) } },
      select: { id: true, name: true },
    });
    for (const server of stale) {
      await this.prisma.server.update({ where: { id: server.id }, data: { status: ServerStatus.OFFLINE } });
      this.realtime.publish({ type: 'server.updated', serverId: server.id });
      this.logger.warn(`Server "${server.name}" stopped sending heartbeats`);
    }

    let closedSessions = 0;
    const silentProxies = await this.prisma.server.findMany({
      where: {
        type: ServerType.VELOCITY,
        OR: [{ lastHeartbeatAt: null }, { lastHeartbeatAt: { lt: new Date(now.getTime() - PROXY_SESSION_TIMEOUT_MS) } }],
        proxySessions: { some: { endedAt: null } },
      },
      select: { id: true, name: true, lastHeartbeatAt: true },
    });
    for (const proxy of silentProxies) {
      const closed = await this.tracking.closeProxySessions(proxy.id, proxy.lastHeartbeatAt ?? now);
      closedSessions += closed;
      this.logger.warn(`Closed ${closed} session(s) of unresponsive proxy "${proxy.name}"`);
    }
    return { markedOffline: stale.length, closedSessions };
  }
}
