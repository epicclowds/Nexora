import { EventEmitter } from 'node:events';
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PERMISSIONS } from '@mnm/shared-types';
import { RedisService } from '../redis/redis.service';

/** Events pushed to dashboards. Payloads carry identifiers only; clients refetch details with their own permissions. */
export type RealtimeEvent =
  | { type: 'server.updated'; serverId: string }
  | { type: 'server.removed'; serverId: string }
  | { type: 'player.online'; uuid: string }
  | { type: 'player.offline'; uuid: string }
  | { type: 'player.updated'; uuid: string }
  | { type: 'punishment.changed'; uuid: string };

/** Permission needed to receive each event type. */
export const EVENT_PERMISSION: Record<RealtimeEvent['type'], string> = {
  'server.updated': PERMISSIONS.SERVERS_VIEW,
  'server.removed': PERMISSIONS.SERVERS_VIEW,
  'player.online': PERMISSIONS.PLAYERS_VIEW,
  'player.offline': PERMISSIONS.PLAYERS_VIEW,
  'player.updated': PERMISSIONS.PLAYERS_VIEW,
  'punishment.changed': PERMISSIONS.PUNISHMENTS_HISTORY,
};

const CHANNEL = 'mnm:realtime';

/**
 * Fan-out of domain events to every backend replica via Redis pub/sub and from
 * there to connected dashboard streams (Server-Sent Events).
 */
@Injectable()
export class RealtimeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RealtimeService.name);
  private readonly local = new EventEmitter().setMaxListeners(0);
  private subscriber: RedisService['client'] | null = null;

  constructor(private readonly redis: RedisService) {}

  async onModuleInit(): Promise<void> {
    this.subscriber = this.redis.client.duplicate();
    this.subscriber.on('message', (_channel: string, message: string) => {
      try {
        this.local.emit('event', JSON.parse(message) as RealtimeEvent);
      } catch {
        this.logger.warn('Discarded malformed realtime message');
      }
    });
    this.subscriber.on('error', (err: Error) => this.logger.warn(`Realtime subscriber error: ${err.message}`));
    await this.subscriber.subscribe(CHANNEL).catch((err: Error) => this.logger.warn(`Realtime subscribe failed: ${err.message}`));
  }

  async onModuleDestroy(): Promise<void> {
    await this.subscriber?.quit().catch(() => undefined);
  }

  /** Fire-and-forget: realtime delivery must never fail the originating request. */
  publish(event: RealtimeEvent): void {
    void this.redis.client.publish(CHANNEL, JSON.stringify(event)).catch((err: Error) => this.logger.warn(`Realtime publish failed: ${err.message}`));
  }

  subscribe(listener: (event: RealtimeEvent) => void): () => void {
    this.local.on('event', listener);
    return () => this.local.off('event', listener);
  }
}
