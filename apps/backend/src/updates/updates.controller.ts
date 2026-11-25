import { Body, Controller, ForbiddenException, Get, HttpCode, Post, Put, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PERMISSIONS } from '@mnm/shared-types';
import type { Request } from 'express';
import { z } from 'zod';
import { AuditService, userActor } from '../audit/audit.service';
import { type AuthenticatedUser, clientIp, CurrentUser, RequirePermissions } from '../common/auth-context';
import { ZodBody } from '../common/zod';
import { PrismaService } from '../prisma/prisma.service';
import { updateSettingsSchema, UpdatesService } from './updates.service';

const dismissSchema = z.object({ version: z.string().trim().min(1).max(64) }).strict();

/**
 * Update status for the dashboard. Read-only towards GitHub: nothing is
 * downloaded, installed or replaced automatically.
 */
@ApiTags('updates')
@Controller('updates')
export class UpdatesController {
  constructor(
    private readonly updates: UpdatesService,
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
  ) {}

  /** Installed and latest versions, connected plugins, warnings and settings. */
  @Get()
  @RequirePermissions(PERMISSIONS.UPDATES_VIEW)
  status() {
    return this.updates.status();
  }

  /** The update notification for the current user, or null. */
  @Get('notification')
  @RequirePermissions(PERMISSIONS.UPDATES_NOTIFY)
  async notification(@CurrentUser() user: AuthenticatedUser) {
    return { notification: await this.updates.notificationFor(user.id) };
  }

  /** Hides the notification for this version; a newer release shows it again. */
  @Post('notification/dismiss')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.UPDATES_NOTIFY)
  @ZodBody(dismissSchema)
  async dismiss(@CurrentUser() user: AuthenticatedUser, @Body() body: z.infer<typeof dismissSchema>) {
    await this.updates.dismiss(user.id, body.version);
    return { dismissed: body.version };
  }

  /** Manual check (rate-limited; within a minute of the last request or during a GitHub rate limit the cached result is returned). */
  @Post('check')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.UPDATES_CHECK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async check(@CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    const settings = await this.updates.getSettings();
    if (!settings.manualChecks) throw new ForbiddenException({ code: 'MANUAL_CHECKS_DISABLED', message: 'Manual update checks are disabled in the update settings' });
    // Never bypasses a GitHub rate limit; repeated clicks within a minute reuse the cached result.
    const { refreshed, outcome } = await this.updates.checkNow();
    if (refreshed) await this.audit.record({ actor: userActor(user), action: 'updates.checked', targetType: 'setting', targetId: 'updates', ipAddress: clientIp(req) });
    return { refreshed, outcome, status: await this.updates.status() };
  }

  @Get('settings')
  @RequirePermissions(PERMISSIONS.UPDATES_VIEW)
  settings() {
    return this.updates.getSettings();
  }

  @Put('settings')
  @RequirePermissions(PERMISSIONS.UPDATES_MANAGE)
  @ZodBody(updateSettingsSchema)
  async saveSettings(@CurrentUser() user: AuthenticatedUser, @Body() body: z.infer<typeof updateSettingsSchema>, @Req() req: Request) {
    const before = await this.updates.getSettings();
    return this.prisma.$transaction(async (tx) => {
      const after = await this.updates.saveSettings(body, user.id, tx);
      await this.audit.record({ actor: userActor(user), action: 'updates.settings_updated', targetType: 'setting', targetId: 'updates.settings', metadata: { before, after }, ipAddress: clientIp(req) }, tx);
      return after;
    });
  }
}
