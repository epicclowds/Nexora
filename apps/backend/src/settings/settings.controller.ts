import { BadRequestException, Body, ConflictException, Controller, Get, Patch, Put, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@mnm/shared-types';
import type { Request } from 'express';
import { z } from 'zod';
import { type AuthenticatedUser, clientIp, CurrentUser, RequirePermissions } from '../common/auth-context';
import { ZodBody } from '../common/zod';
import { AuditService, userActor } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { managedPluginSettingsSchema, moderationSettingsSchema, normalizePluginSettings, pluginCatalogs, validatePluginMessages } from './plugin-settings';
import { clientDetectionSettingsSchema, networkSettingsSchema, privacySettingsSchema, SETTING_KEYS, SettingsService } from './settings.service';

const updateNetworkSchema = networkSettingsSchema.partial().strict();
// Partial update: fields that are not sent keep their stored value.
const updatePrivacySchema = z
  .object({
    ipRetentionDays: z.number().int().min(7).max(3650).nullable().optional(),
    deletedEvidenceRetentionDays: z.number().int().min(1).max(3650).nullable().optional(),
  })
  .strict();
const updatePluginSettingsSchema = z.object({ baseRevision: z.number().int().min(0), settings: managedPluginSettingsSchema }).strict();

const moderationUpdateSchema = moderationSettingsSchema.extend({ requireEvidence: z.boolean().optional() });

@ApiTags('settings')
@Controller('settings')
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('network')
  network() {
    return this.settings.getNetwork();
  }

  @Get('privacy')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  privacy() {
    return this.settings.getPrivacy();
  }

  @Patch('privacy')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  @ZodBody(updatePrivacySchema)
  async updatePrivacy(@CurrentUser() actor: AuthenticatedUser, @Body() body: z.infer<typeof updatePrivacySchema>, @Req() req: Request) {
    const before = await this.settings.getPrivacy();
    const after = privacySettingsSchema.parse({ ...before, ...body });
    await this.prisma.$transaction(async (tx) => {
      await this.settings.set(SETTING_KEYS.PRIVACY, after, actor.id, tx);
      await this.audit.record({ actor: userActor(actor), action: 'settings.privacy_updated', targetType: 'setting', targetId: SETTING_KEYS.PRIVACY, metadata: { before, after }, ipAddress: clientIp(req) }, tx);
    });
    return after;
  }

  @Patch('network')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  @ZodBody(updateNetworkSchema)
  async updateNetwork(@CurrentUser() actor: AuthenticatedUser, @Body() body: z.infer<typeof updateNetworkSchema>, @Req() req: Request) {
    const current = await this.settings.getNetwork();
    const next = networkSettingsSchema.parse({ ...current, ...body });
    await this.prisma.$transaction(async (tx) => {
      await this.settings.set(SETTING_KEYS.NETWORK, next, actor.id, tx);
      await this.audit.record({ actor: userActor(actor), action: 'settings.network_updated', targetType: 'setting', targetId: SETTING_KEYS.NETWORK, metadata: { before: current, after: next }, ipAddress: clientIp(req) }, tx);
    });
    return next;
  }

  /** Client detection (proxy brand capture, optional NoRisk integration, debug logging). */
  @Get('client-detection')
  @RequirePermissions(PERMISSIONS.SERVERS_MANAGE)
  clientDetection() {
    return this.settings.getClientDetection();
  }

  @Put('client-detection')
  @RequirePermissions(PERMISSIONS.SERVERS_MANAGE)
  @ZodBody(clientDetectionSettingsSchema)
  async updateClientDetection(@CurrentUser() actor: AuthenticatedUser, @Body() body: z.infer<typeof clientDetectionSettingsSchema>, @Req() req: Request) {
    const before = await this.settings.getClientDetection();
    await this.prisma.$transaction(async (tx) => {
      await this.settings.set(SETTING_KEYS.CLIENT_DETECTION, body, actor.id, tx);
      await this.audit.record({ actor: userActor(actor), action: 'settings.client_detection_updated', targetType: 'setting', targetId: SETTING_KEYS.CLIENT_DETECTION, metadata: { before, after: body }, ipAddress: clientIp(req) }, tx);
    });
    return body;
  }

  /** Settings pushed to connected plugins (live, within one heartbeat). */
  @Get('plugins')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  plugins() {
    return this.settings.getPluginSettings();
  }

  /** Bundled plugin messages per locale (defaults shown next to overrides). */
  @Get('plugins/messages')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  pluginMessages() {
    return pluginCatalogs();
  }

  @Put('plugins')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  @ZodBody(updatePluginSettingsSchema)
  async updatePlugins(@CurrentUser() actor: AuthenticatedUser, @Body() body: z.infer<typeof updatePluginSettingsSchema>, @Req() req: Request) {
    const issues = validatePluginMessages(body.settings.messages);
    if (issues.length) throw new BadRequestException({ code: 'INVALID_MESSAGES', message: 'Some plugin messages are invalid', issues: issues.map((i) => ({ path: `${i.locale}.${i.key}`, message: i.problem })) });
    const settings = normalizePluginSettings(body.settings);
    return this.prisma.$transaction(async (tx) => {
      // The row lock serialises concurrent saves; the revision check rejects lost updates.
      await tx.$queryRaw`SELECT \`key\` FROM system_settings WHERE \`key\` = ${SETTING_KEYS.PLUGINS} FOR UPDATE`;
      const current = await this.settings.getPluginSettings(tx);
      if (current.revision !== body.baseRevision) {
        throw new ConflictException({ code: 'STALE_SETTINGS', message: 'The settings were changed by someone else. Reload and try again.' });
      }
      const next = { revision: current.revision + 1, settings, updatedAt: new Date().toISOString() };
      await this.settings.set(SETTING_KEYS.PLUGINS, next, actor.id, tx);
      const { messages: beforeMessages, ...before } = current.settings;
      const { messages: afterMessages, ...after } = settings;
      await this.audit.record(
        {
          actor: userActor(actor),
          action: 'settings.plugins_updated',
          targetType: 'setting',
          targetId: SETTING_KEYS.PLUGINS,
          metadata: { revision: next.revision, before, after, messageOverrides: countMessages(afterMessages), previousMessageOverrides: countMessages(beforeMessages) },
          ipAddress: clientIp(req),
        },
        tx,
      );
      return next;
    });
  }

  /** Punishment presets (reasons and durations) offered when issuing punishments. */
  @Get('moderation')
  moderation() {
    return this.settings.getModeration();
  }

  @Put('moderation')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  @ZodBody(moderationUpdateSchema)
  async updateModeration(@CurrentUser() actor: AuthenticatedUser, @Body() update: z.infer<typeof moderationUpdateSchema>, @Req() req: Request) {
    // Older dashboards only send presets: keep the stored evidence policy then.
    const body = moderationSettingsSchema.parse({ ...update, requireEvidence: update.requireEvidence ?? (await this.settings.getModeration()).requireEvidence });
    await this.prisma.$transaction(async (tx) => {
      await this.settings.set(SETTING_KEYS.MODERATION, body, actor.id, tx);
      await this.audit.record({ actor: userActor(actor), action: 'settings.moderation_updated', targetType: 'setting', targetId: SETTING_KEYS.MODERATION, metadata: { presets: body.presets.length, requireEvidence: body.requireEvidence }, ipAddress: clientIp(req) }, tx);
    });
    return body;
  }
}

function countMessages(messages: Record<string, Record<string, string>>): number {
  return Object.values(messages).reduce((sum, entries) => sum + Object.keys(entries).length, 0);
}
