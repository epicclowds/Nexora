import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, NotFoundException, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { LEADERBOARD_STATS, PERMISSIONS, STAT_KEY_PATTERN, STATS } from '@mnm/shared-types';
import { z } from 'zod';
import { SkipCsrf } from '../auth/guards';
import { type AuthenticatedUser, CurrentUser, Public, RequirePermissions } from '../common/auth-context';
import { ZodBody, ZodQuery } from '../common/zod';
import { ServerType } from '../generated/prisma/client';
import { type PluginRequest, PluginAuthGuard } from '../plugin-api/plugin-auth.guard';
import { uuidSchema } from '../plugin-api/plugin-events';
import { normalizeUuid } from '../players/players.controller';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { HISTORY_KEYS, StatisticsService } from './statistics.service';

const ingestSchema = z.object({
  capturedAt: z.number().int().positive(),
  players: z
    .array(
      z.object({
        uuid: uuidSchema,
        stats: z
          .record(z.string().regex(STAT_KEY_PATTERN), z.number().int().min(0).max(Number.MAX_SAFE_INTEGER))
          .refine((r) => Object.keys(r).length <= 5000, 'Too many statistics'),
      }),
    )
    .min(1)
    .max(50),
});

const RANGES = { '24h': 86_400_000, '7d': 7 * 86_400_000, '30d': 30 * 86_400_000 } as const;

const playerQuery = z.object({
  range: z.enum(['24h', '7d', '30d', 'all', 'custom']).default('all'),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
});

const seriesQuery = z.object({
  keys: z.string().max(500).default([STATS.BLOCKS_MINED, STATS.MOB_KILLS, STATS.DEATHS, STATS.WALK].join(',')),
  days: z.coerce.number().int().min(7).max(90).default(30),
});

const leaderboardQuery = z.object({
  stat: z.string().refine((s) => (LEADERBOARD_STATS as readonly string[]).includes(s), 'Unsupported statistic'),
  limit: z.coerce.number().int().min(1).max(100).default(10),
});

/** Ingestion from Paper servers (signed plugin API). */
@ApiTags('plugin')
@Public()
@SkipCsrf()
@UseGuards(PluginAuthGuard)
@Throttle({ default: { limit: 600, ttl: 60_000 } })
@Controller('plugin/v1')
export class PluginStatisticsController {
  constructor(private readonly statistics: StatisticsService) {}

  @Post('statistics')
  @HttpCode(200)
  @ZodBody(ingestSchema)
  ingest(@Req() req: PluginRequest, @Body() body: z.infer<typeof ingestSchema>) {
    const server = req.pluginServer!;
    if (server.type !== ServerType.PAPER) throw new ForbiddenException({ code: 'PAPER_ONLY', message: 'Statistics are reported by Paper servers' });
    return this.statistics.ingest(server.id, body.players, new Date(Math.min(body.capturedAt, Date.now())));
  }
}

@ApiTags('statistics')
@Controller()
export class StatisticsController {
  constructor(
    private readonly statistics: StatisticsService,
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /** Player statistics for 24h / 7d / 30d / all time / a custom range. */
  @Get('players/:uuid/statistics')
  @RequirePermissions(PERMISSIONS.PLAYERS_VIEW_STATISTICS)
  @ZodQuery(playerQuery)
  async player(@Param('uuid') raw: string, @Query() q: z.infer<typeof playerQuery>) {
    const uuid = await this.requirePlayer(raw);
    const to = q.range === 'custom' && q.to ? new Date(q.to) : new Date();
    let from: Date | null = null;
    if (q.range === 'custom') {
      if (!q.from) throw new BadRequestException({ code: 'FROM_REQUIRED', message: 'A custom range needs "from"' });
      from = new Date(q.from);
      if (from >= to) throw new BadRequestException({ code: 'INVALID_RANGE', message: '"from" must be before "to"' });
    } else if (q.range !== 'all') {
      from = new Date(to.getTime() - RANGES[q.range]);
    }
    return this.statistics.forPlayer(uuid, { from, to });
  }

  @Get('players/:uuid/statistics/series')
  @RequirePermissions(PERMISSIONS.PLAYERS_VIEW_STATISTICS)
  @ZodQuery(seriesQuery)
  async series(@Param('uuid') raw: string, @Query() q: z.infer<typeof seriesQuery>, @CurrentUser() user: AuthenticatedUser) {
    const uuid = await this.requirePlayer(raw);
    const keys = q.keys.split(',').filter((k) => HISTORY_KEYS.includes(k)).slice(0, 8);
    if (!keys.length) throw new BadRequestException({ code: 'NO_KEYS', message: 'No supported statistic keys' });
    const timezone = user.timezone ?? (await this.settings.getNetwork()).defaultTimezone;
    return this.statistics.series(uuid, keys, q.days, timezone);
  }

  @Get('statistics/overview')
  @RequirePermissions(PERMISSIONS.PLAYERS_VIEW_STATISTICS)
  overview() {
    return this.statistics.networkOverview();
  }

  @Get('statistics/leaderboard')
  @RequirePermissions(PERMISSIONS.PLAYERS_VIEW_STATISTICS)
  @ZodQuery(leaderboardQuery)
  leaderboard(@Query() q: z.infer<typeof leaderboardQuery>) {
    return this.statistics.leaderboard(q.stat, q.limit);
  }

  private async requirePlayer(raw: string): Promise<string> {
    const uuid = normalizeUuid(raw);
    if (!uuid || !(await this.prisma.player.findUnique({ where: { uuid }, select: { uuid: true } }))) throw new NotFoundException();
    return uuid;
  }
}
