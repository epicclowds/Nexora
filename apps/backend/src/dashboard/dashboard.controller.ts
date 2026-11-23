import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { hasPermission, PERMISSIONS } from '@mnm/shared-types';
import { type AuthenticatedUser, CurrentUser } from '../common/auth-context';
import { startOfDayInTimezone } from '../common/time';
import { AuditService } from '../audit/audit.service';
import { PunishmentSource, PunishmentStatus, PunishmentType } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { serializeServer } from '../servers/servers.service';
import { SETTING_KEYS, SettingsService } from '../settings/settings.service';

/** Aggregated home-page figures. Every value comes from recorded data; nothing is estimated. */
@ApiTags('dashboard')
@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  @Get('summary')
  async summary(@CurrentUser() user: AuthenticatedUser) {
    const network = await this.settings.getNetwork();
    const timezone = user.timezone ?? network.defaultTimezone;
    const dayStart = startOfDayInTimezone(timezone);
    const now = new Date();
    const notExpired = { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] };

    const [onlinePlayers, totalPlayers, newPlayersToday, connectionsToday, activeBans, activeMutes, anticheatToday, servers, record] = await Promise.all([
      this.prisma.player.count({ where: { online: true } }),
      this.prisma.player.count(),
      this.prisma.player.count({ where: { firstSeenAt: { gte: dayStart } } }),
      this.prisma.playerConnection.count({ where: { connectedAt: { gte: dayStart } } }),
      this.prisma.punishment.count({ where: { status: PunishmentStatus.ACTIVE, type: { in: [PunishmentType.BAN, PunishmentType.TEMP_BAN, PunishmentType.BLACKLIST] }, ...notExpired } }),
      this.prisma.punishment.count({ where: { status: PunishmentStatus.ACTIVE, type: { in: [PunishmentType.MUTE, PunishmentType.TEMP_MUTE] }, ...notExpired } }),
      this.prisma.punishment.count({ where: { source: PunishmentSource.ANTICHEAT, createdAt: { gte: dayStart } } }),
      hasPermission(user.permissions, PERMISSIONS.SERVERS_VIEW) ? this.prisma.server.findMany({ orderBy: [{ type: 'asc' }, { name: 'asc' }] }) : Promise.resolve(null),
      this.settings.get<{ count: number; at: string }>(SETTING_KEYS.PLAYER_RECORD),
    ]);

    const recentActivity = hasPermission(user.permissions, PERMISSIONS.AUDIT_VIEW) ? (await this.audit.list({ page: 1, pageSize: 8 })).items : null;

    return {
      generatedAt: now.toISOString(),
      dayStart: dayStart.toISOString(),
      timezone,
      onlinePlayers,
      totalPlayers,
      newPlayersToday,
      connectionsToday,
      playerRecord: record,
      activeBans,
      activeMutes,
      anticheatToday,
      servers: servers?.map(serializeServer) ?? null,
      recentActivity,
    };
  }
}
