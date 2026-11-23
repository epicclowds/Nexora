import { Body, Controller, ForbiddenException, Get, HttpCode, NotFoundException, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PERMISSIONS } from '@mnm/shared-types';
import type { Request } from 'express';
import { z } from 'zod';
import { SkipCsrf } from '../auth/guards';
import { type AuthenticatedUser, clientIp, CurrentUser, Public, RequirePermissions } from '../common/auth-context';
import { ZodBody } from '../common/zod';
import { userActor } from '../audit/audit.service';
import { ServerType } from '../generated/prisma/client';
import { type PluginRequest, PluginAuthGuard } from '../plugin-api/plugin-auth.guard';
import { uuidSchema } from '../plugin-api/plugin-events';
import { normalizeUuid } from '../players/players.controller';
import { editSchema, type Kind, snapshotSchema } from './inventory-model';
import { InventoryService } from './inventory.service';

const ingestSchema = z.object({
  capturedAt: z.number().int().positive(),
  players: z.array(z.object({ uuid: uuidSchema, inventory: snapshotSchema.optional(), enderChest: snapshotSchema.optional() })).min(1).max(50),
});

const resultSchema = z.object({
  status: z.enum(['APPLIED', 'CONFLICT', 'REJECTED']),
  message: z.string().max(500).optional(),
  appliedFps: z.record(z.string().regex(/^\d{1,2}$/), z.string().regex(/^[0-9a-f]{64}$/).nullable()).optional(),
  snapshot: snapshotSchema.optional(),
});

const reasonSchema = z.object({ reason: z.string().trim().max(500).optional() });
const KINDS: Record<string, Kind> = { inventory: 'INVENTORY', 'ender-chest': 'ENDER_CHEST' };

/** Paper servers: snapshots, pending edits and their results (signed plugin API). */
@ApiTags('plugin')
@Public()
@SkipCsrf()
@UseGuards(PluginAuthGuard)
@Throttle({ default: { limit: 1200, ttl: 60_000 } })
@Controller('plugin/v1/inventories')
export class PluginInventoryController {
  constructor(private readonly inventories: InventoryService) {}

  @Post()
  @HttpCode(200)
  @ZodBody(ingestSchema)
  ingest(@Req() req: PluginRequest, @Body() body: z.infer<typeof ingestSchema>) {
    return this.inventories.ingest(this.paper(req), body.players, new Date(Math.min(body.capturedAt, Date.now())));
  }

  @Get('pending')
  pending(@Req() req: PluginRequest) {
    return this.inventories.pendingFor(this.paper(req));
  }

  @Post('revisions/:id/result')
  @HttpCode(200)
  @ZodBody(resultSchema)
  result(@Req() req: PluginRequest, @Param('id') id: string, @Body() body: z.infer<typeof resultSchema>) {
    return this.inventories.complete(this.paper(req), id, body);
  }

  private paper(req: PluginRequest): string {
    const server = req.pluginServer!;
    if (server.type !== ServerType.PAPER) throw new ForbiddenException({ code: 'PAPER_ONLY', message: 'Inventories are handled by Paper servers' });
    return server.id;
  }
}

@ApiTags('inventory')
@Controller('players/:uuid/inventories')
export class InventoryController {
  constructor(private readonly inventories: InventoryService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.PLAYERS_VIEW_INVENTORY)
  overview(@Param('uuid') raw: string) {
    return this.inventories.overview(uuidOf(raw));
  }

  @Get(':scope/:kind')
  @RequirePermissions(PERMISSIONS.PLAYERS_VIEW_INVENTORY)
  view(@Param('uuid') raw: string, @Param('scope') scope: string, @Param('kind') kind: string) {
    return this.inventories.view(uuidOf(raw), scope, kindOf(kind));
  }

  @Post(':scope/refresh')
  @HttpCode(202)
  @RequirePermissions(PERMISSIONS.PLAYERS_VIEW_INVENTORY)
  refresh(@Param('uuid') raw: string, @Param('scope') scope: string) {
    return this.inventories.requestSnapshot(uuidOf(raw), scope);
  }

  @Post(':scope/:kind/revisions')
  @RequirePermissions(PERMISSIONS.PLAYERS_EDIT_INVENTORY)
  @ZodBody(editSchema)
  edit(@CurrentUser() user: AuthenticatedUser, @Param('uuid') raw: string, @Param('scope') scope: string, @Param('kind') kind: string, @Body() body: z.infer<typeof editSchema>, @Req() req: Request) {
    return this.inventories.edit(uuidOf(raw), scope, kindOf(kind), body, { ...userActor(user), userId: user.id }, clientIp(req));
  }

  @Post('revisions/:id/rollback')
  @RequirePermissions(PERMISSIONS.PLAYERS_EDIT_INVENTORY)
  @ZodBody(reasonSchema)
  rollback(@CurrentUser() user: AuthenticatedUser, @Param('uuid') raw: string, @Param('id') id: string, @Body() body: z.infer<typeof reasonSchema>, @Req() req: Request) {
    return this.inventories.rollback(uuidOf(raw), id, body.reason, { ...userActor(user), userId: user.id }, clientIp(req));
  }

  @Post('revisions/:id/cancel')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.PLAYERS_EDIT_INVENTORY)
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('uuid') raw: string, @Param('id') id: string, @Req() req: Request) {
    return this.inventories.cancel(uuidOf(raw), id, userActor(user), clientIp(req));
  }
}

function uuidOf(raw: string): string {
  const uuid = normalizeUuid(raw);
  if (!uuid) throw new NotFoundException();
  return uuid;
}

function kindOf(raw: string): Kind {
  const kind = KINDS[raw];
  if (!kind) throw new NotFoundException();
  return kind;
}
