import { HEX_COLOR, RANK_DISPLAY_SOURCES } from '@mnm/shared-types';
import { z } from 'zod';

export { iconUrl, RANK_DISPLAY_SOURCES, type RankDisplayConfig, type RankDisplaySource, type RankSnapshot, resolveRank, type ResolvedRank } from '@mnm/shared-types';

/**
 * Rank appearance in the dashboard. Purely visual: nothing here is used for
 * permission decisions (those use the LuckPerms snapshot's permissions).
 */

const hex = z
  .string()
  .trim()
  .regex(HEX_COLOR, 'Must be a #RRGGBB colour')
  .transform((v) => v.toUpperCase());
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null));

export const groupNameSchema = z.string().trim().toLowerCase().min(1).max(64).regex(/^[a-z0-9_\-.]+$/, 'Invalid LuckPerms group name');

export const rankDisplaySchema = z
  .object({
    enabled: z.boolean().default(true),
    displaySource: z.enum(RANK_DISPLAY_SOURCES).default('CUSTOM'),
    displayName: optionalText(64),
    textColor: hex.nullable().optional().transform((v) => v ?? null),
    backgroundColor: hex.nullable().optional().transform((v) => v ?? null),
    bold: z.boolean().default(false),
    iconText: optionalText(16),
    fallbackText: optionalText(64),
    tooltip: optionalText(200),
  })
  .strict()
  .refine((v) => v.displaySource !== 'CUSTOM' || !!v.displayName, { message: 'A custom display needs a display name', path: ['displayName'] });

export type RankDisplayInput = z.infer<typeof rankDisplaySchema>;

// ── icon validation ─────────────────────────────────────────────────

/** Small enough to stay below the default 100 KB JSON body limit when base64-encoded. */
export const MAX_ICON_BYTES = 64 * 1024;

/** Content-sniffed raster type of an uploaded icon; null for anything else (SVG, HTML, scripts …). */
export function sniffIconType(data: Buffer): 'image/png' | 'image/gif' | 'image/webp' | 'image/jpeg' | null {
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (data.length >= 6 && (data.subarray(0, 6).toString('latin1') === 'GIF87a' || data.subarray(0, 6).toString('latin1') === 'GIF89a')) return 'image/gif';
  if (data.length >= 12 && data.subarray(0, 4).toString('latin1') === 'RIFF' && data.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  return null;
}

export const iconUploadSchema = z
  .object({
    /** Base64 (optionally a data: URL). */
    data: z.string().min(8).max(Math.ceil((MAX_ICON_BYTES * 4) / 3) + 64),
  })
  .strict();

export function decodeIcon(data: string): Buffer {
  const base64 = data.replace(/^data:[a-z/+.-]+;base64,/i, '');
  if (!/^[A-Za-z0-9+/=\s]+$/.test(base64)) throw new Error('invalid base64');
  return Buffer.from(base64, 'base64');
}
