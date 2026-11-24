/**
 * Canonical permission catalogue. Backend authorization is the source of truth;
 * the dashboard uses these keys only to hide UI it would be refused anyway.
 */
export const PERMISSIONS = {
  PLAYERS_VIEW: 'players.view',
  PLAYERS_VIEW_IP: 'players.view.ip',
  PLAYERS_VIEW_LOCATION: 'players.view.location',
  PLAYERS_VIEW_INVENTORY: 'players.view.inventory',
  PLAYERS_EDIT_INVENTORY: 'players.edit.inventory',
  PLAYERS_VIEW_STATISTICS: 'players.view.statistics',
  PLAYERS_NOTES: 'players.notes',

  PUNISHMENTS_BAN: 'punishments.ban',
  PUNISHMENTS_UNBAN: 'punishments.unban',
  PUNISHMENTS_MUTE: 'punishments.mute',
  PUNISHMENTS_UNMUTE: 'punishments.unmute',
  PUNISHMENTS_KICK: 'punishments.kick',
  PUNISHMENTS_WARN: 'punishments.warn',
  PUNISHMENTS_BLACKLIST: 'punishments.blacklist',
  PUNISHMENTS_HISTORY: 'punishments.history',
  PUNISHMENTS_EDIT: 'punishments.edit',
  PUNISHMENTS_EDIT_REASON: 'punishments.edit.reason',
  PUNISHMENTS_EDIT_DURATION: 'punishments.edit.duration',
  /** Converting between temporary and permanent (elevated). */
  PUNISHMENTS_EDIT_PERMANENT: 'punishments.edit.permanent',
  /** Making an expired or revoked punishment active again (elevated). */
  PUNISHMENTS_REACTIVATE: 'punishments.reactivate',
  PUNISHMENTS_EVIDENCE_VIEW: 'punishments.evidence.view',
  PUNISHMENTS_EVIDENCE_ADD: 'punishments.evidence.add',
  PUNISHMENTS_EVIDENCE_EDIT: 'punishments.evidence.edit',
  PUNISHMENTS_EVIDENCE_DELETE: 'punishments.evidence.delete',
  PUNISHMENTS_HISTORY_VIEW: 'punishments.history.view',

  ANTICHEAT_VIEW: 'anticheat.view',
  ANTICHEAT_MANAGE: 'anticheat.manage',

  SERVERS_VIEW: 'servers.view',
  SERVERS_MANAGE: 'servers.manage',

  DASHBOARD_MANAGE: 'dashboard.manage',
  USERS_VIEW: 'users.view',
  USERS_MANAGE: 'users.manage',
  ROLES_MANAGE: 'roles.manage',
  SETTINGS_MANAGE: 'settings.manage',
  TRANSLATIONS_MANAGE: 'translations.manage',
  AUDIT_VIEW: 'audit.view',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: readonly Permission[] = Object.values(PERMISSIONS);

/** Wildcard granted to the Owner role; matches every permission. */
export const WILDCARD_PERMISSION = '*';

export function isKnownPermission(value: string): value is Permission {
  return (ALL_PERMISSIONS as readonly string[]).includes(value);
}

/**
 * Returns true when the granted set satisfies the required permission.
 * Supports the global wildcard ("*") and namespace wildcards ("players.*").
 */
export function hasPermission(granted: Iterable<string>, required: string): boolean {
  for (const g of granted) {
    if (g === WILDCARD_PERMISSION || g === required) return true;
    if (g.endsWith('.*') && required.startsWith(g.slice(0, -1))) return true;
  }
  return false;
}
