import { hasPermission, WILDCARD_PERMISSION } from '@mnm/shared-types';
import type { AuthenticatedUser } from '../common/auth-context';

export const OWNER_ROLE_KEY = 'owner';

type Actor = Pick<AuthenticatedUser, 'roleKey' | 'rolePriority' | 'permissions'>;

/** An actor may manage users/roles strictly below their own priority. Owners may manage everything. */
export function canManagePriority(actor: Actor, targetPriority: number): boolean {
  return actor.roleKey === OWNER_ROLE_KEY || actor.rolePriority > targetPriority;
}

/** Prevents privilege escalation: nobody can grant a permission they do not hold themselves. */
export function ungrantablePermissions(actor: Actor, requested: readonly string[]): string[] {
  if (actor.roleKey === OWNER_ROLE_KEY) return [];
  return requested.filter((p) => p === WILDCARD_PERMISSION || p.endsWith('.*') || !hasPermission(actor.permissions, p));
}
