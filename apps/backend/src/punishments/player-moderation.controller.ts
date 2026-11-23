import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, NotFoundException, Param, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { hasPermission, PERMISSIONS } from '@mnm/shared-types';
import type { Request } from 'express';
import { z } from 'zod';
import { type AuthenticatedUser, clientIp, CurrentUser, RequirePermissions } from '../common/auth-context';
import { paginationSchema, ZodBody, ZodQuery } from '../common/zod';
import { AuditService, userActor } from '../audit/audit.service';
import { normalizeUuid } from '../players/players.controller';
import { PrismaService } from '../prisma/prisma.service';
import { PunishmentsService } from './punishments.service';

const noteSchema = z.object({ content: z.string().trim().min(1).max(4000) });

/** Moderation data on a player profile: punishment history, active status and internal staff notes. */
@ApiTags('punishments')
@Controller('players/:uuid')
export class PlayerModerationController {
  constructor(
    private readonly punishments: PunishmentsService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get('punishments')
  @RequirePermissions(PERMISSIONS.PUNISHMENTS_HISTORY)
  @ZodQuery(paginationSchema)
  async history(@Param('uuid') raw: string, @Query() q: z.infer<typeof paginationSchema>) {
    const uuid = this.uuid(raw);
    const [list, active] = await Promise.all([this.punishments.list({ ...q, targetUuid: uuid }), this.punishments.activeFor(uuid)]);
    return { ...list, active };
  }

  @Get('notes')
  @RequirePermissions(PERMISSIONS.PLAYERS_NOTES)
  async notes(@Param('uuid') raw: string) {
    const notes = await this.prisma.playerNote.findMany({
      where: { playerUuid: this.uuid(raw) },
      orderBy: { createdAt: 'desc' },
      include: { author: { select: { id: true, username: true } } },
    });
    return notes.map((n) => ({ id: n.id, content: n.content, author: n.author, createdAt: n.createdAt.toISOString() }));
  }

  @Post('notes')
  @RequirePermissions(PERMISSIONS.PLAYERS_NOTES)
  @ZodBody(noteSchema)
  async addNote(@CurrentUser() user: AuthenticatedUser, @Param('uuid') raw: string, @Body() body: z.infer<typeof noteSchema>, @Req() req: Request) {
    const uuid = this.uuid(raw);
    if (!(await this.prisma.player.findUnique({ where: { uuid }, select: { uuid: true } }))) throw new NotFoundException();
    const note = await this.prisma.$transaction(async (tx) => {
      const created = await tx.playerNote.create({ data: { playerUuid: uuid, authorUserId: user.id, content: body.content } });
      await this.audit.record({ actor: userActor(user), action: 'players.note_added', targetType: 'player', targetId: uuid, metadata: { noteId: created.id }, ipAddress: clientIp(req) }, tx);
      return created;
    });
    return { id: note.id, content: note.content, author: { id: user.id, username: user.username }, createdAt: note.createdAt.toISOString() };
  }

  /** Authors may delete their own notes; others need dashboard.manage. */
  @Delete('notes/:noteId')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.PLAYERS_NOTES)
  async deleteNote(@CurrentUser() user: AuthenticatedUser, @Param('uuid') raw: string, @Param('noteId') noteId: string, @Req() req: Request) {
    const uuid = this.uuid(raw);
    const note = await this.prisma.playerNote.findFirst({ where: { id: noteId, playerUuid: uuid } });
    if (!note) throw new NotFoundException();
    if (note.authorUserId !== user.id && !hasPermission(user.permissions, PERMISSIONS.DASHBOARD_MANAGE)) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Only the author can delete this note' });
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.playerNote.delete({ where: { id: noteId } });
      await this.audit.record({ actor: userActor(user), action: 'players.note_deleted', targetType: 'player', targetId: uuid, metadata: { noteId, content: note.content }, ipAddress: clientIp(req) }, tx);
    });
    return { ok: true };
  }

  private uuid(raw: string): string {
    const uuid = normalizeUuid(raw);
    if (!uuid) throw new NotFoundException();
    return uuid;
  }
}
