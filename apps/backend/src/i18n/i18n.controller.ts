import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Patch, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { hasPermission, PERMISSIONS } from '@mnm/shared-types';
import { bundledCatalogs, DEFAULT_LOCALE, findMissingKeys } from '@mnm/translations';
import type { Request } from 'express';
import { z } from 'zod';
import { type AuthenticatedRequest, type AuthenticatedUser, clientIp, CurrentUser, Public, RequirePermissions } from '../common/auth-context';
import { ZodBody } from '../common/zod';
import { AuditService, userActor } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

const updateLanguageSchema = z.object({ enabled: z.boolean().optional(), isDefault: z.literal(true).optional() }).strict();

@ApiTags('i18n')
@Controller('i18n')
export class I18nController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Public: enabled languages (needed by the login page). Managers also see disabled ones and completeness. */
  @Public()
  @Get('languages')
  async languages(@Req() req: AuthenticatedRequest) {
    const canManage = req.user ? hasPermission(req.user.permissions, PERMISSIONS.TRANSLATIONS_MANAGE) : false;
    const rows = await this.prisma.languageSetting.findMany({ where: canManage ? {} : { enabled: true }, orderBy: { locale: 'asc' } });
    const reference = bundledCatalogs[DEFAULT_LOCALE];
    return rows.map((row) => {
      const catalog = bundledCatalogs[row.locale];
      return {
        locale: row.locale,
        name: row.name,
        nativeName: (catalog?.meta as { nativeName?: string } | undefined)?.nativeName ?? row.name,
        enabled: row.enabled,
        isDefault: row.isDefault,
        ...(canManage ? { bundled: Boolean(catalog), missingKeys: catalog ? findMissingKeys(reference, catalog).length : null } : {}),
      };
    });
  }

  @Get('languages/:locale/missing')
  @RequirePermissions(PERMISSIONS.TRANSLATIONS_MANAGE)
  missing(@Param('locale') locale: string) {
    const catalog = bundledCatalogs[locale];
    if (!catalog) throw new NotFoundException();
    return findMissingKeys(bundledCatalogs[DEFAULT_LOCALE], catalog);
  }

  /** Export a bundled catalogue as JSON (basis for translating into a new language). */
  @Get('catalogs/:locale')
  @RequirePermissions(PERMISSIONS.TRANSLATIONS_MANAGE)
  catalog(@Param('locale') locale: string) {
    const catalog = bundledCatalogs[locale];
    if (!catalog) throw new NotFoundException();
    return catalog;
  }

  @Patch('languages/:locale')
  @RequirePermissions(PERMISSIONS.TRANSLATIONS_MANAGE)
  @ZodBody(updateLanguageSchema)
  async update(@CurrentUser() actor: AuthenticatedUser, @Param('locale') locale: string, @Body() body: z.infer<typeof updateLanguageSchema>, @Req() req: Request) {
    const language = await this.prisma.languageSetting.findUnique({ where: { locale } });
    if (!language) throw new NotFoundException();
    if (body.enabled === false && (language.isDefault || body.isDefault)) {
      throw new BadRequestException({ code: 'DEFAULT_LANGUAGE', message: 'The default language cannot be disabled' });
    }
    await this.prisma.$transaction(async (tx) => {
      if (body.isDefault) await tx.languageSetting.updateMany({ data: { isDefault: false } });
      await tx.languageSetting.update({
        where: { locale },
        data: { enabled: body.isDefault ? true : body.enabled, isDefault: body.isDefault },
      });
      await this.audit.record({ actor: userActor(actor), action: 'i18n.language_updated', targetType: 'language', targetId: locale, metadata: body, ipAddress: clientIp(req) }, tx);
    });
    return { ok: true };
  }
}
