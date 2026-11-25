import { type CommandMode, MAX_PRESET_NUMERIC_ID, parseReasonReference, PERMISSIONS, type PresetCategory } from '@mnm/shared-types';
import { z } from 'zod';
import { PunishmentType } from '../generated/prisma/client';
import { MAX_DURATION_SECONDS, MIN_DURATION_SECONDS } from '../punishments/punishment-rules';

/** Pure preset rules shared by the dashboard API and the plugin API (unit-tested). */

export const PERMISSION_PATTERN = /^[a-z0-9][a-z0-9._*-]{2,99}$/;

const presetFields = {
  name: z.string().trim().min(1).max(100),
  reason: z.string().trim().min(1).max(500),
  description: z.string().trim().max(1000).nullable().optional(),
  durationSeconds: z.number().int().min(MIN_DURATION_SECONDS).max(MAX_DURATION_SECONDS).nullable().optional(),
  permanent: z.boolean().default(false),
  /** Empty = the canonical nexora.punishment.<category>.<numericId>. */
  permission: z.string().trim().regex(PERMISSION_PATTERN, 'Lowercase letters, digits, ".", "-" and "_" only').max(100).nullable().optional(),
  enabled: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(100_000).default(0),
};

export const createPresetSchema = z
  .object({
    category: z.enum(['BAN', 'MUTE', 'KICK', 'WARN']),
    numericId: z.number().int().min(1).max(MAX_PRESET_NUMERIC_ID),
    ...presetFields,
  })
  .strict()
  .superRefine(validateDuration);

export const updatePresetSchema = z
  .object({
    version: z.number().int().min(1),
    numericId: z.number().int().min(1).max(MAX_PRESET_NUMERIC_ID).optional(),
    ...presetFields,
  })
  .strict()
  .superRefine((v, ctx) => validateDuration({ ...v, category: undefined }, ctx));

function validateDuration(v: { category?: PresetCategory; durationSeconds?: number | null; permanent: boolean }, ctx: z.RefinementCtx) {
  if (v.category === 'KICK' || v.category === 'WARN') {
    if (v.durationSeconds || v.permanent) ctx.addIssue({ code: 'custom', path: ['durationSeconds'], message: 'Kicks and warnings have no duration' });
    return;
  }
  if (v.permanent && v.durationSeconds) ctx.addIssue({ code: 'custom', path: ['durationSeconds'], message: 'A permanent preset has no duration' });
}

export const commandModeSchema = z.object({ mode: z.enum(['PRESET_ONLY', 'FREE_TEXT', 'HYBRID']) }).strict();

/** Category of a punishment type (BLACKLIST is not preset-based). */
export function categoryOf(type: PunishmentType): PresetCategory | null {
  switch (type) {
    case PunishmentType.BAN:
    case PunishmentType.TEMP_BAN:
      return 'BAN';
    case PunishmentType.MUTE:
    case PunishmentType.TEMP_MUTE:
      return 'MUTE';
    case PunishmentType.KICK:
      return 'KICK';
    case PunishmentType.WARNING:
      return 'WARN';
    default:
      return null;
  }
}

/** Punishment type for a preset with the given (effective) duration. */
export function typeFor(category: PresetCategory, durationSeconds: number | null): PunishmentType {
  switch (category) {
    case 'BAN':
      return durationSeconds === null ? PunishmentType.BAN : PunishmentType.TEMP_BAN;
    case 'MUTE':
      return durationSeconds === null ? PunishmentType.MUTE : PunishmentType.TEMP_MUTE;
    case 'KICK':
      return PunishmentType.KICK;
    case 'WARN':
      return PunishmentType.WARNING;
  }
}

export interface PresetRecord {
  id: string;
  category: PresetCategory;
  numericId: number;
  name: string;
  reason: string;
  durationSeconds: number | null;
  permanent: boolean;
  permission: string;
  enabled: boolean;
  archivedAt: Date | null;
}

export interface ReasonRequest {
  /** Requested type (for presets only the category matters; free text uses it as is). */
  type: PunishmentType;
  /** Explicit reason ID (dashboard / plugin preset selection). */
  presetNumericId?: number;
  /** Typed reason; a single number is a reason ID in preset/hybrid mode. */
  reason?: string;
  /** Override: seconds, null = permanent, undefined = the preset's duration. */
  durationSeconds?: number | null;
}

export type ReasonErrorCode =
  | 'PRESETS_DISABLED'
  | 'PRESET_REQUIRED'
  | 'UNKNOWN_PRESET'
  | 'PRESET_DISABLED'
  | 'PRESET_FORBIDDEN'
  | 'CUSTOM_REASON_FORBIDDEN'
  | 'DURATION_OVERRIDE_FORBIDDEN'
  | 'PERMANENT_FORBIDDEN'
  | 'REASON_REQUIRED';

export type ResolvedReason =
  | { ok: true; type: PunishmentType; reason: string; durationSeconds: number | undefined; preset: PresetRecord | null }
  | { ok: false; code: ReasonErrorCode; numericId?: number };

/**
 * Applies the global command mode and the canonical permissions to one
 * punishment request. `can` answers for the acting staff member (dashboard
 * role / LuckPerms snapshot, or the in-game permission check reported by the
 * plugin). BLACKLIST entries are always typed reasons and not mode-restricted.
 */
export function resolveReason(mode: CommandMode, request: ReasonRequest, findPreset: (category: PresetCategory, numericId: number) => PresetRecord | null, can: (permission: string) => boolean): ResolvedReason {
  const category = categoryOf(request.type);
  const typed = request.reason?.trim() ?? '';
  const reference = request.presetNumericId ?? (mode !== 'FREE_TEXT' && category ? parseReasonReference(typed) : null);

  if (reference !== null && reference !== undefined && category) {
    if (mode === 'FREE_TEXT') return { ok: false, code: 'PRESETS_DISABLED' };
    const preset = findPreset(category, reference);
    if (!preset || preset.archivedAt) return { ok: false, code: 'UNKNOWN_PRESET', numericId: reference };
    if (!preset.enabled) return { ok: false, code: 'PRESET_DISABLED', numericId: reference };
    if (!can(preset.permission)) return { ok: false, code: 'PRESET_FORBIDDEN', numericId: reference };
    const timed = category === 'BAN' || category === 'MUTE';
    const presetDuration = preset.permanent ? null : preset.durationSeconds;
    let duration: number | null = timed ? presetDuration : null;
    if (timed && request.durationSeconds !== undefined && request.durationSeconds !== presetDuration) {
      if (!can(PERMISSIONS.NEXORA_PUNISHMENT_DURATION_OVERRIDE)) return { ok: false, code: 'DURATION_OVERRIDE_FORBIDDEN', numericId: reference };
      if (request.durationSeconds === null && !can(PERMISSIONS.NEXORA_PUNISHMENT_PERMANENT)) return { ok: false, code: 'PERMANENT_FORBIDDEN', numericId: reference };
      duration = request.durationSeconds;
    }
    return { ok: true, type: typeFor(category, duration), reason: preset.reason, durationSeconds: duration ?? undefined, preset };
  }

  if (!typed) return { ok: false, code: 'REASON_REQUIRED' };
  if (category) {
    if (mode === 'PRESET_ONLY') return { ok: false, code: 'PRESET_REQUIRED' };
    if (mode === 'HYBRID' && !can(PERMISSIONS.NEXORA_PUNISHMENT_CUSTOM)) return { ok: false, code: 'CUSTOM_REASON_FORBIDDEN' };
  }
  return { ok: true, type: request.type, reason: typed, durationSeconds: request.durationSeconds ?? undefined, preset: null };
}
