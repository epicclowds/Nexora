import { Injectable, Logger } from '@nestjs/common';
import type { AuthenticatedUser } from '../common/auth-context';
import { ActorType, type Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditActor {
  type: ActorType;
  userId?: string | null;
  name: string;
}

export interface AuditEntry {
  actor: AuditActor;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Prisma.InputJsonValue;
  ipAddress?: string | null;
}

export const SYSTEM_ACTOR: AuditActor = { type: ActorType.SYSTEM, name: 'system' };

export function userActor(user: Pick<AuthenticatedUser, 'id' | 'username'>): AuditActor {
  return { type: ActorType.USER, userId: user.id, name: user.username };
}

/** Append-only audit trail. Pass a transaction client to make the entry atomic with the change. */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry, tx?: Prisma.TransactionClient): Promise<void> {
    const client = tx ?? this.prisma;
    await client.auditLog.create({
      data: {
        actorType: entry.actor.type,
        actorUserId: entry.actor.userId ?? null,
        actorName: entry.actor.name.slice(0, 64),
        action: entry.action,
        targetType: entry.targetType ?? null,
        targetId: entry.targetId ?? null,
        metadata: entry.metadata,
        ipAddress: entry.ipAddress ?? null,
      },
    });
    this.logger.debug(`${entry.actor.name} → ${entry.action} ${entry.targetType ?? ''}:${entry.targetId ?? ''}`);
  }

  async list(params: { page: number; pageSize: number; action?: string; actorUserId?: string; targetType?: string; targetId?: string }) {
    const where: Prisma.AuditLogWhereInput = {
      ...(params.action ? { action: { startsWith: params.action } } : {}),
      ...(params.actorUserId ? { actorUserId: params.actorUserId } : {}),
      ...(params.targetType ? { targetType: params.targetType } : {}),
      ...(params.targetId ? { targetId: params.targetId } : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
    ]);
    return {
      total,
      page: params.page,
      pageSize: params.pageSize,
      items: rows.map((r) => ({
        id: r.id.toString(),
        actorType: r.actorType,
        actorUserId: r.actorUserId,
        actorName: r.actorName,
        action: r.action,
        targetType: r.targetType,
        targetId: r.targetId,
        metadata: r.metadata,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }
}
