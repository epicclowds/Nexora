import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ActorType, type Prisma, type Punishment, PunishmentChangeKind, PunishmentHistoryAction, type PunishmentSource, PunishmentStatus, PunishmentType } from '../generated/prisma/client';
import { type AuditActor, AuditService } from '../audit/audit.service';
import { normalizeUuid } from '../players/players.controller';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { BAN_TYPES, computeExpiry, effectiveStatus, ENFORCEABLE_TYPES, isRevocable, MUTE_TYPES } from './punishment-rules';

export interface Issuer {
  type: ActorType;
  userId?: string | null;
  uuid?: string | null;
  name: string;
}

export interface CreatePunishmentInput {
  type: PunishmentType;
  targetUuid: string;
  reason: string;
  durationSeconds?: number;
  source: PunishmentSource;
  issuer: Issuer;
  serverId?: string | null;
  idempotencyKey?: string;
  ipAddress?: string | null;
}

export const withNames = {
  target: { select: { uuid: true, username: true, online: true } },
  server: { select: { id: true, name: true } },
  _count: { select: { evidence: { where: { deletedAt: null } } } },
} as const;

export type PunishmentWithNames = Prisma.PunishmentGetPayload<{ include: typeof withNames }>;

export function serializePunishment(p: PunishmentWithNames, options: { includeIp?: boolean } = {}) {
  return {
    id: p.id,
    type: p.type,
    status: effectiveStatus(p),
    revocable: isRevocable(p),
    reason: p.reason,
    source: p.source,
    target: { uuid: p.target.uuid, username: p.target.username, online: p.target.online },
    issuer: { type: p.issuerType, name: p.issuerName, uuid: p.issuerUuid, userId: p.issuerUserId },
    server: p.server,
    createdAt: p.createdAt.toISOString(),
    expiresAt: p.expiresAt?.toISOString() ?? null,
    revokedAt: p.revokedAt?.toISOString() ?? null,
    revokedBy: p.revokedByName,
    revokedReason: p.revokedReason,
    version: p.version,
    updatedAt: p.updatedAt?.toISOString() ?? null,
    evidenceCount: p._count.evidence,
    ...(options.includeIp ? { targetIp: p.targetIp } : {}),
  };
}

/** Compact form consumed by the plugins' local cache. */
export function pluginPunishment(p: Punishment & { target: { username: string } }) {
  return {
    id: p.id,
    type: p.type,
    targetUuid: p.targetUuid,
    targetName: p.target.username,
    targetIp: p.type === PunishmentType.BLACKLIST ? p.targetIp : null,
    reason: p.reason,
    issuerName: p.issuerName,
    /** Plugins only cache ACTIVE punishments. */
    status: p.status,
    createdAt: p.createdAt.getTime(),
    expiresAt: p.expiresAt?.getTime() ?? null,
  };
}

/** History actor columns for an issuer. */
export function historyActor(actor: Issuer) {
  return { actorType: actor.type, actorUserId: actor.userId ?? null, actorUuid: actor.uuid ?? null, actorName: actor.name.slice(0, 64) };
}

export function auditActor(issuer: Issuer): AuditActor {
  return { type: issuer.type, userId: issuer.userId ?? null, name: issuer.name };
}

const notExpired = (now: Date): Prisma.PunishmentWhereInput => ({ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] });

@Injectable()
export class PunishmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
  ) {}

  /** Resolves a player by UUID (dashed or not) or by current username (most recently seen wins). */
  async resolvePlayer(target: string) {
    const uuid = normalizeUuid(target);
    const player = uuid
      ? await this.prisma.player.findUnique({ where: { uuid } })
      : await this.prisma.player.findFirst({ where: { username: target }, orderBy: { lastSeenAt: 'desc' } });
    if (!player) throw new NotFoundException({ code: 'PLAYER_NOT_FOUND', message: 'This player has never joined the network' });
    return player;
  }

  async create(input: CreatePunishmentInput) {
    if (input.idempotencyKey) {
      const existing = await this.prisma.punishment.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: withNames });
      if (existing) return serializePunishment(existing);
    }
    const expiry = computeExpiry(input.type, input.durationSeconds);
    if (!expiry.ok) throw new BadRequestException({ code: 'INVALID_DURATION', message: expiry.reason });

    const now = new Date();
    const player = await this.prisma.player.findUnique({ where: { uuid: input.targetUuid } });
    if (!player) throw new NotFoundException({ code: 'PLAYER_NOT_FOUND', message: 'This player has never joined the network' });

    // Duplicate prevention: one active ban (incl. blacklist) and one active mute per player.
    if (BAN_TYPES.includes(input.type) || MUTE_TYPES.includes(input.type)) {
      const group = BAN_TYPES.includes(input.type) ? BAN_TYPES : MUTE_TYPES;
      const active = await this.prisma.punishment.findFirst({
        where: { targetUuid: input.targetUuid, type: { in: [...group] }, status: PunishmentStatus.ACTIVE, ...notExpired(now) },
      });
      if (active) {
        throw new ConflictException({
          code: BAN_TYPES.includes(input.type) ? 'ALREADY_BANNED' : 'ALREADY_MUTED',
          message: 'The player already has an active punishment of this kind',
          punishmentId: active.id,
        });
      }
    }
    if (input.type === PunishmentType.KICK && !player.online) {
      throw new ConflictException({ code: 'PLAYER_OFFLINE', message: 'Only online players can be kicked' });
    }

    let targetIp: string | null = null;
    if (input.type === PunishmentType.BLACKLIST) {
      const last = await this.prisma.playerConnection.findFirst({ where: { playerUuid: input.targetUuid, ipAddress: { not: null } }, orderBy: { connectedAt: 'desc' } });
      targetIp = last?.ipAddress ?? null;
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const punishment = await tx.punishment.create({
        data: {
          type: input.type,
          targetUuid: input.targetUuid,
          reason: input.reason,
          source: input.source,
          expiresAt: expiry.expiresAt,
          issuerType: input.issuer.type,
          issuerUserId: input.issuer.userId ?? null,
          issuerUuid: input.issuer.uuid ?? null,
          issuerName: input.issuer.name.slice(0, 64),
          serverId: input.serverId ?? null,
          idempotencyKey: input.idempotencyKey ?? null,
          targetIp,
          // Kicks take effect once; they are recorded but never "active".
          status: input.type === PunishmentType.KICK ? PunishmentStatus.EXPIRED : PunishmentStatus.ACTIVE,
        },
        include: withNames,
      });
      await tx.punishmentChange.create({ data: { punishmentId: punishment.id, kind: PunishmentChangeKind.CREATED } });
      await tx.punishmentHistory.create({
        data: {
          punishmentId: punishment.id,
          action: PunishmentHistoryAction.CREATED,
          newValues: { type: input.type, reason: input.reason, expiresAt: expiry.expiresAt?.toISOString() ?? null },
          ...historyActor(input.issuer),
        },
      });
      await this.audit.record(
        {
          actor: auditActor(input.issuer),
          action: `punishments.${input.type.toLowerCase()}`,
          targetType: 'player',
          targetId: input.targetUuid,
          metadata: { punishmentId: punishment.id, reason: input.reason, expiresAt: expiry.expiresAt?.toISOString() ?? null, source: input.source },
          ipAddress: input.ipAddress ?? null,
        },
        tx,
      );
      return punishment;
    });
    this.realtime.publish({ type: 'punishment.changed', uuid: input.targetUuid });
    return serializePunishment(created);
  }

  async revokeById(id: string, revoker: Issuer, reason: string | undefined, ipAddress?: string | null) {
    const punishment = await this.prisma.punishment.findUnique({ where: { id } });
    if (!punishment) throw new NotFoundException();
    if (!isRevocable(punishment)) throw new ConflictException({ code: 'NOT_ACTIVE', message: 'This punishment is not active' });
    return this.revoke(punishment, revoker, reason, ipAddress);
  }

  /** Revokes the player's active ban (incl. blacklist) or mute. */
  async revokeActive(targetUuid: string, kind: 'BAN' | 'MUTE', revoker: Issuer, reason: string | undefined, ipAddress?: string | null) {
    const punishment = await this.prisma.punishment.findFirst({
      where: { targetUuid, type: { in: [...(kind === 'BAN' ? BAN_TYPES : MUTE_TYPES)] }, status: PunishmentStatus.ACTIVE, ...notExpired(new Date()) },
      orderBy: { createdAt: 'desc' },
    });
    if (!punishment) throw new ConflictException({ code: kind === 'BAN' ? 'NOT_BANNED' : 'NOT_MUTED', message: 'No active punishment of this kind' });
    return this.revoke(punishment, revoker, reason, ipAddress);
  }

  private async revoke(punishment: Punishment, revoker: Issuer, reason: string | undefined, ipAddress?: string | null) {
    const updated = await this.prisma.$transaction(async (tx) => {
      // Conditional update guards against concurrent double revocation.
      const result = await tx.punishment.updateMany({
        where: { id: punishment.id, status: PunishmentStatus.ACTIVE },
        data: {
          status: PunishmentStatus.REVOKED,
          revokedAt: new Date(),
          revokedReason: reason ?? null,
          revokedByType: revoker.type,
          revokedByUserId: revoker.userId ?? null,
          revokedByUuid: revoker.uuid ?? null,
          revokedByName: revoker.name.slice(0, 64),
          version: { increment: 1 },
          updatedAt: new Date(),
        },
      });
      if (result.count !== 1) throw new ConflictException({ code: 'NOT_ACTIVE', message: 'This punishment is not active' });
      await tx.punishmentChange.create({ data: { punishmentId: punishment.id, kind: PunishmentChangeKind.REVOKED } });
      await tx.punishmentHistory.create({
        data: {
          punishmentId: punishment.id,
          action: PunishmentHistoryAction.REVOKED,
          previousValues: { status: PunishmentStatus.ACTIVE },
          newValues: { status: PunishmentStatus.REVOKED },
          note: reason?.slice(0, 1000) ?? null,
          ...historyActor(revoker),
        },
      });
      await this.audit.record(
        {
          actor: auditActor(revoker),
          action: 'punishments.revoked',
          targetType: 'player',
          targetId: punishment.targetUuid,
          metadata: { punishmentId: punishment.id, type: punishment.type, reason: reason ?? null },
          ipAddress: ipAddress ?? null,
        },
        tx,
      );
      return tx.punishment.findUniqueOrThrow({ where: { id: punishment.id }, include: withNames });
    });
    this.realtime.publish({ type: 'punishment.changed', uuid: punishment.targetUuid });
    return serializePunishment(updated);
  }

  async list(filter: { page: number; pageSize: number; type?: PunishmentType; status?: 'active' | 'expired' | 'revoked'; search?: string; targetUuid?: string }) {
    const now = new Date();
    const where: Prisma.PunishmentWhereInput = {};
    if (filter.type) where.type = filter.type;
    if (filter.targetUuid) where.targetUuid = filter.targetUuid;
    if (filter.status === 'active') Object.assign(where, { status: PunishmentStatus.ACTIVE, type: filter.type ?? { not: PunishmentType.KICK }, ...notExpired(now) });
    if (filter.status === 'revoked') where.status = PunishmentStatus.REVOKED;
    if (filter.status === 'expired') {
      where.OR = [{ status: PunishmentStatus.EXPIRED }, { status: PunishmentStatus.ACTIVE, expiresAt: { lte: now } }];
    }
    if (filter.search) {
      const uuid = normalizeUuid(filter.search);
      where.AND = [
        uuid
          ? { targetUuid: uuid }
          : { OR: [{ target: { username: { startsWith: filter.search } } }, { issuerName: { startsWith: filter.search } }, { id: filter.search }, { reason: { contains: filter.search } }] },
      ];
    }
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.punishment.count({ where }),
      this.prisma.punishment.findMany({ where, include: withNames, orderBy: { createdAt: 'desc' }, skip: (filter.page - 1) * filter.pageSize, take: filter.pageSize }),
    ]);
    return { total, page: filter.page, pageSize: filter.pageSize, items: rows.map((r) => serializePunishment(r)) };
  }

  async activeFor(targetUuid: string) {
    const now = new Date();
    const active = await this.prisma.punishment.findMany({
      where: { targetUuid, type: { in: [...ENFORCEABLE_TYPES] }, status: PunishmentStatus.ACTIVE, ...notExpired(now) },
      include: withNames,
    });
    return {
      ban: active.filter((p) => BAN_TYPES.includes(p.type)).map((p) => serializePunishment(p))[0] ?? null,
      mute: active.filter((p) => MUTE_TYPES.includes(p.type)).map((p) => serializePunishment(p))[0] ?? null,
    };
  }

  /** Full snapshot of enforceable punishments plus the feed cursor to continue from. */
  async pluginSnapshot() {
    const now = new Date();
    const [latest, active] = await Promise.all([
      this.prisma.punishmentChange.findFirst({ orderBy: { id: 'desc' }, select: { id: true } }),
      this.prisma.punishment.findMany({
        where: { type: { in: [...ENFORCEABLE_TYPES] }, status: PunishmentStatus.ACTIVE, ...notExpired(now) },
        include: { target: { select: { username: true } } },
      }),
    ]);
    return { cursor: (latest?.id ?? 0n).toString(), punishments: active.map(pluginPunishment) };
  }

  /** Ordered changes after `cursor` (exclusive). */
  async pluginChanges(cursor: bigint, limit = 500) {
    const changes = await this.prisma.punishmentChange.findMany({
      where: { id: { gt: cursor } },
      orderBy: { id: 'asc' },
      take: limit,
      include: { punishment: { include: { target: { select: { username: true } } } } },
    });
    return {
      cursor: (changes.at(-1)?.id ?? cursor).toString(),
      hasMore: changes.length === limit,
      changes: changes.map((c) => ({ id: c.id.toString(), kind: c.kind, at: c.createdAt.getTime(), punishment: pluginPunishment(c.punishment) })),
    };
  }
}
