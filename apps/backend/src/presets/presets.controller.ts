import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@mnm/shared-types';
import type { Request } from 'express';
import { z } from 'zod';
import { userActor } from '../audit/audit.service';
import { type AuthenticatedUser, clientIp, CurrentUser, RequirePermissions } from '../common/auth-context';
import { ZodBody, ZodQuery } from '../common/zod';
import { commandModeSchema, createPresetSchema, updatePresetSchema } from './presets';
import { type Editor, PresetsService, serializePreset } from './presets.service';
import { StaffPermissionsService } from './staff-permissions.service';

const listQuery = z.object({ archived: z.enum(['true', 'false']).default('false') });
const archiveSchema = z.object({ archived: z.boolean() }).strict();

function editor(user: AuthenticatedUser, req: Request): Editor {
  return { userId: user.id, name: user.username, actor: userActor(user), ipAddress: clientIp(req) };
}

/** Settings → Moderation → Punishment reasons and command mode. */
@ApiTags('moderation')
@Controller('moderation')
export class PresetsController {
  constructor(
    private readonly presets: PresetsService,
    private readonly staff: StaffPermissionsService,
  ) {}

  /** All presets (management view). */
  @Get('presets')
  @RequirePermissions(PERMISSIONS.PUNISHMENT_PRESETS_MANAGE)
  @ZodQuery(listQuery)
  async list(@Query() q: z.infer<typeof listQuery>) {
    return (await this.presets.list({ includeArchived: q.archived === 'true' })).map(serializePreset);
  }

  /**
   * Presets the current user may use when issuing a punishment, the global
   * mode and what else the user may do (typed reasons, duration overrides).
   * Cosmetic for the form – the backend re-checks every request.
   */
  @Get('presets/usable')
  @RequirePermissions(PERMISSIONS.PUNISHMENTS_HISTORY)
  async usable(@CurrentUser() user: AuthenticatedUser) {
    const [mode, presets, check] = await Promise.all([this.presets.mode(), this.presets.list(), this.staff.forUser(user)]);
    const blocked = Boolean(check.blockedReason);
    return {
      mode,
      permissionSource: check.source,
      blockedReason: check.blockedReason ?? null,
      customReasons: mode === 'FREE_TEXT' || (mode === 'HYBRID' && !blocked && check.can(PERMISSIONS.NEXORA_PUNISHMENT_CUSTOM)),
      durationOverride: !blocked && check.can(PERMISSIONS.NEXORA_PUNISHMENT_DURATION_OVERRIDE),
      permanentOverride: !blocked && check.can(PERMISSIONS.NEXORA_PUNISHMENT_PERMANENT),
      presets: mode === 'FREE_TEXT' || blocked ? [] : presets.filter((p) => p.enabled && check.can(p.permission)).map(serializePreset),
    };
  }

  /** Reasons with their permissions for the role editor and the staff permission matrix. */
  @Get('presets/catalog')
  @RequirePermissions(PERMISSIONS.USERS_VIEW)
  async catalog() {
    return (await this.presets.list()).map((p) => ({ id: p.id, category: p.category, numericId: p.numericId, name: p.name, permission: p.permission, enabled: p.enabled }));
  }

  @Get('command-mode')
  @RequirePermissions(PERMISSIONS.PUNISHMENTS_HISTORY)
  async commandMode() {
    return { mode: await this.presets.mode(), revision: await this.presets.revision() };
  }

  /** Global for the whole network (all proxies, servers, staff and the dashboard). */
  @Put('command-mode')
  @RequirePermissions(PERMISSIONS.PUNISHMENT_PRESETS_MANAGE)
  @ZodBody(commandModeSchema)
  async setCommandMode(@CurrentUser() user: AuthenticatedUser, @Body() body: z.infer<typeof commandModeSchema>, @Req() req: Request) {
    return { mode: await this.presets.setMode(body.mode, editor(user, req)) };
  }

  @Post('presets')
  @RequirePermissions(PERMISSIONS.PUNISHMENT_PRESETS_MANAGE)
  @ZodBody(createPresetSchema)
  async create(@CurrentUser() user: AuthenticatedUser, @Body() body: z.infer<typeof createPresetSchema>, @Req() req: Request) {
    return serializePreset(await this.presets.create(body, editor(user, req)));
  }

  @Patch('presets/:id')
  @RequirePermissions(PERMISSIONS.PUNISHMENT_PRESETS_MANAGE)
  @ZodBody(updatePresetSchema)
  async update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() body: z.infer<typeof updatePresetSchema>, @Req() req: Request) {
    return serializePreset(await this.presets.update(id, body, editor(user, req)));
  }

  @Post('presets/:id/archive')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.PUNISHMENT_PRESETS_MANAGE)
  @ZodBody(archiveSchema)
  async archive(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() body: z.infer<typeof archiveSchema>, @Req() req: Request) {
    return serializePreset(await this.presets.setArchived(id, body.archived, editor(user, req)));
  }

  @Post('presets/:id/duplicate')
  @RequirePermissions(PERMISSIONS.PUNISHMENT_PRESETS_MANAGE)
  async duplicate(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Req() req: Request) {
    return serializePreset(await this.presets.duplicate(id, editor(user, req)));
  }
}
