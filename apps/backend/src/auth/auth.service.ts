import { ForbiddenException, HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { AuthenticatedUser } from '../common/auth-context';
import { randomToken, sha256Hex } from '../common/crypto';
import { AppConfig } from '../config/app-config';
import { ActorType } from '../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { PasswordService } from './password.service';

/** Failed logins per account before a temporary lock. */
export const MAX_LOGIN_FAILURES = 10;
export const LOGIN_LOCKOUT_SECONDS = 15 * 60;

interface AccessTokenPayload {
  sub: string;
  sid: string;
}

export interface IssuedSession {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
}

const JWT_AUDIENCE = 'mnm-dashboard';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
    private readonly redis: RedisService,
  ) {}

  async login(identifier: string, password: string, meta: { ip: string | null; userAgent: string | null }): Promise<IssuedSession> {
    const normalized = identifier.trim();
    // Per-account lockout, independent of the client IP (which may be spoofable
    // when no trusted reverse proxy is in front of the dashboard).
    const failureKey = `mnm:login-failures:${sha256Hex(normalized.toLowerCase())}`;
    const failures = Number((await this.redis.client.get(failureKey).catch(() => null)) ?? 0);
    if (failures >= MAX_LOGIN_FAILURES) {
      throw new HttpException({ code: 'ACCOUNT_LOCKED', message: 'Too many failed attempts. Try again later.' }, HttpStatus.TOO_MANY_REQUESTS);
    }

    const user = await this.prisma.dashboardUser.findFirst({
      where: normalized.includes('@') ? { email: normalized.toLowerCase() } : { username: normalized },
    });
    const valid = await this.passwords.verify(user?.passwordHash ?? null, password);

    if (!user || !valid) {
      await this.redis.client
        .multi()
        .incr(failureKey)
        .expire(failureKey, LOGIN_LOCKOUT_SECONDS)
        .exec()
        .catch(() => undefined);
      await this.audit.record({
        actor: { type: ActorType.SYSTEM, name: 'auth' },
        action: 'auth.login_failed',
        targetType: user ? 'dashboard_user' : undefined,
        targetId: user?.id,
        metadata: { identifier: normalized.slice(0, 64) },
        ipAddress: meta.ip,
      });
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Invalid username or password' });
    }
    if (user.disabled) {
      throw new ForbiddenException({ code: 'ACCOUNT_DISABLED', message: 'This account is disabled' });
    }

    await this.redis.client.del(failureKey).catch(() => undefined);
    const session = await this.issueSession(user.id, meta);
    await this.prisma.dashboardUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await this.audit.record({
      actor: { type: ActorType.USER, userId: user.id, name: user.username },
      action: 'auth.login',
      targetType: 'dashboard_user',
      targetId: user.id,
      ipAddress: meta.ip,
    });
    return session;
  }

  async issueSession(userId: string, meta: { ip: string | null; userAgent: string | null }): Promise<IssuedSession> {
    const refreshToken = randomToken(48);
    const refreshExpiresAt = new Date(Date.now() + this.config.env.REFRESH_TOKEN_TTL_DAYS * 86_400_000);
    const session = await this.prisma.dashboardSession.create({
      data: {
        userId,
        refreshTokenHash: sha256Hex(refreshToken),
        expiresAt: refreshExpiresAt,
        ipAddress: meta.ip,
        userAgent: meta.userAgent?.slice(0, 255) ?? null,
      },
    });
    return { accessToken: await this.signAccessToken({ sub: userId, sid: session.id }), refreshToken, refreshExpiresAt };
  }

  /** Rotates the refresh token. A token can only be used once. */
  async refresh(refreshToken: string): Promise<IssuedSession> {
    const session = await this.prisma.dashboardSession.findUnique({
      where: { refreshTokenHash: sha256Hex(refreshToken) },
      include: { user: true },
    });
    if (!session || session.revokedAt || session.expiresAt < new Date() || session.user.disabled) {
      throw new UnauthorizedException({ code: 'SESSION_INVALID', message: 'Session expired' });
    }
    const nextRefresh = randomToken(48);
    const rotated = await this.prisma.dashboardSession.updateMany({
      where: { id: session.id, refreshTokenHash: session.refreshTokenHash, revokedAt: null },
      data: { refreshTokenHash: sha256Hex(nextRefresh), lastUsedAt: new Date() },
    });
    if (rotated.count !== 1) throw new UnauthorizedException({ code: 'SESSION_INVALID', message: 'Session expired' });
    return {
      accessToken: await this.signAccessToken({ sub: session.userId, sid: session.id }),
      refreshToken: nextRefresh,
      refreshExpiresAt: session.expiresAt,
    };
  }

  async logout(user: AuthenticatedUser, ip: string | null): Promise<void> {
    await this.prisma.dashboardSession.updateMany({ where: { id: user.sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.audit.record({ actor: { type: ActorType.USER, userId: user.id, name: user.username }, action: 'auth.logout', ipAddress: ip });
  }

  async revokeAllSessions(userId: string): Promise<void> {
    await this.prisma.dashboardSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  /** Verifies an access token and loads the live user, role and permissions. */
  async authenticate(accessToken: string): Promise<AuthenticatedUser | null> {
    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(accessToken, { audience: JWT_AUDIENCE });
    } catch {
      return null;
    }
    return this.authenticateSession(payload.sid, payload.sub);
  }

  /** Loads a live session with the user's current role and permissions; null when revoked, expired or disabled. */
  async authenticateSession(sessionId: string, userId: string): Promise<AuthenticatedUser | null> {
    const session = await this.prisma.dashboardSession.findUnique({
      where: { id: sessionId },
      include: { user: { include: { role: { include: { permissions: true } } } } },
    });
    if (!session || session.userId !== userId || session.revokedAt || session.expiresAt < new Date() || session.user.disabled) {
      return null;
    }
    const { user } = session;
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      roleId: user.roleId,
      roleKey: user.role.key,
      rolePriority: user.role.priority,
      permissions: user.role.permissions.map((p) => p.permission),
      sessionId: session.id,
      locale: user.locale,
      theme: user.theme,
      timezone: user.timezone,
    };
  }

  private signAccessToken(payload: AccessTokenPayload): Promise<string> {
    return this.jwt.signAsync(payload, { audience: JWT_AUDIENCE, expiresIn: this.config.env.ACCESS_TOKEN_TTL_SECONDS });
  }
}
