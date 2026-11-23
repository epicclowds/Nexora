import type { CookieOptions, Request, Response } from 'express';
import type { AppConfig } from '../config/app-config';

export const ACCESS_COOKIE = 'mnm_access';
export const REFRESH_COOKIE = 'mnm_refresh';
/** Mutating requests authenticated by cookie must carry this header (CSRF defence). */
export const CSRF_HEADER = 'x-mnm-csrf';

function baseOptions(config: AppConfig, req: Request): CookieOptions {
  const mode = config.env.COOKIE_SECURE;
  const secure = mode === 'true' || (mode === 'auto' && req.secure);
  return { httpOnly: true, sameSite: 'strict', secure };
}

export function setSessionCookies(
  res: Response,
  req: Request,
  config: AppConfig,
  tokens: { accessToken: string; refreshToken: string; refreshExpiresAt: Date },
): void {
  const base = baseOptions(config, req);
  res.cookie(ACCESS_COOKIE, tokens.accessToken, { ...base, path: '/', maxAge: config.env.ACCESS_TOKEN_TTL_SECONDS * 1000 });
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, { ...base, path: '/api/auth', expires: tokens.refreshExpiresAt });
}

export function clearSessionCookies(res: Response, req: Request, config: AppConfig): void {
  const base = baseOptions(config, req);
  res.clearCookie(ACCESS_COOKIE, { ...base, path: '/' });
  res.clearCookie(REFRESH_COOKIE, { ...base, path: '/api/auth' });
}
