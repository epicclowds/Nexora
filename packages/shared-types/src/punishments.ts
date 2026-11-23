export const PUNISHMENT_TYPES = ['BAN', 'TEMP_BAN', 'MUTE', 'TEMP_MUTE', 'KICK', 'WARNING', 'BLACKLIST'] as const;
export type PunishmentType = (typeof PUNISHMENT_TYPES)[number];

export const PUNISHMENT_STATUSES = ['ACTIVE', 'EXPIRED', 'REVOKED'] as const;
export type PunishmentStatus = (typeof PUNISHMENT_STATUSES)[number];
