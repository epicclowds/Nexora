import { ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { randomToken, sha256Hex } from '../common/crypto';
import { AppConfig } from '../config/app-config';
import { ActorType, type Server, ServerStatus, type ServerType } from '../generated/prisma/client';
import { AuditService, type AuditActor } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';

/** A server whose last heartbeat is older than this is reported as offline. */
export const HEARTBEAT_TIMEOUT_MS = 60_000;

export function effectiveStatus(server: Pick<Server, 'status' | 'enabled' | 'lastHeartbeatAt'>, now = Date.now()): ServerStatus {
  if (!server.enabled) return ServerStatus.DISABLED;
  if (server.status === ServerStatus.PENDING) return ServerStatus.PENDING;
  if (!server.lastHeartbeatAt || now - server.lastHeartbeatAt.getTime() > HEARTBEAT_TIMEOUT_MS) return ServerStatus.OFFLINE;
  return server.status;
}

export function serializeServer(s: Server) {
  return {
    id: s.id,
    name: s.name,
    type: s.type,
    status: effectiveStatus(s),
    enabled: s.enabled,
    minecraftVersion: s.minecraftVersion,
    pluginVersion: s.pluginVersion,
    platformVersion: s.platformVersion,
    onlinePlayers: s.onlinePlayers,
    maxPlayers: s.maxPlayers,
    tps: s.tps,
    mspt: s.mspt,
    memoryUsedBytes: s.memoryUsedBytes?.toString() ?? null,
    memoryMaxBytes: s.memoryMaxBytes?.toString() ?? null,
    cpuLoad: s.cpuLoad,
    lastHeartbeatAt: s.lastHeartbeatAt?.toISOString() ?? null,
    createdAt: s.createdAt.toISOString(),
  };
}

const TOKEN_PREFIX = 'mnm_reg_';
const SECRET_PREFIX = 'mnm_sk_';
const KEY_PREFIX = 'mnm_key_';

@Injectable()
export class ServersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
    private readonly realtime: RealtimeService,
  ) {}

  async list() {
    const servers = await this.prisma.server.findMany({ orderBy: [{ type: 'asc' }, { name: 'asc' }] });
    return servers.map(serializeServer);
  }


  async detail(id: string) {
    const server = await this.prisma.server.findUnique({
      where: { id },
      include: { credentials: { orderBy: { createdAt: 'desc' }, select: { id: true, keyId: true, createdAt: true, lastUsedAt: true, revokedAt: true } } },
    });
    if (!server) throw new NotFoundException();
    const [connectedPlayers, openProxySessions] = await Promise.all([
      this.prisma.player.count({ where: { currentServerId: id, online: true } }),
      this.prisma.playerSession.count({ where: { proxyServerId: id, endedAt: null } }),
    ]);
    return {
      ...serializeServer(server),
      connectedPlayers,
      openProxySessions,
      credentials: server.credentials.map((c) => ({
        id: c.id,
        keyId: c.keyId,
        createdAt: c.createdAt.toISOString(),
        lastUsedAt: c.lastUsedAt?.toISOString() ?? null,
        revokedAt: c.revokedAt?.toISOString() ?? null,
      })),
    };
  }

  /** Rename or enable/disable. Disabled servers are rejected by the plugin API. */
  async update(id: string, changes: { name?: string; enabled?: boolean }, actor: AuditActor, ip: string | null) {
    const before = await this.prisma.server.findUnique({ where: { id } });
    if (!before) throw new NotFoundException();
    const updated = await this.prisma.$transaction(async (tx) => {
      const server = await tx.server.update({ where: { id }, data: changes });
      await this.audit.record(
        { actor, action: 'servers.updated', targetType: 'server', targetId: id, metadata: { before: { name: before.name, enabled: before.enabled }, changes }, ipAddress: ip },
        tx,
      );
      return server;
    });
    this.realtime.publish({ type: 'server.updated', serverId: id });
    return serializeServer(updated);
  }

  async remove(id: string, actor: AuditActor, ip: string | null) {
    const server = await this.prisma.server.findUnique({ where: { id } });
    if (!server) throw new NotFoundException();
    await this.prisma.$transaction(async (tx) => {
      await tx.server.delete({ where: { id } });
      await this.audit.record({ actor, action: 'servers.deleted', targetType: 'server', targetId: id, metadata: { name: server.name, type: server.type }, ipAddress: ip }, tx);
    });
    this.realtime.publish({ type: 'server.removed', serverId: id });
  }

  /** Revokes all active credentials and issues a new one. The secret is returned once. */
  async rotateCredentials(id: string, actor: AuditActor, ip: string | null) {
    const server = await this.prisma.server.findUnique({ where: { id } });
    if (!server) throw new NotFoundException();
    const secret = SECRET_PREFIX + randomToken(32);
    const keyId = KEY_PREFIX + randomToken(12);
    await this.prisma.$transaction(async (tx) => {
      await tx.serverCredential.updateMany({ where: { serverId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.serverCredential.create({ data: { serverId: id, keyId, secretHash: sha256Hex(secret) } });
      await this.audit.record({ actor, action: 'servers.credentials_rotated', targetType: 'server', targetId: id, metadata: { keyId }, ipAddress: ip }, tx);
    });
    return { serverId: id, serverName: server.name, keyId, secret };
  }

  async revokeCredentials(id: string, actor: AuditActor, ip: string | null) {
    const server = await this.prisma.server.findUnique({ where: { id } });
    if (!server) throw new NotFoundException();
    await this.prisma.$transaction(async (tx) => {
      const result = await tx.serverCredential.updateMany({ where: { serverId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.record({ actor, action: 'servers.credentials_revoked', targetType: 'server', targetId: id, metadata: { revoked: result.count }, ipAddress: ip }, tx);
    });
  }

  /** Creates a single-use registration token. The plaintext is returned once and never stored. */
  async createRegistrationToken(type: ServerType, name: string, actor: AuditActor, ip: string | null) {
    if (await this.prisma.server.findUnique({ where: { name } })) {
      throw new ConflictException({ code: 'SERVER_NAME_TAKEN', message: 'A server with this name is already registered' });
    }
    const token = TOKEN_PREFIX + randomToken(24);
    const expiresAt = new Date(Date.now() + this.config.env.REGISTRATION_TOKEN_TTL_MINUTES * 60_000);
    const record = await this.prisma.$transaction(async (tx) => {
      const created = await tx.registrationToken.create({
        data: { tokenHash: sha256Hex(token), serverType: type, serverName: name, expiresAt, createdByUserId: actor.userId ?? null },
      });
      await this.audit.record(
        { actor, action: 'servers.registration_token_created', targetType: 'registration_token', targetId: created.id, metadata: { type, name, expiresAt: expiresAt.toISOString() }, ipAddress: ip },
        tx,
      );
      return created;
    });
    return { id: record.id, token, serverType: type, serverName: name, expiresAt: expiresAt.toISOString() };
  }

  async listPendingTokens() {
    const tokens = await this.prisma.registrationToken.findMany({
      where: { usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, serverType: true, serverName: true, expiresAt: true, createdAt: true },
    });
    return tokens;
  }

  /** Progress of a registration started in the dashboard (polled by the add-server flow). */
  async tokenStatus(id: string) {
    const token = await this.prisma.registrationToken.findUnique({
      where: { id },
      select: { id: true, serverType: true, serverName: true, expiresAt: true, usedAt: true, server: { select: { id: true, name: true, status: true, lastHeartbeatAt: true, pluginVersion: true, minecraftVersion: true } } },
    });
    if (!token) throw new NotFoundException();
    const status = token.usedAt ? 'REGISTERED' : token.expiresAt <= new Date() ? 'EXPIRED' : 'PENDING';
    return { id: token.id, serverType: token.serverType, serverName: token.serverName, expiresAt: token.expiresAt, usedAt: token.usedAt, status, server: token.server };
  }

  async revokeToken(id: string, actor: AuditActor, ip: string | null) {
    await this.prisma.$transaction(async (tx) => {
      await tx.registrationToken.updateMany({ where: { id, usedAt: null }, data: { expiresAt: new Date() } });
      await this.audit.record({ actor, action: 'servers.registration_token_revoked', targetType: 'registration_token', targetId: id, ipAddress: ip }, tx);
    });
  }

  /**
   * Exchanges a registration token for a long-lived credential. The token is
   * consumed atomically (conditional update), so it can never be used twice.
   */
  async register(input: { token: string; pluginVersion: string; platformVersion?: string; minecraftVersion?: string }, ip: string | null) {
    const tokenHash = sha256Hex(input.token);
    const secret = SECRET_PREFIX + randomToken(32);
    const keyId = KEY_PREFIX + randomToken(12);

    return this.prisma.$transaction(async (tx) => {
      const token = await tx.registrationToken.findUnique({ where: { tokenHash } });
      const now = new Date();
      const consumed = token
        ? await tx.registrationToken.updateMany({ where: { id: token.id, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } })
        : { count: 0 };
      if (!token || consumed.count !== 1) {
        throw new UnauthorizedException({ code: 'INVALID_REGISTRATION_TOKEN', message: 'Registration token is invalid, expired or already used' });
      }
      const server = await tx.server.create({
        data: {
          name: token.serverName,
          type: token.serverType,
          status: ServerStatus.OFFLINE,
          pluginVersion: input.pluginVersion,
          platformVersion: input.platformVersion,
          minecraftVersion: input.minecraftVersion,
        },
      });
      await tx.registrationToken.update({ where: { id: token.id }, data: { serverId: server.id } });
      await tx.serverCredential.create({ data: { serverId: server.id, keyId, secretHash: sha256Hex(secret) } });
      await this.audit.record(
        { actor: { type: ActorType.SERVER, name: server.name }, action: 'servers.registered', targetType: 'server', targetId: server.id, metadata: { type: server.type, pluginVersion: input.pluginVersion }, ipAddress: ip },
        tx,
      );
      return { serverId: server.id, serverName: server.name, serverType: server.type, keyId, secret };
    });
  }
}
