import { Controller, Get, NotFoundException, Param, Query, Res } from '@nestjs/common';
import { LuckPermsService } from '../luckperms/luckperms.service';
import { ApiTags } from '@nestjs/swagger';
import { hasPermission, PERMISSIONS } from '@mnm/shared-types';
import { z } from 'zod';
import { type AuthenticatedUser, CurrentUser, RequirePermissions } from '../common/auth-context';
import { paginationSchema, ZodQuery } from '../common/zod';
import type { Prisma } from '../generated/prisma/client';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { buildActivity } from './activity';
import { GeoIpService } from './geoip.service';
import { sendSkin } from './account-skin.controller';
import { SkinService } from './skin.service';

const listQuery = paginationSchema.extend({
  search: z.string().trim().max(36).optional(),
  online: z.enum(['true', 'false']).optional(),
  sort: z.enum(['lastSeen', 'firstSeen', 'username', 'playtime']).default('lastSeen'),
});

const activityQuery = z.object({ days: z.coerce.number().int().min(7).max(365).default(30) });

const UUID_LOOSE = /^[0-9a-f]{32}$|^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Normalises dashed or undashed UUIDs to the dashed lowercase form used as primary key. */
export function normalizeUuid(value: string): string | null {
  if (!UUID_LOOSE.test(value)) return null;
  const hex = value.replace(/-/g, '').toLowerCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const listSelect = {
  uuid: true,
  username: true,
  online: true,
  firstSeenAt: true,
  lastSeenAt: true,
  totalPlaytimeSeconds: true,
  connectionCount: true,
  currentServer: { select: { id: true, name: true } },
} as const;

type ListRow = Prisma.PlayerGetPayload<{ select: typeof listSelect }>;

/** Adds the running session to the stored playtime so online players show live totals. */
function serializeListRow(p: ListRow, openSessionStart?: Date) {
  const running = p.online && openSessionStart ? Math.max(0, Math.floor((Date.now() - openSessionStart.getTime()) / 1000)) : 0;
  return {
    uuid: p.uuid,
    username: p.username,
    online: p.online,
    currentServer: p.currentServer,
    firstSeenAt: p.firstSeenAt.toISOString(),
    lastSeenAt: p.lastSeenAt.toISOString(),
    totalPlaytimeSeconds: Number(p.totalPlaytimeSeconds) + running,
    connectionCount: p.connectionCount,
  };
}

@ApiTags('players')
@Controller('players')
export class PlayersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly skins: SkinService,
    private readonly settings: SettingsService,
    private readonly geoip: GeoIpService,
    private readonly luckperms: LuckPermsService,
  ) {}

  /** Search by current name, previous names or UUID (dashed or undashed). */
  @Get()
  @RequirePermissions(PERMISSIONS.PLAYERS_VIEW)
  @ZodQuery(listQuery)
  async list(@Query() q: z.infer<typeof listQuery>) {
    const where: Prisma.PlayerWhereInput = {};
    if (q.online) where.online = q.online === 'true';
    if (q.search) {
      const uuid = normalizeUuid(q.search);
      where.OR = uuid
        ? [{ uuid }]
        : [{ username: { startsWith: q.search } }, { names: { some: { username: { startsWith: q.search } } } }];
    }
    const orderBy: Prisma.PlayerOrderByWithRelationInput =
      q.sort === 'username' ? { username: 'asc' } : q.sort === 'firstSeen' ? { firstSeenAt: 'desc' } : q.sort === 'playtime' ? { totalPlaytimeSeconds: 'desc' } : { lastSeenAt: 'desc' };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.player.count({ where }),
      this.prisma.player.findMany({ where, select: listSelect, orderBy, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    ]);
    const starts = await this.openSessionStarts(rows.filter((r) => r.online).map((r) => r.uuid));
    return { total, page: q.page, pageSize: q.pageSize, items: rows.map((r) => serializeListRow(r, starts.get(r.uuid))) };
  }

  @Get(':uuid')
  @RequirePermissions(PERMISSIONS.PLAYERS_VIEW)
  async profile(@Param('uuid') raw: string, @CurrentUser() user: AuthenticatedUser) {
    const uuid = normalizeUuid(raw);
    if (!uuid) throw new NotFoundException();
    const player = await this.prisma.player.findUnique({
      where: { uuid },
      include: {
        currentServer: { select: { id: true, name: true } },
        names: { orderBy: { firstSeenAt: 'desc' } },
      },
    });
    if (!player) throw new NotFoundException();

    const canSeeIp = hasPermission(user.permissions, PERMISSIONS.PLAYERS_VIEW_IP);
    const sessions = await this.prisma.playerSession.findMany({
      where: { playerUuid: uuid },
      orderBy: { startedAt: 'desc' },
      take: 20,
      include: {
        proxyServer: { select: { id: true, name: true } },
        serverVisits: { orderBy: { joinedAt: 'asc' }, include: { server: { select: { id: true, name: true } } } },
        connection: true,
      },
    });
    const open = sessions.find((s) => !s.endedAt);

    return {
      ...serializeListRow(player, open?.startedAt),
      gamemode: player.gamemode,
      clientVersion: player.clientVersion,
      clientProtocol: player.clientProtocol,
      clientBrand: player.clientBrand,
      rank: player.rank,
      /** LuckPerms rank from the proxy (null when not synchronised – never guessed). */
      minecraftRank: await this.luckperms.rankFor(uuid),
      skinModel: player.skinModel,
      // Not collected yet (requires AFK tracking on Paper, Phase 5): null means "not recorded".
      activePlaytimeSeconds: player.activePlaytimeSeconds === null ? null : Number(player.activePlaytimeSeconds),
      afkSeconds: player.afkSeconds === null ? null : Number(player.afkSeconds),
      names: player.names.map((n) => ({ username: n.username, firstSeenAt: n.firstSeenAt.toISOString(), lastSeenAt: n.lastSeenAt.toISOString() })),
      canViewConnectionData: canSeeIp,
      sessions: sessions.map((s) => ({
        id: s.id.toString(),
        proxy: s.proxyServer,
        startedAt: s.startedAt.toISOString(),
        endedAt: s.endedAt?.toISOString() ?? null,
        durationSeconds: s.durationSeconds,
        servers: s.serverVisits.map((v) => ({ server: v.server, joinedAt: v.joinedAt.toISOString(), leftAt: v.leftAt?.toISOString() ?? null })),
        connection: s.connection
          ? {
              clientProtocol: s.connection.clientProtocol,
              clientBrand: s.connection.clientBrand,
              // Personal data: only with players.view.ip.
              ...(canSeeIp ? { ipAddress: s.connection.ipAddress, virtualHost: s.connection.virtualHost } : {}),
            }
          : null,
      })),
    };
  }

  /** Skin texture (64×64 PNG), resolved and cached server-side. 404 when unknown. */
  @Get(':uuid/skin')
  @RequirePermissions(PERMISSIONS.PLAYERS_VIEW)
  async skin(@Param('uuid') raw: string, @Res() res: Response) {
    const uuid = normalizeUuid(raw);
    const skin = uuid ? await this.skins.getSkin(uuid) : null;
    sendSkin(res, skin);
  }

  /** Daily playtime and weekday/hour heatmap from recorded sessions, in the viewer's time zone. */
  @Get(':uuid/activity')
  @RequirePermissions(PERMISSIONS.PLAYERS_VIEW)
  @ZodQuery(activityQuery)
  async activity(@Param('uuid') raw: string, @Query() q: z.infer<typeof activityQuery>, @CurrentUser() user: AuthenticatedUser) {
    const uuid = normalizeUuid(raw);
    if (!uuid || !(await this.prisma.player.findUnique({ where: { uuid }, select: { uuid: true } }))) throw new NotFoundException();
    const timezone = user.timezone ?? (await this.settings.getNetwork()).defaultTimezone;
    const from = new Date(Date.now() - q.days * 86_400_000);
    const sessions = await this.prisma.playerSession.findMany({
      where: { playerUuid: uuid, startedAt: { lt: new Date() }, OR: [{ endedAt: null }, { endedAt: { gt: from } }] },
      select: { startedAt: true, endedAt: true },
      take: 10_000,
    });
    return buildActivity(sessions, { timezone, days: q.days });
  }

  /**
   * Connection history. IP addresses require players.view.ip, approximate
   * location requires players.view.location; other fields players.view.
   */
  @Get(':uuid/connections')
  @RequirePermissions(PERMISSIONS.PLAYERS_VIEW)
  @ZodQuery(paginationSchema)
  async connections(@Param('uuid') raw: string, @Query() q: z.infer<typeof paginationSchema>, @CurrentUser() user: AuthenticatedUser) {
    const uuid = normalizeUuid(raw);
    if (!uuid || !(await this.prisma.player.findUnique({ where: { uuid }, select: { uuid: true } }))) throw new NotFoundException();
    const canIp = hasPermission(user.permissions, PERMISSIONS.PLAYERS_VIEW_IP);
    const canLocation = hasPermission(user.permissions, PERMISSIONS.PLAYERS_VIEW_LOCATION);

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.playerConnection.count({ where: { playerUuid: uuid } }),
      this.prisma.playerConnection.findMany({
        where: { playerUuid: uuid },
        orderBy: { connectedAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { session: { select: { endedAt: true, durationSeconds: true, proxyServer: { select: { name: true } } } } },
      }),
    ]);
    const location = (c: { countryCode: string | null; region: string | null; city: string | null; isp: string | null; asn: number | null }) =>
      canLocation ? { countryCode: c.countryCode, region: c.region, city: c.city, isp: c.isp, asn: c.asn } : undefined;

    const items = rows.map((c) => ({
      id: c.id.toString(),
      connectedAt: c.connectedAt.toISOString(),
      endedAt: c.session?.endedAt?.toISOString() ?? null,
      durationSeconds: c.session?.durationSeconds ?? null,
      proxy: c.session?.proxyServer?.name ?? null,
      clientProtocol: c.clientProtocol,
      clientBrand: c.clientBrand,
      ...(canIp ? { ipAddress: c.ipAddress, virtualHost: c.virtualHost } : {}),
      ...(canLocation ? { location: location(c) } : {}),
    }));

    let ipSummary: unknown = undefined;
    let relatedAccounts: unknown = undefined;
    if (canIp) {
      const groups = await this.prisma.playerConnection.groupBy({
        by: ['ipAddress'],
        where: { playerUuid: uuid, ipAddress: { not: null } },
        _count: { _all: true },
        _min: { connectedAt: true },
        _max: { connectedAt: true },
        orderBy: { _max: { connectedAt: 'desc' } },
        take: 50,
      });
      const ips = groups.map((g) => g.ipAddress!).filter(Boolean);
      const latest = canLocation
        ? await this.prisma.playerConnection.findMany({ where: { playerUuid: uuid, ipAddress: { in: ips } }, orderBy: { connectedAt: 'desc' }, distinct: ['ipAddress'] })
        : [];
      ipSummary = groups.map((g) => {
        const loc = latest.find((l) => l.ipAddress === g.ipAddress);
        return {
          ipAddress: g.ipAddress,
          connections: g._count._all,
          firstSeenAt: g._min.connectedAt?.toISOString() ?? null,
          lastSeenAt: g._max.connectedAt?.toISOString() ?? null,
          ...(canLocation && loc ? { location: location(loc) } : {}),
        };
      });
      // Other accounts that connected from the same addresses (possible alternate accounts).
      const shared = ips.length
        ? await this.prisma.playerConnection.groupBy({
            by: ['playerUuid'],
            where: { ipAddress: { in: ips }, playerUuid: { not: uuid } },
            _count: { _all: true },
            _max: { connectedAt: true },
            orderBy: { _max: { connectedAt: 'desc' } },
            take: 25,
          })
        : [];
      const players = await this.prisma.player.findMany({ where: { uuid: { in: shared.map((s) => s.playerUuid) } }, select: { uuid: true, username: true, online: true } });
      relatedAccounts = shared.map((s) => ({
        ...players.find((p) => p.uuid === s.playerUuid),
        connections: s._count._all,
        lastSeenAt: s._max.connectedAt?.toISOString() ?? null,
      }));
    }

    return { total, page: q.page, pageSize: q.pageSize, items, canViewIp: canIp, canViewLocation: canLocation, geoipEnabled: this.geoip.enabled, ipSummary, relatedAccounts };
  }

  private async openSessionStarts(uuids: string[]): Promise<Map<string, Date>> {
    if (!uuids.length) return new Map();
    const open = await this.prisma.playerSession.findMany({
      where: { playerUuid: { in: uuids }, endedAt: null },
      select: { playerUuid: true, startedAt: true },
      orderBy: { startedAt: 'asc' },
    });
    const map = new Map<string, Date>();
    for (const s of open) if (!map.has(s.playerUuid)) map.set(s.playerUuid, s.startedAt);
    return map;
  }
}
