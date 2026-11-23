import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthService } from '../auth/auth.service';
import { setSessionCookies } from '../auth/cookies';
import { clientIp, Public } from '../common/auth-context';
import { ZodBody } from '../common/zod';
import { AppConfig } from '../config/app-config';
import { type InitializeInput, initializeSchema, SetupService } from './setup.service';

@ApiTags('setup')
@Public()
@Controller('setup')
export class SetupController {
  constructor(
    private readonly setup: SetupService,
    private readonly auth: AuthService,
    private readonly config: AppConfig,
  ) {}

  @Get('status')
  status() {
    return this.setup.status();
  }

  /** Creates the Owner and network settings, then signs the Owner in. Works exactly once. */
  @Post('initialize')
  @HttpCode(201)
  @Throttle({ default: { limit: 5, ttl: 60_000, blockDuration: 300_000 } })
  @ZodBody(initializeSchema)
  async initialize(@Body() body: InitializeInput, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { userId } = await this.setup.initialize(body, clientIp(req));
    const session = await this.auth.issueSession(userId, { ip: clientIp(req), userAgent: req.header('user-agent') ?? null });
    setSessionCookies(res, req, this.config, session);
    return { ok: true };
  }
}
