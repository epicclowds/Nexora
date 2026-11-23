import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { type AuditActor, AuditService } from '../audit/audit.service';
import { ActorType, type InventoryKind, InventoryRevisionStatus, type Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { RedisService } from '../redis/redis.service';
import { type EditInput, inverseChanges, InventoryEditError, type Kind, publicItems, resolveEdit, type ResolvedChange, type Snapshot, snapshotSchema, type SnapshotItem } from './inventory-model';

const REQUEST_KEY = (serverId: string) => `mnm:inventory:requests:${serverId}`;

function parseSnapshot(value: Prisma.JsonValue): Snapshot {
  const parsed = snapshotSchema.safeParse(value);
  return parsed.success ? parsed.data : { items: [], fp: '0'.repeat(64) };
}

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
  ) {}

  // ── Plugin side ────────────────────────────────────────────────

  /** Stores snapshots from a Paper server. The revision only increases when the content changed. */
  async ingest(serverId: string, players: { uuid: string; inventory?: Snapshot; enderChest?: Snapshot }[], capturedAt: Date) {
    const known = new Set((await this.prisma.player.findMany({ where: { uuid: { in: players.map((p) => p.uuid) } }, select: { uuid: true } })).map((p) => p.uuid));
    let changed = 0;
    for (const p of players.filter((x) => known.has(x.uuid))) {
      for (const [kind, snapshot] of [['INVENTORY', p.inventory], ['ENDER_CHEST', p.enderChest]] as const) {
        if (!snapshot) continue;
        if (await this.store(p.uuid, serverId, kind, snapshot, capturedAt)) changed++;
      }
    }
    return { changed };
  }

  private async store(uuid: string, scope: string, kind: Kind, snapshot: Snapshot, capturedAt: Date, tx: Prisma.TransactionClient = this.prisma): Promise<boolean> {
    const existing = await tx.playerInventory.findUnique({ where: { playerUuid_scope_kind: { playerUuid: uuid, scope, kind } } });
    if (existing && parseSnapshot(existing.contents).fp === snapshot.fp) {
      await tx.playerInventory.update({ where: { id: existing.id }, data: { capturedAt } });
      return false;
    }
    await tx.playerInventory.upsert({
      where: { playerUuid_scope_kind: { playerUuid: uuid, scope, kind } },
      create: { playerUuid: uuid, scope, kind, revision: 1, contents: snapshot, capturedAt },
      update: { revision: { increment: 1 }, contents: snapshot, capturedAt },
    });
    this.realtime.publish({ type: 'inventory.changed', uuid });
    return true;
  }

  /** Pending edits for players currently online on this server, plus requested snapshots. */
  async pendingFor(serverId: string) {
    const revisions = await this.prisma.inventoryRevision.findMany({
      where: { status: InventoryRevisionStatus.PENDING, inventory: { scope: serverId, player: { online: true, currentServerId: serverId } } },
      orderBy: { createdAt: 'asc' },
      take: 50,
      include: { inventory: { select: { playerUuid: true, kind: true } } },
    });
    const requests = await this.redis.client.spop(REQUEST_KEY(serverId), 100).catch(() => [] as string[]);
    return {
      snapshotRequests: requests,
      revisions: revisions.map((r) => ({
        id: r.id,
        playerUuid: r.inventory.playerUuid,
        kind: r.inventory.kind,
        changes: (r.changes as unknown as ResolvedChange[]).map((c) => ({ slot: c.slot, before: c.before, after: c.after })),
      })),
    };
  }

  /** Result reported by the plugin after trying to apply a revision. */
  async complete(serverId: string, revisionId: string, result: { status: 'APPLIED' | 'CONFLICT' | 'REJECTED'; message?: string; appliedFps?: Record<string, string | null>; snapshot?: Snapshot }) {
    const revision = await this.prisma.inventoryRevision.findUnique({ where: { id: revisionId }, include: { inventory: true } });
    if (!revision || revision.inventory.scope !== serverId) throw new NotFoundException();
    if (revision.status !== InventoryRevisionStatus.PENDING) return { status: revision.status };

    await this.prisma.$transaction(async (tx) => {
      let changes = revision.changes as unknown as ResolvedChange[];
      if (result.status === 'APPLIED') {
        changes = changes.map((c) => ({ ...c, afterFp: result.appliedFps?.[String(c.slot)] ?? null }));
        if (result.snapshot) await this.store(revision.inventory.playerUuid, serverId, revision.inventory.kind, result.snapshot, new Date(), tx);
        const inventory = await tx.playerInventory.findUniqueOrThrow({ where: { id: revision.inventoryId } });
        await tx.inventoryRevision.update({
          where: { id: revisionId },
          data: { status: InventoryRevisionStatus.APPLIED, appliedAt: new Date(), revision: inventory.revision, changes: changes as unknown as Prisma.InputJsonValue, resultMessage: null },
        });
        if (revision.rollbackOfId) await tx.inventoryRevision.update({ where: { id: revision.rollbackOfId }, data: { status: InventoryRevisionStatus.ROLLED_BACK } });
      } else {
        await tx.inventoryRevision.update({ where: { id: revisionId }, data: { status: result.status, resultMessage: result.message?.slice(0, 500) ?? null } });
        if (result.snapshot) await this.store(revision.inventory.playerUuid, serverId, revision.inventory.kind, result.snapshot, new Date(), tx);
      }
      await this.audit.record(
        {
          actor: { type: ActorType.SERVER, name: 'inventory' },
          action: `inventory.revision_${result.status.toLowerCase()}`,
          targetType: 'player',
          targetId: revision.inventory.playerUuid,
          metadata: { revisionId, kind: revision.inventory.kind, scope: serverId, message: result.message ?? null },
        },
        tx,
      );
    });
    this.realtime.publish({ type: 'inventory.changed', uuid: revision.inventory.playerUuid });
    return { status: result.status };
  }

  // ── Dashboard side ─────────────────────────────────────────────

  /** Servers with stored inventories for a player. */
  async overview(uuid: string) {
    const [inventories, player] = await Promise.all([
      this.prisma.playerInventory.findMany({ where: { playerUuid: uuid }, select: { scope: true, kind: true, revision: true, capturedAt: true } }),
      this.prisma.player.findUnique({ where: { uuid }, select: { online: true, currentServerId: true } }),
    ]);
    const servers = await this.prisma.server.findMany({ where: { id: { in: [...new Set(inventories.map((i) => i.scope))] } }, select: { id: true, name: true } });
    return servers.map((s) => ({
      serverId: s.id,
      serverName: s.name,
      online: Boolean(player?.online && player.currentServerId === s.id),
      kinds: inventories.filter((i) => i.scope === s.id).map((i) => ({ kind: i.kind, revision: i.revision, capturedAt: i.capturedAt.toISOString() })),
    }));
  }

  async view(uuid: string, scope: string, kind: Kind) {
    const inventory = await this.prisma.playerInventory.findUnique({ where: { playerUuid_scope_kind: { playerUuid: uuid, scope, kind } } });
    if (!inventory) throw new NotFoundException({ code: 'NO_SNAPSHOT', message: 'No snapshot recorded for this server yet' });
    const revisions = await this.prisma.inventoryRevision.findMany({
      where: { inventoryId: inventory.id },
      orderBy: { createdAt: 'desc' },
      take: 25,
      include: { actor: { select: { id: true, username: true } } },
    });
    return {
      revision: inventory.revision,
      capturedAt: inventory.capturedAt.toISOString(),
      items: publicItems(parseSnapshot(inventory.contents)),
      pending: revisions.find((r) => r.status === InventoryRevisionStatus.PENDING)?.id ?? null,
      revisions: revisions.map((r) => ({
        id: r.id,
        status: r.status,
        reason: r.reason,
        resultMessage: r.resultMessage,
        rollbackOfId: r.rollbackOfId,
        actor: r.actor,
        createdAt: r.createdAt.toISOString(),
        appliedAt: r.appliedAt?.toISOString() ?? null,
        changes: (r.changes as unknown as ResolvedChange[]).map((c) => ({
          slot: c.slot,
          before: c.beforeItem ? { id: c.beforeItem.id, amount: c.beforeItem.amount, name: c.beforeItem.name ?? null } : null,
          after: c.after ? { id: c.after.id, amount: c.after.amount, name: c.after.name ?? null } : null,
        })),
      })),
    };
  }

  /** Asks the Paper server to send a fresh snapshot (only possible while the player is online there). */
  async requestSnapshot(uuid: string, scope: string) {
    const player = await this.prisma.player.findUnique({ where: { uuid }, select: { online: true, currentServerId: true } });
    if (!player?.online || player.currentServerId !== scope) throw new ConflictException({ code: 'PLAYER_NOT_ON_SERVER', message: 'The player is not online on this server' });
    await this.redis.client.sadd(REQUEST_KEY(scope), uuid);
    await this.redis.client.expire(REQUEST_KEY(scope), 300);
    return { requested: true };
  }

  /** Queues an edit. Applied immediately if the player is online on that server, otherwise on their next join. */
  async edit(uuid: string, scope: string, kind: Kind, input: EditInput, actor: AuditActor & { userId: string }, ip: string | null) {
    const inventory = await this.prisma.playerInventory.findUnique({ where: { playerUuid_scope_kind: { playerUuid: uuid, scope, kind } } });
    if (!inventory) throw new NotFoundException({ code: 'NO_SNAPSHOT', message: 'No snapshot recorded for this server yet' });
    if (inventory.revision !== input.baseRevision) throw new ConflictException({ code: 'STALE_REVISION', message: 'The inventory changed; reload and try again' });
    await this.assertNoPending(inventory.id);

    const pool = await this.itemPool(uuid, scope);
    let changes: ResolvedChange[];
    try {
      changes = resolveEdit(kind, parseSnapshot(inventory.contents), pool, input);
    } catch (err) {
      if (err instanceof InventoryEditError) throw (err.code === 'STALE_SLOT' ? new ConflictException({ code: err.code, message: err.message }) : new BadRequestException({ code: err.code, message: err.message }));
      throw err;
    }
    return this.createRevision(inventory.id, uuid, kind, scope, changes, input.reason, actor, ip, null);
  }

  async rollback(uuid: string, revisionId: string, reason: string | undefined, actor: AuditActor & { userId: string }, ip: string | null) {
    const revision = await this.prisma.inventoryRevision.findUnique({ where: { id: revisionId }, include: { inventory: true } });
    if (!revision || revision.inventory.playerUuid !== uuid) throw new NotFoundException();
    if (revision.status !== InventoryRevisionStatus.APPLIED) throw new ConflictException({ code: 'NOT_APPLIED', message: 'Only applied revisions can be rolled back' });
    await this.assertNoPending(revision.inventoryId);
    const changes = inverseChanges(revision.changes as unknown as ResolvedChange[]);
    return this.createRevision(revision.inventoryId, uuid, revision.inventory.kind, revision.inventory.scope, changes, reason ?? `Rollback of ${revisionId}`, actor, ip, revisionId);
  }

  async cancel(uuid: string, revisionId: string, actor: AuditActor, ip: string | null) {
    const revision = await this.prisma.inventoryRevision.findUnique({ where: { id: revisionId }, include: { inventory: true } });
    if (!revision || revision.inventory.playerUuid !== uuid) throw new NotFoundException();
    const result = await this.prisma.inventoryRevision.updateMany({ where: { id: revisionId, status: InventoryRevisionStatus.PENDING }, data: { status: InventoryRevisionStatus.CANCELLED } });
    if (result.count !== 1) throw new ConflictException({ code: 'NOT_PENDING', message: 'Only pending revisions can be cancelled' });
    await this.audit.record({ actor, action: 'inventory.revision_cancelled', targetType: 'player', targetId: uuid, metadata: { revisionId }, ipAddress: ip });
    this.realtime.publish({ type: 'inventory.changed', uuid });
    return { ok: true };
  }

  private async createRevision(inventoryId: string, uuid: string, kind: InventoryKind, scope: string, changes: ResolvedChange[], reason: string | undefined, actor: AuditActor & { userId: string }, ip: string | null, rollbackOfId: string | null) {
    const inventory = await this.prisma.playerInventory.findUniqueOrThrow({ where: { id: inventoryId } });
    const revision = await this.prisma.$transaction(async (tx) => {
      const created = await tx.inventoryRevision.create({
        data: {
          inventoryId,
          baseRevision: inventory.revision,
          status: InventoryRevisionStatus.PENDING,
          changes: changes as unknown as Prisma.InputJsonValue,
          actorUserId: actor.userId,
          reason: reason?.slice(0, 500) ?? null,
          rollbackOfId,
        },
      });
      await this.audit.record(
        {
          actor,
          action: rollbackOfId ? 'inventory.rollback_requested' : 'inventory.edit_requested',
          targetType: 'player',
          targetId: uuid,
          metadata: {
            revisionId: created.id,
            kind,
            scope,
            reason: reason ?? null,
            rollbackOf: rollbackOfId,
            slots: changes.map((c) => ({ slot: c.slot, before: c.beforeItem ? `${c.beforeItem.amount}× ${c.beforeItem.id}` : null, after: c.after ? `${c.after.amount}× ${c.after.id}` : null })),
          },
          ipAddress: ip,
        },
        tx,
      );
      return created;
    });
    this.realtime.publish({ type: 'inventory.changed', uuid });
    return { id: revision.id, status: revision.status };
  }

  private async assertNoPending(inventoryId: string) {
    if (await this.prisma.inventoryRevision.count({ where: { inventoryId, status: InventoryRevisionStatus.PENDING } })) {
      throw new ConflictException({ code: 'PENDING_EDIT', message: 'Another change is still waiting to be applied' });
    }
  }

  /** All items of the player on this server (both containers), for move operations. */
  private async itemPool(uuid: string, scope: string): Promise<SnapshotItem[]> {
    const all = await this.prisma.playerInventory.findMany({ where: { playerUuid: uuid, scope } });
    return all.flatMap((i) => parseSnapshot(i.contents).items);
  }
}
