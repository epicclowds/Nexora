import { Body, Controller, Get, Patch, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@mnm/shared-types';
import type { Request } from 'express';
import { z } from 'zod';
import { type AuthenticatedUser, clientIp, CurrentUser, RequirePermissions } from '../common/auth-context';
import { ZodBody } from '../common/zod';
import { AuditService, userActor } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { networkSettingsSchema, privacySettingsSchema, SETTING_KEYS, SettingsService } from './settings.service';

const updateNetworkSchema = networkSettingsSchema.partial().strict();
const updatePrivacySchema = privacySettingsSchema.strict();

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
    await this.prisma.$transaction(async (tx) => {
      await this.settings.set(SETTING_KEYS.PRIVACY, body, actor.id, tx);
      await this.audit.record({ actor: userActor(actor), action: 'settings.privacy_updated', targetType: 'setting', targetId: SETTING_KEYS.PRIVACY, metadata: { before, after: body }, ipAddress: clientIp(req) }, tx);
    });
    return body;
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
}
