/**
 * Minecraft client identification from the brand a client reports
 * (`minecraft:brand` plugin message) and optional client integrations.
 *
 * The brand is self-reported by the client: it is evidence, not a verified
 * identity. A specific client is only named when the evidence says so; the
 * protocol version is never used to guess the client.
 */

export const KNOWN_CLIENTS = {
  vanilla: 'Vanilla',
  fabric: 'Fabric',
  quilt: 'Quilt',
  forge: 'Forge',
  neoforge: 'NeoForge',
  norisk: 'NoRisk Client',
  lunar: 'Lunar Client',
  badlion: 'Badlion Client',
  feather: 'Feather Client',
  labymod: 'LabyMod',
} as const;

export type KnownClient = keyof typeof KNOWN_CLIENTS;

/** How the client was identified. */
export const CLIENT_DETECTION_SOURCES = ['BRAND', 'INTEGRATION'] as const;
export type ClientDetectionSource = (typeof CLIENT_DETECTION_SOURCES)[number];

/**
 * DETECTED: a known client; UNRECOGNIZED: a brand was received but is not a
 * known client; NONE: no brand was received (Unknown).
 */
export type ClientDetectionStatus = 'DETECTED' | 'UNRECOGNIZED' | 'NONE';

/** Brand patterns, most specific first (e.g. NoRisk runs on Fabric, Lunar may mention Forge). */
const BRAND_PATTERNS: Array<[RegExp, KnownClient]> = [
  [/no\s*risk|\bnrc\b/i, 'norisk'],
  [/lunar/i, 'lunar'],
  [/badlion|\bblc\b/i, 'badlion'],
  [/feather/i, 'feather'],
  [/laby/i, 'labymod'],
  [/neoforge/i, 'neoforge'],
  [/\bquilt/i, 'quilt'],
  [/\bfabric/i, 'fabric'],
  [/\bforge\b|\bfml\b|fml,forge/i, 'forge'],
  [/^vanilla$/i, 'vanilla'],
];

/** Known client key for a reported brand, or null when the brand is empty or not recognised. */
export function normalizeClientBrand(raw: string | null | undefined): KnownClient | null {
  const brand = raw?.trim();
  if (!brand) return null;
  for (const [pattern, client] of BRAND_PATTERNS) if (pattern.test(brand)) return client;
  return null;
}

export function clientDetectionStatus(raw: string | null | undefined): ClientDetectionStatus {
  if (!raw?.trim()) return 'NONE';
  return normalizeClientBrand(raw) ? 'DETECTED' : 'UNRECOGNIZED';
}

export function isKnownClient(value: string | null | undefined): value is KnownClient {
  return !!value && Object.prototype.hasOwnProperty.call(KNOWN_CLIENTS, value);
}
