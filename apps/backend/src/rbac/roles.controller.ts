import { BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, HttpCode, NotFoundException, Param, Patch, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ALL_PERMISSIONS, isGrantablePermission, PERMISSIONS } from '@mnm/shared-types';
import type { Request } from 'express';
import { z } from 'zod';
import { type AuthenticatedUser, clientIp, CurrentUser, RequirePermissions } from '../common/auth-context';
import { ZodBody } from '../common/zod';
import { AuditService, userActor } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { canManagePriority, OWNER_ROLE_KEY, ungrantablePermissions } from './rbac.policy';

const permissionList = z
  // Catalogue permissions plus per-preset keys such as nexora.punishment.ban.1.
  .array(z.string().refine(isGrantablePermission, 'Unknown permission'))
  .max(ALL_PERMISSIONS.length + 400)
  .transform((list) => [...new Set(list)]);

const createRoleSchema = z.object({
  key: z.string().trim().min(2).max(32).regex(/^[a-z0-9-]+$/, 'Use lowercase letters, digits and "-"'),
  name: z.string().trim().min(1).max(64),
  description: z.string().trim().max(255).optional(),
  priority: z.number().int().min(1).max(999),
  permissions: permissionList.default([]),
});

const updateRoleSchema = z
  .object({
    name: z.string().trim().min(1).max(64).optional(),
    description: z.string().trim().max(255).nullable().optional(),
    priority: z.number().int().min(1).max(999).optional(),
    permissions: permissionList.optional(),
  })
  .strict();

@ApiTags('roles')
@Controller()
export class RolesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get('permissions')
  @RequirePermissions(PERMISSIONS.USERS_VIEW)
  permissions() {
    return ALL_PERMISSIONS;
  }

  @Get('roles')
  @RequirePermissions(PERMISSIONS.USERS_VIEW)
  async list() {
    const roles = await this.prisma.dashboardRole.findMany({
      orderBy: { priority: 'desc' },
      include: { permissions: true, _count: { select: { users: true } } },
    });
    return roles.map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      description: r.description,
      priority: r.priority,
      isSystem: r.isSystem,
      userCount: r._count.users,
      permissions: r.permissions.map((p) => p.permission).sort(),
    }));
  }

  @Post('roles')
  @RequirePermissions(PERMISSIONS.ROLES_MANAGE)
  @ZodBody(createRoleSchema)
  async create(@CurrentUser() actor: AuthenticatedUser, @Body() body: z.infer<typeof createRoleSchema>, @Req() req: Request) {
    if (!canManagePriority(actor, body.priority)) throw new ForbiddenException({ code: 'PRIORITY_TOO_HIGH', message: 'Role priority must be below your own' });
    this.assertGrantable(actor, body.permissions);
    const role = await this.prisma.$transaction(async (tx) => {
      const created = await tx.dashboardRole.create({
        data: {
          key: body.key,
          name: body.name,
          description: body.description,
          priority: body.priority,
          permissions: { create: body.permissions.map((permission) => ({ permission })) },
        },
      });
      await this.audit.record(
        { actor: userActor(actor), action: 'roles.created', targetType: 'dashboard_role', targetId: created.id, metadata: { key: body.key, permissions: body.permissions }, ipAddress: clientIp(req) },
        tx,
      );
      return created;
    });
    return { id: role.id };
  }

  @Patch('roles/:id')
  @RequirePermissions(PERMISSIONS.ROLES_MANAGE)
  @ZodBody(updateRoleSchema)
  async update(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string, @Body() body: z.infer<typeof updateRoleSchema>, @Req() req: Request) {
    const role = await this.prisma.dashboardRole.findUnique({ where: { id }, include: { permissions: true } });
    if (!role) throw new NotFoundException();
    if (role.key === OWNER_ROLE_KEY) throw new ForbiddenException({ code: 'OWNER_ROLE_LOCKED', message: 'The Owner role cannot be modified' });
    if (!canManagePriority(actor, role.priority) || (body.priority !== undefined && !canManagePriority(actor, body.priority))) {
      throw new ForbiddenException({ code: 'PRIORITY_TOO_HIGH', message: 'You cannot manage this role' });
    }
    if (body.permissions) this.assertGrantable(actor, body.permissions);

    await this.prisma.$transaction(async (tx) => {
      await tx.dashboardRole.update({
        where: { id },
        data: { name: body.name, description: body.description, priority: body.priority },
      });
      if (body.permissions) {
        await tx.dashboardRolePermission.deleteMany({ where: { roleId: id } });
        await tx.dashboardRolePermission.createMany({ data: body.permissions.map((permission) => ({ roleId: id, permission })) });
      }
      await this.audit.record(
        {
          actor: userActor(actor),
          action: 'roles.updated',
          targetType: 'dashboard_role',
          targetId: id,
          metadata: { before: { name: role.name, priority: role.priority, permissions: role.permissions.map((p) => p.permission) }, changes: body },
          ipAddress: clientIp(req),
        },
        tx,
      );
    });
    return { ok: true };
  }

  @Delete('roles/:id')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.ROLES_MANAGE)
  async remove(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string, @Req() req: Request) {
    const role = await this.prisma.dashboardRole.findUnique({ where: { id }, include: { _count: { select: { users: true } } } });
    if (!role) throw new NotFoundException();
    if (role.isSystem) throw new BadRequestException({ code: 'SYSTEM_ROLE', message: 'System roles cannot be deleted' });
    if (!canManagePriority(actor, role.priority)) throw new ForbiddenException({ code: 'PRIORITY_TOO_HIGH', message: 'You cannot manage this role' });
    if (role._count.users > 0) throw new ConflictException({ code: 'ROLE_IN_USE', message: 'Reassign users before deleting this role' });
    await this.prisma.$transaction(async (tx) => {
      await tx.dashboardRole.delete({ where: { id } });
      await this.audit.record({ actor: userActor(actor), action: 'roles.deleted', targetType: 'dashboard_role', targetId: id, metadata: { key: role.key }, ipAddress: clientIp(req) }, tx);
    });
    return { ok: true };
  }

  private assertGrantable(actor: AuthenticatedUser, permissions: string[]): void {
    const denied = ungrantablePermissions(actor, permissions);
    if (denied.length) throw new ForbiddenException({ code: 'PERMISSION_ESCALATION', message: `You cannot grant: ${denied.join(', ')}` });
  }
}
