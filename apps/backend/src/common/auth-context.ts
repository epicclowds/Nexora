import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';

export interface AuthenticatedUser {
  id: string;
  username: string;
  email: string;
  roleId: string;
  roleKey: string;
  rolePriority: number;
  permissions: string[];
  sessionId: string;
  locale: string | null;
  theme: string | null;
  timezone: string | null;
}

export type AuthenticatedRequest = Request & { user?: AuthenticatedUser };

export const IS_PUBLIC_KEY = 'mnm:isPublic';
export const PERMISSIONS_KEY = 'mnm:permissions';

/** Marks a route as reachable without a dashboard session. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** All listed permissions are required (checked server-side by PermissionsGuard). */
export const RequirePermissions = (...permissions: string[]) => SetMetadata(PERMISSIONS_KEY, permissions);

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
  const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
  if (!req.user) throw new Error('CurrentUser used on a public route');
  return req.user;
});

/** Client IP as resolved by Express (honours the configured trust proxy). */
export function clientIp(req: Request): string | null {
  return req.ip ?? null;
}
