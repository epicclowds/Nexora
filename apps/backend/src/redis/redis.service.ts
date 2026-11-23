import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { AppConfig } from '../config/app-config';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;

  constructor(config: AppConfig) {
    this.client = new Redis(config.env.REDIS_URL, {
      maxRetriesPerRequest: 2,
      retryStrategy: (attempt: number) => Math.min(attempt * 500, 5000),
    });
    this.client.on('error', (err: Error) => this.logger.warn(`Redis error: ${err.message}`));
    this.client.on('ready', () => this.logger.log('Redis connection established'));
  }

  /** Round-trip latency in milliseconds. Throws when Redis is unreachable. */
  async ping(): Promise<number> {
    const started = performance.now();
    await this.client.ping();
    return Math.round(performance.now() - started);
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit().catch(() => undefined);
  }
}
