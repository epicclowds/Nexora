/**
 * Plugin ↔ platform version compatibility. Backend, dashboard and plugins are
 * released together with one version number.
 *   - same version            → ok
 *   - same major.minor        → "recommended" (patch releases are compatible, but update)
 *   - different major/minor   → "required"   (plugin and platform belong to different releases)
 *   - unparseable / missing   → "unknown"    (e.g. development builds; no warning)
 */
export type PluginCompatibility = 'ok' | 'recommended' | 'required' | 'unknown';

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/;

export function pluginCompatibility(pluginVersion: string | null | undefined, platformVersion: string): PluginCompatibility {
  const plugin = SEMVER.exec(pluginVersion?.trim() ?? '');
  const platform = SEMVER.exec(platformVersion.trim());
  if (!plugin || !platform) return 'unknown';
  if (plugin[1] !== platform[1] || plugin[2] !== platform[2]) return 'required';
  if (plugin[0].replace(/^v/, '') !== platform[0].replace(/^v/, '')) return 'recommended';
  return 'ok';
}
