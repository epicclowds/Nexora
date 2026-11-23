import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Plugin request signing (shared contract with apps/plugin-common: RequestSigner.java).
 *
 *   signingKey = SHA-256(secret)                       (raw 32 bytes; the backend stores it as hex)
 *   canonical  = METHOD \n PATH \n TIMESTAMP \n NONCE \n hex(SHA-256(body))
 *   signature  = hex(HMAC-SHA256(signingKey, canonical))
 *
 * Headers: X-MNM-Key-Id, X-MNM-Timestamp (epoch ms), X-MNM-Nonce, X-MNM-Signature.
 * The secret itself never travels after registration; timestamp + single-use
 * nonce make captured requests unusable for replay.
 */
export const SIGNATURE_HEADERS = {
  keyId: 'x-mnm-key-id',
  timestamp: 'x-mnm-timestamp',
  nonce: 'x-mnm-nonce',
  signature: 'x-mnm-signature',
} as const;

/** Maximum accepted clock difference between plugin and backend. */
export const MAX_CLOCK_SKEW_MS = 5 * 60_000;
/** Nonces are remembered at least as long as a timestamp stays acceptable. */
export const NONCE_TTL_SECONDS = Math.ceil((2 * MAX_CLOCK_SKEW_MS) / 1000);

const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

export function canonicalRequest(method: string, path: string, timestamp: string, nonce: string, body: Buffer | string): string {
  const bodyHash = createHash('sha256').update(body).digest('hex');
  return [method.toUpperCase(), path, timestamp, nonce, bodyHash].join('\n');
}

export function sign(signingKeyHex: string, canonical: string): string {
  return createHmac('sha256', Buffer.from(signingKeyHex, 'hex')).update(canonical, 'utf8').digest('hex');
}

export type SignatureCheck =
  | { ok: true }
  | { ok: false; reason: 'MISSING_HEADERS' | 'BAD_TIMESTAMP' | 'CLOCK_SKEW' | 'BAD_NONCE' | 'BAD_SIGNATURE' };

export function checkSignature(input: {
  signingKeyHex: string;
  method: string;
  path: string;
  timestamp: string | undefined;
  nonce: string | undefined;
  signature: string | undefined;
  body: Buffer | string;
  now?: number;
}): SignatureCheck {
  const { timestamp, nonce, signature } = input;
  if (!timestamp || !nonce || !signature) return { ok: false, reason: 'MISSING_HEADERS' };
  if (!/^\d{10,16}$/.test(timestamp)) return { ok: false, reason: 'BAD_TIMESTAMP' };
  if (Math.abs((input.now ?? Date.now()) - Number(timestamp)) > MAX_CLOCK_SKEW_MS) return { ok: false, reason: 'CLOCK_SKEW' };
  if (!NONCE_PATTERN.test(nonce)) return { ok: false, reason: 'BAD_NONCE' };
  if (!/^[0-9a-f]{64}$/.test(signature)) return { ok: false, reason: 'BAD_SIGNATURE' };

  const expected = sign(input.signingKeyHex, canonicalRequest(input.method, input.path, timestamp, nonce, input.body));
  const valid = timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
  return valid ? { ok: true } : { ok: false, reason: 'BAD_SIGNATURE' };
}
