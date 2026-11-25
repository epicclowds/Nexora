import { Body, Controller, ForbiddenException, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { SkipCsrf } from '../auth/guards';
import { Public } from '../common/auth-context';
import { ZodBody } from '../common/zod';
import { ServerStatus, ServerType } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { SettingsService } from '../settings/settings.service';
import { UpdatesService } from '../updates/updates.service';
import { type PluginRequest, PluginAuthGuard, type PluginServer } from './plugin-auth.guard';
import { eventBatchSchema, type HeartbeatInput, heartbeatSchema, type PluginEvent, syncSchema, type SyncInput } from './plugin-events';
import { PlayerTrackingService } from './player-tracking.service';

/** Recommended heartbeat interval returned to plugins. */
export const HEARTBEAT_INTERVAL_SECONDS = 15;

/** Signed machine-to-machine API used by the Velocity and Paper plugins. */
@ApiTags('plugin')
@ApiHeader({ name: 'X-MNM-Key-Id', required: true })
@ApiHeader({ name: 'X-MNM-Timestamp', required: true })
@ApiHeader({ name: 'X-MNM-Nonce', required: true })
@ApiHeader({ name: 'X-MNM-Signature', required: true })
@Public()
@SkipCsrf()
@UseGuards(PluginAuthGuard)
@Throttle({ default: { limit: 1200, ttl: 60_000 } })
@Controller('plugin/v1')
export class PluginApiController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tracking: PlayerTrackingService,
    private readonly realtime: RealtimeService,
    private readonly settings: SettingsService,
    private readonly updates: UpdatesService,
  ) {}

  /** Lets a plugin verify its credentials and clock. */
  @Get('ping')
  async ping(@Req() req: PluginRequest) {
    const server = req.pluginServer!;
    const configRevision = await this.settings.pluginSettingsRevision();
    return { serverId: server.id, serverName: server.name, serverType: server.type, serverTime: Date.now(), heartbeatIntervalSeconds: HEARTBEAT_INTERVAL_SECONDS, configRevision };
  }

  /**
   * Centrally managed settings. Plugins fetch them on start and whenever the
   * configRevision in a heartbeat response changes; null fields keep the
   * server's local value.
   */
  @Get('config')
  async config() {
    const { revision, settings } = await this.settings.getPluginSettings();
    return { revision, ...settings };
  }

  @Post('heartbeat')
  @HttpCode(200)
  @ZodBody(heartbeatSchema)
  async heartbeat(@Req() req: PluginRequest, @Body() body: HeartbeatInput) {
    const server = req.pluginServer!;
    await this.prisma.server.update({
      where: { id: server.id },
      data: {
        status: ServerStatus.ONLINE,
        lastHeartbeatAt: new Date(),
        pluginVersion: body.pluginVersion,
        platformVersion: body.platformVersion,
        minecraftVersion: body.minecraftVersion,
        onlinePlayers: body.onlinePlayers,
        maxPlayers: body.maxPlayers ?? null,
        tps: body.tps ?? null,
        mspt: body.mspt ?? null,
        memoryUsedBytes: body.memoryUsedBytes === undefined ? null : BigInt(body.memoryUsedBytes),
        memoryMaxBytes: body.memoryMaxBytes === undefined ? null : BigInt(body.memoryMaxBytes),
        cpuLoad: body.cpuLoad ?? null,
      },
    });
    if (server.type === ServerType.PAPER && body.players?.length) await this.tracking.updateGamemodes(body.players);
    this.realtime.publish({ type: 'server.updated', serverId: server.id });
    // Cached release information (never a GitHub request): lets the plugins notify staff about updates.
    const update = await this.updates.pluginInfo(body.pluginVersion).catch(() => null);
    return { serverTime: Date.now(), heartbeatIntervalSeconds: HEARTBEAT_INTERVAL_SECONDS, configRevision: await this.settings.pluginSettingsRevision(), update };
  }

  /** Ordered batch of player events from the proxy (join, server switch, client brand, leave). */
  @Post('events')
  @HttpCode(200)
  @ZodBody(eventBatchSchema)
  events(@Req() req: PluginRequest, @Body() body: { events: PluginEvent[] }) {
    return this.tracking.applyEvents(this.requireProxy(req.pluginServer!).id, body.events);
  }

  /** Full list of players currently connected to the proxy; reconciles state after outages. */
  @Post('sync')
  @HttpCode(200)
  @ZodBody(syncSchema)
  sync(@Req() req: PluginRequest, @Body() body: SyncInput) {
    return this.tracking.sync(this.requireProxy(req.pluginServer!).id, body);
  }

  /** Graceful shutdown: marks the server offline and ends the proxy's open sessions. */
  @Post('shutdown')
  @HttpCode(200)
  async shutdown(@Req() req: PluginRequest) {
    const server = req.pluginServer!;
    await this.prisma.server.update({ where: { id: server.id }, data: { status: ServerStatus.OFFLINE, onlinePlayers: 0 } });
    const closedSessions = server.type === ServerType.VELOCITY ? await this.tracking.closeProxySessions(server.id, new Date()) : 0;
    this.realtime.publish({ type: 'server.updated', serverId: server.id });
    return { closedSessions };
  }

  private requireProxy(server: PluginServer): PluginServer {
    if (server.type !== ServerType.VELOCITY) {
      throw new ForbiddenException({ code: 'PROXY_ONLY', message: 'Only Velocity proxies may report player sessions' });
    }
    return server;
  }
}
