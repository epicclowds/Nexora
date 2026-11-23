import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { PermissionsGuard, SessionGuard } from '../src/auth/guards';
import type { AuthService } from '../src/auth/auth.service';
import type { AuthenticatedUser } from '../src/common/auth-context';

const user: AuthenticatedUser = {
  id: 'u1',
  username: 'alice',
  email: 'alice@example.test',
  roleId: 'r1',
  roleKey: 'moderator',
  rolePriority: 500,
  permissions: ['players.view'],
  sessionId: 's1',
  locale: null,
  theme: null,
  timezone: null,
};

function context(req: Record<string, unknown>, meta: Record<string, unknown> = {}): { ctx: ExecutionContext; reflector: Reflector } {
  const handler = () => undefined;
  const reflector = {
    getAllAndOverride: (key: string) => meta[key],
    getAllAndMerge: (key: string) => meta[key] ?? [],
  } as unknown as Reflector;
  const request = { method: 'GET', cookies: {}, header: (name: string) => (req.headers as Record<string, string> | undefined)?.[name], ...req };
  const ctx = {
    getType: () => 'http',
    getHandler: () => handler,
    getClass: () => Object,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { ctx, reflector };
}

const auth = { authenticate: async (token: string) => (token === 'good' ? user : null) } as unknown as AuthService;

describe('SessionGuard', () => {
  it('rejects unauthenticated requests to protected routes', async () => {
    const { ctx, reflector } = context({});
    await expect(new SessionGuard(reflector, auth).canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('accepts a valid session cookie', async () => {
    const { ctx, reflector } = context({ cookies: { mnm_access: 'good' } });
    await expect(new SessionGuard(reflector, auth).canActivate(ctx)).resolves.toBe(true);
  });

  it('rejects an invalid token', async () => {
    const { ctx, reflector } = context({ headers: { authorization: 'Bearer bad' } });
    await expect(new SessionGuard(reflector, auth).canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('requires the CSRF header on mutating requests', async () => {
    const { ctx, reflector } = context({ method: 'POST', cookies: { mnm_access: 'good' } });
    await expect(new SessionGuard(reflector, auth).canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
    const ok = context({ method: 'POST', cookies: { mnm_access: 'good' }, headers: { 'x-mnm-csrf': '1' } });
    await expect(new SessionGuard(ok.reflector, auth).canActivate(ok.ctx)).resolves.toBe(true);
  });

  it('lets public routes through and skips CSRF for plugin routes', async () => {
    const { ctx, reflector } = context({ method: 'POST' }, { 'mnm:isPublic': true, 'mnm:skipCsrf': true });
    await expect(new SessionGuard(reflector, auth).canActivate(ctx)).resolves.toBe(true);
  });
});

describe('PermissionsGuard', () => {
  it('allows when every required permission is granted', () => {
    const { ctx, reflector } = context({ user }, { 'mnm:permissions': ['players.view'] });
    expect(new PermissionsGuard(reflector).canActivate(ctx)).toBe(true);
  });

  it('denies missing permissions server-side', () => {
    const { ctx, reflector } = context({ user }, { 'mnm:permissions': ['punishments.ban'] });
    expect(() => new PermissionsGuard(reflector).canActivate(ctx)).toThrow(ForbiddenException);
  });
});
