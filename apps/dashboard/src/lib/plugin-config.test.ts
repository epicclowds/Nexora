import { describe, expect, it } from 'vitest';
import { configPath, defaultOptions, generateConfig, installGuide, isInsecureUrl, validateOptions } from './plugin-config';
import { crc32, createZip } from './zip';

const parse = (text: string) =>
  Object.fromEntries(
    text
      .split('\n')
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
  );

describe('plugin config generator', () => {
  it('generates a Velocity config with proxy options only', () => {
    const config = parse(generateConfig({ ...defaultOptions('VELOCITY', 'https://admin.example.net/'), registrationToken: 'mnm_reg_abc', syncIntervalSeconds: 30 }));
    expect(config).toMatchObject({
      'backend-url': 'https://admin.example.net',
      'registration-token': 'mnm_reg_abc',
      'sync-interval-seconds': '30',
      'collect-ip-addresses': 'true',
      'moderation-commands': 'true',
      'managed-settings': 'true',
    });
    expect(config['statistics-enabled']).toBeUndefined();
    expect(config['inventory-sync']).toBeUndefined();
  });

  it('generates a Paper config with statistics, AntiCheat and inventory options', () => {
    const options = { ...defaultOptions('PAPER', 'http://10.0.0.5:3000'), statisticsCategories: ['general', 'combat'] as const, anticheatIntegrations: ' Grim, Vulcan ,Grim', enderChestSync: false };
    const config = parse(generateConfig({ ...options, statisticsCategories: [...options.statisticsCategories] }));
    expect(config).toMatchObject({
      'statistics-categories': 'combat,general',
      'anticheat-integrations': 'Grim,Vulcan',
      'enderchest-sync': 'false',
      'inventory-sync': 'true',
    });
    expect(config['sync-interval-seconds']).toBeUndefined();
  });

  it('never lets values break out of their line', () => {
    const text = generateConfig({ ...defaultOptions('PAPER', 'http://x.test'), registrationToken: 'abc\ndebug=true' });
    expect(parse(text)['registration-token']).toBe('abc debug=true');
    expect(parse(text).debug).toBe('false');
  });

  it('validates the backend URL, integration names and ranges', () => {
    expect(validateOptions(defaultOptions('PAPER', 'https://admin.example.net'))).toEqual([]);
    expect(validateOptions(defaultOptions('PAPER', 'ftp://x'))).toEqual(['backendUrl']);
    expect(validateOptions(defaultOptions('PAPER', 'https://x.test/dashboard'))).toEqual(['backendUrlPath']);
    expect(validateOptions({ ...defaultOptions('PAPER', 'https://x.test'), anticheatIntegrations: 'Grim, bad name!' })).toEqual(['integrations']);
    expect(validateOptions({ ...defaultOptions('PAPER', 'https://x.test'), heartbeatIntervalSeconds: 1 })).toEqual(['range']);
  });

  it('flags plain HTTP to public hosts', () => {
    expect(isInsecureUrl('http://admin.example.net')).toBe(true);
    expect(isInsecureUrl('http://192.168.1.10:3000')).toBe(false);
    expect(isInsecureUrl('http://dashboard:3000')).toBe(false);
    expect(isInsecureUrl('https://admin.example.net')).toBe(false);
  });

  it('writes installation instructions with the right paths', () => {
    const guide = installGuide({ ...defaultOptions('VELOCITY', 'https://x.test'), registrationToken: 't' }, 'proxy-1', '0.8.0', '2026-12-01T00:00:00Z');
    expect(guide).toContain(configPath('VELOCITY'));
    expect(guide).toContain('NetworkManager-Velocity-0.8.0.jar');
    expect(guide).toContain('single-use');
  });
});

describe('zip writer', () => {
  it('computes CRC-32', () => {
    expect(crc32(new TextEncoder().encode('hello'))).toBe(0x3610a686);
  });

  it('creates a valid archive layout', () => {
    const zip = createZip([{ name: 'a/config.properties', content: 'x=1\n' }, { name: 'INSTALL.md', content: '# Hi' }], new Date(2026, 10, 30, 12, 0, 0));
    const view = new DataView(zip.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    const end = zip.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(2);
    const centralOffset = view.getUint32(end + 16, true);
    expect(view.getUint32(centralOffset, true)).toBe(0x02014b50);
    expect(new TextDecoder().decode(zip.slice(30, 30 + 'a/config.properties'.length))).toBe('a/config.properties');
  });

  it('rejects path traversal', () => {
    expect(() => createZip([{ name: '../evil', content: '' }])).toThrow();
  });
});
