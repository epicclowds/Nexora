import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, NotFoundException, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PERMISSIONS } from '@mnm/shared-types';
import type { Request } from 'express';
import { z } from 'zod';
import { userActor } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { SkipCsrf } from '../auth/guards';
import { type AuthenticatedUser, clientIp, CurrentUser, Public, RequirePermissions } from '../common/auth-context';
import { emailSchema, passwordSchema, usernameSchema } from '../common/validation';
import { ZodBody } from '../common/zod';
import { AccountManager, ServerType } from '../generated/prisma/client';
import { type PluginRequest, PluginAuthGuard } from '../plugin-api/plugin-auth.guard';
import { uuidSchema } from '../plugin-api/plugin-events';
import { PresetsService, serializePreset } from '../presets/presets.service';
import { StaffPermissionsService } from '../presets/staff-permissions.service';
import { PrismaService } from '../prisma/prisma.service';
import { canManagePriority } from '../rbac/rbac.policy';
import { freshness, luckPermsSettingsSchema, mappingSchema, syncSchema } from './luckperms';
import { LinkingService } from './linking.service';
import { LuckPermsService } from './luckperms.service';

const codeSchema = z.object({ code: z.string().trim().min(8).max(16) }).strict();
const registerSchema = z.object({ code: z.string().trim().min(8).max(16), username: usernameSchema, email: emailSchema, password: passwordSchema }).strict();
const linkCodeSchema = z.object({ uuid: uuidSchema, username: z.string().trim().min(1).max(16), registerPermission: z.boolean().default(false) }).strict();

/** Settings → Integrations → LuckPerms (Owner by default: integrations.manage). */
@ApiTags('integrations')
@Controller('integrations/luckperms')
export class LuckPermsController {
  constructor(
    private readonly luckperms: LuckPermsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.INTEGRATIONS_MANAGE)
  async overview() {
    const [settings, status, mappings, groups, snapshots, linked] = await Promise.all([
      this.luckperms.getSettings(),
      this.luckperms.status(),
      this.luckperms.listMappings(),
      this.luckperms.knownGroups(),
      this.prisma.permissionSyncState.count(),
      this.prisma.linkedMinecraftAccount.count(),
    ]);
    const stale = await this.prisma.permissionSyncState.count({ where: { synchronizedAt: { lt: new Date(Date.now() - settings.staleAfterMinutes * 60_000) } } });
    return { settings, status, mappings, knownGroups: groups, counts: { snapshots, linkedAccounts: linked, stale } };
  }

  @Put('settings')
  @RequirePermissions(PERMISSIONS.INTEGRATIONS_MANAGE)
  @ZodBody(luckPermsSettingsSchema)
  saveSettings(@CurrentUser() user: AuthenticatedUser, @Body() body: z.infer<typeof luckPermsSettingsSchema>, @Req() req: Request) {
    return this.luckperms.saveSettings(body, user, clientIp(req));
  }

  @Post('mappings')
  @RequirePermissions(PERMISSIONS.INTEGRATIONS_MANAGE)
  @ZodBody(mappingSchema)
  createMapping(@CurrentUser() user: AuthenticatedUser, @Body() body: z.infer<typeof mappingSchema>, @Req() req: Request) {
    return this.luckperms.upsertMapping(null, body, user, clientIp(req));
  }

  @Put('mappings/:id')
  @RequirePermissions(PERMISSIONS.INTEGRATIONS_MANAGE)
  @ZodBody(mappingSchema)
  updateMapping(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() body: z.infer<typeof mappingSchema>, @Req() req: Request) {
    return this.luckperms.upsertMapping(id, body, user, clientIp(req));
  }

  @Delete('mappings/:id')
  @RequirePermissions(PERMISSIONS.INTEGRATIONS_MANAGE)
  async deleteMapping(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Req() req: Request) {
    await this.luckperms.deleteMapping(id, user, clientIp(req));
    return { deleted: id };
  }
}

/** Linking the signed-in user's Minecraft account, and staff self-registration. */
@ApiTags('account')
@Controller()
export class AccountLinkController {
  constructor(
    private readonly linking: LinkingService,
    private readonly luckperms: LuckPermsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('account/minecraft-link')
  async current(@CurrentUser() user: AuthenticatedUser) {
    const [link, settings] = await Promise.all([this.prisma.linkedMinecraftAccount.findUnique({ where: { dashboardUserId: user.id } }), this.luckperms.getSettings()]);
    return {
      linkingEnabled: settings.mode !== 'DISABLED' && settings.linking.enabled,
      link: link ? { minecraftUuid: link.minecraftUuid, minecraftUsername: link.minecraftUsername, linkedAt: link.linkedAt.toISOString(), lastVerifiedAt: link.lastVerifiedAt?.toISOString() ?? null } : null,
      rank: link ? await this.luckperms.rankFor(link.minecraftUuid) : null,
    };
  }

  @Post('account/minecraft-link')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ZodBody(codeSchema)
  async link(@CurrentUser() user: AuthenticatedUser, @Body() body: z.infer<typeof codeSchema>, @Req() req: Request) {
    const link = await this.linking.linkToUser(user, body.code, clientIp(req));
    return { minecraftUuid: link.minecraftUuid, minecraftUsername: link.minecraftUsername };
  }

  /** Whether the registration page should be offered (public, no details). */
  @Public()
  @Get('auth/registration')
  async registration() {
    const settings = await this.luckperms.getSettings();
    return { enabled: settings.mode !== 'DISABLED' && settings.linking.enabled && settings.linking.allowRegistration };
  }

  @Public()
  @Post('auth/register-linked')
  @Throttle({ default: { limit: 5, ttl: 600_000 } })
  @ZodBody(registerSchema)
  register(@Body() body: z.infer<typeof registerSchema>, @Req() req: Request) {
    return this.linking.register(body, clientIp(req));
  }
}

/** Staff account details and actions for User Management. */
@ApiTags('users')
@Controller('users/:id')
export class StaffAccountsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly luckperms: LuckPermsService,
    private readonly linking: LinkingService,
    private readonly presets: PresetsService,
    private readonly staff: StaffPermissionsService,
    private readonly auth: AuthService,
  ) {}

  private async target(actor: AuthenticatedUser, id: string, manage: boolean) {
    const user = await this.prisma.dashboardUser.findUnique({ where: { id }, include: { role: { include: { permissions: true } }, minecraftLink: true } });
    if (!user) throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found' });
    if (manage && (user.role.key === 'owner' || !canManagePriority(actor, user.role.priority)) && actor.id !== user.id) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'You cannot manage this account' });
    }
    return user;
  }

  /** Link, rank, effective role, permission source, status history and the reason matrix. */
  @Get('staff')
  @RequirePermissions(PERMISSIONS.USERS_VIEW)
  async detail(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    const user = await this.target(actor, id, false);
    const settings = await this.luckperms.getSettings();
    const snapshot = user.minecraftLink ? await this.prisma.permissionSyncState.findUnique({ where: { minecraftUuid: user.minecraftLink.minecraftUuid } }) : null;
    const asUser = { id: user.id, username: user.username, email: user.email, roleId: user.roleId, roleKey: user.role.key, rolePriority: user.role.priority, permissions: user.role.permissions.map((p) => p.permission), sessionId: '', locale: null, theme: null, timezone: null };
    const check = await this.staff.forUser(asUser);
    const presets = await this.presets.list();
    const history = await this.prisma.staffAccountStatusHistory.findMany({ where: { dashboardUserId: id }, orderBy: { createdAt: 'desc' }, take: 50 });
    const fresh = snapshot ? freshness(snapshot, settings.staleAfterMinutes) : null;
    return {
      id: user.id,
      username: user.username,
      role: { id: user.role.id, key: user.role.key, name: user.role.name },
      protected: user.role.key === 'owner',
      managedBy: user.managedBy,
      disabled: user.disabled,
      disabledByLuckPerms: user.disabledByLuckPerms,
      status: accountStatus(user, settings.mode, fresh),
      link: user.minecraftLink ? { minecraftUuid: user.minecraftLink.minecraftUuid, minecraftUsername: user.minecraftLink.minecraftUsername, linkedAt: user.minecraftLink.linkedAt.toISOString(), lastVerifiedAt: user.minecraftLink.lastVerifiedAt?.toISOString() ?? null } : null,
      rank: user.minecraftLink ? await this.luckperms.rankFor(user.minecraftLink.minecraftUuid) : null,
      synchronizedAt: snapshot?.synchronizedAt.toISOString() ?? null,
      freshness: fresh,
      permissionSource: check.source,
      blockedReason: check.blockedReason ?? null,
      special: {
        custom: !check.blockedReason && check.can(PERMISSIONS.NEXORA_PUNISHMENT_CUSTOM),
        durationOverride: !check.blockedReason && check.can(PERMISSIONS.NEXORA_PUNISHMENT_DURATION_OVERRIDE),
        permanent: !check.blockedReason && check.can(PERMISSIONS.NEXORA_PUNISHMENT_PERMANENT),
      },
      reasons: presets.map((p) => ({ ...serializePreset(p), allowed: !check.blockedReason && check.can(p.permission) })),
      history: history.map((h) => ({ id: h.id, previousStatus: h.previousStatus, newStatus: h.newStatus, reason: h.reason, source: h.source, createdAt: h.createdAt.toISOString() })),
    };
  }

  /** Asks the proxy to resynchronise the linked player's LuckPerms data now. */
  @Post('staff/recheck')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.USERS_MANAGE)
  async recheck(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    const user = await this.target(actor, id, true);
    if (!user.minecraftLink) throw new NotFoundException({ code: 'NOT_LINKED', message: 'No Minecraft account is linked' });
    await this.luckperms.requestResync(user.minecraftLink.minecraftUuid);
    return { requested: true, result: await this.luckperms.reconcileUser(user.id, 'Manual recheck') };
  }

  @Post('staff/revoke-sessions')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.USERS_MANAGE)
  async revokeSessions(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    await this.target(actor, id, true);
    await this.auth.revokeAllSessions(id);
    return { revoked: true };
  }

  @Delete('minecraft-link')
  @RequirePermissions(PERMISSIONS.USERS_MANAGE)
  async unlink(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string, @Req() req: Request) {
    await this.target(actor, id, true);
    await this.linking.unlink(id, userActor(actor), clientIp(req));
    return { unlinked: true };
  }
}

export type AccountStatus = 'ACTIVE' | 'DISABLED' | 'PENDING_LINK' | 'SYNC_WARNING';

export function accountStatus(user: { disabled: boolean; managedBy: AccountManager; minecraftLink: unknown }, mode: string, fresh: string | null): AccountStatus {
  if (user.disabled) return 'DISABLED';
  if (user.managedBy === AccountManager.LUCKPERMS && !user.minecraftLink) return 'PENDING_LINK';
  if (user.minecraftLink && mode !== 'DISABLED' && fresh !== 'FRESH') return 'SYNC_WARNING';
  return 'ACTIVE';
}

/** Signed plugin API: LuckPerms snapshots and link codes (Velocity proxy only). */
@ApiTags('plugin')
@Public()
@SkipCsrf()
@UseGuards(PluginAuthGuard)
@Throttle({ default: { limit: 600, ttl: 60_000 } })
@Controller('plugin/v1')
export class PluginLuckPermsController {
  constructor(
    private readonly luckperms: LuckPermsService,
    private readonly linking: LinkingService,
  ) {}

  private proxy(req: PluginRequest) {
    const server = req.pluginServer!;
    if (server.type !== ServerType.VELOCITY) throw new ForbiddenException({ code: 'PROXY_ONLY', message: 'Only the Velocity proxy reports LuckPerms data' });
    return server;
  }

  @Post('luckperms/sync')
  @HttpCode(200)
  @ZodBody(syncSchema)
  sync(@Req() req: PluginRequest, @Body() body: z.infer<typeof syncSchema>) {
    const server = this.proxy(req);
    return this.luckperms.ingest({ id: server.id, name: server.name }, body);
  }

  /** /nexora link: the proxy vouches for the player's authenticated session. */
  @Post('link-codes')
  @ZodBody(linkCodeSchema)
  linkCode(@Req() req: PluginRequest, @Body() body: z.infer<typeof linkCodeSchema>) {
    this.proxy(req);
    return this.linking.createCode(body);
  }
}
