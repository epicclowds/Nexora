import { z } from 'zod';
import { compareSemVer, compareVersions, parseSemVer } from './semver';

/**
 * Release information from the GitHub Releases API. Everything in a release is
 * untrusted input: it is validated here and rendered as text by the dashboard.
 */
const githubAssetSchema = z.object({
  name: z.string().max(255),
  size: z.number().int().nonnegative(),
  browser_download_url: z.url(),
});

export const githubReleaseSchema = z.object({
  tag_name: z.string().max(128),
  name: z.string().max(512).nullable().optional(),
  html_url: z.url(),
  published_at: z.string().nullable().optional(),
  draft: z.boolean(),
  prerelease: z.boolean(),
  body: z.string().nullable().optional(),
  assets: z.array(githubAssetSchema).default([]),
});
export type GithubRelease = z.infer<typeof githubReleaseSchema>;

export type ReleaseChannel = 'stable' | 'prerelease';

export interface ReleaseAsset {
  name: string;
  size: number;
  url: string;
}

/**
 * Optional machine-readable compatibility rules embedded in the release notes:
 *   <!-- nexora-compatibility {"minPluginVersion":"1.2.0","minUpgradeFrom":"1.1.0"} -->
 * minPluginVersion: oldest plugin version that works with this backend.
 * minUpgradeFrom:   oldest installed version that can upgrade directly (database migrations).
 */
export const compatibilitySchema = z
  .object({
    minPluginVersion: z.string().max(64).optional(),
    minUpgradeFrom: z.string().max(64).optional(),
  })
  .strip();
export type CompatibilityRules = z.infer<typeof compatibilitySchema>;

export interface ReleaseInfo {
  version: string;
  tag: string;
  name: string;
  url: string;
  publishedAt: string | null;
  prerelease: boolean;
  /** Markdown, untrusted; capped in size. */
  notes: string;
  assets: ReleaseAsset[];
  /** Plugin jars – only when an asset with exactly the documented name exists (never guessed). */
  pluginAssets: { velocity: ReleaseAsset | null; paper: ReleaseAsset | null };
  compatibility: CompatibilityRules | null;
}

const MAX_NOTES = 20_000;
const COMPATIBILITY_MARKER = /<!--\s*nexora-compatibility\s+(\{[\s\S]*?\})\s*-->/;

export function parseCompatibility(body: string | null | undefined): CompatibilityRules | null {
  const match = COMPATIBILITY_MARKER.exec(body ?? '');
  if (!match) return null;
  try {
    const parsed = compatibilitySchema.safeParse(JSON.parse(match[1]));
    if (!parsed.success) return null;
    const rules: CompatibilityRules = {};
    if (parsed.data.minPluginVersion && parseSemVer(parsed.data.minPluginVersion)) rules.minPluginVersion = parsed.data.minPluginVersion;
    if (parsed.data.minUpgradeFrom && parseSemVer(parsed.data.minUpgradeFrom)) rules.minUpgradeFrom = parsed.data.minUpgradeFrom;
    return Object.keys(rules).length ? rules : null;
  } catch {
    return null;
  }
}

export function toReleaseInfo(release: GithubRelease): ReleaseInfo | null {
  const version = parseSemVer(release.tag_name);
  if (!version || release.draft) return null;
  const assets = release.assets.map((a) => ({ name: a.name, size: a.size, url: a.browser_download_url }));
  const exact = (name: string) => assets.find((a) => a.name === name && a.url.startsWith('https://')) ?? null;
  const body = release.body ?? '';
  return {
    version: version.raw,
    tag: release.tag_name,
    name: release.name?.trim() || release.tag_name,
    url: release.html_url,
    publishedAt: release.published_at ?? null,
    // A version with a pre-release suffix is never treated as stable, whatever the flag says.
    prerelease: release.prerelease || version.prerelease.length > 0,
    notes: body.length > MAX_NOTES ? `${body.slice(0, MAX_NOTES)}\n\n…` : body,
    assets,
    pluginAssets: { velocity: exact(`Nexora-Velocity-${version.raw}.jar`), paper: exact(`Nexora-Paper-${version.raw}.jar`) },
    compatibility: parseCompatibility(body),
  };
}

/** Parses an API response (array of releases); invalid entries are skipped. */
export function parseReleases(payload: unknown): ReleaseInfo[] {
  if (!Array.isArray(payload)) throw new Error('Unexpected response from the releases API (not a list)');
  const releases: ReleaseInfo[] = [];
  for (const item of payload) {
    const parsed = githubReleaseSchema.safeParse(item);
    if (!parsed.success) continue;
    const info = toReleaseInfo(parsed.data);
    if (info) releases.push(info);
  }
  return releases;
}

/** Newest release of the channel: stable = no pre-releases; prerelease = both. */
export function latestRelease(releases: ReleaseInfo[], channel: ReleaseChannel): ReleaseInfo | null {
  let best: ReleaseInfo | null = null;
  for (const r of releases) {
    if (channel === 'stable' && r.prerelease) continue;
    if (!best || compareSemVer(parseSemVer(r.version)!, parseSemVer(best.version)!) > 0) best = r;
  }
  return best;
}

export type ComponentState = 'current' | 'outdated' | 'newer' | 'unknown';

/** Installed version against the latest release; "unknown" when either is missing or invalid. */
export function componentState(installed: string | null | undefined, latest: string | null | undefined): ComponentState {
  const c = compareVersions(installed, latest);
  if (c === null) return 'unknown';
  return c < 0 ? 'outdated' : c > 0 ? 'newer' : 'current';
}

/**
 * Plugin ↔ backend compatibility, from documented rules only:
 *  - the release's minPluginVersion (when the installed backend's release publishes one);
 *  - Nexora's release policy: backend, dashboard and plugins of one release share one
 *    version; a different major or minor version is a different feature release whose
 *    plugin protocol is not guaranteed ("incompatible"); patch differences only fix bugs
 *    ("update recommended").
 * Returns "unknown" when a version cannot be parsed – never "compatible" by assumption.
 */
export type PluginCompatibility = 'compatible' | 'recommended' | 'incompatible' | 'unknown';

export function pluginCompatibility(pluginVersion: string | null | undefined, backendVersion: string, rules: CompatibilityRules | null): PluginCompatibility {
  const plugin = parseSemVer(pluginVersion);
  const backend = parseSemVer(backendVersion);
  if (!plugin || !backend) return 'unknown';
  if (rules?.minPluginVersion) {
    const min = parseSemVer(rules.minPluginVersion)!;
    if (compareSemVer(plugin, min) < 0) return 'incompatible';
  }
  if (plugin.major !== backend.major || plugin.minor !== backend.minor) return 'incompatible';
  return compareSemVer(plugin, backend) === 0 ? 'compatible' : 'recommended';
}
