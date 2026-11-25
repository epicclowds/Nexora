import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, NotFoundException, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import { hasPermission, PERMISSIONS } from '@mnm/shared-types';
import type { Request } from 'express';
import { z } from 'zod';
import { type AuthenticatedUser, clientIp, CurrentUser, RequirePermissions } from '../common/auth-context';
import { paginationSchema, ZodBody, ZodQuery } from '../common/zod';
import { ActorType, PunishmentSource, PunishmentType } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ISSUE_PERMISSION, MAX_DURATION_SECONDS, MIN_DURATION_SECONDS, REVOKE_PERMISSION } from './punishment-rules';
import { createEvidenceSchema, updateEvidenceSchema } from './punishment-editing';
import { PunishmentEditingService } from './punishment-editing.service';
import { PresetsService } from '../presets/presets.service';
import { reasonError } from '../presets/reason-errors';
import { StaffPermissionsService } from '../presets/staff-permissions.service';
import { type Issuer, PunishmentsService } from './punishments.service';

export const reasonSchema = z.string().trim().min(1).max(500);

const listQuery = paginationSchema.extend({
  type: z.enum(PunishmentType).optional(),
  status: z.enum(['active', 'expired', 'revoked']).optional(),
  search: z.string().trim().max(64).optional(),
});

const createSchema = z
  .object({
    type: z.enum(PunishmentType),
    target: z.string().trim().min(1).max(36),
    /** Numeric reason ID of a preset (not a punishment ID). */
    presetNumericId: z.number().int().min(1).max(9999).optional(),
    reason: reasonSchema.optional(),
    /** Seconds; with a preset: override (null = permanent), omitted = the preset's duration. */
    durationSeconds: z.number().int().min(MIN_DURATION_SECONDS).max(MAX_DURATION_SECONDS).nullable().optional(),
  })
  .refine((b) => b.presetNumericId !== undefined || Boolean(b.reason), { message: 'A reason or a reason ID is required', path: ['reason'] });

const revokeSchema = z.object({ reason: z.string().trim().max(500).optional() });

const noteSchema = z.string().trim().max(1000);
const editSchema = z
  .object({
    version: z.number().int().min(1),
    reason: reasonSchema.optional(),
    /** ISO 8601 (UTC); null = permanent; omitted = unchanged. */
    expiresAt: z.iso.datetime({ offset: true }).nullable().optional(),
    staffNote: z.string().max(5000).nullable().optional(),
    /** Explanation stored with the change history. */
    note: noteSchema.optional(),
  })
  .strict();
const reactivateSchema = z.object({ version: z.number().int().min(1), expiresAt: z.iso.datetime({ offset: true }).nullable(), note: noteSchema.optional() }).strict();
const removeEvidenceSchema = z.object({ version: z.number().int().min(1), reason: noteSchema.optional() }).strict();

function dashboardIssuer(user: AuthenticatedUser): Issuer {
  return { type: ActorType.USER, userId: user.id, name: user.username };
}

@ApiTags('punishments')
@Controller('punishments')
export class PunishmentsController {
  constructor(
    private readonly punishments: PunishmentsService,
    private readonly prisma: PrismaService,
    private readonly editing: PunishmentEditingService,
    private readonly presets: PresetsService,
    private readonly staff: StaffPermissionsService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.PUNISHMENTS_HISTORY)
  @ZodQuery(listQuery)
  list(@Query() q: z.infer<typeof listQuery>) {
    return this.punishments.list(q);
  }

  /** Issue a punishment. The required permission depends on the type (checked here, server-side). */
  @Post()
  @ZodBody(createSchema)
  async create(@CurrentUser() user: AuthenticatedUser, @Body() body: z.infer<typeof createSchema>, @Req() req: Request) {
    this.require(user, ISSUE_PERMISSION[body.type]);
    // Same rules as in-game: global command mode + canonical nexora.punishment.* permissions.
    const check = await this.staff.forUser(user);
    const resolved = await this.presets.resolve(
      { type: body.type, presetNumericId: body.presetNumericId, reason: body.reason, durationSeconds: body.durationSeconds },
      check.blockedReason ? () => false : check.can,
    );
    if (!resolved.ok) throw reasonError(resolved.code, resolved.numericId);
    this.require(user, ISSUE_PERMISSION[resolved.type]);
    const player = await this.punishments.resolvePlayer(body.target);
    return this.punishments.create({
      type: resolved.type,
      targetUuid: player.uuid,
      reason: resolved.reason,
      durationSeconds: resolved.durationSeconds,
      source: PunishmentSource.DASHBOARD,
      issuer: dashboardIssuer(user),
      ipAddress: clientIp(req),
      preset: resolved.preset ? { id: resolved.preset.id, category: resolved.preset.category, numericId: resolved.preset.numericId, name: resolved.preset.name } : null,
    });
  }

  @Post(':id/revoke')
  @HttpCode(200)
  @ZodBody(revokeSchema)
  async revoke(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() body: z.infer<typeof revokeSchema>, @Req() req: Request) {
    const punishment = await this.prisma.punishment.findUnique({ where: { id }, select: { type: true } });
    if (punishment) this.require(user, REVOKE_PERMISSION[punishment.type]);
    return this.punishments.revokeById(id, dashboardIssuer(user), body.reason || undefined, clientIp(req));
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.PUNISHMENTS_HISTORY)
  detail(@Param('id') id: string) {
    return this.editing.detail(id, { includeStaffNote: true });
  }

  /**
   * Edits reason, duration/expiry (incl. temporary ↔ permanent) and the staff
   * note. Needs punishments.edit, the permission to issue this punishment type
   * and the specific permission for every changed aspect (checked server-side).
   */
  @Patch(':id')
  @RequirePermissions(PERMISSIONS.PUNISHMENTS_EDIT)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ZodBody(editSchema)
  async edit(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() body: z.infer<typeof editSchema>, @Req() req: Request) {
    const type = await this.typeOf(id);
    // A typed reason replaces a preset reason only where typed reasons are allowed (same rule as issuing).
    if (body.reason !== undefined && (await this.presets.mode()) !== 'FREE_TEXT') {
      const check = await this.staff.forUser(user);
      if (check.blockedReason || !check.can(PERMISSIONS.NEXORA_PUNISHMENT_CUSTOM)) throw reasonError('CUSTOM_REASON_FORBIDDEN');
    }
    return this.editing.edit(
      id,
      { reason: body.reason, expiresAt: body.expiresAt === undefined ? undefined : body.expiresAt === null ? null : new Date(body.expiresAt), staffNote: body.staffNote },
      dashboardIssuer(user),
      {
        version: body.version,
        note: body.note,
        ipAddress: clientIp(req),
        authorize: (permissions) => [ISSUE_PERMISSION[type], ...permissions].forEach((p) => this.require(user, p)),
      },
    );
  }

  /** Explicitly makes an expired or revoked ban/mute active again. */
  @Post(':id/reactivate')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.PUNISHMENTS_REACTIVATE)
  @ZodBody(reactivateSchema)
  async reactivate(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() body: z.infer<typeof reactivateSchema>, @Req() req: Request) {
    this.require(user, ISSUE_PERMISSION[await this.typeOf(id)]);
    return this.editing.reactivate(id, body.expiresAt === null ? null : new Date(body.expiresAt), dashboardIssuer(user), { version: body.version, note: body.note, ipAddress: clientIp(req) });
  }

  @Get(':id/history')
  @RequirePermissions(PERMISSIONS.PUNISHMENTS_HISTORY_VIEW)
  history(@Param('id') id: string) {
    return this.editing.history(id);
  }

  @Get(':id/evidence')
  @RequirePermissions(PERMISSIONS.PUNISHMENTS_EVIDENCE_VIEW)
  evidence(@Param('id') id: string) {
    return this.editing.listEvidence(id);
  }

  @Post(':id/evidence')
  @RequirePermissions(PERMISSIONS.PUNISHMENTS_EVIDENCE_ADD)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ZodBody(createEvidenceSchema)
  addEvidence(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() body: z.infer<typeof createEvidenceSchema>, @Req() req: Request) {
    return this.editing.addEvidence(id, body, dashboardIssuer(user), clientIp(req));
  }

  @Patch(':id/evidence/:evidenceId')
  @RequirePermissions(PERMISSIONS.PUNISHMENTS_EVIDENCE_EDIT)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ZodBody(updateEvidenceSchema)
  updateEvidence(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Param('evidenceId') evidenceId: string, @Body() body: z.infer<typeof updateEvidenceSchema>, @Req() req: Request) {
    return this.editing.updateEvidence(id, evidenceId, body, dashboardIssuer(user), clientIp(req));
  }

  @Delete(':id/evidence/:evidenceId')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.PUNISHMENTS_EVIDENCE_DELETE)
  @ZodBody(removeEvidenceSchema)
  async removeEvidence(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Param('evidenceId') evidenceId: string, @Body() body: z.infer<typeof removeEvidenceSchema>, @Req() req: Request) {
    await this.editing.removeEvidence(id, evidenceId, body.version, body.reason ?? null, dashboardIssuer(user), clientIp(req));
    return { ok: true };
  }

  private async typeOf(id: string) {
    const punishment = await this.prisma.punishment.findUnique({ where: { id }, select: { type: true } });
    if (!punishment) throw new NotFoundException({ code: 'PUNISHMENT_NOT_FOUND', message: 'Punishment not found' });
    return punishment.type;
  }

  private require(user: AuthenticatedUser, permission: string): void {
    if (!hasPermission(user.permissions, permission)) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: `Missing permission: ${permission}` });
    }
  }
}
