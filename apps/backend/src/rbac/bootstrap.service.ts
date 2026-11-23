import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ALL_PERMISSIONS, DEFAULT_LOCALE, DEFAULT_ROLES, WILDCARD_PERMISSION } from '@mnm/shared-types';
import { bundledCatalogs } from '@mnm/translations';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Idempotent startup synchronisation of reference data: permission catalogue,
 * default system roles and bundled languages. Existing customisations of
 * non-owner roles are never overwritten.
 */
@Injectable()
export class BootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BootstrapService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.syncPermissions();
    await this.ensureSystemRoles();
    await this.ensureLanguages();
  }

  private async syncPermissions(): Promise<void> {
    await this.prisma.dashboardPermission.createMany({
      data: ALL_PERMISSIONS.map((key) => ({ key })),
      skipDuplicates: true,
    });
  }

  private async ensureSystemRoles(): Promise<void> {
    for (const def of DEFAULT_ROLES) {
      const existing = await this.prisma.dashboardRole.findUnique({ where: { key: def.key } });
      if (!existing) {
        await this.prisma.dashboardRole.create({
          data: {
            key: def.key,
            name: def.name,
            priority: def.priority,
            isSystem: true,
            permissions: { create: def.permissions.map((permission) => ({ permission })) },
          },
        });
        this.logger.log(`Created system role "${def.key}"`);
      } else if (def.key === 'owner') {
        await this.prisma.dashboardRolePermission.createMany({
          data: [{ roleId: existing.id, permission: WILDCARD_PERMISSION }],
          skipDuplicates: true,
        });
      }
    }
  }

  private async ensureLanguages(): Promise<void> {
    for (const [locale, catalog] of Object.entries(bundledCatalogs)) {
      const meta = catalog.meta as { name?: string } | undefined;
      await this.prisma.languageSetting.upsert({
        where: { locale },
        create: { locale, name: meta?.name ?? locale, enabled: true, isDefault: locale === DEFAULT_LOCALE },
        update: {},
      });
    }
    const defaults = await this.prisma.languageSetting.count({ where: { isDefault: true } });
    if (defaults !== 1) {
      await this.prisma.$transaction([
        this.prisma.languageSetting.updateMany({ data: { isDefault: false } }),
        this.prisma.languageSetting.update({ where: { locale: DEFAULT_LOCALE }, data: { isDefault: true, enabled: true } }),
      ]);
    }
  }
}
