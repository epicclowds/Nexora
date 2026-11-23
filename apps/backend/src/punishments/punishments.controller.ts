import { Body, Controller, ForbiddenException, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { hasPermission, PERMISSIONS } from '@mnm/shared-types';
import type { Request } from 'express';
import { z } from 'zod';
import { type AuthenticatedUser, clientIp, CurrentUser, RequirePermissions } from '../common/auth-context';
import { paginationSchema, ZodBody, ZodQuery } from '../common/zod';
import { ActorType, PunishmentSource, PunishmentType } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ISSUE_PERMISSION, MAX_DURATION_SECONDS, MIN_DURATION_SECONDS, REVOKE_PERMISSION } from './punishment-rules';
import { type Issuer, PunishmentsService } from './punishments.service';

export const reasonSchema = z.string().trim().min(1).max(500);

const listQuery = paginationSchema.extend({
  type: z.enum(PunishmentType).optional(),
  status: z.enum(['active', 'expired', 'revoked']).optional(),
  search: z.string().trim().max(64).optional(),
});

const createSchema = z.object({
  type: z.enum(PunishmentType),
  target: z.string().trim().min(1).max(36),
  reason: reasonSchema,
  durationSeconds: z.number().int().min(MIN_DURATION_SECONDS).max(MAX_DURATION_SECONDS).optional(),
});

const revokeSchema = z.object({ reason: z.string().trim().max(500).optional() });

function dashboardIssuer(user: AuthenticatedUser): Issuer {
  return { type: ActorType.USER, userId: user.id, name: user.username };
}

@ApiTags('punishments')
@Controller('punishments')
export class PunishmentsController {
  constructor(
    private readonly punishments: PunishmentsService,
    private readonly prisma: PrismaService,
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
    const player = await this.punishments.resolvePlayer(body.target);
    return this.punishments.create({
      type: body.type,
      targetUuid: player.uuid,
      reason: body.reason,
      durationSeconds: body.durationSeconds,
      source: PunishmentSource.DASHBOARD,
      issuer: dashboardIssuer(user),
      ipAddress: clientIp(req),
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

  private require(user: AuthenticatedUser, permission: string): void {
    if (!hasPermission(user.permissions, permission)) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: `Missing permission: ${permission}` });
    }
  }
}
