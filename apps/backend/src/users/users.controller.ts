import { BadRequestException, Body, Controller, ForbiddenException, Get, NotFoundException, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@mnm/shared-types';
import type { Request } from 'express';
import { z } from 'zod';
import { AuthService } from '../auth/auth.service';
import { TwoFactorService } from '../auth/two-factor.service';
import { PasswordService } from '../auth/password.service';
import { type AuthenticatedUser, clientIp, CurrentUser, RequirePermissions } from '../common/auth-context';
import { emailSchema, passwordSchema, usernameSchema } from '../common/validation';
import { paginationSchema, ZodBody, ZodQuery } from '../common/zod';
import { AuditService, userActor } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { RankDisplayService } from '../luckperms/rank-display.service';
import { canManagePriority, OWNER_ROLE_KEY } from '../rbac/rbac.policy';

const listQuery = paginationSchema.extend({ search: z.string().trim().max(64).optional() });

const createUserSchema = z.object({
  username: usernameSchema,
  email: emailSchema,
  password: passwordSchema,
  roleId: z.string().min(1).max(32),
});

const updateUserSchema = z
  .object({
    email: emailSchema.optional(),
    roleId: z.string().min(1).max(32).optional(),
    disabled: z.boolean().optional(),
    password: passwordSchema.optional(),
    /** Removes two-factor authentication (lost device). */
    resetTwoFactor: z.literal(true).optional(),
  })
  .strict();

const userSelect = {
  id: true,
  username: true,
  email: true,
  disabled: true,
  locale: true,
  lastLoginAt: true,
  createdAt: true,
  twoFactorEnabled: true,
  managedBy: true,
  disabledByLuckPerms: true,
  role: { select: { id: true, key: true, name: true, priority: true } },
  minecraftLink: { select: { minecraftUuid: true, minecraftUsername: true, lastVerifiedAt: true } },
} as const;

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    private readonly twoFactor: TwoFactorService,
    private readonly ranks: RankDisplayService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.USERS_VIEW)
  @ZodQuery(listQuery)
  async list(@Query() q: z.infer<typeof listQuery>) {
    const where = q.search ? { OR: [{ username: { contains: q.search } }, { email: { contains: q.search } }] } : {};
    const [total, items] = await this.prisma.$transaction([
      this.prisma.dashboardUser.count({ where }),
      this.prisma.dashboardUser.findMany({
        where,
        select: userSelect,
        orderBy: { createdAt: 'asc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    // LuckPerms rank of the linked player (appearance only).
    const ranks = await this.ranks.ranksFor(items.flatMap((i) => (i.minecraftLink ? [i.minecraftLink.minecraftUuid] : [])));
    return { total, page: q.page, pageSize: q.pageSize, items: items.map((i) => ({ ...i, minecraftRank: i.minecraftLink ? (ranks.get(i.minecraftLink.minecraftUuid) ?? null) : null })) };
  }

  @Post()
  @RequirePermissions(PERMISSIONS.USERS_MANAGE)
  @ZodBody(createUserSchema)
  async create(@CurrentUser() actor: AuthenticatedUser, @Body() body: z.infer<typeof createUserSchema>, @Req() req: Request) {
    await this.assertAssignableRole(actor, body.roleId);
    const passwordHash = await this.passwords.hash(body.password);
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.dashboardUser.create({
        data: { username: body.username, email: body.email, passwordHash, roleId: body.roleId },
        select: userSelect,
      });
      await this.audit.record(
        { actor: userActor(actor), action: 'users.created', targetType: 'dashboard_user', targetId: user.id, metadata: { username: user.username, role: user.role.key }, ipAddress: clientIp(req) },
        tx,
      );
      return user;
    });
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.USERS_MANAGE)
  @ZodBody(updateUserSchema)
  async update(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string, @Body() body: z.infer<typeof updateUserSchema>, @Req() req: Request) {
    const target = await this.prisma.dashboardUser.findUnique({ where: { id }, include: { role: true } });
    if (!target) throw new NotFoundException();
    const isSelf = target.id === actor.id;

    if (!isSelf && !canManagePriority(actor, target.role.priority)) {
      throw new ForbiddenException({ code: 'PRIORITY_TOO_HIGH', message: 'You cannot manage this user' });
    }
    if (isSelf && (body.disabled !== undefined || body.roleId !== undefined || body.resetTwoFactor)) {
      throw new BadRequestException({ code: 'SELF_MODIFICATION', message: 'You cannot change your own role or status' });
    }
    if (body.roleId && body.roleId !== target.roleId) await this.assertAssignableRole(actor, body.roleId);

    const losesOwner = target.role.key === OWNER_ROLE_KEY && ((body.roleId && body.roleId !== target.roleId) || body.disabled === true);
    if (losesOwner) {
      const owners = await this.prisma.dashboardUser.count({ where: { role: { key: OWNER_ROLE_KEY }, disabled: false } });
      if (owners <= 1) throw new BadRequestException({ code: 'LAST_OWNER', message: 'At least one active Owner is required' });
    }

    const passwordHash = body.password ? await this.passwords.hash(body.password) : undefined;
    if (body.resetTwoFactor) await this.twoFactor.clear(id);
    const updated = await this.prisma.$transaction(async (tx) => {
      const user = await tx.dashboardUser.update({
        where: { id },
        data: { email: body.email, roleId: body.roleId, disabled: body.disabled, passwordHash },
        select: userSelect,
      });
      const { password: _omit, ...changes } = body;
      await this.audit.record(
        {
          actor: userActor(actor),
          action: 'users.updated',
          targetType: 'dashboard_user',
          targetId: id,
          metadata: { ...changes, passwordReset: Boolean(body.password) },
          ipAddress: clientIp(req),
        },
        tx,
      );
      return user;
    });
    if (body.disabled || body.password || body.roleId || body.resetTwoFactor) await this.auth.revokeAllSessions(id);
    return updated;
  }

  private async assertAssignableRole(actor: AuthenticatedUser, roleId: string): Promise<void> {
    const role = await this.prisma.dashboardRole.findUnique({ where: { id: roleId } });
    if (!role) throw new BadRequestException({ code: 'UNKNOWN_ROLE', message: 'Role does not exist' });
    if (!canManagePriority(actor, role.priority)) {
      throw new ForbiddenException({ code: 'PRIORITY_TOO_HIGH', message: 'You cannot assign this role' });
    }
  }
}
