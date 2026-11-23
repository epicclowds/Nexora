import { describe, expect, it } from 'vitest';
import { buildActivity } from '../src/players/activity';
import { isPublicIp } from '../src/players/geoip.service';
import { isPremiumUuid, isSkinPng, normalizeTextureUrl, parseTexturesProperty } from '../src/players/skins';

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64');

describe('skin textures', () => {
  it('accepts only Mojang texture URLs (SSRF protection)', () => {
    expect(normalizeTextureUrl('http://textures.minecraft.net/texture/abcdef0123456789')).toBe('https://textures.minecraft.net/texture/abcdef0123456789');
    expect(normalizeTextureUrl('https://evil.example/texture/abcdef0123456789')).toBeNull();
    expect(normalizeTextureUrl('https://textures.minecraft.net.evil.example/texture/abcdef0123456789')).toBeNull();
    expect(normalizeTextureUrl('https://textures.minecraft.net/texture/../admin')).toBeNull();
    expect(normalizeTextureUrl('http://169.254.169.254/latest/meta-data')).toBeNull();
  });

  it('parses the textures property including the arm model', () => {
    const slim = b64({ textures: { SKIN: { url: 'http://textures.minecraft.net/texture/0123456789abcdef', metadata: { model: 'slim' } } } });
    expect(parseTexturesProperty(slim)).toEqual({ url: 'https://textures.minecraft.net/texture/0123456789abcdef', model: 'slim' });
    const classic = b64({ textures: { SKIN: { url: 'http://textures.minecraft.net/texture/0123456789abcdef' } } });
    expect(parseTexturesProperty(classic)?.model).toBe('classic');
    expect(parseTexturesProperty('not base64 json')).toBeNull();
    expect(parseTexturesProperty(b64({ textures: { SKIN: { url: 'http://localhost/x' } } }))).toBeNull();
  });

  it('identifies premium UUIDs and valid skin PNGs', () => {
    expect(isPremiumUuid('069a79f4-44e9-4726-a5be-fca90e38aaf5')).toBe(true);
    expect(isPremiumUuid('5c80c4a6-9c49-3d2d-8f8a-1d3e8b0a1d2c')).toBe(false);
    const png = Buffer.alloc(24);
    png.writeUInt32BE(0x89504e47, 0);
    png.writeUInt32BE(0x0d0a1a0a, 4);
    png.writeUInt32BE(64, 16);
    png.writeUInt32BE(64, 20);
    expect(isSkinPng(png)).toBe(true);
    png.writeUInt32BE(128, 16);
    expect(isSkinPng(png)).toBe(false);
  });
});

describe('isPublicIp', () => {
  it('skips private and special ranges', () => {
    expect(isPublicIp('203.0.113.7')).toBe(true);
    expect(isPublicIp('2001:db8::1')).toBe(true);
    for (const ip of ['10.0.0.1', '172.16.5.4', '192.168.1.1', '127.0.0.1', '100.64.0.1', '169.254.1.1', '::1', 'fd00::1', 'not-an-ip']) {
      expect(isPublicIp(ip)).toBe(false);
    }
  });
});

describe('buildActivity', () => {
  const now = new Date('2026-11-26T12:00:00Z'); // Thursday

  it('splits sessions across local days and weekday/hour buckets', () => {
    const report = buildActivity(
      [
        // 23:30–00:30 Berlin (UTC+1) spans two local days
        { startedAt: new Date('2026-11-24T22:30:00Z'), endedAt: new Date('2026-11-24T23:30:00Z') },
        // open session: 11:00 UTC until now → 1 h
        { startedAt: new Date('2026-11-26T11:00:00Z'), endedAt: null },
      ],
      { timezone: 'Europe/Berlin', days: 7, now },
    );
    expect(report.daily).toHaveLength(7);
    expect(report.daily.at(-1)).toEqual({ date: '2026-11-26', seconds: 3600 });
    expect(report.daily.find((d) => d.date === '2026-11-24')?.seconds).toBe(1800);
    expect(report.daily.find((d) => d.date === '2026-11-25')?.seconds).toBe(1800);
    expect(report.totalSeconds).toBe(7200);
    expect(report.sessions).toBe(2);
    // Tuesday 23:00 local and Wednesday 00:00 local
    expect(report.heatmap[1][23]).toBe(1800);
    expect(report.heatmap[2][0]).toBe(1800);
    expect(report.heatmap[3][12]).toBe(3600); // Thursday 12:00 local
  });

  it('ignores time outside the range', () => {
    const report = buildActivity([{ startedAt: new Date('2026-10-01T10:00:00Z'), endedAt: new Date('2026-10-01T11:00:00Z') }], { timezone: 'UTC', days: 7, now });
    expect(report.totalSeconds).toBe(0);
    expect(report.sessions).toBe(0);
    expect(report.averageSessionSeconds).toBeNull();
  });
});
