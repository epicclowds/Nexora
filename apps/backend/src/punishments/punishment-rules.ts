import { PERMISSIONS } from '@mnm/shared-types';
import { type Punishment, PunishmentStatus, PunishmentType } from '../generated/prisma/client';

export const BAN_TYPES: readonly PunishmentType[] = [PunishmentType.BAN, PunishmentType.TEMP_BAN, PunishmentType.BLACKLIST];
export const MUTE_TYPES: readonly PunishmentType[] = [PunishmentType.MUTE, PunishmentType.TEMP_MUTE];
/** Types the plugins enforce from their local cache. */
export const ENFORCEABLE_TYPES: readonly PunishmentType[] = [...BAN_TYPES, ...MUTE_TYPES];
export const TEMPORARY_TYPES: readonly PunishmentType[] = [PunishmentType.TEMP_BAN, PunishmentType.TEMP_MUTE];

export const MIN_DURATION_SECONDS = 60;
export const MAX_DURATION_SECONDS = 10 * 365 * 86_400;

/** Permission required to issue each punishment type. */
export const ISSUE_PERMISSION: Record<PunishmentType, string> = {
  BAN: PERMISSIONS.PUNISHMENTS_BAN,
  TEMP_BAN: PERMISSIONS.PUNISHMENTS_BAN,
  MUTE: PERMISSIONS.PUNISHMENTS_MUTE,
  TEMP_MUTE: PERMISSIONS.PUNISHMENTS_MUTE,
  KICK: PERMISSIONS.PUNISHMENTS_KICK,
  WARNING: PERMISSIONS.PUNISHMENTS_WARN,
  BLACKLIST: PERMISSIONS.PUNISHMENTS_BLACKLIST,
};

/** Permission required to revoke each punishment type. */
export const REVOKE_PERMISSION: Record<PunishmentType, string> = {
  BAN: PERMISSIONS.PUNISHMENTS_UNBAN,
  TEMP_BAN: PERMISSIONS.PUNISHMENTS_UNBAN,
  BLACKLIST: PERMISSIONS.PUNISHMENTS_BLACKLIST,
  MUTE: PERMISSIONS.PUNISHMENTS_UNMUTE,
  TEMP_MUTE: PERMISSIONS.PUNISHMENTS_UNMUTE,
  WARNING: PERMISSIONS.PUNISHMENTS_WARN,
  KICK: PERMISSIONS.PUNISHMENTS_KICK,
};

/** Status as of `now`: active temporary punishments past their expiry are EXPIRED. */
export function effectiveStatus(p: Pick<Punishment, 'status' | 'expiresAt'>, now = Date.now()): PunishmentStatus {
  if (p.status === PunishmentStatus.ACTIVE && p.expiresAt && p.expiresAt.getTime() <= now) return PunishmentStatus.EXPIRED;
  return p.status;
}

/** Kicks are instantaneous: they are never "active" afterwards. */
export function isRevocable(p: Pick<Punishment, 'type' | 'status' | 'expiresAt'>, now = Date.now()): boolean {
  return p.type !== PunishmentType.KICK && effectiveStatus(p, now) === PunishmentStatus.ACTIVE;
}

/** Validates the duration for the type and returns the expiry (null = permanent / not applicable). */
export function computeExpiry(type: PunishmentType, durationSeconds: number | undefined, now = new Date()): { ok: true; expiresAt: Date | null } | { ok: false; reason: string } {
  const temporary = TEMPORARY_TYPES.includes(type);
  if (temporary) {
    if (durationSeconds === undefined) return { ok: false, reason: 'A duration is required for temporary punishments' };
    if (durationSeconds < MIN_DURATION_SECONDS || durationSeconds > MAX_DURATION_SECONDS) {
      return { ok: false, reason: `Duration must be between ${MIN_DURATION_SECONDS} seconds and 10 years` };
    }
    return { ok: true, expiresAt: new Date(now.getTime() + durationSeconds * 1000) };
  }
  if (durationSeconds !== undefined) return { ok: false, reason: `${type} does not take a duration` };
  return { ok: true, expiresAt: null };
}
