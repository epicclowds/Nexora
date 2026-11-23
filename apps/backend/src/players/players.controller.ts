import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { hasPermission, PERMISSIONS } from '@mnm/shared-types';
import { z } from 'zod';
import { type AuthenticatedUser, CurrentUser, RequirePermissions } from '../common/auth-context';
import { paginationSchema, ZodQuery } from '../common/zod';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const listQuery = paginationSchema.extend({
  search: z.string().trim().max(36).optional(),
  online: z.enum(['true', 'false']).optional(),
  sort: z.enum(['lastSeen', 'firstSeen', 'username', 'playtime']).default('lastSeen'),
});

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
  constructor(private readonly prisma: PrismaService) {}

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
