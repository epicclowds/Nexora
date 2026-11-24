import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Time-based one-time passwords (RFC 6238, HMAC-SHA1, 30 s, 6 digits) as used
 * by common authenticator apps, plus encryption of the shared secrets at rest.
 */
export const TOTP_PERIOD_SECONDS = 30;
const DIGITS = 6;
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(data: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error('Invalid base32');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** 160-bit secret, the size recommended by RFC 4226. */
export function generateTotpSecret(): Buffer {
  return randomBytes(20);
}

export function totpStep(now = Date.now()): number {
  return Math.floor(now / 1000 / TOTP_PERIOD_SECONDS);
}

/** HOTP value for a counter (RFC 4226 dynamic truncation). */
export function hotp(secret: Buffer, counter: number): string {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', secret).update(buffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS;
  return String(code).padStart(DIGITS, '0');
}

/**
 * Checks a code against the current step ±1 (clock drift). Returns the matched
 * step, or null. Steps at or before `lastUsedStep` are rejected so a code
 * cannot be replayed.
 */
export function verifyTotp(secret: Buffer, code: string, lastUsedStep: number | null, now = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const current = totpStep(now);
  for (const step of [current - 1, current, current + 1]) {
    if (lastUsedStep !== null && step <= lastUsedStep) continue;
    if (timingSafeEqual(Buffer.from(hotp(secret, step)), Buffer.from(code))) return step;
  }
  return null;
}

export function otpauthUri(issuer: string, account: string, secret: Buffer): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret: base32Encode(secret), issuer, algorithm: 'SHA1', digits: String(DIGITS), period: String(TOTP_PERIOD_SECONDS) });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// ── Secrets at rest ──────────────────────────────────────────────

/**
 * AES-256-GCM with a key derived from JWT_SECRET (HKDF). A database dump alone
 * therefore does not reveal the TOTP secrets. Changing JWT_SECRET invalidates
 * stored secrets: affected users must set up 2FA again (an administrator can
 * reset it).
 */
export class SecretBox {
  private readonly key: Buffer;

  constructor(masterSecret: string) {
    this.key = Buffer.from(hkdfSync('sha256', masterSecret, 'mnm-network-manager', 'two-factor-secret-v1', 32));
  }

  seal(plaintext: Buffer): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join(':');
  }

  /** @throws Error when the value was tampered with or sealed with another key */
  open(sealed: string): Buffer {
    const [version, iv, tag, data] = sealed.split(':');
    if (version !== 'v1' || !iv || !tag || !data) throw new Error('Unsupported sealed value');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]);
  }
}
