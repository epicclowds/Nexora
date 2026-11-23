import { BadRequestException, Body, Controller, Get, HttpCode, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { SkipCsrf } from '../auth/guards';
import { Public } from '../common/auth-context';
import { ZodBody, ZodQuery } from '../common/zod';
import { ActorType, PunishmentSource, PunishmentType } from '../generated/prisma/client';
import { type PluginRequest, PluginAuthGuard, type PluginServer } from '../plugin-api/plugin-auth.guard';
import { uuidSchema } from '../plugin-api/plugin-events';
import { MAX_DURATION_SECONDS, MIN_DURATION_SECONDS } from './punishment-rules';
import { reasonSchema } from './punishments.controller';
import { type Issuer, PunishmentsService } from './punishments.service';

const actorSchema = z.object({ uuid: uuidSchema.optional(), name: z.string().trim().min(1).max(32) });

const createSchema = z.object({
  type: z.enum([PunishmentType.BAN, PunishmentType.TEMP_BAN, PunishmentType.MUTE, PunishmentType.TEMP_MUTE, PunishmentType.KICK, PunishmentType.WARNING]),
  target: z.string().trim().min(1).max(36),
  reason: reasonSchema,
  durationSeconds: z.number().int().min(MIN_DURATION_SECONDS).max(MAX_DURATION_SECONDS).optional(),
  issuer: actorSchema,
  /** One key per command invocation; retries return the original punishment. */
  idempotencyKey: z.string().min(8).max(64),
});

const revokeSchema = z.object({
  kind: z.enum(['BAN', 'MUTE']),
  target: z.string().trim().min(1).max(36),
  reason: z.string().trim().max(500).optional(),
  revoker: actorSchema,
});

const changesQuery = z.object({ after: z.string().regex(/^\d{1,19}$/).default('0') });
const lookupQuery = z.object({ target: z.string().trim().min(1).max(36), limit: z.coerce.number().int().min(1).max(50).default(10) });

/** In-game moderation and the punishment feed for the plugins' local enforcement caches. */
@ApiTags('plugin')
@Public()
@SkipCsrf()
@UseGuards(PluginAuthGuard)
@Throttle({ default: { limit: 1200, ttl: 60_000 } })
@Controller('plugin/v1')
export class PluginPunishmentsController {
  constructor(private readonly punishments: PunishmentsService) {}

  @Get('punishments/active')
  snapshot() {
    return this.punishments.pluginSnapshot();
  }

  @Get('punishments/changes')
  @ZodQuery(changesQuery)
  changes(@Query() q: z.infer<typeof changesQuery>) {
    return this.punishments.pluginChanges(BigInt(q.after));
  }

  @Post('punishments')
  @ZodBody(createSchema)
  async create(@Req() req: PluginRequest, @Body() body: z.infer<typeof createSchema>) {
    const server = req.pluginServer!;
    const player = await this.punishments.resolvePlayer(body.target);
    return this.punishments.create({
      type: body.type,
      targetUuid: player.uuid,
      reason: body.reason,
      durationSeconds: body.durationSeconds,
      source: body.issuer.uuid ? PunishmentSource.COMMAND : PunishmentSource.CONSOLE,
      issuer: issuerFor(body.issuer, server),
      serverId: server.id,
      idempotencyKey: `${server.id}:${body.idempotencyKey}`,
    });
  }

  @Post('punishments/revoke')
  @HttpCode(200)
  @ZodBody(revokeSchema)
  async revoke(@Req() req: PluginRequest, @Body() body: z.infer<typeof revokeSchema>) {
    const player = await this.punishments.resolvePlayer(body.target);
    return this.punishments.revokeActive(player.uuid, body.kind, issuerFor(body.revoker, req.pluginServer!), body.reason || undefined);
  }

  /** Data for /history and /check. */
  @Get('players/lookup')
  @ZodQuery(lookupQuery)
  async lookup(@Query() q: z.infer<typeof lookupQuery>) {
    if (!q.target) throw new BadRequestException();
    const player = await this.punishments.resolvePlayer(q.target);
    const [active, history] = await Promise.all([
      this.punishments.activeFor(player.uuid),
      this.punishments.list({ page: 1, pageSize: q.limit, targetUuid: player.uuid }),
    ]);
    return { player: { uuid: player.uuid, username: player.username, online: player.online }, active, total: history.total, history: history.items };
  }
}

function issuerFor(actor: { uuid?: string; name: string }, server: PluginServer): Issuer {
  return actor.uuid
    ? { type: ActorType.PLAYER, uuid: actor.uuid, name: actor.name }
    : { type: ActorType.CONSOLE, name: `console@${server.name}`.slice(0, 64) };
}
