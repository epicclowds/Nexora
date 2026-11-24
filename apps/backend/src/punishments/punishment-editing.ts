import { PERMISSIONS } from '@mnm/shared-types';
import { z } from 'zod';
import { type Punishment, PunishmentHistoryAction, PunishmentStatus, PunishmentType } from '../generated/prisma/client';
import { effectiveStatus, MAX_DURATION_SECONDS, MIN_DURATION_SECONDS } from './punishment-rules';

/**
 * Pure rules for editing punishments. Durations are measured from the original
 * creation time: "30 days" means createdAt + 30 days, independent of when the
 * edit happens. All timestamps are UTC.
 */

/** Types whose expiry can be edited (temporary ↔ permanent switches the type). */
export const DURATION_EDITABLE: readonly PunishmentType[] = [PunishmentType.BAN, PunishmentType.TEMP_BAN, PunishmentType.MUTE, PunishmentType.TEMP_MUTE];
const PERMANENT_OF: Partial<Record<PunishmentType, PunishmentType>> = { TEMP_BAN: PunishmentType.BAN, TEMP_MUTE: PunishmentType.MUTE };
const TEMPORARY_OF: Partial<Record<PunishmentType, PunishmentType>> = { BAN: PunishmentType.TEMP_BAN, MUTE: PunishmentType.TEMP_MUTE };

export interface EditInput {
  reason?: string;
  /** undefined = unchanged, null = permanent. */
  expiresAt?: Date | null;
  /** undefined = unchanged, null or "" = remove. */
  staffNote?: string | null;
}

export interface HistoryEntry {
  action: PunishmentHistoryAction;
  previousValues: Record<string, unknown>;
  newValues: Record<string, unknown>;
}

export type EditPlan =
  | {
      ok: true;
      data: { reason?: string; expiresAt?: Date | null; type?: PunishmentType; staffNote?: string | null };
      history: HistoryEntry[];
      /** Permissions the editor needs for exactly these changes. */
      permissions: string[];
      /** Whether connected plugins must refresh the cached punishment (reason/expiry/type). */
      notifyPlugins: boolean;
    }
  | { ok: false; code: 'NO_CHANGES' | 'NOT_ACTIVE' | 'DURATION_NOT_EDITABLE' | 'DURATION_ALREADY_ELAPSED' | 'INVALID_DURATION'; message: string };

type Current = Pick<Punishment, 'type' | 'status' | 'reason' | 'expiresAt' | 'createdAt' | 'staffNote'>;

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/** Expiry for a total duration counted from the creation time (null = permanent). */
export function expiryFromCreation(createdAt: Date, durationSeconds: number | null): Date | null {
  return durationSeconds === null ? null : new Date(createdAt.getTime() + durationSeconds * 1000);
}

/** Validates a new expiry for a punishment that stays active. */
export function checkExpiry(createdAt: Date, expiresAt: Date | null, now: Date): EditPlan | null {
  if (expiresAt === null) return null;
  const total = (expiresAt.getTime() - createdAt.getTime()) / 1000;
  if (total < MIN_DURATION_SECONDS || total > MAX_DURATION_SECONDS) {
    return { ok: false, code: 'INVALID_DURATION', message: `The total duration must be between ${MIN_DURATION_SECONDS} seconds and 10 years from the creation time` };
  }
  if (expiresAt.getTime() <= now.getTime()) {
    return { ok: false, code: 'DURATION_ALREADY_ELAPSED', message: 'This duration has already elapsed since the punishment was created; revoke the punishment instead' };
  }
  return null;
}

export function planEdit(current: Current, input: EditInput, now = new Date()): EditPlan {
  const data: Extract<EditPlan, { ok: true }>['data'] = {};
  const history: HistoryEntry[] = [];
  const permissions = new Set<string>([PERMISSIONS.PUNISHMENTS_EDIT]);
  let notifyPlugins = false;

  const reason = input.reason?.trim();
  if (reason !== undefined && reason !== current.reason) {
    data.reason = reason;
    history.push({ action: PunishmentHistoryAction.REASON_CHANGED, previousValues: { reason: current.reason }, newValues: { reason } });
    permissions.add(PERMISSIONS.PUNISHMENTS_EDIT_REASON);
    notifyPlugins = true;
  }

  if (input.expiresAt !== undefined && iso(input.expiresAt) !== iso(current.expiresAt)) {
    if (!DURATION_EDITABLE.includes(current.type)) {
      return { ok: false, code: 'DURATION_NOT_EDITABLE', message: `The duration of a ${current.type} cannot be changed` };
    }
    // Changing the duration of an expired or revoked punishment would silently reactivate it.
    if (effectiveStatus(current, now.getTime()) !== PunishmentStatus.ACTIVE) {
      return { ok: false, code: 'NOT_ACTIVE', message: 'Only active punishments can change their duration; use reactivation for expired or revoked ones' };
    }
    const invalid = checkExpiry(current.createdAt, input.expiresAt, now);
    if (invalid) return invalid;

    const previous = { type: current.type, expiresAt: iso(current.expiresAt) };
    if (input.expiresAt === null) {
      data.type = PERMANENT_OF[current.type] ?? current.type;
      history.push({ action: PunishmentHistoryAction.MADE_PERMANENT, previousValues: previous, newValues: { type: data.type, expiresAt: null } });
      permissions.add(PERMISSIONS.PUNISHMENTS_EDIT_PERMANENT);
    } else if (current.expiresAt === null) {
      data.type = TEMPORARY_OF[current.type] ?? current.type;
      history.push({ action: PunishmentHistoryAction.MADE_TEMPORARY, previousValues: previous, newValues: { type: data.type, expiresAt: iso(input.expiresAt) } });
      permissions.add(PERMISSIONS.PUNISHMENTS_EDIT_PERMANENT);
    } else {
      const extended = input.expiresAt.getTime() > current.expiresAt.getTime();
      history.push({
        action: extended ? PunishmentHistoryAction.DURATION_EXTENDED : PunishmentHistoryAction.DURATION_SHORTENED,
        previousValues: previous,
        newValues: { type: current.type, expiresAt: iso(input.expiresAt) },
      });
    }
    data.expiresAt = input.expiresAt;
    permissions.add(PERMISSIONS.PUNISHMENTS_EDIT_DURATION);
    notifyPlugins = true;
  }

  if (input.staffNote !== undefined) {
    const note = input.staffNote?.trim() || null;
    if (note !== (current.staffNote ?? null)) {
      data.staffNote = note;
      history.push({ action: PunishmentHistoryAction.NOTE_CHANGED, previousValues: { staffNote: current.staffNote ?? null }, newValues: { staffNote: note } });
    }
  }

  if (history.length === 0) return { ok: false, code: 'NO_CHANGES', message: 'Nothing was changed' };
  return { ok: true, data, history, permissions: [...permissions], notifyPlugins };
}

// ── Evidence ──────────────────────────────────────────────────────

export const EVIDENCE_TYPES = ['VIDEO', 'SCREENSHOT', 'IMAGE', 'LINK', 'TEXT', 'NOTE'] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];
/** Types that are a link to external content (URL required). */
export const LINK_TYPES: readonly EvidenceType[] = ['VIDEO', 'SCREENSHOT', 'IMAGE', 'LINK'];
export const MAX_EVIDENCE_DESCRIPTION = 10_000;

/**
 * Evidence URLs are untrusted input: only absolute https:// URLs with a host,
 * without embedded credentials or whitespace. They are never fetched by the
 * server (no SSRF surface) and rendered as plain links by the dashboard.
 */
export function evidenceUrlProblem(raw: string): string | null {
  if (raw.length > 2048) return 'URL is too long';
  if ([...raw].some((c) => /\s/.test(c) || c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f)) return 'URL must not contain whitespace or control characters';
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'Not a valid absolute URL';
  }
  if (url.protocol !== 'https:') return 'Only https:// links are allowed';
  if (!url.hostname || !url.hostname.includes('.')) return 'URL must contain a public host name';
  if (url.username || url.password) return 'URLs with embedded credentials are not allowed';
  return null;
}

const urlSchema = z
  .string()
  .trim()
  .superRefine((value, ctx) => {
    const problem = evidenceUrlProblem(value);
    if (problem) ctx.addIssue({ code: 'custom', message: problem });
  })
  .transform((value) => new URL(value).href);

const evidenceFields = {
  title: z.string().trim().min(1).max(200),
  url: urlSchema.nullable(),
  description: z.string().max(MAX_EVIDENCE_DESCRIPTION).nullable(),
  visibility: z.enum(['STAFF', 'PUBLIC']),
};

/** Consistency rules shared by create and update (after merging with the stored values). */
export function evidenceConsistency(e: { type: string; url: string | null; description: string | null; visibility: string }): string | null {
  const linkType = (LINK_TYPES as readonly string[]).includes(e.type);
  if (linkType && !e.url) return 'This evidence type needs a URL';
  if (!linkType && e.url) return 'This evidence type does not take a URL';
  if (!linkType && !e.description?.trim()) return 'A description is required';
  if (e.type === 'NOTE' && e.visibility !== 'STAFF') return 'Internal notes are always staff-only';
  return null;
}

export const createEvidenceSchema = z
  .object({
    type: z.enum(EVIDENCE_TYPES),
    title: evidenceFields.title,
    url: evidenceFields.url.optional().default(null),
    description: evidenceFields.description.optional().default(null),
    visibility: evidenceFields.visibility.default('STAFF'),
  })
  .strict()
  .superRefine((e, ctx) => {
    const problem = evidenceConsistency(e);
    if (problem) ctx.addIssue({ code: 'custom', message: problem, path: ['url'] });
  });

export const updateEvidenceSchema = z
  .object({
    version: z.number().int().min(1),
    title: evidenceFields.title.optional(),
    url: evidenceFields.url.optional(),
    description: evidenceFields.description.optional(),
    visibility: evidenceFields.visibility.optional(),
  })
  .strict();
