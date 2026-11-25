import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@mnm/shared-types';
import type { Response } from 'express';
import { type AuthenticatedUser, CurrentUser, RequirePermissions } from '../common/auth-context';
import { PrismaService } from '../prisma/prisma.service';
import { type Skin, SkinService } from './skin.service';

/** Sends a skin texture with the same headers as GET /players/:uuid/skin. */
export function sendSkin(res: Response, skin: Skin | null): void {
  if (!skin) throw new NotFoundException({ code: 'SKIN_UNAVAILABLE', message: 'No skin available' });
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader('X-Skin-Model', skin.model);
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.send(skin.png);
}

/**
 * Skins of linked Minecraft accounts, used as dashboard avatars. Always resolved
 * from the stored, verified UUID (never a username), through the server-side
 * skin cache – the browser never contacts a third-party service.
 */
@ApiTags('account')
@Controller()
export class AccountSkinController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly skins: SkinService,
  ) {}

  /** The signed-in user's own avatar – no players.view permission needed. */
  @Get('account/minecraft-link/skin')
  async own(@CurrentUser() user: AuthenticatedUser, @Res() res: Response) {
    sendSkin(res, await this.skinOf(user.id));
  }

  /** Avatar of a dashboard account in User Management. */
  @Get('users/:id/minecraft-link/skin')
  @RequirePermissions(PERMISSIONS.USERS_VIEW)
  async ofUser(@Param('id') id: string, @Res() res: Response) {
    sendSkin(res, await this.skinOf(id));
  }

  private async skinOf(dashboardUserId: string): Promise<Skin | null> {
    if (dashboardUserId.length > 64) return null;
    const link = await this.prisma.linkedMinecraftAccount.findUnique({ where: { dashboardUserId }, select: { minecraftUuid: true } });
    return link ? this.skins.getSkin(link.minecraftUuid) : null;
  }
}
