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
import { PunishmentEditingService } from './punishment-editing.service';
import { PresetsService } from '../presets/presets.service';
import { reasonError } from '../presets/reason-errors';
import { type Issuer, PunishmentsService } from './punishments.service';

const actorSchema = z.object({ uuid: uuidSchema.optional(), name: z.string().trim().min(1).max(32) });

const createSchema = z
  .object({
    type: z.enum([PunishmentType.BAN, PunishmentType.TEMP_BAN, PunishmentType.MUTE, PunishmentType.TEMP_MUTE, PunishmentType.KICK, PunishmentType.WARNING]),
    target: z.string().trim().min(1).max(36),
    /** Numeric reason ID (/ban Steve 1); the punishment itself gets its own unique ID. */
    presetNumericId: z.number().int().min(1).max(9999).optional(),
    reason: reasonSchema.optional(),
    /** Seconds; with a preset an override (null = permanent), omitted = the preset's duration. */
    durationSeconds: z.number().int().min(MIN_DURATION_SECONDS).max(MAX_DURATION_SECONDS).nullable().optional(),
    issuer: actorSchema,
    /**
     * Canonical permissions the plugin verified for the issuer for this command
     * (nexora.punishment.<category>.<id>, .custom, .duration-override, .permanent).
     * In-game permissions are checked on the proxy (LuckPerms); plugins before 1.3 send none.
     */
    granted: z.array(z.string().max(100)).max(16).default([]),
    /** One key per command invocation; retries return the original punishment. */
    idempotencyKey: z.string().min(8).max(64),
  })
  .refine((b) => b.presetNumericId !== undefined || Boolean(b.reason), { message: 'A reason or a reason ID is required', path: ['reason'] });

const revokeSchema = z.object({
  kind: z.enum(['BAN', 'MUTE']),
  target: z.string().trim().min(1).max(36),
  reason: z.string().trim().max(500).optional(),
  revoker: actorSchema,
});

/**
 * /editban, /editmute: by player (active ban/mute) or by punishment id.
 * durationSeconds is the new TOTAL duration counted from the creation time;
 * null = permanent, omitted = keep the duration (reason-only edit).
 */
const editSchema = z
  .object({
    kind: z.enum(['BAN', 'MUTE']),
    target: z.string().trim().min(1).max(36).optional(),
    id: z.string().trim().min(1).max(32).optional(),
    durationSeconds: z.number().int().min(MIN_DURATION_SECONDS).max(MAX_DURATION_SECONDS).nullable().optional(),
    reason: reasonSchema.optional(),
    editor: actorSchema,
    /** Whether the editor holds the in-game permission for temporary ↔ permanent changes. */
    allowPermanentChange: z.boolean().default(false),
    /** Canonical permissions verified in-game (nexora.punishment.custom for a typed reason outside free-text mode). */
    granted: z.array(z.string().max(100)).max(16).default([]),
  })
  .strict()
  .refine((b) => Boolean(b.id) !== Boolean(b.target), { message: 'Either id or target is required' })
  .refine((b) => b.durationSeconds !== undefined || b.reason !== undefined, { message: 'Nothing to change' });

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
  constructor(
    private readonly punishments: PunishmentsService,
    private readonly editing: PunishmentEditingService,
    private readonly presets: PresetsService,
  ) {}

  /** Command mode and usable reason presets (fetched when the heartbeat's moderationRevision changes). */
  @Get('moderation')
  moderation() {
    return this.presets.pluginCatalog();
  }

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
    const granted = new Set(body.granted);
    const resolved = await this.presets.resolve({ type: body.type, presetNumericId: body.presetNumericId, reason: body.reason, durationSeconds: body.durationSeconds }, (p) => granted.has(p));
    if (!resolved.ok) throw reasonError(resolved.code, resolved.numericId);
    const player = await this.punishments.resolvePlayer(body.target);
    return this.punishments.create({
      type: resolved.type,
      targetUuid: player.uuid,
      reason: resolved.reason,
      durationSeconds: resolved.durationSeconds,
      preset: resolved.preset ? { id: resolved.preset.id, category: resolved.preset.category, numericId: resolved.preset.numericId, name: resolved.preset.name } : null,
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

  /** /editban and /editmute (the plugin checks the in-game permission nodes). */
  @Post('punishments/edit')
  @HttpCode(200)
  @ZodBody(editSchema)
  async edit(@Req() req: PluginRequest, @Body() body: z.infer<typeof editSchema>) {
    const editor = issuerFor(body.editor, req.pluginServer!);
    if (body.reason !== undefined && (await this.presets.mode()) !== 'FREE_TEXT' && !body.granted.includes('nexora.punishment.custom')) throw reasonError('CUSTOM_REASON_FORBIDDEN');
    const options = { kind: body.kind, allowPermanentChange: body.allowPermanentChange };
    if (body.id) return this.editing.editByCommand(body.id, body.durationSeconds, body.reason, editor, options);
    const player = await this.punishments.resolvePlayer(body.target!);
    return this.editing.editActive(player.uuid, body.kind, body.durationSeconds, body.reason, editor, options);
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
