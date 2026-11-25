import { PERMISSIONS as P, WILDCARD_PERMISSION, type Permission } from './permissions';

export const SYSTEM_ROLES = ['owner', 'administrator', 'developer', 'moderator', 'supporter', 'viewer'] as const;
export type SystemRole = (typeof SYSTEM_ROLES)[number];

export interface RoleDefinition {
  key: SystemRole;
  name: string;
  /** Higher priority roles may manage users of lower priority. */
  priority: number;
  permissions: readonly (Permission | typeof WILDCARD_PERMISSION)[];
}

/** Default roles seeded on first start. Administrators may edit all except Owner. */
export const DEFAULT_ROLES: readonly RoleDefinition[] = [
  { key: 'owner', name: 'Owner', priority: 1000, permissions: [WILDCARD_PERMISSION] },
  {
    key: 'administrator',
    name: 'Administrator',
    priority: 900,
    permissions: [
      P.PLAYERS_VIEW, P.PLAYERS_VIEW_IP, P.PLAYERS_VIEW_LOCATION, P.PLAYERS_VIEW_INVENTORY,
      P.PLAYERS_EDIT_INVENTORY, P.PLAYERS_VIEW_STATISTICS, P.PLAYERS_NOTES,
      P.PUNISHMENTS_BAN, P.PUNISHMENTS_UNBAN, P.PUNISHMENTS_MUTE, P.PUNISHMENTS_UNMUTE,
      P.PUNISHMENTS_KICK, P.PUNISHMENTS_WARN, P.PUNISHMENTS_BLACKLIST, P.PUNISHMENTS_HISTORY,
      P.PUNISHMENTS_EDIT, P.PUNISHMENTS_EDIT_REASON, P.PUNISHMENTS_EDIT_DURATION, P.PUNISHMENTS_EDIT_PERMANENT,
      P.PUNISHMENTS_REACTIVATE, P.PUNISHMENTS_EVIDENCE_VIEW, P.PUNISHMENTS_EVIDENCE_ADD, P.PUNISHMENTS_EVIDENCE_EDIT,
      P.PUNISHMENTS_EVIDENCE_DELETE, P.PUNISHMENTS_HISTORY_VIEW,
      P.ANTICHEAT_VIEW, P.ANTICHEAT_MANAGE, P.SERVERS_VIEW, P.SERVERS_MANAGE,
      P.DASHBOARD_MANAGE, P.USERS_VIEW, P.USERS_MANAGE, P.ROLES_MANAGE, P.SETTINGS_MANAGE,
      P.TRANSLATIONS_MANAGE, P.AUDIT_VIEW,
      P.UPDATES_VIEW, P.UPDATES_NOTIFY, P.UPDATES_CHECK,
    ],
  },
  {
    key: 'developer',
    name: 'Developer',
    priority: 700,
    permissions: [
      P.PLAYERS_VIEW, P.PLAYERS_VIEW_STATISTICS, P.ANTICHEAT_VIEW, P.SERVERS_VIEW,
      P.SERVERS_MANAGE, P.AUDIT_VIEW, P.TRANSLATIONS_MANAGE,
    ],
  },
  {
    key: 'moderator',
    name: 'Moderator',
    priority: 500,
    permissions: [
      P.PLAYERS_VIEW, P.PLAYERS_VIEW_STATISTICS, P.PLAYERS_VIEW_INVENTORY, P.PLAYERS_NOTES,
      P.PUNISHMENTS_BAN, P.PUNISHMENTS_UNBAN, P.PUNISHMENTS_MUTE, P.PUNISHMENTS_UNMUTE,
      P.PUNISHMENTS_KICK, P.PUNISHMENTS_WARN, P.PUNISHMENTS_HISTORY, P.ANTICHEAT_VIEW,
      P.PUNISHMENTS_EDIT, P.PUNISHMENTS_EDIT_REASON, P.PUNISHMENTS_EDIT_DURATION,
      P.PUNISHMENTS_EVIDENCE_VIEW, P.PUNISHMENTS_EVIDENCE_ADD, P.PUNISHMENTS_EVIDENCE_EDIT, P.PUNISHMENTS_HISTORY_VIEW,
      P.SERVERS_VIEW,
    ],
  },
  {
    key: 'supporter',
    name: 'Supporter',
    priority: 300,
    permissions: [
      P.PLAYERS_VIEW, P.PLAYERS_VIEW_STATISTICS, P.PLAYERS_NOTES, P.PUNISHMENTS_MUTE,
      P.PUNISHMENTS_KICK, P.PUNISHMENTS_WARN, P.PUNISHMENTS_HISTORY, P.SERVERS_VIEW,
      P.PUNISHMENTS_EVIDENCE_VIEW, P.PUNISHMENTS_EVIDENCE_ADD, P.PUNISHMENTS_HISTORY_VIEW,
    ],
  },
  {
    key: 'viewer',
    name: 'Viewer',
    priority: 100,
    permissions: [P.PLAYERS_VIEW, P.PLAYERS_VIEW_STATISTICS, P.SERVERS_VIEW],
  },
];
