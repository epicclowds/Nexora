import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../src/common/crypto';
import { canonicalRequest, checkSignature, MAX_CLOCK_SKEW_MS, sign } from '../src/plugin-api/plugin-signature';
import { eventBatchSchema, heartbeatSchema } from '../src/plugin-api/plugin-events';
import { normalizeUuid } from '../src/players/players.controller';

// Shared test vector – the same values are asserted in RequestSignerTest.java.
const VECTOR = {
  secret: 'mnm_sk_test-vector-secret',
  method: 'POST',
  path: '/api/plugin/v1/heartbeat',
  timestamp: '1795400000000',
  nonce: 'nonce-0123456789abcdef',
  body: '{"onlinePlayers":3}',
  signingKeyHex: '2d82f41db33f1785036be6980f75ca56279ad6c7a3a2de9dad2374e2d1ea85ca', // gitleaks:allow (test vector)
  signature: 'abbe9d82b6527986e5434b4df02b8ff6d6ce279d6cffebd9a722221ac561bb03',
};

describe('plugin request signatures', () => {
  it('derives the signing key as SHA-256 of the secret (= stored credential hash)', () => {
    expect(sha256Hex(VECTOR.secret)).toBe(VECTOR.signingKeyHex);
  });

  it('matches the shared test vector', () => {
    const canonical = canonicalRequest(VECTOR.method, VECTOR.path, VECTOR.timestamp, VECTOR.nonce, VECTOR.body);
    expect(sign(VECTOR.signingKeyHex, canonical)).toBe(VECTOR.signature);
  });

  const base = {
    signingKeyHex: VECTOR.signingKeyHex,
    method: VECTOR.method,
    path: VECTOR.path,
    timestamp: VECTOR.timestamp,
    nonce: VECTOR.nonce,
    signature: VECTOR.signature,
    body: VECTOR.body,
    now: Number(VECTOR.timestamp) + 1000,
  };

  it('accepts a valid signature', () => {
    expect(checkSignature(base)).toEqual({ ok: true });
  });

  it('rejects tampered bodies, paths and methods', () => {
    expect(checkSignature({ ...base, body: '{"onlinePlayers":4}' })).toEqual({ ok: false, reason: 'BAD_SIGNATURE' });
    expect(checkSignature({ ...base, path: '/api/plugin/v1/shutdown' })).toEqual({ ok: false, reason: 'BAD_SIGNATURE' });
    expect(checkSignature({ ...base, method: 'PUT' })).toEqual({ ok: false, reason: 'BAD_SIGNATURE' });
  });

  it('rejects stale or future timestamps', () => {
    expect(checkSignature({ ...base, now: Number(VECTOR.timestamp) + MAX_CLOCK_SKEW_MS + 1 })).toEqual({ ok: false, reason: 'CLOCK_SKEW' });
    expect(checkSignature({ ...base, now: Number(VECTOR.timestamp) - MAX_CLOCK_SKEW_MS - 1 })).toEqual({ ok: false, reason: 'CLOCK_SKEW' });
  });

  it('rejects missing or malformed headers', () => {
    expect(checkSignature({ ...base, signature: undefined })).toEqual({ ok: false, reason: 'MISSING_HEADERS' });
    expect(checkSignature({ ...base, nonce: 'short' })).toEqual({ ok: false, reason: 'BAD_NONCE' });
    expect(checkSignature({ ...base, timestamp: 'yesterday' })).toEqual({ ok: false, reason: 'BAD_TIMESTAMP' });
    expect(checkSignature({ ...base, signature: 'zz' })).toEqual({ ok: false, reason: 'BAD_SIGNATURE' });
  });
});

describe('plugin payload validation', () => {
  it('normalises UUIDs and clamps future event times', () => {
    const future = Date.now() + 3_600_000;
    const parsed = eventBatchSchema.parse({
      events: [{ type: 'player.leave', sessionKey: 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE', uuid: '069A79F4-44E9-4726-A5BE-FCA90E38AAF5', at: future }],
    });
    const event = parsed.events[0];
    expect(event.uuid).toBe('069a79f4-44e9-4726-a5be-fca90e38aaf5');
    expect(event.type === 'player.leave' && event.at.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('rejects unknown event types and invalid IPs', () => {
    expect(eventBatchSchema.safeParse({ events: [{ type: 'player.fly', uuid: 'x' }] }).success).toBe(false);
    expect(
      eventBatchSchema.safeParse({
        events: [{ type: 'player.join', sessionKey: '00000000-0000-0000-0000-000000000001', uuid: '00000000-0000-0000-0000-000000000002', username: 'Steve', at: 1, ip: 'not-an-ip' }],
      }).success,
    ).toBe(false);
  });

  it('validates heartbeat metrics', () => {
    expect(heartbeatSchema.safeParse({ pluginVersion: '0.2.0', onlinePlayers: 5, tps: 19.98, cpuLoad: 0.2 }).success).toBe(true);
    expect(heartbeatSchema.safeParse({ pluginVersion: '0.2.0', onlinePlayers: -1 }).success).toBe(false);
    expect(heartbeatSchema.safeParse({ pluginVersion: '0.2.0', onlinePlayers: 1, cpuLoad: 3 }).success).toBe(false);
  });
});

describe('normalizeUuid', () => {
  it('accepts dashed and undashed UUIDs', () => {
    expect(normalizeUuid('069a79f444e94726a5befca90e38aaf5')).toBe('069a79f4-44e9-4726-a5be-fca90e38aaf5');
    expect(normalizeUuid('069A79F4-44E9-4726-A5BE-FCA90E38AAF5')).toBe('069a79f4-44e9-4726-a5be-fca90e38aaf5');
    expect(normalizeUuid('Notch')).toBeNull();
  });
});
