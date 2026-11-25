import { clientDetectionStatus, normalizeClientBrand } from '@mnm/shared-types';
import { describe, expect, it } from 'vitest';
import { clientInfo } from '../src/players/players.controller';
import { clientDetectionSettingsSchema } from '../src/settings/settings.service';

describe('client brand normalisation', () => {
  it.each([
    ['vanilla', 'vanilla'],
    ['fabric', 'fabric'],
    ['Fabric', 'fabric'],
    ['forge', 'forge'],
    ['fml,forge', 'forge'],
    ['neoforge', 'neoforge'],
    ['quilt', 'quilt'],
    ['NoRisk Client', 'norisk'],
    ['norisk', 'norisk'],
    ['fabric/norisk', 'norisk'],
    ['lunarclient:v2.18.3-2451', 'lunar'],
    ['Badlion Client', 'badlion'],
    ['Feather Fabric', 'feather'],
    ['labymod', 'labymod'],
  ])('%s → %s', (brand, client) => {
    expect(normalizeClientBrand(brand)).toBe(client);
    expect(clientDetectionStatus(brand)).toBe('DETECTED');
  });

  it('never names a client without evidence', () => {
    expect(normalizeClientBrand(null)).toBeNull();
    expect(normalizeClientBrand('')).toBeNull();
    expect(normalizeClientBrand('   ')).toBeNull();
    expect(clientDetectionStatus(undefined)).toBe('NONE');
    expect(normalizeClientBrand('my-custom-launcher')).toBeNull();
    expect(clientDetectionStatus('my-custom-launcher')).toBe('UNRECOGNIZED');
    // "vanilla" must be the whole brand – not a substring of something else.
    expect(normalizeClientBrand('notvanilla')).toBeNull();
  });
});

describe('connection client info', () => {
  const base = { clientBrand: null, clientName: null, clientSource: null, clientDetectedAt: null };

  it('reports Unknown (no name) when no brand was received', () => {
    expect(clientInfo(base, true)).toEqual({ name: null, status: 'NONE', source: null, detectedAt: null, brand: null });
  });

  it('normalises historical rows that only stored the raw brand', () => {
    expect(clientInfo({ ...base, clientBrand: 'fabric' }, false)).toEqual({ name: 'fabric', status: 'DETECTED', source: 'BRAND', detectedAt: null });
  });

  it('keeps unknown brands as unrecognised, never guessed', () => {
    expect(clientInfo({ ...base, clientBrand: 'weird' }, true)).toMatchObject({ name: null, status: 'UNRECOGNIZED', brand: 'weird' });
  });

  it('prefers the stored (integration) result and hides the raw brand unless allowed', () => {
    const at = new Date('2026-11-25T10:00:00Z');
    const info = clientInfo({ clientBrand: 'fabric', clientName: 'norisk', clientSource: 'INTEGRATION', clientDetectedAt: at }, false);
    expect(info).toEqual({ name: 'norisk', status: 'DETECTED', source: 'INTEGRATION', detectedAt: at.toISOString() });
    expect('brand' in info).toBe(false);
  });

  it('has safe defaults for the detection settings', () => {
    expect(clientDetectionSettingsSchema.parse({})).toEqual({ enabled: true, debug: false, norisk: true, showRawBrand: false });
    expect(clientDetectionSettingsSchema.safeParse({ debug: 'yes' }).success).toBe(false);
  });
});
