import { Injectable } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import { RedisService } from './redis.service';

/**
 * Fixed-window rate-limit storage in Redis so limits hold across backend replicas.
 * `ttl` and `blockDuration` are milliseconds; returned times are seconds, matching
 * @nestjs/throttler's in-memory storage.
 */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(private readonly redis: RedisService) {}

  async increment(key: string, ttl: number, limit: number, blockDuration: number, throttlerName: string) {
    const hitsKey = `mnm:throttle:${throttlerName}:${key}`;
    const blockKey = `${hitsKey}:blocked`;
    const r = this.redis.client;

    const blockTtl = await r.pttl(blockKey);
    if (blockTtl > 0) {
      const seconds = Math.ceil(blockTtl / 1000);
      return { totalHits: limit + 1, timeToExpire: seconds, isBlocked: true, timeToBlockExpire: seconds };
    }

    const results = await r.multi().incr(hitsKey).pttl(hitsKey).exec();
    const hits = Number(results?.[0]?.[1] ?? 1);
    let remaining = Number(results?.[1]?.[1] ?? -1);
    if (remaining < 0) {
      await r.pexpire(hitsKey, ttl);
      remaining = ttl;
    }
    if (hits > limit) {
      await r.set(blockKey, '1', 'PX', blockDuration);
      return {
        totalHits: hits,
        timeToExpire: Math.ceil(remaining / 1000),
        isBlocked: true,
        timeToBlockExpire: Math.ceil(blockDuration / 1000),
      };
    }
    return { totalHits: hits, timeToExpire: Math.ceil(remaining / 1000), isBlocked: false, timeToBlockExpire: 0 };
  }
}
