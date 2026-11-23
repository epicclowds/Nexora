import { Injectable } from '@nestjs/common';
import { ORE_BLOCKS, STAT_DEFINITIONS, STAT_PREFIXES, STATS } from '@mnm/shared-types';
import { Prisma } from '../generated/prisma/client';
import { startOfDayInTimezone } from '../common/time';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { dailySeries, rangeTotals, type Snapshot, sumByKey, truncateToHour } from './aggregation';

/** Keys kept in hourly history (ranges and charts). Per-block/entity values are current-only. */
export const HISTORY_KEYS: readonly string[] = STAT_DEFINITIONS.map((d) => d.key);
const HISTORY_SET = new Set(HISTORY_KEYS);
const UPSERT_CHUNK = 500;

export interface IngestPlayer {
  uuid: string;
  stats: Record<string, number>;
}

const toNumber = (v: bigint | undefined) => (v === undefined ? null : Number(v));

@Injectable()
export class StatisticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  /**
   * Stores absolute values reported by a server. Only changed values are
   * written; core statistics also update the hourly history.
   */
  async ingest(scope: string, players: IngestPlayer[], capturedAt: Date): Promise<{ players: number; changed: number }> {
    const known = new Set((await this.prisma.player.findMany({ where: { uuid: { in: players.map((p) => p.uuid) } }, select: { uuid: true } })).map((p) => p.uuid));
    const relevant = players.filter((p) => known.has(p.uuid));
    if (!relevant.length) return { players: 0, changed: 0 };

    const existing = await this.prisma.playerStatistic.findMany({
      where: { scope, playerUuid: { in: relevant.map((p) => p.uuid) } },
      select: { playerUuid: true, statKey: true, value: true },
    });
    const current = new Map(existing.map((r) => [`${r.playerUuid}\u0000${r.statKey}`, r.value]));

    const changed: { uuid: string; key: string; value: bigint }[] = [];
    for (const p of relevant) {
      for (const [key, raw] of Object.entries(p.stats)) {
        const value = BigInt(raw);
        if (current.get(`${p.uuid}\u0000${key}`) !== value) changed.push({ uuid: p.uuid, key, value });
      }
    }

    const hour = truncateToHour(capturedAt);
    for (let i = 0; i < changed.length; i += UPSERT_CHUNK) {
      const chunk = changed.slice(i, i + UPSERT_CHUNK);
      await this.prisma.$executeRaw`
        INSERT INTO player_statistics (player_uuid, scope, stat_key, value, updated_at)
        VALUES ${Prisma.join(chunk.map((c) => Prisma.sql`(${c.uuid}, ${scope}, ${c.key}, ${c.value}, ${capturedAt})`))}
        ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = VALUES(updated_at)`;
      const history = chunk.filter((c) => HISTORY_SET.has(c.key));
      if (history.length) {
        await this.prisma.$executeRaw`
          INSERT INTO player_statistic_snapshots (player_uuid, scope, stat_key, value, captured_at)
          VALUES ${Prisma.join(history.map((c) => Prisma.sql`(${c.uuid}, ${scope}, ${c.key}, ${c.value}, ${hour})`))}
          ON DUPLICATE KEY UPDATE value = VALUES(value)`;
      }
    }

    // Keep the profile's active/AFK time in sync (sum across servers).
    const touched = [...new Set(changed.filter((c) => c.key === STATS.ACTIVE_TIME || c.key === STATS.AFK_TIME).map((c) => c.uuid))];
    for (const uuid of touched) {
      const sums = await this.prisma.playerStatistic.groupBy({
        by: ['statKey'],
        where: { playerUuid: uuid, statKey: { in: [STATS.ACTIVE_TIME, STATS.AFK_TIME] } },
        _sum: { value: true },
      });
      const get = (k: string) => sums.find((s) => s.statKey === k)?._sum.value ?? null;
      await this.prisma.player.update({ where: { uuid }, data: { activePlaytimeSeconds: get(STATS.ACTIVE_TIME), afkSeconds: get(STATS.AFK_TIME) } });
    }
    for (const uuid of new Set(changed.map((c) => c.uuid))) this.realtime.publish({ type: 'player.updated', uuid });
    return { players: relevant.length, changed: changed.length };
  }

  /** Statistics for a player, all-time (current values) or for a range (from hourly history). */
  async forPlayer(uuid: string, range: { from: Date | null; to: Date }) {
    const [rows, firstSnapshot] = await Promise.all([
      this.prisma.playerStatistic.findMany({ where: { playerUuid: uuid }, select: { statKey: true, value: true } }),
      this.prisma.playerStatisticSnapshot.findFirst({ where: { playerUuid: uuid }, orderBy: { capturedAt: 'asc' }, select: { capturedAt: true } }),
    ]);
    const allTime = sumByKey(rows);
    const top = (prefix: string, limit = 10) =>
      [...allTime.entries()]
        .filter(([k]) => k.startsWith(prefix))
        .sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0))
        .slice(0, limit)
        .map(([k, v]) => ({ id: k.slice(prefix.length), value: Number(v) }));
    const ores = ORE_BLOCKS.map((id) => ({ id, value: toNumber(allTime.get(`${STAT_PREFIXES.MINED}${id}`)) ?? 0 }))
      .filter((o) => o.value > 0)
      .sort((a, b) => b.value - a.value);

    let totals: Map<string, bigint> = allTime;
    if (range.from) {
      const snapshots = await this.loadSnapshots(uuid, range.from, range.to);
      totals = rangeTotals(snapshots, truncateToHour(range.from), range.to);
    }
    const coverageStart = firstSnapshot?.capturedAt ?? null;
    return {
      range: { from: range.from?.toISOString() ?? null, to: range.to.toISOString() },
      collected: rows.length > 0,
      coverageStart: coverageStart?.toISOString() ?? null,
      // A range starting before collection began cannot be complete; it is flagged, never extrapolated.
      partial: Boolean(range.from && (!coverageStart || coverageStart > range.from)),
      values: Object.fromEntries(HISTORY_KEYS.filter((k) => rows.some((r) => r.statKey === k)).map((k) => [k, Number(totals.get(k) ?? 0n)])),
      // Per-type breakdowns are all-time only.
      topMined: top(STAT_PREFIXES.MINED),
      topPlaced: top(STAT_PREFIXES.PLACED),
      topKilled: top(STAT_PREFIXES.KILLED),
      ores,
    };
  }

  /** Daily increments for the given keys over the last `days` local days. */
  async series(uuid: string, keys: string[], days: number, timezone: string) {
    const now = new Date();
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
    const dayKeys = [...new Set(Array.from({ length: days }, (_, i) => fmt.format(new Date(now.getTime() - (days - 1 - i) * 86_400_000))))];
    const from = startOfDayInTimezone(timezone, new Date(now.getTime() - (days - 1) * 86_400_000));
    const snapshots = await this.loadSnapshots(uuid, from, now, keys);
    return { timezone, days: dayKeys, series: dailySeries(snapshots, keys, dayKeys, timezone) };
  }

  /** Network leaderboard for one statistic (sum over servers). */
  async leaderboard(statKey: string, limit: number) {
    const groups = await this.prisma.playerStatistic.groupBy({
      by: ['playerUuid'],
      where: { statKey },
      _sum: { value: true },
      orderBy: { _sum: { value: 'desc' } },
      take: limit,
    });
    const players = await this.prisma.player.findMany({ where: { uuid: { in: groups.map((g) => g.playerUuid) } }, select: { uuid: true, username: true, online: true } });
    return groups.map((g, i) => ({ rank: i + 1, player: players.find((p) => p.uuid === g.playerUuid)!, value: Number(g._sum.value ?? 0n) }));
  }

  async networkOverview() {
    const [totals, trackedPlayers, first] = await Promise.all([
      this.prisma.playerStatistic.groupBy({ by: ['statKey'], where: { statKey: { in: [...HISTORY_KEYS] } }, _sum: { value: true } }),
      this.prisma.playerStatistic.findMany({ distinct: ['playerUuid'], select: { playerUuid: true } }).then((r) => r.length),
      this.prisma.playerStatisticSnapshot.findFirst({ orderBy: { capturedAt: 'asc' }, select: { capturedAt: true } }),
    ]);
    return {
      trackedPlayers,
      coverageStart: first?.capturedAt.toISOString() ?? null,
      totals: Object.fromEntries(totals.map((t) => [t.statKey, Number(t._sum.value ?? 0n)])),
    };
  }

  /** In-range snapshots plus, per scope+key, the last snapshot before `from` as baseline. */
  private async loadSnapshots(uuid: string, from: Date, to: Date, keys: readonly string[] = HISTORY_KEYS): Promise<Snapshot[]> {
    const [inRange, baselines] = await Promise.all([
      this.prisma.playerStatisticSnapshot.findMany({
        where: { playerUuid: uuid, statKey: { in: [...keys] }, capturedAt: { gte: truncateToHour(from), lte: to } },
        select: { scope: true, statKey: true, value: true, capturedAt: true },
      }),
      this.prisma.$queryRaw<Snapshot[]>`
        SELECT s.scope AS scope, s.stat_key AS statKey, s.value AS value, s.captured_at AS capturedAt
        FROM player_statistic_snapshots s
        JOIN (
          SELECT scope, stat_key, MAX(captured_at) AS captured_at
          FROM player_statistic_snapshots
          WHERE player_uuid = ${uuid} AND captured_at < ${truncateToHour(from)} AND stat_key IN (${Prisma.join([...keys])})
          GROUP BY scope, stat_key
        ) b ON b.scope = s.scope AND b.stat_key = s.stat_key AND b.captured_at = s.captured_at
        WHERE s.player_uuid = ${uuid}`,
    ]);
    return [...baselines.map((b) => ({ ...b, value: BigInt(b.value), capturedAt: new Date(b.capturedAt) })), ...inRange];
  }
}
