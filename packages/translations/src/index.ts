import enUS from '../locales/en-US.json';
import deDE from '../locales/de-DE.json';

export type MessageTree = { [key: string]: string | MessageTree };

export const DEFAULT_LOCALE = 'en-US';

/** Catalogues bundled with the platform, keyed by BCP 47 locale code. */
export const bundledCatalogs: Readonly<Record<string, MessageTree>> = {
  'en-US': enUS as MessageTree,
  'de-DE': deDE as MessageTree,
};

export function getBundledLocales(): string[] {
  return Object.keys(bundledCatalogs);
}

/** Flattens a nested catalogue into dot-separated keys. */
export function flattenMessages(tree: MessageTree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out[path] = value;
    else Object.assign(out, flattenMessages(value, path));
  }
  return out;
}

/**
 * Deep-merges `overrides` on top of `base`. Used to fall back to English for
 * keys missing in another locale.
 */
export function mergeWithFallback(base: MessageTree, overrides: MessageTree | undefined): MessageTree {
  if (!overrides) return base;
  const result: MessageTree = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    const baseValue = base[key];
    if (typeof value === 'string') {
      if (baseValue === undefined || typeof baseValue === 'string') result[key] = value;
    } else if (baseValue !== undefined && typeof baseValue !== 'string') {
      result[key] = mergeWithFallback(baseValue, value);
    }
  }
  return result;
}

/** Returns the catalogue for `locale` with English used for any missing keys. */
export function getMessages(locale: string): MessageTree {
  const base = bundledCatalogs[DEFAULT_LOCALE];
  if (locale === DEFAULT_LOCALE) return base;
  return mergeWithFallback(base, bundledCatalogs[locale]);
}

/** Keys present in the reference catalogue but missing from `candidate`. */
export function findMissingKeys(reference: MessageTree, candidate: MessageTree): string[] {
  const have = flattenMessages(candidate);
  return Object.keys(flattenMessages(reference)).filter((k) => !(k in have));
}

/** Keys present in `candidate` that do not exist in the reference catalogue. */
export function findUnknownKeys(reference: MessageTree, candidate: MessageTree): string[] {
  const ref = flattenMessages(reference);
  return Object.keys(flattenMessages(candidate)).filter((k) => !(k in ref));
}

// Markup is never allowed in translations: catalogues are rendered as text and
// may originate from untrusted imports.
const FORBIDDEN_PATTERNS: readonly RegExp[] = [/<[a-z!/?]/i, /javascript:/i, /on[a-z]+\s*=/i, /&#/];

export interface ValidationIssue {
  key: string;
  problem: 'not-a-string' | 'unsafe-content' | 'unbalanced-braces' | 'invalid-key' | 'too-long';
}

const KEY_SEGMENT = /^[A-Za-z][A-Za-z0-9_-]*$/;
const MAX_MESSAGE_LENGTH = 2000;

/** Structural and safety validation for an (untrusted) translation catalogue. */
export function validateCatalog(input: unknown, prefix = ''): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return [{ key: prefix || '<root>', problem: 'not-a-string' }];
  }
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (!KEY_SEGMENT.test(key)) {
      issues.push({ key: path, problem: 'invalid-key' });
      continue;
    }
    if (typeof value === 'string') {
      if (value.length > MAX_MESSAGE_LENGTH) issues.push({ key: path, problem: 'too-long' });
      if (FORBIDDEN_PATTERNS.some((re) => re.test(value))) issues.push({ key: path, problem: 'unsafe-content' });
      if (!bracesBalanced(value)) issues.push({ key: path, problem: 'unbalanced-braces' });
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      issues.push(...validateCatalog(value, path));
    } else {
      issues.push({ key: path, problem: 'not-a-string' });
    }
  }
  return issues;
}

function bracesBalanced(value: string): boolean {
  let depth = 0;
  for (const ch of value) {
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    if (depth < 0) return false;
  }
  return depth === 0;
}

/**
 * Parses a Minecraft plugin message catalogue (`minecraft/<locale>.yml`). The
 * files use a flat subset of YAML: `key: "double-quoted value"` per line plus
 * comments, so no YAML library is needed.
 */
export function parseMinecraftCatalog(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Za-z][A-Za-z0-9_.-]*):\s*(".*")\s*$/.exec(line);
    if (!match) continue;
    out[match[1]] = JSON.parse(match[2]) as string;
  }
  return out;
}

/** `{name}` placeholders used in a plugin message. */
export function messagePlaceholders(text: string): string[] {
  return [...new Set([...text.matchAll(/\{([a-zA-Z][a-zA-Z0-9_-]*)\}/g)].map((m) => m[1]))];
}
