/**
 * Minecraft skin texture handling. Only textures hosted on Mojang's texture
 * server are ever fetched by the backend (prevents server-side request forgery
 * through crafted profile properties).
 */
const TEXTURE_URL = /^https?:\/\/textures\.minecraft\.net\/texture\/([0-9a-f]{16,128})$/;

export interface SkinTexture {
  url: string;
  model: 'classic' | 'slim';
}

/** Normalises a texture URL to https, or returns null when it is not an allowed Mojang texture. */
export function normalizeTextureUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = TEXTURE_URL.exec(value.trim());
  return match ? `https://textures.minecraft.net/texture/${match[1]}` : null;
}

/** Parses the base64 "textures" game-profile property. Returns null for missing/invalid data. */
export function parseTexturesProperty(base64: string | undefined | null): SkinTexture | null {
  if (!base64 || base64.length > 8192) return null;
  try {
    const decoded = JSON.parse(Buffer.from(base64, 'base64').toString('utf8')) as {
      textures?: { SKIN?: { url?: string; metadata?: { model?: string } } };
    };
    const url = normalizeTextureUrl(decoded.textures?.SKIN?.url);
    if (!url) return null;
    return { url, model: decoded.textures?.SKIN?.metadata?.model === 'slim' ? 'slim' : 'classic' };
  } catch {
    return null;
  }
}

/** Mojang only issues version-4 (random) UUIDs for premium accounts; offline-mode UUIDs are version 3. */
export function isPremiumUuid(uuid: string): boolean {
  return uuid.length === 36 && uuid[14] === '4';
}

/** PNG signature check plus the dimensions Minecraft skins use (64×64 or legacy 64×32). */
export function isSkinPng(data: Buffer): boolean {
  if (data.length < 24 || data.readUInt32BE(0) !== 0x89504e47 || data.readUInt32BE(4) !== 0x0d0a1a0a) return false;
  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  return width === 64 && (height === 64 || height === 32);
}
