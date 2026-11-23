import { type CanActivate, type ExecutionContext, ForbiddenException, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { hasPermission } from '@mnm/shared-types';
import { type AuthenticatedRequest, IS_PUBLIC_KEY, PERMISSIONS_KEY } from '../common/auth-context';
import { AuthService } from './auth.service';
import { ACCESS_COOKIE, CSRF_HEADER } from './cookies';

export const SKIP_CSRF_KEY = 'mnm:skipCsrf';
/** For machine-to-machine routes (plugins) that never use cookies. */
export const SkipCsrf = () => SetMetadata(SKIP_CSRF_KEY, true);

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Authenticates dashboard sessions (cookie or Bearer token) and enforces the
 * CSRF header on state-changing requests. Public routes still get `req.user`
 * attached when a valid session is present.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const targets = [context.getHandler(), context.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets) ?? false;
    const skipCsrf = this.reflector.getAllAndOverride<boolean>(SKIP_CSRF_KEY, targets) ?? false;

    if (!skipCsrf && !SAFE_METHODS.has(req.method) && req.header(CSRF_HEADER) !== '1') {
      throw new ForbiddenException({ code: 'CSRF_HEADER_MISSING', message: 'Missing CSRF header' });
    }

    const header = req.header('authorization');
    const token = header?.startsWith('Bearer ') ? header.slice(7) : (req.cookies?.[ACCESS_COOKIE] as string | undefined);
    if (token) {
      const user = await this.auth.authenticate(token);
      if (user) req.user = user;
    }
    if (!isPublic && !req.user) {
      throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'Authentication required' });
    }
    return true;
  }
}

/** Enforces @RequirePermissions on the server; frontend checks are cosmetic only. */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndMerge<string[]>(PERMISSIONS_KEY, [context.getHandler(), context.getClass()]) ?? [];
    if (required.length === 0) return true;
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const granted = req.user?.permissions ?? [];
    const missing = required.filter((p) => !hasPermission(granted, p));
    if (missing.length > 0) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: `Missing permission: ${missing.join(', ')}` });
    }
    return true;
  }
}
