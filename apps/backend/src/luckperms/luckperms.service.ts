import { ConflictException, Injectable, Logger, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { PERMISSIONS } from '@mnm/shared-types';
import type { z } from 'zod';
import { type AuditActor, AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import type { AuthenticatedUser } from '../common/auth-context';
import { AccountManager, ActorType, type Prisma } from '../generated/prisma/client';
import { PresetsService } from '../presets/presets.service';
import { type PermissionCheck, StaffPermissionsService } from '../presets/staff-permissions.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { RealtimeService } from '../realtime/realtime.service';
import { SettingsService } from '../settings/settings.service';
import { RankDisplayService } from './rank-display.service';
import { freshness, type LuckPermsSettings, luckPermsSettingsSchema, type mappingSchema, resolveRole, type Snapshot } from './luckperms';

const SETTINGS_KEY = 'integrations.luckperms';
const STATUS_KEY = 'integrations.luckperms.status';
const RESYNC_KEY = 'nexora:luckperms:resync';
/** In-game permission that allows creating a dashboard account through account linking. */
export const REGISTER_PERMISSION = 'nexora.dashboard.register';
const SYSTEM_ACTOR: AuditActor = { type: ActorType.SYSTEM, name: 'LuckPerms sync' };

export interface IntegrationStatus {
  lastSyncAt: string | null;
  lastFullSyncAt: string | null;
  luckPermsVersion: string | null;
  serverId: string | null;
  serverName: string | null;
}

/**
 * LuckPerms integration: stores the snapshots the Velocity proxy sends,
 * decides canonical moderation permissions for linked staff, and keeps
 * LuckPerms-managed dashboard accounts in line with their groups (role
 * changes, deactivation with session revocation, reactivation). The Owner
 * role is never touched.
 */
@Injectable()
export class LuckPermsService implements OnModuleInit {
  private readonly logger = new Logger(LuckPermsService.name);
  private settingsCache: { value: LuckPermsSettings; at: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
    private readonly redis: RedisService,
    private readonly presets: PresetsService,
    private readonly staff: StaffPermissionsService,
    private readonly ranks: RankDisplayService,
    private readonly realtime: RealtimeService,
  ) {}

  onModuleInit(): void {
    this.staff.useResolver({ checkFor: (user) => this.checkFor(user) });
  }

  // ── settings ──────────────────────────────────────────────────────

  async getSettings(): Promise<LuckPermsSettings> {
    if (this.settingsCache && Date.now() - this.settingsCache.at < 10_000) return this.settingsCache.value;
    const parsed = luckPermsSettingsSchema.safeParse((await this.settings.get<unknown>(SETTINGS_KEY)) ?? {});
    const value = parsed.success ? parsed.data : luckPermsSettingsSchema.parse({});
    this.settingsCache = { value, at: Date.now() };
    return value;
  }

  async saveSettings(next: LuckPermsSettings, actor: AuthenticatedUser, ipAddress: string | null): Promise<LuckPermsSettings> {
    const before = await this.getSettings();
    const value = luckPermsSettingsSchema.parse(next);
    await this.prisma.$transaction(async (tx) => {
      await this.settings.set(SETTINGS_KEY, value, actor.id, tx);
      await this.audit.record({ actor: { type: ActorType.USER, userId: actor.id, name: actor.username }, action: 'integrations.luckperms_updated', targetType: 'setting', targetId: SETTINGS_KEY, metadata: { before, after: value }, ipAddress }, tx);
    });
    this.settingsCache = { value, at: Date.now() };
    if (value.mode === 'MANAGED') await this.reconcileAll('settings changed');
    return value;
  }

  async status(): Promise<IntegrationStatus> {
    const stored = await this.settings.get<IntegrationStatus>(STATUS_KEY);
    return { lastSyncAt: null, lastFullSyncAt: null, luckPermsVersion: null, serverId: null, serverName: null, ...(stored ?? {}) };
  }

  // ── mappings ──────────────────────────────────────────────────────

  listMappings() {
    return this.prisma.luckPermsGroupMapping.findMany({ include: { role: { select: { id: true, key: true, name: true, priority: true } } }, orderBy: [{ priority: 'desc' }, { groupName: 'asc' }] });
  }

  async upsertMapping(id: string | null, input: z.infer<typeof mappingSchema>, actor: AuthenticatedUser, ipAddress: string | null) {
    if (input.roleId) {
      const role = await this.prisma.dashboardRole.findUnique({ where: { id: input.roleId } });
      if (!role) throw new NotFoundException({ code: 'ROLE_NOT_FOUND', message: 'Role not found' });
      if (role.key === 'owner') throw new ConflictException({ code: 'OWNER_NOT_MAPPABLE', message: 'The protected Owner role cannot be granted through LuckPerms' });
    }
    try {
      const mapping = await this.prisma.$transaction(async (tx) => {
        const data = { groupName: input.groupName, roleId: input.deny ? null : input.roleId, dashboardAccess: input.deny ? false : input.dashboardAccess, deny: input.deny, priority: input.priority };
        const saved = id ? await tx.luckPermsGroupMapping.update({ where: { id }, data }) : await tx.luckPermsGroupMapping.create({ data });
        await this.audit.record({ actor: { type: ActorType.USER, userId: actor.id, name: actor.username }, action: id ? 'integrations.mapping_updated' : 'integrations.mapping_created', targetType: 'luckperms_mapping', targetId: saved.id, metadata: data, ipAddress }, tx);
        return saved;
      });
      await this.reconcileAll('group mapping changed');
      return mapping;
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') throw new ConflictException({ code: 'DUPLICATE_MAPPING', message: 'This group is already mapped' });
      throw err;
    }
  }

  async deleteMapping(id: string, actor: AuthenticatedUser, ipAddress: string | null) {
    await this.prisma.$transaction(async (tx) => {
      const removed = await tx.luckPermsGroupMapping.delete({ where: { id } });
      await this.audit.record({ actor: { type: ActorType.USER, userId: actor.id, name: actor.username }, action: 'integrations.mapping_deleted', targetType: 'luckperms_mapping', targetId: id, metadata: { groupName: removed.groupName }, ipAddress }, tx);
    });
    await this.reconcileAll('group mapping removed');
  }

  /** Group names seen in synchronised snapshots (for the mapping editor). */
  async knownGroups(): Promise<string[]> {
    const rows = await this.prisma.permissionSyncState.findMany({ select: { groups: true }, take: 5000, orderBy: { synchronizedAt: 'desc' } });
    const set = new Set<string>();
    for (const r of rows) for (const g of (r.groups as string[]) ?? []) set.add(g);
    return [...set].sort();
  }

  // ── synchronisation ───────────────────────────────────────────────

  /** Permissions the proxy evaluates for every snapshot (presets + static canonical keys). */
  async trackedPermissions(): Promise<string[]> {
    const presets = await this.presets.list();
    return [
      ...new Set([
        PERMISSIONS.NEXORA_PUNISHMENT_CUSTOM,
        PERMISSIONS.NEXORA_PUNISHMENT_DURATION_OVERRIDE,
        PERMISSIONS.NEXORA_PUNISHMENT_PERMANENT,
        REGISTER_PERMISSION,
        ...presets.map((p) => p.permission),
      ]),
    ].sort();
  }

  async linkedUuids(): Promise<string[]> {
    return (await this.prisma.linkedMinecraftAccount.findMany({ select: { minecraftUuid: true } })).map((l) => l.minecraftUuid);
  }

  /** Stores snapshots from the proxy and reconciles the affected linked accounts. */
  async ingest(server: { id: string; name: string }, input: { luckPermsVersion?: string | null; snapshots: Snapshot[]; full: boolean }) {
    const now = new Date();
    for (const s of input.snapshots) {
      const uuid = s.uuid.toLowerCase();
      const data = {
        username: s.username ?? null,
        primaryGroup: s.primaryGroup ?? null,
        groupDisplay: s.groupDisplay ?? null,
        groups: s.groups as Prisma.InputJsonValue,
        prefix: s.prefix ?? null,
        suffix: s.suffix ?? null,
        weight: s.weight ?? null,
        permissions: s.permissions as Prisma.InputJsonValue,
        source: 'LUCKPERMS',
        expiresAt: s.expiresAt ? new Date(s.expiresAt) : null,
        synchronizedAt: now,
        serverId: server.id,
      };
      const before = await this.prisma.permissionSyncState.findUnique({ where: { minecraftUuid: uuid }, select: { primaryGroup: true, groupDisplay: true, prefix: true } });
      await this.prisma.permissionSyncState.upsert({ where: { minecraftUuid: uuid }, create: { minecraftUuid: uuid, ...data }, update: { ...data, revision: { increment: 1 } } });
      // Rank changes reach open profiles and lists through the existing realtime stream.
      if (!before || before.primaryGroup !== data.primaryGroup || before.groupDisplay !== data.groupDisplay || before.prefix !== data.prefix) this.realtime.publish({ type: 'player.updated', uuid });
    }
    const previous = await this.status();
    await this.settings.set(
      STATUS_KEY,
      { lastSyncAt: now.toISOString(), lastFullSyncAt: input.full ? now.toISOString() : previous.lastFullSyncAt, luckPermsVersion: input.luckPermsVersion ?? previous.luckPermsVersion, serverId: server.id, serverName: server.name },
      null,
    );
    const linked = await this.prisma.linkedMinecraftAccount.findMany({ where: { minecraftUuid: { in: input.snapshots.map((s) => s.uuid.toLowerCase()) } }, select: { dashboardUserId: true } });
    for (const l of linked) await this.reconcileUser(l.dashboardUserId, 'LuckPerms groups synchronised');
    return { trackedPermissions: await this.trackedPermissions(), linkedUuids: await this.linkedUuids() };
  }

  /** Asks the proxy to resynchronise a player soon (heartbeat response). */
  async requestResync(uuid: string): Promise<void> {
    await this.redis.client.sadd(RESYNC_KEY, uuid.toLowerCase()).catch(() => undefined);
  }

  async takeResync(): Promise<string[]> {
    const members = await this.redis.client.spop(RESYNC_KEY, 100).catch(() => [] as string[]);
    return Array.isArray(members) ? members : members ? [members] : [];
  }

  // ── managed staff accounts ────────────────────────────────────────

  async reconcileAll(reason: string): Promise<void> {
    if ((await this.getSettings()).mode !== 'MANAGED') return;
    const managed = await this.prisma.dashboardUser.findMany({ where: { managedBy: AccountManager.LUCKPERMS, minecraftLink: { isNot: null } }, select: { id: true } });
    for (const u of managed) await this.reconcileUser(u.id, reason);
  }

  /**
   * Applies the group mapping to one LuckPerms-managed account. Only in MANAGED
   * mode; never for the Owner role; never on missing or stale data (an outage
   * must not lock staff out – sensitive actions are blocked by checkFor instead).
   */
  async reconcileUser(userId: string, reason: string): Promise<'unchanged' | 'role-changed' | 'disabled' | 'reactivated' | 'skipped'> {
    const user = await this.prisma.dashboardUser.findUnique({ where: { id: userId }, include: { role: true, minecraftLink: true } });
    if (!user?.minecraftLink) return 'skipped';
    await this.prisma.linkedMinecraftAccount.update({ where: { id: user.minecraftLink.id }, data: { lastVerifiedAt: new Date() } }).catch(() => undefined);
    const settings = await this.getSettings();
    if (settings.mode !== 'MANAGED' || user.managedBy !== AccountManager.LUCKPERMS || user.role.key === 'owner') return 'skipped';
    const snapshot = await this.prisma.permissionSyncState.findUnique({ where: { minecraftUuid: user.minecraftLink.minecraftUuid } });
    if (!snapshot || freshness(snapshot, settings.staleAfterMinutes) === 'STALE') return 'skipped';
    const [mappings, roles] = await Promise.all([this.prisma.luckPermsGroupMapping.findMany(), this.prisma.dashboardRole.findMany({ select: { id: true, key: true, priority: true } })]);
    const resolution = resolveRole((snapshot.groups as string[]) ?? [], mappings, roles);

    if (!resolution.access) {
      if (user.disabled) return 'unchanged';
      await this.prisma.$transaction(async (tx) => {
        await tx.dashboardUser.update({ where: { id: user.id }, data: { disabled: true, disabledByLuckPerms: true } });
        await tx.staffAccountStatusHistory.create({ data: { dashboardUserId: user.id, previousStatus: 'ACTIVE', newStatus: 'DISABLED', reason: `${reason}: ${resolution.reason === 'DENIED_GROUP' ? `group ${resolution.group} has no dashboard access` : 'no eligible LuckPerms group'}`.slice(0, 255), source: 'LUCKPERMS' } });
        await this.audit.record({ actor: SYSTEM_ACTOR, action: 'users.disabled_by_luckperms', targetType: 'dashboard_user', targetId: user.id, metadata: { username: user.username, reason: resolution.reason, group: resolution.group ?? null } }, tx);
      });
      await this.auth.revokeAllSessions(user.id);
      this.logger.log(`Disabled dashboard access of ${user.username}: ${resolution.reason}.`);
      return 'disabled';
    }

    if (user.disabled && user.disabledByLuckPerms) {
      // Eligible again: re-enable, but previous sessions stay revoked (fresh sign-in required).
      await this.prisma.$transaction(async (tx) => {
        await tx.dashboardUser.update({ where: { id: user.id }, data: { disabled: false, disabledByLuckPerms: false, roleId: resolution.roleId } });
        await tx.staffAccountStatusHistory.create({ data: { dashboardUserId: user.id, previousStatus: 'DISABLED', newStatus: 'ACTIVE', reason: `${reason}: group ${resolution.group}`.slice(0, 255), source: 'LUCKPERMS' } });
        await this.audit.record({ actor: SYSTEM_ACTOR, action: 'users.reactivated_by_luckperms', targetType: 'dashboard_user', targetId: user.id, metadata: { username: user.username, group: resolution.group, roleId: resolution.roleId } }, tx);
      });
      return 'reactivated';
    }
    if (user.disabled) return 'unchanged'; // disabled manually: LuckPerms does not override administrators
    if (user.roleId !== resolution.roleId) {
      await this.prisma.$transaction(async (tx) => {
        await tx.dashboardUser.update({ where: { id: user.id }, data: { roleId: resolution.roleId } });
        await tx.staffAccountStatusHistory.create({ data: { dashboardUserId: user.id, previousStatus: `ROLE:${user.role.key}`, newStatus: `ROLE:${roles.find((r) => r.id === resolution.roleId)?.key ?? '?'}`, reason: `${reason}: group ${resolution.group}`.slice(0, 255), source: 'LUCKPERMS' } });
        await this.audit.record({ actor: SYSTEM_ACTOR, action: 'users.role_changed_by_luckperms', targetType: 'dashboard_user', targetId: user.id, metadata: { username: user.username, from: user.role.key, toRoleId: resolution.roleId, group: resolution.group } }, tx);
      });
      return 'role-changed';
    }
    return 'unchanged';
  }

  /**
   * Canonical moderation permissions of a linked staff member (resolver for
   * StaffPermissionsService). Null = use the dashboard role.
   */
  async checkFor(user: AuthenticatedUser): Promise<PermissionCheck | null> {
    if (user.roleKey === 'owner') return null; // the protected Owner never depends on LuckPerms
    const settings = await this.getSettings();
    if (settings.mode === 'DISABLED') return null;
    const link = await this.prisma.linkedMinecraftAccount.findUnique({ where: { dashboardUserId: user.id } });
    if (!link) return null;
    const snapshot = await this.prisma.permissionSyncState.findUnique({ where: { minecraftUuid: link.minecraftUuid } });
    if (!snapshot) return { source: 'LUCKPERMS', can: () => false, blockedReason: 'NO_PERMISSION_DATA' };
    if (freshness(snapshot, settings.staleAfterMinutes) !== 'FRESH') return { source: 'LUCKPERMS', can: () => false, blockedReason: 'STALE_PERMISSIONS' };
    const permissions = (snapshot.permissions ?? {}) as Record<string, boolean>;
    return { source: 'LUCKPERMS', can: (permission) => permissions[permission] === true };
  }

  /** Rank shown on player profiles (null when unknown – never invented). See RankDisplayService. */
  rankFor(uuid: string) {
    return this.ranks.rankFor(uuid);
  }

}
