import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { isPremiumUuid, isSkinPng, normalizeTextureUrl, parseTexturesProperty, type SkinTexture } from './skins';

const MAX_SKIN_BYTES = 64 * 1024;
const FETCH_TIMEOUT_MS = 5000;
const TEXTURE_TTL_SECONDS = 30 * 86_400; // texture URLs are content-addressed and immutable
const PROFILE_TTL_SECONDS = 6 * 3600;
const NEGATIVE_TTL_SECONDS = 3600;

export interface Skin {
  png: Buffer;
  model: 'classic' | 'slim';
}

/**
 * Resolves and caches player skins on the server, so dashboard users' browsers
 * never contact third-party services. Sources, in order: texture URL reported by
 * the proxy at login, then Mojang's session server (premium UUIDs only).
 */
@Injectable()
export class SkinService {
  private readonly logger = new Logger(SkinService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async getSkin(uuid: string): Promise<Skin | null> {
    const texture = await this.resolveTexture(uuid);
    if (!texture) return null;
    const png = await this.fetchTexture(texture.url);
    return png ? { png, model: texture.model } : null;
  }

  private async resolveTexture(uuid: string): Promise<SkinTexture | null> {
    const player = await this.prisma.player.findUnique({ where: { uuid }, select: { skinTextureUrl: true, skinModel: true } });
    const known = normalizeTextureUrl(player?.skinTextureUrl);
    if (known) return { url: known, model: player?.skinModel === 'slim' ? 'slim' : 'classic' };
    if (!player || !isPremiumUuid(uuid)) return null;

    const cacheKey = `mnm:skin:profile:${uuid}`;
    const cached = await this.redis.client.get(cacheKey).catch(() => null);
    if (cached) return cached === 'none' ? null : (JSON.parse(cached) as SkinTexture);

    let texture: SkinTexture | null = null;
    try {
      const res = await fetch(`https://sessionserver.mojang.com/session/minecraft/profile/${uuid.replace(/-/g, '')}`, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        redirect: 'error',
      });
      if (res.ok) {
        const body = (await res.json()) as { properties?: { name: string; value: string }[] };
        texture = parseTexturesProperty(body.properties?.find((p) => p.name === 'textures')?.value);
      }
    } catch (err) {
      this.logger.debug(`Session server lookup failed for ${uuid}: ${(err as Error).message}`);
      return null; // transient: do not cache
    }
    await this.redis.client.set(cacheKey, texture ? JSON.stringify(texture) : 'none', 'EX', texture ? PROFILE_TTL_SECONDS : NEGATIVE_TTL_SECONDS).catch(() => undefined);
    return texture;
  }

  private async fetchTexture(url: string): Promise<Buffer | null> {
    const allowed = normalizeTextureUrl(url);
    if (!allowed) return null;
    const cacheKey = `mnm:skin:texture:${allowed.slice(allowed.lastIndexOf('/') + 1)}`;
    const cached = await this.redis.client.getBuffer(cacheKey).catch(() => null);
    if (cached) return cached;

    try {
      const res = await fetch(allowed, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: 'error' });
      if (!res.ok) return null;
      const length = Number(res.headers.get('content-length') ?? 0);
      if (length > MAX_SKIN_BYTES) return null;
      const png = Buffer.from(await res.arrayBuffer());
      if (png.length > MAX_SKIN_BYTES || !isSkinPng(png)) return null;
      await this.redis.client.set(cacheKey, png, 'EX', TEXTURE_TTL_SECONDS).catch(() => undefined);
      return png;
    } catch (err) {
      this.logger.debug(`Texture download failed: ${(err as Error).message}`);
      return null;
    }
  }
}
