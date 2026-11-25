import { Injectable } from '@nestjs/common';
import { hasPermission } from '@mnm/shared-types';
import type { AuthenticatedUser } from '../common/auth-context';

/** Where a staff member's canonical moderation permissions (nexora.punishment.*) come from. */
export type PermissionSource = 'ROLE' | 'LUCKPERMS';

export interface PermissionCheck {
  source: PermissionSource;
  can: (permission: string) => boolean;
  /** Set when the source cannot be trusted right now (e.g. stale LuckPerms data). */
  blockedReason?: 'STALE_PERMISSIONS' | 'NO_PERMISSION_DATA';
}

/**
 * Extension point for the LuckPerms integration: returns the check for a
 * linked staff account whose Minecraft permissions are authoritative, or
 * null to fall back to the dashboard role.
 */
export interface LinkedPermissionResolver {
  checkFor(user: AuthenticatedUser): Promise<PermissionCheck | null>;
}

/**
 * Effective canonical moderation permissions of a dashboard user. Exactly one
 * source decides – the dashboard role, or (for linked staff with LuckPerms
 * integration enabled) the synchronised LuckPerms permissions. They are never
 * merged, so neither system can widen the other.
 */
@Injectable()
export class StaffPermissionsService {
  private resolver: LinkedPermissionResolver | null = null;

  /** Registered by the LuckPerms integration module. */
  useResolver(resolver: LinkedPermissionResolver): void {
    this.resolver = resolver;
  }

  async forUser(user: AuthenticatedUser): Promise<PermissionCheck> {
    const linked = this.resolver ? await this.resolver.checkFor(user) : null;
    if (linked) return linked;
    return { source: 'ROLE', can: (permission) => hasPermission(user.permissions, permission) };
  }
}
