import { BadRequestException, Body, Controller, Get, HttpCode, Patch, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { type AuthenticatedUser, clientIp, CurrentUser, Public } from '../common/auth-context';
import { localeSchema, passwordSchema, themeSchema, timezoneSchema } from '../common/validation';
import { ZodBody } from '../common/zod';
import { AppConfig } from '../config/app-config';
import { AuditService, userActor } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import { clearSessionCookies, REFRESH_COOKIE, setSessionCookies } from './cookies';
import { PasswordService } from './password.service';
import { TwoFactorService } from './two-factor.service';

const loginSchema = z.object({
  identifier: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(256),
});

const preferencesSchema = z
  .object({
    locale: localeSchema.nullable().optional(),
    theme: themeSchema.nullable().optional(),
    timezone: timezoneSchema.nullable().optional(),
  })
  .strict();

const secondFactorSchema = z.object({ challenge: z.string().min(32).max(128), code: z.string().trim().min(6).max(16) });
const passwordOnlySchema = z.object({ password: z.string().min(1).max(256) });
const codeOnlySchema = z.object({ code: z.string().trim().regex(/^\d{6}$/) });
const passwordAndCodeSchema = z.object({ password: z.string().min(1).max(256), code: z.string().trim().min(6).max(16) });

const changePasswordSchema = z.object({ currentPassword: z.string().min(1).max(256), newPassword: passwordSchema });

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
    private readonly twoFactor: TwoFactorService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000, blockDuration: 300_000 } })
  @ZodBody(loginSchema)
  async login(@Body() body: z.infer<typeof loginSchema>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.login(body.identifier, body.password, { ip: clientIp(req), userAgent: req.header('user-agent') ?? null });
    if ('challenge' in result) return { twoFactorRequired: true, challenge: result.challenge };
    setSessionCookies(res, req, this.config, result);
    return { ok: true };
  }

  /** Second step for accounts with two-factor authentication (TOTP or recovery code). */
  @Public()
  @Post('login/2fa')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000, blockDuration: 300_000 } })
  @ZodBody(secondFactorSchema)
  async loginSecondFactor(@Body() body: z.infer<typeof secondFactorSchema>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const session = await this.auth.loginWithSecondFactor(body.challenge, body.code, { ip: clientIp(req), userAgent: req.header('user-agent') ?? null });
    setSessionCookies(res, req, this.config, session);
    return { ok: true };
  }

  @Get('me/2fa')
  twoFactorStatus(@CurrentUser() user: AuthenticatedUser) {
    return this.twoFactor.status(user.id);
  }

  @Post('me/2fa/setup')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ZodBody(passwordOnlySchema)
  setupTwoFactor(@CurrentUser() user: AuthenticatedUser, @Body() body: z.infer<typeof passwordOnlySchema>) {
    return this.twoFactor.beginSetup(user.id, body.password);
  }

  @Post('me/2fa/enable')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ZodBody(codeOnlySchema)
  async enableTwoFactor(@CurrentUser() user: AuthenticatedUser, @Body() body: z.infer<typeof codeOnlySchema>, @Req() req: Request) {
    const recoveryCodes = await this.twoFactor.enable(user.id, body.code);
    // Other sessions were created without the second factor: end them.
    await this.auth.revokeOtherSessions(user.id, user.sessionId);
    await this.audit.record({ actor: userActor(user), action: 'auth.2fa_enabled', targetType: 'dashboard_user', targetId: user.id, ipAddress: clientIp(req) });
    return { recoveryCodes };
  }

  @Post('me/2fa/disable')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ZodBody(passwordAndCodeSchema)
  async disableTwoFactor(@CurrentUser() user: AuthenticatedUser, @Body() body: z.infer<typeof passwordAndCodeSchema>, @Req() req: Request) {
    await this.twoFactor.disable(user.id, body.password, body.code);
    await this.audit.record({ actor: userActor(user), action: 'auth.2fa_disabled', targetType: 'dashboard_user', targetId: user.id, ipAddress: clientIp(req) });
    return { ok: true };
  }

  @Post('me/2fa/recovery-codes')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ZodBody(passwordAndCodeSchema)
  async regenerateRecoveryCodes(@CurrentUser() user: AuthenticatedUser, @Body() body: z.infer<typeof passwordAndCodeSchema>, @Req() req: Request) {
    const recoveryCodes = await this.twoFactor.regenerateRecoveryCodes(user.id, body.password, body.code);
    await this.audit.record({ actor: userActor(user), action: 'auth.2fa_recovery_codes_regenerated', targetType: 'dashboard_user', targetId: user.id, ipAddress: clientIp(req) });
    return { recoveryCodes };
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    if (!token) throw new UnauthorizedException({ code: 'SESSION_INVALID', message: 'No session' });
    try {
      const session = await this.auth.refresh(token);
      setSessionCookies(res, req, this.config, session);
      return { ok: true };
    } catch (err) {
      clearSessionCookies(res, req, this.config);
      throw err;
    }
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@CurrentUser() user: AuthenticatedUser, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(user, clientIp(req));
    clearSessionCookies(res, req, this.config);
    return { ok: true };
  }

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    const { sessionId: _sessionId, ...profile } = user;
    return profile;
  }

  @Patch('me')
  @ZodBody(preferencesSchema)
  async updatePreferences(@CurrentUser() user: AuthenticatedUser, @Body() body: z.infer<typeof preferencesSchema>) {
    if (body.locale) {
      const language = await this.prisma.languageSetting.findUnique({ where: { locale: body.locale } });
      if (!language?.enabled) throw new BadRequestException({ code: 'LOCALE_UNAVAILABLE', message: 'Language is not enabled' });
    }
    const updated = await this.prisma.dashboardUser.update({
      where: { id: user.id },
      data: { locale: body.locale, theme: body.theme, timezone: body.timezone },
      select: { locale: true, theme: true, timezone: true },
    });
    return updated;
  }

  @Post('me/password')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ZodBody(changePasswordSchema)
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: z.infer<typeof changePasswordSchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const record = await this.prisma.dashboardUser.findUniqueOrThrow({ where: { id: user.id } });
    if (!(await this.passwords.verify(record.passwordHash, body.currentPassword))) {
      throw new BadRequestException({ code: 'INVALID_PASSWORD', message: 'Current password is incorrect' });
    }
    await this.prisma.dashboardUser.update({ where: { id: user.id }, data: { passwordHash: await this.passwords.hash(body.newPassword) } });
    // Invalidate every other session, then issue a fresh one for this browser.
    await this.auth.revokeAllSessions(user.id);
    const session = await this.auth.issueSession(user.id, { ip: clientIp(req), userAgent: req.header('user-agent') ?? null });
    setSessionCookies(res, req, this.config, session);
    await this.audit.record({ actor: userActor(user), action: 'auth.password_changed', targetType: 'dashboard_user', targetId: user.id, ipAddress: clientIp(req) });
    return { ok: true };
  }
}
