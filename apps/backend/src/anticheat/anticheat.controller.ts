import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PERMISSIONS } from '@mnm/shared-types';
import type { Request } from 'express';
import { z } from 'zod';
import { SkipCsrf } from '../auth/guards';
import { type AuthenticatedUser, clientIp, CurrentUser, Public, RequirePermissions } from '../common/auth-context';
import { startOfDayInTimezone } from '../common/time';
import { paginationSchema, ZodBody, ZodQuery } from '../common/zod';
import { AuditService, userActor } from '../audit/audit.service';
import { type PluginRequest, PluginAuthGuard } from '../plugin-api/plugin-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { antiCheatSettingsSchema, cheatTypeSchema, EXAMPLE_RULES } from './anticheat-rules';
import { ANTICHEAT_SETTINGS_KEY, AntiCheatService } from './anticheat.service';

const reportSchema = z.object({
  target: z.string().trim().min(1).max(36),
  provider: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9 _.-]+$/),
  cheatType: cheatTypeSchema,
  violationLevel: z.number().min(0).max(1_000_000).optional(),
  reason: z.string().trim().max(500).optional(),
  evidence: z.string().max(10_000).optional(),
  metadata: z
    .record(z.string().max(64), z.union([z.string().max(1000), z.number(), z.boolean(), z.null()]))
    .refine((m) => Object.keys(m).length <= 50, 'Too many metadata entries')
    .optional(),
  explicit: z.boolean().default(false),
  eventKey: z.string().min(8).max(64),
});

const eventsQuery = paginationSchema.extend({
  provider: z.string().max(64).optional(),
  cheatType: z.string().max(64).optional(),
  punished: z.enum(['true', 'false']).optional(),
});

/** Reports from AntiCheat integrations on Paper servers (signed plugin API). */
@ApiTags('plugin')
@Public()
@SkipCsrf()
@UseGuards(PluginAuthGuard)
@Throttle({ default: { limit: 600, ttl: 60_000 } })
@Controller('plugin/v1/anticheat')
export class PluginAntiCheatController {
  constructor(private readonly anticheat: AntiCheatService) {}

  @Post('reports')
  @HttpCode(200)
  @ZodBody(reportSchema)
  report(@Req() req: PluginRequest, @Body() body: z.infer<typeof reportSchema>) {
    const server = req.pluginServer!;
    return this.anticheat.report({ id: server.id, name: server.name }, body);
  }
}

@ApiTags('anticheat')
@Controller()
export class AntiCheatController {
  constructor(
    private readonly anticheat: AntiCheatService,
    private readonly settings: SettingsService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get('anticheat/events')
  @RequirePermissions(PERMISSIONS.ANTICHEAT_VIEW)
  @ZodQuery(eventsQuery)
  events(@Query() q: z.infer<typeof eventsQuery>) {
    return this.anticheat.list({ ...q, punishedOnly: q.punished === 'true' });
  }

  @Get('anticheat/summary')
  @RequirePermissions(PERMISSIONS.ANTICHEAT_VIEW)
  async summary(@CurrentUser() user: AuthenticatedUser) {
    const timezone = user.timezone ?? (await this.settings.getNetwork()).defaultTimezone;
    return this.anticheat.summary(startOfDayInTimezone(timezone));
  }

  @Get('players/:uuid/anticheat')
  @RequirePermissions(PERMISSIONS.ANTICHEAT_VIEW)
  @ZodQuery(paginationSchema)
  forPlayer(@Param('uuid') raw: string, @Query() q: z.infer<typeof paginationSchema>) {
    return this.anticheat.list({ ...q, uuid: AntiCheatService.uuid(raw) });
  }

  @Get('anticheat/settings')
  @RequirePermissions(PERMISSIONS.ANTICHEAT_VIEW)
  async getSettings() {
    return { settings: await this.anticheat.getSettings(), examples: EXAMPLE_RULES };
  }

  /** Replaces rules and options. Takes effect for the next report (no plugin restart needed). */
  @Put('anticheat/settings')
  @RequirePermissions(PERMISSIONS.ANTICHEAT_MANAGE)
  @ZodBody(antiCheatSettingsSchema)
  async putSettings(@CurrentUser() actor: AuthenticatedUser, @Body() body: z.infer<typeof antiCheatSettingsSchema>, @Req() req: Request) {
    const before = await this.anticheat.getSettings();
    await this.prisma.$transaction(async (tx) => {
      await this.settings.set(ANTICHEAT_SETTINGS_KEY, body, actor.id, tx);
      await this.audit.record({ actor: userActor(actor), action: 'anticheat.settings_updated', targetType: 'setting', targetId: ANTICHEAT_SETTINGS_KEY, metadata: { before, after: body }, ipAddress: clientIp(req) }, tx);
    });
    return body;
  }
}
