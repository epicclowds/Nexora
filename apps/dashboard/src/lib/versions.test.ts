import { describe, expect, it } from 'vitest';
import { pluginCompatibility } from './versions';

describe('pluginCompatibility', () => {
  it('accepts identical versions', () => {
    expect(pluginCompatibility('1.0.1', '1.0.1')).toBe('ok');
    expect(pluginCompatibility('v1.0.1', '1.0.1')).toBe('ok');
  });

  it('recommends updating within the same minor release', () => {
    expect(pluginCompatibility('1.0.0', '1.0.1')).toBe('recommended');
    expect(pluginCompatibility('1.0.2', '1.0.1')).toBe('recommended');
  });

  it('requires an update across minor or major releases', () => {
    expect(pluginCompatibility('0.8.0', '1.0.1')).toBe('required');
    expect(pluginCompatibility('1.1.0', '1.0.1')).toBe('required');
  });

  it('does not warn for unknown versions', () => {
    expect(pluginCompatibility(null, '1.0.1')).toBe('unknown');
    expect(pluginCompatibility('dev', '1.0.1')).toBe('unknown');
  });
});
