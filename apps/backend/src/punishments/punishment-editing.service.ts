import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PERMISSIONS } from '@mnm/shared-types';
import { type ActorType, EvidenceVisibility, type Prisma, PunishmentChangeKind, PunishmentHistoryAction, PunishmentStatus, PunishmentType } from '../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { SettingsService } from '../settings/settings.service';
import { checkExpiry, DURATION_EDITABLE, type EditInput, type EvidenceType, evidenceConsistency, expiryFromCreation, planEdit } from './punishment-editing';
import { BAN_TYPES, effectiveStatus, MUTE_TYPES } from './punishment-rules';
import { auditActor, historyActor, type Issuer, serializePunishment, withNames } from './punishments.service';

const notExpired = (now: Date): Prisma.PunishmentWhereInput => ({ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] });
const PERMANENT_OF: Partial<Record<PunishmentType, PunishmentType>> = { TEMP_BAN: PunishmentType.BAN, TEMP_MUTE: PunishmentType.MUTE };
const TEMPORARY_OF: Partial<Record<PunishmentType, PunishmentType>> = { BAN: PunishmentType.TEMP_BAN, MUTE: PunishmentType.TEMP_MUTE };

type EvidenceRow = Prisma.PunishmentEvidenceGetPayload<object>;

export function serializeEvidence(e: EvidenceRow) {
  return {
    id: e.id,
    punishmentId: e.punishmentId,
    type: e.kind.toUpperCase(),
    title: e.title,
    url: e.url,
    description: e.content,
    visibility: e.visibility,
    version: e.version,
    system: !['VIDEO', 'SCREENSHOT', 'IMAGE', 'LINK', 'TEXT', 'NOTE'].includes(e.kind.toUpperCase()),
    createdAt: e.createdAt.toISOString(),
    createdBy: e.createdByName ?? null,
    updatedAt: e.updatedAt?.toISOString() ?? null,
    updatedBy: e.updatedByName ?? null,
  };
}

/** Snapshot of an evidence entry for the change history (no metadata blobs). */
const evidenceSnapshot = (e: { id: string; kind: string; title: string | null; url: string | null; content: string | null; visibility: EvidenceVisibility }) => ({
  evidenceId: e.id,
  type: e.kind.toUpperCase(),
  title: e.title,
  url: e.url,
  description: e.content,
  visibility: e.visibility,
});

/** In-game edits: the plugin checked the permission nodes and reports the elevated one. */
export interface CommandOptions {
  kind: 'BAN' | 'MUTE';
  allowPermanentChange: boolean;
}

export interface EditOptions {
  /** Optimistic lock; undefined only for in-game commands that act on the current state. */
  version?: number;
  note?: string | null;
  ipAddress?: string | null;
  /** Server-side permission check for exactly the planned changes (dashboard). */
  authorize?: (permissions: string[]) => void;
}

@Injectable()
export class PunishmentEditingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
    private readonly settings: SettingsService,
  ) {}

  async detail(id: string, options: { includeStaffNote: boolean }) {
    const p = await this.prisma.punishment.findUnique({ where: { id }, include: withNames });
    if (!p) throw new NotFoundException({ code: 'PUNISHMENT_NOT_FOUND', message: 'Punishment not found' });
    const { requireEvidence } = await this.settings.getModeration();
    const status = effectiveStatus(p);
    return {
      ...serializePunishment(p),
      staffNote: options.includeStaffNote ? p.staffNote : undefined,
      // Policy flag only: an authorised punishment stays in force without evidence.
      needsReview: requireEvidence && status === PunishmentStatus.ACTIVE && p._count.evidence === 0 && p.type !== PunishmentType.KICK,
      durationEditable: DURATION_EDITABLE.includes(p.type),
      reactivatable: DURATION_EDITABLE.includes(p.type) && (status === PunishmentStatus.EXPIRED || status === PunishmentStatus.REVOKED),
    };
  }

  /**
   * Edits reason, expiry (incl. temporary ↔ permanent) and staff note. Never
   * creates a second punishment and never reactivates an inactive one.
   */
  async edit(id: string, input: EditInput, actor: Issuer, options: EditOptions = {}) {
    const result = await this.prisma.$transaction(async (tx) => {
      const current = await tx.punishment.findUnique({ where: { id } });
      if (!current) throw new NotFoundException({ code: 'PUNISHMENT_NOT_FOUND', message: 'Punishment not found' });
      if (options.version !== undefined && options.version !== current.version) {
        throw new ConflictException({ code: 'STALE_PUNISHMENT', message: 'The punishment was changed by someone else. Reload and try again.' });
      }
      const plan = planEdit(current, input);
      if (!plan.ok) {
        throw plan.code === 'NO_CHANGES' || plan.code === 'INVALID_DURATION' || plan.code === 'DURATION_ALREADY_ELAPSED'
          ? new BadRequestException({ code: plan.code, message: plan.message })
          : new ConflictException({ code: plan.code, message: plan.message });
      }
      options.authorize?.(plan.permissions);

      // Conditional update on the version: concurrent edits cannot both succeed.
      const updated = await tx.punishment.updateMany({
        where: { id, version: current.version },
        data: { ...plan.data, version: { increment: 1 }, updatedAt: new Date() },
      });
      if (updated.count !== 1) throw new ConflictException({ code: 'STALE_PUNISHMENT', message: 'The punishment was changed by someone else. Reload and try again.' });
      const note = options.note?.trim().slice(0, 1000) || null;
      await tx.punishmentHistory.createMany({
        data: plan.history.map((h) => ({
          punishmentId: id,
          action: h.action,
          previousValues: h.previousValues as Prisma.InputJsonValue,
          newValues: h.newValues as Prisma.InputJsonValue,
          note,
          ...historyActor(actor),
        })),
      });
      // Only active punishments are in the plugins' caches. An update entry for an
      // expired or revoked one would make plugins (incl. 1.0.x, which upsert every
      // non-REVOKED entry) enforce it again.
      if (plan.notifyPlugins && effectiveStatus(current) === PunishmentStatus.ACTIVE) {
        await tx.punishmentChange.create({ data: { punishmentId: id, kind: PunishmentChangeKind.UPDATED } });
      }
      await this.audit.record(
        {
          actor: auditActor(actor),
          action: 'punishments.edited',
          targetType: 'player',
          targetId: current.targetUuid,
          metadata: { punishmentId: id, changes: plan.history.map((h) => ({ action: h.action, from: h.previousValues, to: h.newValues })) as Prisma.InputJsonValue, note },
          ipAddress: options.ipAddress ?? null,
        },
        tx,
      );
      const after = await tx.punishment.findUniqueOrThrow({ where: { id }, include: withNames });
      return { previous: current, after, plan };
    });
    this.realtime.publish({ type: 'punishment.changed', uuid: result.after.targetUuid });
    return {
      punishment: serializePunishment(result.after),
      previous: { type: result.previous.type, reason: result.previous.reason, expiresAt: result.previous.expiresAt?.toISOString() ?? null },
      changes: result.plan.history.map((h) => h.action),
    };
  }

  /** In-game /editban and /editmute: duration counted from the creation time (null = permanent). */
  async editActive(targetUuid: string, kind: 'BAN' | 'MUTE', durationSeconds: number | null | undefined, reason: string | undefined, actor: Issuer, options: CommandOptions) {
    const active = await this.prisma.punishment.findFirst({
      where: { targetUuid, type: { in: [...(kind === 'BAN' ? BAN_TYPES : MUTE_TYPES)] }, status: PunishmentStatus.ACTIVE, ...notExpired(new Date()) },
      orderBy: { createdAt: 'desc' },
    });
    if (!active) throw new ConflictException({ code: kind === 'BAN' ? 'NOT_BANNED' : 'NOT_MUTED', message: 'No active punishment of this kind' });
    return this.editByCommand(active.id, durationSeconds, reason, actor, options);
  }

  async editByCommand(id: string, durationSeconds: number | null | undefined, reason: string | undefined, actor: Issuer, options: CommandOptions) {
    const p = await this.prisma.punishment.findUnique({ where: { id }, select: { createdAt: true, type: true } });
    if (!p) throw new NotFoundException({ code: 'PUNISHMENT_NOT_FOUND', message: 'Punishment not found' });
    if (!(options.kind === 'BAN' ? BAN_TYPES : MUTE_TYPES).includes(p.type)) {
      throw new ConflictException({ code: 'WRONG_PUNISHMENT_TYPE', message: `Punishment ${id} is not a ${options.kind.toLowerCase()}` });
    }
    const expiresAt = durationSeconds === undefined ? undefined : expiryFromCreation(p.createdAt, durationSeconds);
    return this.edit(id, { reason, expiresAt }, actor, {
      authorize: (permissions) => {
        if (permissions.includes(PERMISSIONS.PUNISHMENTS_EDIT_PERMANENT) && !options.allowPermanentChange) {
          throw new ForbiddenException({ code: 'PERMANENT_NOT_ALLOWED', message: 'Missing permission for temporary/permanent changes' });
        }
      },
    });
  }

  /** Explicit reactivation of an expired or revoked ban/mute (separate permission and confirmation). */
  async reactivate(id: string, expiresAt: Date | null, actor: Issuer, options: EditOptions & { version: number }) {
    const result = await this.prisma.$transaction(async (tx) => {
      const current = await tx.punishment.findUnique({ where: { id } });
      if (!current) throw new NotFoundException({ code: 'PUNISHMENT_NOT_FOUND', message: 'Punishment not found' });
      if (current.version !== options.version) throw new ConflictException({ code: 'STALE_PUNISHMENT', message: 'The punishment was changed by someone else. Reload and try again.' });
      const now = new Date();
      const status = effectiveStatus(current, now.getTime());
      if (!DURATION_EDITABLE.includes(current.type) || status === PunishmentStatus.ACTIVE) {
        throw new ConflictException({ code: 'NOT_REACTIVATABLE', message: 'Only expired or revoked bans and mutes can be reactivated' });
      }
      const invalid = checkExpiry(current.createdAt, expiresAt, now);
      if (invalid && !invalid.ok) throw new BadRequestException({ code: invalid.code, message: invalid.message });
      const group = BAN_TYPES.includes(current.type) ? BAN_TYPES : MUTE_TYPES;
      const other = await tx.punishment.findFirst({
        where: { targetUuid: current.targetUuid, type: { in: [...group] }, status: PunishmentStatus.ACTIVE, id: { not: id }, ...notExpired(now) },
      });
      if (other) {
        throw new ConflictException({ code: BAN_TYPES.includes(current.type) ? 'ALREADY_BANNED' : 'ALREADY_MUTED', message: 'The player already has another active punishment of this kind', punishmentId: other.id });
      }
      const type = expiresAt === null ? (PERMANENT_OF[current.type] ?? current.type) : (TEMPORARY_OF[current.type] ?? current.type);
      const updated = await tx.punishment.updateMany({
        where: { id, version: current.version },
        data: {
          status: PunishmentStatus.ACTIVE,
          type,
          expiresAt,
          revokedAt: null,
          revokedReason: null,
          revokedByType: null,
          revokedByUserId: null,
          revokedByUuid: null,
          revokedByName: null,
          version: { increment: 1 },
          updatedAt: now,
        },
      });
      if (updated.count !== 1) throw new ConflictException({ code: 'STALE_PUNISHMENT', message: 'The punishment was changed by someone else. Reload and try again.' });
      const note = options.note?.trim().slice(0, 1000) || null;
      await tx.punishmentHistory.create({
        data: {
          punishmentId: id,
          action: PunishmentHistoryAction.REACTIVATED,
          previousValues: { status, type: current.type, expiresAt: current.expiresAt?.toISOString() ?? null, revokedBy: current.revokedByName, revokedReason: current.revokedReason },
          newValues: { status: PunishmentStatus.ACTIVE, type, expiresAt: expiresAt?.toISOString() ?? null },
          note,
          ...historyActor(actor),
        },
      });
      await tx.punishmentChange.create({ data: { punishmentId: id, kind: PunishmentChangeKind.REACTIVATED } });
      await this.audit.record(
        { actor: auditActor(actor), action: 'punishments.reactivated', targetType: 'player', targetId: current.targetUuid, metadata: { punishmentId: id, previousStatus: status, expiresAt: expiresAt?.toISOString() ?? null, note }, ipAddress: options.ipAddress ?? null },
        tx,
      );
      return tx.punishment.findUniqueOrThrow({ where: { id }, include: withNames });
    });
    this.realtime.publish({ type: 'punishment.changed', uuid: result.targetUuid });
    return serializePunishment(result);
  }

  async history(id: string) {
    await this.ensureExists(id);
    const rows = await this.prisma.punishmentHistory.findMany({ where: { punishmentId: id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    return rows.map((h) => ({
      id: h.id,
      action: h.action,
      previousValues: h.previousValues,
      newValues: h.newValues,
      actor: { type: h.actorType, name: h.actorName },
      note: h.note,
      createdAt: h.createdAt.toISOString(),
    }));
  }

  // ── Evidence ────────────────────────────────────────────────────

  async listEvidence(id: string) {
    await this.ensureExists(id);
    const rows = await this.prisma.punishmentEvidence.findMany({ where: { punishmentId: id, deletedAt: null }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    return rows.map(serializeEvidence);
  }

  async addEvidence(id: string, input: { type: EvidenceType; title: string; url: string | null; description: string | null; visibility: 'STAFF' | 'PUBLIC' }, actor: Issuer, ipAddress?: string | null) {
    const created = await this.prisma.$transaction(async (tx) => {
      const punishment = await tx.punishment.findUnique({ where: { id }, select: { id: true, targetUuid: true } });
      if (!punishment) throw new NotFoundException({ code: 'PUNISHMENT_NOT_FOUND', message: 'Punishment not found' });
      const evidence = await tx.punishmentEvidence.create({
        data: {
          punishmentId: id,
          kind: input.type,
          title: input.title,
          url: input.url,
          content: input.description?.trim() || null,
          visibility: input.visibility as EvidenceVisibility,
          createdByType: actor.type as ActorType,
          createdByUserId: actor.userId ?? null,
          createdByName: actor.name.slice(0, 64),
        },
      });
      await tx.punishmentHistory.create({
        data: { punishmentId: id, action: PunishmentHistoryAction.EVIDENCE_ADDED, newValues: evidenceSnapshot(evidence), ...historyActor(actor) },
      });
      await this.audit.record(
        { actor: auditActor(actor), action: 'punishments.evidence_added', targetType: 'punishment', targetId: id, metadata: { evidenceId: evidence.id, type: input.type, title: input.title }, ipAddress: ipAddress ?? null },
        tx,
      );
      return { evidence, targetUuid: punishment.targetUuid };
    });
    this.realtime.publish({ type: 'punishment.changed', uuid: created.targetUuid });
    return serializeEvidence(created.evidence);
  }

  async updateEvidence(
    id: string,
    evidenceId: string,
    input: { version: number; title?: string; url?: string | null; description?: string | null; visibility?: 'STAFF' | 'PUBLIC' },
    actor: Issuer,
    ipAddress?: string | null,
  ) {
    const result = await this.prisma.$transaction(async (tx) => {
      const current = await tx.punishmentEvidence.findFirst({ where: { id: evidenceId, punishmentId: id, deletedAt: null }, include: { punishment: { select: { targetUuid: true } } } });
      if (!current) throw new NotFoundException({ code: 'EVIDENCE_NOT_FOUND', message: 'Evidence not found' });
      if (current.version !== input.version) throw new ConflictException({ code: 'STALE_EVIDENCE', message: 'The evidence was changed by someone else. Reload and try again.' });
      const kind = current.kind.toUpperCase();
      if (!['VIDEO', 'SCREENSHOT', 'IMAGE', 'LINK', 'TEXT', 'NOTE'].includes(kind)) {
        throw new ConflictException({ code: 'SYSTEM_EVIDENCE', message: 'Evidence recorded by the system cannot be edited' });
      }
      const next = {
        title: input.title ?? current.title,
        url: input.url !== undefined ? input.url : current.url,
        content: input.description !== undefined ? input.description?.trim() || null : current.content,
        visibility: (input.visibility ?? current.visibility) as EvidenceVisibility,
      };
      const problem = evidenceConsistency({ type: kind, url: next.url, description: next.content, visibility: next.visibility });
      if (problem) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: problem });
      const changed = (['title', 'url', 'content', 'visibility'] as const).filter((k) => next[k] !== current[k]);
      if (changed.length === 0) throw new BadRequestException({ code: 'NO_CHANGES', message: 'Nothing was changed' });

      const updated = await tx.punishmentEvidence.updateMany({
        where: { id: evidenceId, version: current.version },
        data: { ...next, version: { increment: 1 }, updatedAt: new Date(), updatedByName: actor.name.slice(0, 64) },
      });
      if (updated.count !== 1) throw new ConflictException({ code: 'STALE_EVIDENCE', message: 'The evidence was changed by someone else. Reload and try again.' });
      const field = (k: (typeof changed)[number]) => (k === 'content' ? 'description' : k);
      await tx.punishmentHistory.create({
        data: {
          punishmentId: id,
          action: PunishmentHistoryAction.EVIDENCE_UPDATED,
          previousValues: { evidenceId, ...Object.fromEntries(changed.map((k) => [field(k), current[k]])) },
          newValues: { evidenceId, ...Object.fromEntries(changed.map((k) => [field(k), next[k]])) },
          ...historyActor(actor),
        },
      });
      await this.audit.record(
        { actor: auditActor(actor), action: 'punishments.evidence_updated', targetType: 'punishment', targetId: id, metadata: { evidenceId, fields: changed.map(field) }, ipAddress: ipAddress ?? null },
        tx,
      );
      return { evidence: await tx.punishmentEvidence.findUniqueOrThrow({ where: { id: evidenceId } }), targetUuid: current.punishment.targetUuid };
    });
    this.realtime.publish({ type: 'punishment.changed', uuid: result.targetUuid });
    return serializeEvidence(result.evidence);
  }

  /** Soft deletion: hidden everywhere, kept for the retention period, recorded in the history. */
  async removeEvidence(id: string, evidenceId: string, version: number, reason: string | null, actor: Issuer, ipAddress?: string | null) {
    const targetUuid = await this.prisma.$transaction(async (tx) => {
      const current = await tx.punishmentEvidence.findFirst({ where: { id: evidenceId, punishmentId: id, deletedAt: null }, include: { punishment: { select: { targetUuid: true } } } });
      if (!current) throw new NotFoundException({ code: 'EVIDENCE_NOT_FOUND', message: 'Evidence not found' });
      const removed = await tx.punishmentEvidence.updateMany({
        where: { id: evidenceId, version, deletedAt: null },
        data: { deletedAt: new Date(), deletedByName: actor.name.slice(0, 64), version: { increment: 1 } },
      });
      if (removed.count !== 1) throw new ConflictException({ code: 'STALE_EVIDENCE', message: 'The evidence was changed by someone else. Reload and try again.' });
      await tx.punishmentHistory.create({
        data: { punishmentId: id, action: PunishmentHistoryAction.EVIDENCE_REMOVED, previousValues: evidenceSnapshot(current), note: reason?.trim().slice(0, 1000) || null, ...historyActor(actor) },
      });
      await this.audit.record(
        { actor: auditActor(actor), action: 'punishments.evidence_removed', targetType: 'punishment', targetId: id, metadata: { evidenceId, reason }, ipAddress: ipAddress ?? null },
        tx,
      );
      return current.punishment.targetUuid;
    });
    this.realtime.publish({ type: 'punishment.changed', uuid: targetUuid });
  }

  private async ensureExists(id: string) {
    const exists = await this.prisma.punishment.count({ where: { id } });
    if (!exists) throw new NotFoundException({ code: 'PUNISHMENT_NOT_FOUND', message: 'Punishment not found' });
  }
}
