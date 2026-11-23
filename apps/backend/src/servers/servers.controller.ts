import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PERMISSIONS } from '@mnm/shared-types';
import type { Request } from 'express';
import { z } from 'zod';
import { SkipCsrf } from '../auth/guards';
import { type AuthenticatedUser, clientIp, CurrentUser, Public, RequirePermissions } from '../common/auth-context';
import { ZodBody } from '../common/zod';
import { userActor } from '../audit/audit.service';
import { ServerType } from '../generated/prisma/client';
import { ServersService } from './servers.service';

const createTokenSchema = z.object({
  type: z.enum([ServerType.VELOCITY, ServerType.PAPER]),
  name: z.string().trim().min(2).max(64).regex(/^[A-Za-z0-9_.-]+$/, 'Only letters, digits, "_", "." and "-" are allowed'),
});

const registerSchema = z.object({
  token: z.string().min(16).max(128),
  pluginVersion: z.string().trim().min(1).max(32),
  platformVersion: z.string().trim().max(128).optional(),
  minecraftVersion: z.string().trim().max(32).optional(),
});

@ApiTags('servers')
@Controller('servers')
export class ServersController {
  constructor(private readonly servers: ServersService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.SERVERS_VIEW)
  list() {
    return this.servers.list();
  }

  @Get('registration-tokens')
  @RequirePermissions(PERMISSIONS.SERVERS_MANAGE)
  pendingTokens() {
    return this.servers.listPendingTokens();
  }

  @Post('registration-tokens')
  @RequirePermissions(PERMISSIONS.SERVERS_MANAGE)
  @ZodBody(createTokenSchema)
  createToken(@CurrentUser() actor: AuthenticatedUser, @Body() body: z.infer<typeof createTokenSchema>, @Req() req: Request) {
    return this.servers.createRegistrationToken(body.type, body.name, userActor(actor), clientIp(req));
  }

  @Delete('registration-tokens/:id')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.SERVERS_MANAGE)
  async revokeToken(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string, @Req() req: Request) {
    await this.servers.revokeToken(id, userActor(actor), clientIp(req));
    return { ok: true };
  }
}

/** Machine-to-machine endpoints used by the Velocity/Paper plugins. */
@ApiTags('plugin')
@Public()
@SkipCsrf()
@Controller('plugin/v1')
export class PluginRegistrationController {
  constructor(private readonly servers: ServersService) {}

  @Post('register')
  @HttpCode(201)
  @Throttle({ default: { limit: 10, ttl: 60_000, blockDuration: 600_000 } })
  @ZodBody(registerSchema)
  register(@Body() body: z.infer<typeof registerSchema>, @Req() req: Request) {
    return this.servers.register(body, clientIp(req));
  }
}
