import { z } from 'zod';

/** Pure LuckPerms integration rules (unit-tested). */

export const LUCKPERMS_MODES = ['DISABLED', 'HYBRID', 'MANAGED'] as const;
export type LuckPermsMode = (typeof LUCKPERMS_MODES)[number];

/**
 * DISABLED – only Nexora's roles. HYBRID – dashboard roles stay as assigned,
 * but linked staff use their synchronised LuckPerms permissions for the
 * canonical nexora.punishment.* checks. MANAGED – additionally, accounts
 * created through account linking get their role from the group mapping and
 * lose dashboard access when no eligible group remains.
 */
export const luckPermsSettingsSchema = z
  .object({
    mode: z.enum(LUCKPERMS_MODES).default('DISABLED'),
    /** Synchronised permissions older than this are not trusted for sensitive actions. */
    staleAfterMinutes: z.number().int().min(5).max(1440).default(30),
    linking: z
      .object({
        /** /nexora link may be used to link Minecraft accounts. */
        enabled: z.boolean().default(true),
        /** Eligible staff may create a dashboard account with a link code (needs a group mapping). */
        allowRegistration: z.boolean().default(false),
      })
      .strict()
      .default({ enabled: true, allowRegistration: false }),
  })
  .strict();
export type LuckPermsSettings = z.infer<typeof luckPermsSettingsSchema>;

export const mappingSchema = z
  .object({
    groupName: z.string().trim().toLowerCase().regex(/^[a-z0-9_.-]{1,64}$/, 'LuckPerms group names: lowercase letters, digits, "_", "." and "-"'),
    roleId: z.string().max(32).nullable().default(null),
    dashboardAccess: z.boolean().default(true),
    deny: z.boolean().default(false),
    priority: z.number().int().min(0).max(1000).default(0),
  })
  .strict();

export const snapshotSchema = z
  .object({
    uuid: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
    username: z.string().max(16).nullable().optional(),
    primaryGroup: z.string().max(64).nullable().optional(),
    groupDisplay: z.string().max(64).nullable().optional(),
    groups: z.array(z.string().max(64)).max(100),
    prefix: z.string().max(255).nullable().optional(),
    suffix: z.string().max(255).nullable().optional(),
    weight: z.number().int().nullable().optional(),
    /** Canonical permission → true/false as evaluated by LuckPerms (undefined permissions omitted). */
    permissions: z.record(z.string().max(100), z.boolean()),
    /** Earliest expiry of a temporary group/permission, epoch millis. */
    expiresAt: z.number().int().positive().nullable().optional(),
  })
  .strict();
export type Snapshot = z.infer<typeof snapshotSchema>;

export const syncSchema = z
  .object({
    luckPermsVersion: z.string().max(64).nullable().optional(),
    snapshots: z.array(snapshotSchema).max(200),
    /** True for a full periodic reconciliation (all linked staff and online players). */
    full: z.boolean().default(false),
  })
  .strict();

export interface MappingRecord {
  groupName: string;
  roleId: string | null;
  dashboardAccess: boolean;
  deny: boolean;
  priority: number;
}

export interface RoleRecord {
  id: string;
  key: string;
  priority: number;
}

export type RoleResolution = { access: true; roleId: string; group: string } | { access: false; reason: 'DENIED_GROUP' | 'NO_ELIGIBLE_GROUP'; group?: string };

/**
 * Dashboard role of a LuckPerms-managed account from its (inherited) groups:
 * any group mapped with deny → no access; otherwise the eligible mapping with
 * the highest priority (then the higher role) wins. The protected Owner role
 * can never be granted through a mapping.
 */
export function resolveRole(groups: readonly string[], mappings: readonly MappingRecord[], roles: readonly RoleRecord[]): RoleResolution {
  const held = new Set(groups.map((g) => g.toLowerCase()));
  const applicable = mappings.filter((m) => held.has(m.groupName.toLowerCase()));
  const denied = applicable.find((m) => m.deny);
  if (denied) return { access: false, reason: 'DENIED_GROUP', group: denied.groupName };
  const byId = new Map(roles.map((r) => [r.id, r]));
  const eligible = applicable
    .filter((m) => m.dashboardAccess && m.roleId && byId.has(m.roleId) && byId.get(m.roleId)!.key !== 'owner')
    .sort((a, b) => b.priority - a.priority || byId.get(b.roleId!)!.priority - byId.get(a.roleId!)!.priority);
  if (!eligible.length) return { access: false, reason: 'NO_ELIGIBLE_GROUP' };
  return { access: true, roleId: eligible[0].roleId!, group: eligible[0].groupName };
}

export type Freshness = 'FRESH' | 'STALE' | 'EXPIRED';

/** Whether a snapshot may still be trusted for authorisation decisions. */
export function freshness(snapshot: { synchronizedAt: Date; expiresAt: Date | null }, staleAfterMinutes: number, now = new Date()): Freshness {
  if (snapshot.expiresAt && snapshot.expiresAt.getTime() <= now.getTime()) return 'EXPIRED';
  if (now.getTime() - snapshot.synchronizedAt.getTime() > staleAfterMinutes * 60_000) return 'STALE';
  return 'FRESH';
}

/**
 * Display form of a LuckPerms prefix: plain text plus the first colour.
 * Legacy codes (&a, §a, &#RRGGBB) and MiniMessage tags are removed, so the
 * dashboard never renders untrusted markup.
 */
const LEGACY_COLORS: Record<string, string> = {
  '0': '#000000', '1': '#0000AA', '2': '#00AA00', '3': '#00AAAA', '4': '#AA0000', '5': '#AA00AA', '6': '#FFAA00', '7': '#AAAAAA',
  '8': '#555555', '9': '#5555FF', a: '#55FF55', b: '#55FFFF', c: '#FF5555', d: '#FF55FF', e: '#FFFF55', f: '#FFFFFF',
};
const NAMED_COLORS: Record<string, string> = {
  black: '#000000', dark_blue: '#0000AA', dark_green: '#00AA00', dark_aqua: '#00AAAA', dark_red: '#AA0000', dark_purple: '#AA00AA', gold: '#FFAA00',
  gray: '#AAAAAA', dark_gray: '#555555', blue: '#5555FF', green: '#55FF55', aqua: '#55FFFF', red: '#FF5555', light_purple: '#FF55FF', yellow: '#FFFF55', white: '#FFFFFF',
};

export function parsePrefix(raw: string | null | undefined): { text: string; color: string | null } | null {
  if (!raw) return null;
  let color: string | null = null;
  const firstHex = /(?:[&§]#|<#|<color:#)([0-9a-fA-F]{6})/.exec(raw);
  const firstLegacy = /[&§]([0-9a-fA-F])/.exec(raw);
  const firstNamed = /<(?:color:)?([a-z_]+)>/.exec(raw);
  const candidates: Array<[number, string]> = [];
  if (firstHex) candidates.push([firstHex.index, `#${firstHex[1].toUpperCase()}`]);
  if (firstLegacy) candidates.push([firstLegacy.index, LEGACY_COLORS[firstLegacy[1].toLowerCase()]]);
  if (firstNamed && NAMED_COLORS[firstNamed[1]]) candidates.push([firstNamed.index, NAMED_COLORS[firstNamed[1]]]);
  if (candidates.length) color = candidates.sort((a, b) => a[0] - b[0])[0][1];
  const text = raw
    .replace(/[&§]x(?:[&§][0-9a-fA-F]){6}/g, '')
    .replace(/[&§]#[0-9a-fA-F]{6}/g, '')
    .replace(/[&§][0-9a-fk-orA-FK-OR]/g, '')
    .replace(/<[^<>]{1,64}>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64);
  return text ? { text, color } : null;
}
