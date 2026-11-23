/** Thin client for the backend API, reached through the same-origin /api proxy. */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly issues?: { path: string; message: string }[],
  ) {
    super(message);
  }
}

let refreshing: Promise<boolean> | null = null;

/** Single-flight refresh so parallel 401s trigger only one token rotation. */
async function refreshSession(): Promise<boolean> {
  refreshing ??= fetch('/api/auth/refresh', { method: 'POST', headers: { 'x-mnm-csrf': '1' }, credentials: 'same-origin' })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => {
      setTimeout(() => (refreshing = null), 0);
    });
  return refreshing;
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}, retry = true): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: init.method ?? 'GET',
      headers: { 'content-type': 'application/json', 'x-mnm-csrf': '1' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Network error');
  }

  if (res.status === 401 && retry && !path.startsWith('/auth/login') && !path.startsWith('/auth/refresh')) {
    if (await refreshSession()) return api<T>(path, init, false);
  }

  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    const body = (data ?? {}) as { code?: string; message?: string; issues?: { path: string; message: string }[] };
    throw new ApiError(res.status, body.code ?? 'ERROR', body.message ?? res.statusText, body.issues);
  }
  return data as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Maps an error to a translation key in the `errors` namespace. */
export function errorKey(err: unknown): 'generic' | 'network' | 'forbidden' | 'notFound' | 'validation' | 'conflict' {
  if (!(err instanceof ApiError)) return 'generic';
  if (err.status === 0 || err.status === 502) return 'network';
  if (err.status === 403) return 'forbidden';
  if (err.status === 404) return 'notFound';
  if (err.status === 400) return 'validation';
  if (err.status === 409) return 'conflict';
  return 'generic';
}

// ── Response types ──────────────────────────────────────────────

export interface Me {
  id: string;
  username: string;
  email: string;
  roleId: string;
  roleKey: string;
  rolePriority: number;
  permissions: string[];
  locale: string | null;
  theme: 'dark' | 'light' | 'system' | null;
  timezone: string | null;
}

export interface SetupStatus {
  initialized: boolean;
  version: string;
  networkName: string | null;
  database: { connected: boolean; version: string | null; migrationsApplied: number | null; pendingMigrations: boolean | null };
  redis: { connected: boolean };
}

export interface Language {
  locale: string;
  name: string;
  nativeName: string;
  enabled: boolean;
  isDefault: boolean;
  bundled?: boolean;
  customized?: boolean;
  customUpdatedAt?: string | null;
  missingKeys?: number | null;
}

export interface ServerInfo {
  id: string;
  name: string;
  type: 'VELOCITY' | 'PAPER';
  status: 'PENDING' | 'ONLINE' | 'OFFLINE' | 'DISABLED';
  enabled: boolean;
  minecraftVersion: string | null;
  pluginVersion: string | null;
  platformVersion: string | null;
  onlinePlayers: number | null;
  maxPlayers: number | null;
  tps: number | null;
  mspt: number | null;
  memoryUsedBytes: string | null;
  memoryMaxBytes: string | null;
  cpuLoad: number | null;
  lastHeartbeatAt: string | null;
  createdAt: string;
}

export interface AuditEntry {
  id: string;
  actorType: string;
  actorUserId: string | null;
  actorName: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: unknown;
  createdAt: string;
}

export interface Page<T> {
  total: number;
  page: number;
  pageSize: number;
  items: T[];
}

export interface DashboardSummary {
  generatedAt: string;
  timezone: string;
  onlinePlayers: number;
  totalPlayers: number;
  newPlayersToday: number;
  connectionsToday: number;
  playerRecord: { count: number; at: string } | null;
  activeBans: number;
  activeMutes: number;
  anticheatToday: number;
  servers: ServerInfo[] | null;
  recentActivity: AuditEntry[] | null;
}

export interface RegistrationTokenResult {
  id: string;
  token: string;
  serverType: 'VELOCITY' | 'PAPER';
  serverName: string;
  expiresAt: string;
}

export interface RegistrationStatus {
  id: string;
  serverType: 'VELOCITY' | 'PAPER';
  serverName: string;
  expiresAt: string;
  usedAt: string | null;
  status: 'PENDING' | 'REGISTERED' | 'EXPIRED';
  server: { id: string; name: string; status: ServerInfo['status']; lastHeartbeatAt: string | null; pluginVersion: string | null; minecraftVersion: string | null } | null;
}

export interface ManagedPluginSettings {
  language: string | null;
  statisticsEnabled: boolean | null;
  statisticsCategories: string[] | null;
  statisticsIntervalSeconds: number | null;
  inventorySync: boolean | null;
  enderChestSync: boolean | null;
  inventorySyncIntervalSeconds: number | null;
  messages: Record<string, Record<string, string>>;
}

export interface StoredPluginSettings {
  revision: number;
  settings: ManagedPluginSettings;
  updatedAt: string | null;
}

export interface ModerationPreset {
  id: string;
  name: string;
  type: PunishmentType;
  reason: string;
  durationSeconds: number | null;
}

export interface PlayerListItem {
  uuid: string;
  username: string;
  online: boolean;
  currentServer: { id: string; name: string } | null;
  firstSeenAt: string;
  lastSeenAt: string;
  totalPlaytimeSeconds: number;
  connectionCount: number;
}

export interface PlayerSessionInfo {
  id: string;
  proxy: { id: string; name: string } | null;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  servers: { server: { id: string; name: string }; joinedAt: string; leftAt: string | null }[];
  connection: { clientProtocol: number | null; clientBrand: string | null; ipAddress?: string | null; virtualHost?: string | null } | null;
}

export interface PlayerProfile extends PlayerListItem {
  gamemode: string | null;
  clientVersion: string | null;
  clientProtocol: number | null;
  clientBrand: string | null;
  rank: string | null;
  skinModel: string | null;
  activePlaytimeSeconds: number | null;
  afkSeconds: number | null;
  names: { username: string; firstSeenAt: string; lastSeenAt: string }[];
  canViewConnectionData: boolean;
  sessions: PlayerSessionInfo[];
}

export interface ServerDetail extends ServerInfo {
  connectedPlayers: number;
  openProxySessions: number;
  credentials: { id: string; keyId: string; createdAt: string; lastUsedAt: string | null; revokedAt: string | null }[];
}

export interface RotatedCredentials {
  serverId: string;
  serverName: string;
  keyId: string;
  secret: string;
}

export type PunishmentType = 'BAN' | 'TEMP_BAN' | 'MUTE' | 'TEMP_MUTE' | 'KICK' | 'WARNING' | 'BLACKLIST';
export type PunishmentStatus = 'ACTIVE' | 'EXPIRED' | 'REVOKED';

export interface Punishment {
  id: string;
  type: PunishmentType;
  status: PunishmentStatus;
  revocable: boolean;
  reason: string;
  source: 'COMMAND' | 'DASHBOARD' | 'ANTICHEAT' | 'API' | 'CONSOLE';
  target: { uuid: string; username: string; online: boolean };
  issuer: { type: string; name: string; uuid: string | null; userId: string | null };
  server: { id: string; name: string } | null;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
  revokedReason: string | null;
}

export interface PlayerPunishments extends Page<Punishment> {
  active: { ban: Punishment | null; mute: Punishment | null };
}

export interface PlayerNote {
  id: string;
  content: string;
  author: { id: string; username: string } | null;
  createdAt: string;
}
