import { describe, expect, it } from 'vitest';
import { antiCheatSettingsSchema, decide, EXAMPLE_RULES, findRule } from '../src/anticheat/anticheat-rules';

const settings = antiCheatSettingsSchema.parse({
  rules: [
    { cheatType: 'Speed', action: 'TEMP_BAN', durationSeconds: 2_592_000, minViolationLevel: 10, cooldownSeconds: 300 },
    { cheatType: 'KillAura', action: 'BAN', durationSeconds: null },
    { cheatType: 'Timer', action: 'KICK', durationSeconds: null, enabled: false },
  ],
});
const ok = { inCooldown: false, rateLimited: false };

describe('AntiCheat settings', () => {
  it('defaults to logging only for automatic reports and a 30-day ban for explicit requests', () => {
    const defaults = antiCheatSettingsSchema.parse({});
    expect(defaults.defaultRule.action).toBe('NONE');
    expect(defaults.commandFallback).toMatchObject({ action: 'TEMP_BAN', durationSeconds: 30 * 86_400 });
    expect(defaults.rules).toEqual([]);
  });

  it('validates durations, duplicates and example rules', () => {
    expect(antiCheatSettingsSchema.safeParse({ rules: [{ cheatType: 'Fly', action: 'TEMP_BAN', durationSeconds: null }] }).success).toBe(false);
    expect(antiCheatSettingsSchema.safeParse({ rules: [{ cheatType: 'Fly', action: 'BAN', durationSeconds: 60 }] }).success).toBe(false);
    expect(antiCheatSettingsSchema.safeParse({ rules: [{ cheatType: 'Fly', action: 'KICK', durationSeconds: null }, { cheatType: 'fly', action: 'BAN', durationSeconds: null }] }).success).toBe(false);
    expect(antiCheatSettingsSchema.safeParse({ rules: EXAMPLE_RULES }).success).toBe(true);
  });

  it('matches cheat types case-insensitively and ignores disabled rules', () => {
    expect(findRule(settings, 'speed')?.cheatType).toBe('Speed');
    expect(findRule(settings, 'Timer')).toBeNull();
  });
});

describe('decide', () => {
  it('applies the matching rule above the threshold', () => {
    expect(decide(settings, { cheatType: 'Speed', violationLevel: 12, explicit: false }, ok).outcome).toBe('TEMP_BAN');
    expect(decide(settings, { cheatType: 'Speed', violationLevel: 5, explicit: false }, ok).outcome).toBe('SKIPPED_THRESHOLD');
    expect(decide(settings, { cheatType: 'Speed', violationLevel: 5, explicit: true }, ok).outcome).toBe('TEMP_BAN');
  });

  it('logs unknown automatic reports and uses the fallback for explicit ones', () => {
    expect(decide(settings, { cheatType: 'Reach', violationLevel: 99, explicit: false }, ok).outcome).toBe('LOGGED');
    const explicit = decide(settings, { cheatType: 'Reach', violationLevel: null, explicit: true }, ok);
    expect(explicit.outcome).toBe('TEMP_BAN');
    expect(explicit.matchedCheatType).toBeNull();
  });

  it('respects cooldowns, rate limits and the global switch', () => {
    expect(decide(settings, { cheatType: 'KillAura', violationLevel: 1, explicit: false }, { inCooldown: true, rateLimited: false }).outcome).toBe('SKIPPED_COOLDOWN');
    expect(decide(settings, { cheatType: 'KillAura', violationLevel: 1, explicit: false }, { inCooldown: false, rateLimited: true }).outcome).toBe('SKIPPED_RATE_LIMIT');
    expect(decide({ ...settings, enabled: false }, { cheatType: 'KillAura', violationLevel: 1, explicit: true }, ok).outcome).toBe('DISABLED');
  });
});
