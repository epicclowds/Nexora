import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, hotp, otpauthUri, SecretBox, totpStep, verifyTotp } from '../src/auth/totp';

// RFC 6238 appendix B (SHA-1 secret), truncated to 6 digits.
const RFC_SECRET = Buffer.from('12345678901234567890', 'ascii');

describe('TOTP', () => {
  it('matches the RFC 6238 test vectors', () => {
    expect(hotp(RFC_SECRET, totpStep(59_000))).toBe('287082');
    expect(hotp(RFC_SECRET, totpStep(1_111_111_109_000))).toBe('081804');
    expect(hotp(RFC_SECRET, totpStep(2_000_000_000_000))).toBe('279037');
  });

  it('accepts one step of clock drift and rejects replays', () => {
    const now = 1_700_000_000_000;
    const current = totpStep(now);
    expect(verifyTotp(RFC_SECRET, hotp(RFC_SECRET, current), null, now)).toBe(current);
    expect(verifyTotp(RFC_SECRET, hotp(RFC_SECRET, current - 1), null, now)).toBe(current - 1);
    expect(verifyTotp(RFC_SECRET, hotp(RFC_SECRET, current - 2), null, now)).toBeNull();
    expect(verifyTotp(RFC_SECRET, hotp(RFC_SECRET, current), current, now)).toBeNull();
    expect(verifyTotp(RFC_SECRET, '12345', null, now)).toBeNull();
  });

  it('encodes base32 per RFC 4648', () => {
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    expect(base32Decode('mzxw 6ytb-oi').toString()).toBe('foobar');
    expect(() => base32Decode('1!')).toThrow();
  });

  it('builds otpauth URIs for authenticator apps', () => {
    const uri = new URL(otpauthUri('Blockcraft Network', 'owner', RFC_SECRET));
    expect(uri.protocol).toBe('otpauth:');
    expect(uri.host).toBe('totp');
    expect(decodeURIComponent(uri.pathname)).toBe('/Blockcraft Network:owner');
    expect(uri.searchParams.get('secret')).toBe(base32Encode(RFC_SECRET));
    expect(uri.searchParams.get('issuer')).toBe('Blockcraft Network');
  });
});

describe('SecretBox', () => {
  it('encrypts, authenticates and binds to the key', () => {
    const box = new SecretBox('a-jwt-secret-that-is-long-enough-0123456789');
    const sealed = box.seal(RFC_SECRET);
    expect(sealed).not.toContain(RFC_SECRET.toString('base64url'));
    expect(box.open(sealed).equals(RFC_SECRET)).toBe(true);
    expect(box.seal(RFC_SECRET)).not.toBe(sealed); // random IV
    const parts = sealed.split(':');
    parts[3] = Buffer.from('tampered-value').toString('base64url');
    expect(() => box.open(parts.join(':'))).toThrow();
    expect(() => new SecretBox('another-secret-that-is-long-enough-012345').open(sealed)).toThrow();
  });
});
