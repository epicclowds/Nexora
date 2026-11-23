import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** URL-safe random token with `bytes` bytes of entropy. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Human-friendly code (no ambiguous characters), grouped as XXXX-XXXX-... */
export function randomCode(groups = 4, groupLength = 4): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(groups * groupLength);
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]);
  const parts: string[] = [];
  for (let i = 0; i < groups; i++) parts.push(chars.slice(i * groupLength, (i + 1) * groupLength).join(''));
  return parts.join('-');
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Constant-time comparison of two strings via their SHA-256 digests. */
export function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(Buffer.from(sha256Hex(a), 'hex'), Buffer.from(sha256Hex(b), 'hex'));
}
