import { messagePlaceholders, parseMinecraftCatalog } from '@mnm/translations';
import { describe, expect, it } from 'vitest';
import { managedPluginSettingsSchema, moderationSettingsSchema, normalizePluginSettings, pluginCatalogs, validatePluginMessages } from '../src/settings/plugin-settings';

describe('plugin message catalogues', () => {
  it('parses the flat YAML subset including escapes', () => {
    const parsed = parseMinecraftCatalog('# comment\nprefix: "<gray>[N]</gray> "\na.b-c: "Line\\nwith \\"quotes\\""\n\nbroken line\n');
    expect(parsed).toEqual({ prefix: '<gray>[N]</gray> ', 'a.b-c': 'Line\nwith "quotes"' });
  });

  it('loads the bundled catalogues with identical keys', () => {
    const catalogs = pluginCatalogs();
    expect(Object.keys(catalogs['en-US']).length).toBeGreaterThan(20);
    expect(Object.keys(catalogs['de-DE']).sort()).toEqual(Object.keys(catalogs['en-US']).sort());
  });

  it('extracts placeholders', () => {
    expect(messagePlaceholders('{player} was banned for {duration}. ID: {id} {player}')).toEqual(['player', 'duration', 'id']);
  });
});

describe('managed plugin settings', () => {
  it('defaults every field to "use the local value"', () => {
    const parsed = managedPluginSettingsSchema.parse({});
    expect(parsed).toMatchObject({ language: null, statisticsEnabled: null, inventorySync: null, messages: {} });
  });

  it('rejects out-of-range intervals and unknown fields', () => {
    expect(managedPluginSettingsSchema.safeParse({ statisticsIntervalSeconds: 10 }).success).toBe(false);
    expect(managedPluginSettingsSchema.safeParse({ backendUrl: 'http://evil' }).success).toBe(false);
  });

  it('validates message overrides', () => {
    const ok = validatePluginMessages({ 'fr-FR': { 'command.ban.success': '<green>{player} a été banni. ID : {id}' } });
    expect(ok).toEqual([]);
    const issues = validatePluginMessages({
      'en-US': {
        'does.not.exist': 'x',
        'command.ban.success': '<click:run_command:/op {player}>Click</click>',
        'command.kick.success': '{player} {secret}',
        'command.warn.success': '  ',
      },
    });
    expect(issues.map((i) => [i.key, i.problem])).toEqual([
      ['does.not.exist', 'unknown-key'],
      ['command.ban.success', 'unsafe-content'],
      ['command.kick.success', 'unknown-placeholder'],
      ['command.warn.success', 'empty'],
    ]);
  });

  it('normalises categories and drops empty locales', () => {
    const settings = managedPluginSettingsSchema.parse({ statisticsCategories: ['general', 'combat', 'combat'], messages: { 'de-DE': {} } });
    expect(normalizePluginSettings(settings)).toMatchObject({ statisticsCategories: ['combat', 'general'], messages: {} });
  });
});

describe('moderation presets', () => {
  const preset = { id: 'hacking', name: 'Hacking', type: 'TEMP_BAN', reason: 'Unfair advantage', durationSeconds: 30 * 86_400 };

  it('accepts valid presets', () => {
    expect(moderationSettingsSchema.safeParse({ presets: [preset, { ...preset, id: 'spam', type: 'MUTE', durationSeconds: null }] }).success).toBe(true);
  });

  it('requires durations exactly for temporary types and unique IDs', () => {
    expect(moderationSettingsSchema.safeParse({ presets: [{ ...preset, durationSeconds: null }] }).success).toBe(false);
    expect(moderationSettingsSchema.safeParse({ presets: [{ ...preset, type: 'BAN' }] }).success).toBe(false);
    expect(moderationSettingsSchema.safeParse({ presets: [preset, preset] }).success).toBe(false);
  });
});
