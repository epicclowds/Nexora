import { BadRequestException, Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../common/auth-context';
import { ActorType } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { decodeIcon, iconUrl, MAX_ICON_BYTES, type RankDisplayConfig, type RankDisplayInput, resolveRank, type ResolvedRank, sniffIconType } from './rank-display';

const CONFIG_SELECT = {
  id: true,
  groupName: true,
  enabled: true,
  displaySource: true,
  displayName: true,
  textColor: true,
  backgroundColor: true,
  bold: true,
  iconText: true,
  iconMimeType: true,
  fallbackText: true,
  tooltip: true,
  updatedAt: true,
} as const;

/**
 * Rank displays (Settings → Integrations → LuckPerms → Rank display) and the
 * rank shown for players across the dashboard. Appearance only.
 */
@Injectable()
export class RankDisplayService {
  private cache: { value: Map<string, RankDisplayConfig>; at: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
  ) {}

  /** group → configuration (cached briefly; invalidated on every change). */
  async configs(): Promise<Map<string, RankDisplayConfig>> {
    if (this.cache && Date.now() - this.cache.at < 30_000) return this.cache.value;
    const rows = await this.prisma.rankDisplay.findMany({ select: CONFIG_SELECT });
    const value = new Map(rows.map((r) => [r.groupName, { ...r, hasIcon: !!r.iconMimeType }]));
    this.cache = { value, at: Date.now() };
    return value;
  }

  async list() {
    return [...(await this.configs()).values()].sort((a, b) => a.groupName.localeCompare(b.groupName)).map(serialize);
  }

  /** Rank of one player (null when no LuckPerms snapshot exists – never invented). */
  async rankFor(uuid: string): Promise<ResolvedRank | null> {
    const snapshot = await this.prisma.permissionSyncState.findUnique({ where: { minecraftUuid: uuid.toLowerCase() } });
    return resolveRank(snapshot, await this.configs());
  }

  /** Ranks of many players at once (lists): uuid → rank. */
  async ranksFor(uuids: string[]): Promise<Map<string, ResolvedRank>> {
    const unique = [...new Set(uuids.map((u) => u.toLowerCase()))];
    if (!unique.length) return new Map();
    const [snapshots, configs] = await Promise.all([this.prisma.permissionSyncState.findMany({ where: { minecraftUuid: { in: unique } } }), this.configs()]);
    const out = new Map<string, ResolvedRank>();
    for (const s of snapshots) {
      const rank = resolveRank(s, configs);
      if (rank) out.set(s.minecraftUuid, rank);
    }
    return out;
  }

  /** Latest LuckPerms prefix and display name per primary group (for the live preview). */
  async samples(groups: string[]): Promise<Record<string, { prefix: string | null; groupDisplay: string | null }>> {
    if (!groups.length) return {};
    const rows = await this.prisma.permissionSyncState.findMany({
      where: { primaryGroup: { in: groups.slice(0, 200) } },
      select: { primaryGroup: true, prefix: true, groupDisplay: true },
      orderBy: { synchronizedAt: 'desc' },
      distinct: ['primaryGroup'],
    });
    return Object.fromEntries(rows.filter((r) => r.primaryGroup).map((r) => [r.primaryGroup!.toLowerCase(), { prefix: r.prefix, groupDisplay: r.groupDisplay }]));
  }

  async save(groupName: string, input: RankDisplayInput, actor: AuthenticatedUser, ipAddress: string | null) {
    const saved = await this.prisma.$transaction(async (tx) => {
      const row = await tx.rankDisplay.upsert({ where: { groupName }, create: { groupName, ...input }, update: input, select: CONFIG_SELECT });
      await this.audit.record({ actor: userActor(actor), action: 'integrations.rank_display_saved', targetType: 'rank_display', targetId: row.id, metadata: { groupName, ...input }, ipAddress }, tx);
      return row;
    });
    this.changed();
    return serialize({ ...saved, hasIcon: !!saved.iconMimeType });
  }

  async remove(groupName: string, actor: AuthenticatedUser, ipAddress: string | null) {
    await this.prisma.$transaction(async (tx) => {
      const removed = await tx.rankDisplay.delete({ where: { groupName } }).catch(() => null);
      if (!removed) throw new NotFoundException({ code: 'RANK_DISPLAY_NOT_FOUND', message: 'No rank display for this group' });
      await this.audit.record({ actor: userActor(actor), action: 'integrations.rank_display_deleted', targetType: 'rank_display', targetId: removed.id, metadata: { groupName }, ipAddress }, tx);
    });
    this.changed();
  }

  /** Stores an uploaded icon after checking its size and real content type (PNG, GIF, WebP, JPEG). */
  async setIcon(groupName: string, data: string, actor: AuthenticatedUser, ipAddress: string | null) {
    let bytes: Buffer;
    try {
      bytes = decodeIcon(data);
    } catch {
      throw new BadRequestException({ code: 'INVALID_ICON', message: 'The icon could not be decoded' });
    }
    if (bytes.length > MAX_ICON_BYTES) throw new PayloadTooLargeException({ code: 'ICON_TOO_LARGE', message: `Icons may be at most ${MAX_ICON_BYTES / 1024} KB` });
    const type = sniffIconType(bytes);
    if (!type) throw new BadRequestException({ code: 'INVALID_ICON', message: 'Icons must be PNG, WebP, GIF or JPEG images' });
    const existing = await this.prisma.rankDisplay.findUnique({ where: { groupName }, select: { id: true } });
    if (!existing) throw new NotFoundException({ code: 'RANK_DISPLAY_NOT_FOUND', message: 'Save the rank display before adding an icon' });
    const saved = await this.prisma.$transaction(async (tx) => {
      const row = await tx.rankDisplay.update({ where: { groupName }, data: { iconImage: new Uint8Array(bytes), iconMimeType: type }, select: CONFIG_SELECT });
      await this.audit.record({ actor: userActor(actor), action: 'integrations.rank_icon_uploaded', targetType: 'rank_display', targetId: row.id, metadata: { groupName, type, bytes: bytes.length }, ipAddress }, tx);
      return row;
    });
    this.changed();
    return serialize({ ...saved, hasIcon: true });
  }

  async removeIcon(groupName: string, actor: AuthenticatedUser, ipAddress: string | null) {
    const saved = await this.prisma.$transaction(async (tx) => {
      const row = await tx.rankDisplay.update({ where: { groupName }, data: { iconImage: null, iconMimeType: null }, select: CONFIG_SELECT }).catch(() => null);
      if (!row) throw new NotFoundException({ code: 'RANK_DISPLAY_NOT_FOUND', message: 'No rank display for this group' });
      await this.audit.record({ actor: userActor(actor), action: 'integrations.rank_icon_removed', targetType: 'rank_display', targetId: row.id, metadata: { groupName }, ipAddress }, tx);
      return row;
    });
    this.changed();
    return serialize({ ...saved, hasIcon: false });
  }

  async icon(id: string): Promise<{ data: Buffer; type: string } | null> {
    const row = await this.prisma.rankDisplay.findUnique({ where: { id }, select: { iconImage: true, iconMimeType: true } });
    if (!row?.iconImage || !row.iconMimeType) return null;
    return { data: Buffer.from(row.iconImage), type: row.iconMimeType };
  }

  /** Rank appearance changed: drop the cache and let open dashboards refresh. */
  private changed() {
    this.cache = null;
    this.realtime.publish({ type: 'ranks.updated' });
  }
}

function userActor(actor: AuthenticatedUser) {
  return { type: ActorType.USER, userId: actor.id, name: actor.username };
}

function serialize(c: RankDisplayConfig) {
  return {
    id: c.id,
    groupName: c.groupName,
    enabled: c.enabled,
    displaySource: c.displaySource,
    displayName: c.displayName,
    textColor: c.textColor,
    backgroundColor: c.backgroundColor,
    bold: c.bold,
    iconText: c.iconText,
    iconUrl: iconUrl(c),
    fallbackText: c.fallbackText,
    tooltip: c.tooltip,
    updatedAt: c.updatedAt.toISOString(),
  };
}
