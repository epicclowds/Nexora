export const PUNISHMENT_TYPES = ['BAN', 'TEMP_BAN', 'MUTE', 'TEMP_MUTE', 'KICK', 'WARNING', 'BLACKLIST'] as const;
export type PunishmentType = (typeof PUNISHMENT_TYPES)[number];

export const PUNISHMENT_STATUSES = ['ACTIVE', 'EXPIRED', 'REVOKED'] as const;
export type PunishmentStatus = (typeof PUNISHMENT_STATUSES)[number];

/**
 * Punishment reason presets. A preset is addressed by its category and a
 * numeric reason ID (e.g. ban reason 1) – never to be confused with the
 * unique ID of a punishment record. Ban, mute, kick and warning reasons use
 * separate numeric namespaces.
 */
export const PRESET_CATEGORIES = ['BAN', 'MUTE', 'KICK', 'WARN'] as const;
export type PresetCategory = (typeof PRESET_CATEGORIES)[number];

/**
 * Network-wide command mode (Settings → Moderation):
 *  PRESET_ONLY – only numeric reason IDs; FREE_TEXT – only typed reasons (the
 *  behaviour before presets); HYBRID – both, typed reasons need
 *  nexora.punishment.custom.
 */
export const COMMAND_MODES = ['PRESET_ONLY', 'FREE_TEXT', 'HYBRID'] as const;
export type CommandMode = (typeof COMMAND_MODES)[number];

export const MAX_PRESET_NUMERIC_ID = 9999;

/** Canonical permission of a preset, identical in Minecraft (LuckPerms) and the dashboard. */
export function presetPermission(category: PresetCategory, numericId: number): string {
  return `nexora.punishment.${category.toLowerCase()}.${numericId}`;
}

/** Per-preset permission keys may be granted to dashboard roles in addition to the static catalogue. */
export const PRESET_PERMISSION_PATTERN = /^nexora\.punishment\.(ban|mute|kick|warn)\.\d{1,4}$/;

/**
 * Hybrid mode: a reason consisting of exactly one number is always a preset
 * reference (never free text), so typing an ID cannot bypass preset
 * permissions. Anything else is free text.
 */
export function parseReasonReference(reason: string): number | null {
  const trimmed = reason.trim();
  return /^\d{1,4}$/.test(trimmed) ? Number(trimmed) : null;
}
