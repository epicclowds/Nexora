import { BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, NotFoundException, Param, Patch, Post, Put, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { hasPermission, isValidLocaleCode, PERMISSIONS } from '@mnm/shared-types';
import { bundledCatalogs, DEFAULT_LOCALE, findMissingKeys, findUnknownKeys, type MessageTree, validateCatalog } from '@mnm/translations';
import type { Request } from 'express';
import { z } from 'zod';
import { type AuthenticatedRequest, type AuthenticatedUser, clientIp, CurrentUser, Public, RequirePermissions } from '../common/auth-context';
import { ZodBody } from '../common/zod';
import { localeSchema } from '../common/validation';
import { AuditService, userActor } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

const updateLanguageSchema = z.object({ enabled: z.boolean().optional(), isDefault: z.literal(true).optional(), name: z.string().trim().min(1).max(64).optional() }).strict();
const createLanguageSchema = z.object({ locale: localeSchema, name: z.string().trim().min(1).max(64) }).strict();
const importCatalogSchema = z.object({ messages: z.record(z.string(), z.unknown()) }).strict();

/**
 * Languages and dashboard translations. Bundled catalogues ship with the
 * platform; administrators can add languages and import catalogues at runtime
 * (validated: no markup, known keys only). Missing keys fall back to en-US.
 */
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
    const [rows, custom] = await Promise.all([
      this.prisma.languageSetting.findMany({ where: canManage ? {} : { enabled: true }, orderBy: { locale: 'asc' } }),
      this.prisma.translationCatalog.findMany({ select: { locale: true, messages: true, updatedAt: true } }),
    ]);
    const customByLocale = new Map(custom.map((c) => [c.locale, c]));
    const reference = bundledCatalogs[DEFAULT_LOCALE];
    return rows.map((row) => {
      const imported = customByLocale.get(row.locale);
      const catalog = effectiveCatalog(row.locale, imported?.messages as MessageTree | undefined);
      return {
        locale: row.locale,
        name: row.name,
        nativeName: (catalog?.meta as { nativeName?: string } | undefined)?.nativeName ?? row.name,
        enabled: row.enabled,
        isDefault: row.isDefault,
        ...(canManage
          ? {
              bundled: Boolean(bundledCatalogs[row.locale]),
              customized: Boolean(imported),
              customUpdatedAt: imported?.updatedAt ?? null,
              missingKeys: catalog ? findMissingKeys(reference, catalog).length : findMissingKeys(reference, {}).length,
            }
          : {}),
      };
    });
  }

  /**
   * Public: imported messages of an enabled language. The dashboard merges them
   * over the bundled catalogue when rendering; `revision` lets it cache.
   */
  @Public()
  @Get('messages/:locale')
  async messages(@Param('locale') locale: string) {
    if (!isValidLocaleCode(locale)) throw new NotFoundException();
    const language = await this.prisma.languageSetting.findUnique({ where: { locale } });
    if (!language?.enabled) throw new NotFoundException();
    const custom = await this.prisma.translationCatalog.findUnique({ where: { locale } });
    return { locale, revision: custom?.updatedAt.getTime() ?? 0, messages: (custom?.messages as MessageTree | undefined) ?? {} };
  }

  @Get('languages/:locale/missing')
  @RequirePermissions(PERMISSIONS.TRANSLATIONS_MANAGE)
  async missing(@Param('locale') locale: string) {
    const catalog = await this.catalogOf(locale);
    return findMissingKeys(bundledCatalogs[DEFAULT_LOCALE], catalog);
  }

  /** Export the effective catalogue (bundled + imported) as JSON, the basis for translating. */
  @Get('catalogs/:locale')
  @RequirePermissions(PERMISSIONS.TRANSLATIONS_MANAGE)
  catalog(@Param('locale') locale: string) {
    return this.catalogOf(locale);
  }

  @Post('languages')
  @RequirePermissions(PERMISSIONS.TRANSLATIONS_MANAGE)
  @ZodBody(createLanguageSchema)
  async create(@CurrentUser() actor: AuthenticatedUser, @Body() body: z.infer<typeof createLanguageSchema>, @Req() req: Request) {
    if (await this.prisma.languageSetting.findUnique({ where: { locale: body.locale } })) {
      throw new ConflictException({ code: 'LANGUAGE_EXISTS', message: 'This language already exists' });
    }
    await this.prisma.$transaction(async (tx) => {
      // New languages start disabled: enable them once a catalogue was imported.
      await tx.languageSetting.create({ data: { locale: body.locale, name: body.name, enabled: false } });
      await this.audit.record({ actor: userActor(actor), action: 'i18n.language_created', targetType: 'language', targetId: body.locale, metadata: { name: body.name }, ipAddress: clientIp(req) }, tx);
    });
    return { ok: true };
  }

  @Delete('languages/:locale')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.TRANSLATIONS_MANAGE)
  async remove(@CurrentUser() actor: AuthenticatedUser, @Param('locale') locale: string, @Req() req: Request) {
    const language = await this.prisma.languageSetting.findUnique({ where: { locale } });
    if (!language) throw new NotFoundException();
    if (bundledCatalogs[locale]) throw new BadRequestException({ code: 'BUNDLED_LANGUAGE', message: 'Bundled languages can be disabled but not deleted' });
    if (language.isDefault) throw new BadRequestException({ code: 'DEFAULT_LANGUAGE', message: 'The default language cannot be deleted' });
    await this.prisma.$transaction(async (tx) => {
      // Users of the removed language fall back to the network default.
      const users = await tx.dashboardUser.updateMany({ where: { locale }, data: { locale: null } });
      await tx.translationCatalog.deleteMany({ where: { locale } });
      await tx.languageSetting.delete({ where: { locale } });
      await this.audit.record({ actor: userActor(actor), action: 'i18n.language_deleted', targetType: 'language', targetId: locale, metadata: { usersReset: users.count }, ipAddress: clientIp(req) }, tx);
    });
    return { ok: true };
  }

  /** Imports a catalogue. Validated like bundled files; unknown keys are rejected, missing keys fall back to en-US. */
  @Put('catalogs/:locale')
  @RequirePermissions(PERMISSIONS.TRANSLATIONS_MANAGE)
  @ZodBody(importCatalogSchema)
  async import(@CurrentUser() actor: AuthenticatedUser, @Param('locale') locale: string, @Body() body: z.infer<typeof importCatalogSchema>, @Req() req: Request) {
    const language = await this.prisma.languageSetting.findUnique({ where: { locale } });
    if (!language) throw new NotFoundException();
    const issues = validateCatalog(body.messages);
    const messages = body.messages as MessageTree;
    const unknown = issues.length ? [] : findUnknownKeys(bundledCatalogs[DEFAULT_LOCALE], messages);
    if (issues.length || unknown.length) {
      throw new BadRequestException({
        code: 'INVALID_CATALOG',
        message: 'The catalogue is invalid',
        issues: [...issues, ...unknown.map((key) => ({ key, problem: 'unknown-key' }))].slice(0, 50).map((i) => ({ path: i.key, message: i.problem })),
      });
    }
    // meta.locale always names the language it is stored for.
    const meta = typeof messages.meta === 'object' ? (messages.meta as MessageTree) : {};
    const stored: MessageTree = { ...messages, meta: { ...meta, locale } };
    const missingKeys = findMissingKeys(bundledCatalogs[DEFAULT_LOCALE], effectiveCatalog(locale, stored) ?? {}).length;
    await this.prisma.$transaction(async (tx) => {
      await tx.translationCatalog.upsert({
        where: { locale },
        create: { locale, messages: stored, updatedByUserId: actor.id },
        update: { messages: stored, updatedByUserId: actor.id },
      });
      await this.audit.record(
        {
          actor: userActor(actor),
          action: 'i18n.catalog_imported',
          targetType: 'language',
          targetId: locale,
          metadata: { missingKeys },
          ipAddress: clientIp(req),
        },
        tx,
      );
    });
    return { ok: true, missingKeys };
  }

  /** Removes imported messages (bundled languages return to the shipped catalogue). */
  @Delete('catalogs/:locale')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.TRANSLATIONS_MANAGE)
  async reset(@CurrentUser() actor: AuthenticatedUser, @Param('locale') locale: string, @Req() req: Request) {
    await this.prisma.$transaction(async (tx) => {
      const removed = await tx.translationCatalog.deleteMany({ where: { locale } });
      if (removed.count === 0) throw new NotFoundException();
      await this.audit.record({ actor: userActor(actor), action: 'i18n.catalog_reset', targetType: 'language', targetId: locale, ipAddress: clientIp(req) }, tx);
    });
    return { ok: true };
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
        data: { enabled: body.isDefault ? true : body.enabled, isDefault: body.isDefault, name: body.name },
      });
      await this.audit.record({ actor: userActor(actor), action: 'i18n.language_updated', targetType: 'language', targetId: locale, metadata: body, ipAddress: clientIp(req) }, tx);
    });
    return { ok: true };
  }

  private async catalogOf(locale: string): Promise<MessageTree> {
    const language = await this.prisma.languageSetting.findUnique({ where: { locale } });
    if (!language) throw new NotFoundException();
    const custom = await this.prisma.translationCatalog.findUnique({ where: { locale } });
    return effectiveCatalog(locale, custom?.messages as MessageTree | undefined) ?? { meta: { locale } };
  }
}

/** Bundled catalogue with imported messages merged over it (null when neither exists). */
function effectiveCatalog(locale: string, imported: MessageTree | undefined): MessageTree | null {
  const bundled = bundledCatalogs[locale];
  if (!bundled && !imported) return null;
  if (!bundled) return imported!;
  // Imported keys may also fill gaps the bundled catalogue has, so merge over the
  // union of keys rather than only the bundled ones.
  return mergeTrees(bundled, imported);
}

function mergeTrees(base: MessageTree, overrides: MessageTree | undefined): MessageTree {
  if (!overrides) return base;
  const result: MessageTree = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    const current = result[key];
    result[key] = typeof value === 'string' || typeof current !== 'object' ? value : mergeTrees(current, value);
  }
  return result;
}
