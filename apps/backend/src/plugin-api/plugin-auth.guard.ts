import { type CanActivate, type ExecutionContext, ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import type { ServerType } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { checkSignature, NONCE_TTL_SECONDS, SIGNATURE_HEADERS } from './plugin-signature';

export interface PluginServer {
  id: string;
  name: string;
  type: ServerType;
  credentialId: string;
}

export type PluginRequest = Request & { pluginServer?: PluginServer; rawBody?: Buffer };

/** Authenticates Velocity/Paper plugins by HMAC request signature with replay protection. */
@Injectable()
export class PluginAuthGuard implements CanActivate {
  private readonly logger = new Logger(PluginAuthGuard.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<PluginRequest>();
    const keyId = req.header(SIGNATURE_HEADERS.keyId);
    if (!keyId || keyId.length > 64) throw this.unauthorized('MISSING_KEY');

    const credential = await this.prisma.serverCredential.findUnique({ where: { keyId }, include: { server: true } });
    if (!credential || credential.revokedAt) throw this.unauthorized('UNKNOWN_KEY');

    const check = checkSignature({
      signingKeyHex: credential.secretHash,
      method: req.method,
      path: req.originalUrl,
      timestamp: req.header(SIGNATURE_HEADERS.timestamp),
      nonce: req.header(SIGNATURE_HEADERS.nonce),
      signature: req.header(SIGNATURE_HEADERS.signature),
      body: req.rawBody ?? Buffer.alloc(0),
    });
    if (!check.ok) {
      this.logger.warn(`Rejected plugin request from ${credential.server.name}: ${check.reason}`);
      throw this.unauthorized(check.reason);
    }

    // Single-use nonce (replay protection). SET NX succeeds only the first time.
    const fresh = await this.redis.client.set(`mnm:nonce:${keyId}:${req.header(SIGNATURE_HEADERS.nonce)}`, '1', 'EX', NONCE_TTL_SECONDS, 'NX');
    if (fresh !== 'OK') throw this.unauthorized('REPLAYED');

    if (!credential.server.enabled) throw new ForbiddenException({ code: 'SERVER_DISABLED', message: 'This server connection is disabled' });

    req.pluginServer = { id: credential.server.id, name: credential.server.name, type: credential.server.type, credentialId: credential.id };
    void this.prisma.serverCredential.update({ where: { id: credential.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
    return true;
  }

  private unauthorized(code: string) {
    return new UnauthorizedException({ code: `PLUGIN_AUTH_${code}`, message: 'Plugin authentication failed' });
  }
}
