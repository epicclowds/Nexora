import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Put, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@mnm/shared-types';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { type AuthenticatedUser, clientIp, CurrentUser, RequirePermissions } from '../common/auth-context';
import { ZodBody } from '../common/zod';
import { LuckPermsService } from './luckperms.service';
import { groupNameSchema, iconUploadSchema, type RankDisplayInput, rankDisplaySchema } from './rank-display';
import { RankDisplayService } from './rank-display.service';

function group(raw: string): string {
  const parsed = groupNameSchema.safeParse(raw);
  if (!parsed.success) throw new BadRequestException({ code: 'INVALID_GROUP', message: 'Invalid LuckPerms group name' });
  return parsed.data;
}

/** Settings → Integrations → LuckPerms → Rank display (integrations.manage). */
@ApiTags('integrations')
@Controller('integrations/luckperms/rank-displays')
export class RankDisplayController {
  constructor(
    private readonly ranks: RankDisplayService,
    private readonly luckperms: LuckPermsService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.INTEGRATIONS_MANAGE)
  async list() {
    const [displays, knownGroups] = await Promise.all([this.ranks.list(), this.luckperms.knownGroups()]);
    // Real LuckPerms texts per group, so the editor previews exactly what players will show.
    const samples = await this.ranks.samples([...new Set([...knownGroups, ...displays.map((d) => d.groupName)])]);
    return { displays, knownGroups, samples };
  }

  @Put(':group')
  @RequirePermissions(PERMISSIONS.INTEGRATIONS_MANAGE)
  @ZodBody(rankDisplaySchema)
  save(@CurrentUser() user: AuthenticatedUser, @Param('group') raw: string, @Body() body: RankDisplayInput, @Req() req: Request) {
    return this.ranks.save(group(raw), body, user, clientIp(req));
  }

  @Delete(':group')
  @RequirePermissions(PERMISSIONS.INTEGRATIONS_MANAGE)
  async remove(@CurrentUser() user: AuthenticatedUser, @Param('group') raw: string, @Req() req: Request) {
    await this.ranks.remove(group(raw), user, clientIp(req));
    return { deleted: group(raw) };
  }

  /** Uploads a raster icon (base64 JSON body; PNG, WebP, GIF or JPEG; at most 64 KB). */
  @Put(':group/icon')
  @RequirePermissions(PERMISSIONS.INTEGRATIONS_MANAGE)
  @ZodBody(iconUploadSchema)
  setIcon(@CurrentUser() user: AuthenticatedUser, @Param('group') raw: string, @Body() body: z.infer<typeof iconUploadSchema>, @Req() req: Request) {
    return this.ranks.setIcon(group(raw), body.data, user, clientIp(req));
  }

  @Delete(':group/icon')
  @RequirePermissions(PERMISSIONS.INTEGRATIONS_MANAGE)
  removeIcon(@CurrentUser() user: AuthenticatedUser, @Param('group') raw: string, @Req() req: Request) {
    return this.ranks.removeIcon(group(raw), user, clientIp(req));
  }
}

/**
 * Rank icons for every signed-in dashboard user (ranks appear on profiles,
 * lists and staff pages). Served as inert images: content type fixed from the
 * validated upload, no sniffing, no scripts.
 */
@ApiTags('integrations')
@Controller('rank-icons')
export class RankIconController {
  constructor(private readonly ranks: RankDisplayService) {}

  @Get(':id')
  async icon(@Param('id') id: string, @Res() res: Response) {
    const icon = id.length <= 32 ? await this.ranks.icon(id) : null;
    if (!icon) throw new NotFoundException({ code: 'ICON_NOT_FOUND', message: 'No icon' });
    res.setHeader('Content-Type', icon.type);
    res.setHeader('Cache-Control', 'private, max-age=86400, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Content-Disposition', 'inline');
    res.send(icon.data);
  }
}
