import { z } from 'zod';
import { MAX_DURATION_SECONDS, MIN_DURATION_SECONDS } from '../punishments/punishment-rules';

export const ANTICHEAT_ACTIONS = ['NONE', 'WARNING', 'KICK', 'TEMP_BAN', 'BAN'] as const;
export type AntiCheatAction = (typeof ANTICHEAT_ACTIONS)[number];

export const cheatTypeSchema = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9 _.:-]+$/, 'Letters, digits, space, "_", ".", ":" and "-" only');

export const ruleSchema = z
  .object({
    action: z.enum(ANTICHEAT_ACTIONS),
    durationSeconds: z.number().int().min(MIN_DURATION_SECONDS).max(MAX_DURATION_SECONDS).nullable().default(null),
    /** Reports below this violation level are only logged. */
    minViolationLevel: z.number().min(0).max(1_000_000).default(0),
    /** No further automatic punishment for the same player and cheat type within this window. */
    cooldownSeconds: z.number().int().min(0).max(30 * 86_400).default(300),
  })
  .refine((r) => (r.action === 'TEMP_BAN') === (r.durationSeconds !== null), { message: 'A duration is required for TEMP_BAN and only allowed there', path: ['durationSeconds'] });

export const cheatRuleSchema = z.intersection(ruleSchema, z.object({ cheatType: cheatTypeSchema, enabled: z.boolean().default(true) }));

export const antiCheatSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  /** Store evidence and metadata sent by integrations (may contain gameplay details). */
  collectEvidence: z.boolean().default(true),
  /** Applied to automatic reports without a matching rule. Default: log only. */
  defaultRule: ruleSchema.default({ action: 'NONE', durationSeconds: null, minViolationLevel: 0, cooldownSeconds: 300 }),
  /** Applied to explicit /anticheatban requests without a matching rule. */
  commandFallback: ruleSchema.default({ action: 'TEMP_BAN', durationSeconds: 30 * 86_400, minViolationLevel: 0, cooldownSeconds: 0 }),
  rules: z
    .array(cheatRuleSchema)
    .max(200)
    .default([])
    .refine((rules) => new Set(rules.map((r) => r.cheatType.toLowerCase())).size === rules.length, 'Cheat types must be unique'),
  /** Upper bound of automatic punishments per server and minute (protects against misbehaving integrations). */
  maxPunishmentsPerMinute: z.number().int().min(1).max(1000).default(30),
});

export type AntiCheatSettings = z.infer<typeof antiCheatSettingsSchema>;
export type Rule = z.infer<typeof ruleSchema>;

/** Example rules from the specification. Offered as a template in the dashboard, never applied automatically. */
export const EXAMPLE_RULES = [
  { cheatType: 'Speed', action: 'TEMP_BAN', durationSeconds: 30 * 86_400, minViolationLevel: 0, cooldownSeconds: 300, enabled: true },
  { cheatType: 'Fly', action: 'TEMP_BAN', durationSeconds: 14 * 86_400, minViolationLevel: 0, cooldownSeconds: 300, enabled: true },
  { cheatType: 'KillAura', action: 'BAN', durationSeconds: null, minViolationLevel: 0, cooldownSeconds: 300, enabled: true },
] as const;

export type Outcome =
  | AntiCheatAction
  | 'LOGGED'
  | 'DISABLED'
  | 'SKIPPED_THRESHOLD'
  | 'SKIPPED_COOLDOWN'
  | 'SKIPPED_RATE_LIMIT'
  | 'SKIPPED_DUPLICATE'
  | 'SKIPPED_OFFLINE';

export interface Decision {
  outcome: Outcome;
  rule: Rule | null;
  matchedCheatType: string | null;
}

/** Finds the enabled rule for a cheat type (case-insensitive). */
export function findRule(settings: AntiCheatSettings, cheatType: string): AntiCheatSettings['rules'][number] | null {
  const key = cheatType.trim().toLowerCase();
  return settings.rules.find((r) => r.enabled && r.cheatType.toLowerCase() === key) ?? null;
}

/** The rule that applies to a report: matching cheat-type rule, else the fallback for its kind. */
export function resolveRule(settings: AntiCheatSettings, cheatType: string, explicit: boolean): { rule: Rule; matchedCheatType: string | null } {
  const matched = findRule(settings, cheatType);
  return { rule: matched ?? (explicit ? settings.commandFallback : settings.defaultRule), matchedCheatType: matched?.cheatType ?? null };
}

/**
 * Pure decision step. Results of side-effect checks (cooldown, rate limit)
 * are passed in so the logic stays testable. Explicit requests skip the
 * violation-level threshold.
 */
export function decide(
  settings: AntiCheatSettings,
  report: { cheatType: string; violationLevel: number | null; explicit: boolean },
  checks: { inCooldown: boolean; rateLimited: boolean },
): Decision {
  if (!settings.enabled) return { outcome: 'DISABLED', rule: null, matchedCheatType: null };
  const { rule, matchedCheatType } = resolveRule(settings, report.cheatType, report.explicit);
  const base = { rule, matchedCheatType };
  if (rule.action === 'NONE') return { outcome: 'LOGGED', ...base };
  if (!report.explicit && (report.violationLevel ?? 0) < rule.minViolationLevel) return { outcome: 'SKIPPED_THRESHOLD', ...base };
  if (checks.inCooldown) return { outcome: 'SKIPPED_COOLDOWN', ...base };
  if (checks.rateLimited) return { outcome: 'SKIPPED_RATE_LIMIT', ...base };
  return { outcome: rule.action, ...base };
}
