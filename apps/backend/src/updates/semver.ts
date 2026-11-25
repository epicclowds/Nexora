/**
 * Semantic version parsing and precedence (https://semver.org/#spec-item-11).
 * Versions are never compared as strings: 1.10.0 > 1.9.0, 1.2.0 > 1.2.0-rc.1.
 */
export interface SemVer {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
  raw: string;
}

const PATTERN = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/;

/** Parses "1.2.3", "v1.2.3", "1.2.3-rc.1" (build metadata is ignored); null when invalid. */
export function parseSemVer(value: string | null | undefined): SemVer | null {
  const match = PATTERN.exec(value?.trim() ?? '');
  if (!match) return null;
  const [major, minor, patch] = [match[1], match[2], match[3]].map(Number);
  if (![major, minor, patch].every(Number.isSafeInteger)) return null;
  return { major, minor, patch, prerelease: match[4] ? match[4].split('.') : [], raw: `${major}.${minor}.${patch}${match[4] ? `-${match[4]}` : ''}` };
}

function compareIdentifiers(a: string, b: string): number {
  const numA = /^\d+$/.test(a);
  const numB = /^\d+$/.test(b);
  if (numA && numB) return Math.sign(Number(a) - Number(b));
  if (numA) return -1; // numeric identifiers have lower precedence
  if (numB) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** -1, 0 or 1. */
export function compareSemVer(a: SemVer, b: SemVer): number {
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (a[key] !== b[key]) return Math.sign(a[key] - b[key]);
  }
  if (!a.prerelease.length || !b.prerelease.length) return Math.sign(b.prerelease.length - a.prerelease.length);
  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i++) {
    if (a.prerelease[i] === undefined) return -1;
    if (b.prerelease[i] === undefined) return 1;
    const c = compareIdentifiers(a.prerelease[i], b.prerelease[i]);
    if (c !== 0) return c;
  }
  return 0;
}

/** Compares two version strings; null when either is not a valid version. */
export function compareVersions(a: string | null | undefined, b: string | null | undefined): number | null {
  const pa = parseSemVer(a);
  const pb = parseSemVer(b);
  return pa && pb ? compareSemVer(pa, pb) : null;
}
