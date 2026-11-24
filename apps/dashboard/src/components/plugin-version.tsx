'use client';

import { TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { createContext, type ReactNode, useContext } from 'react';
import type { ServerInfo } from '@/lib/api';
import { pluginCompatibility } from '@/lib/versions';
import { Alert, Badge } from './ui/primitives';

const PlatformVersion = createContext<string>('');

/** Provides the Nexora release version of this dashboard (shared with backend and plugins). */
export function PlatformVersionProvider({ version, children }: { version: string; children: ReactNode }) {
  return <PlatformVersion.Provider value={version}>{children}</PlatformVersion.Provider>;
}

export function usePlatformVersion(): string {
  return useContext(PlatformVersion);
}

/** Badge shown next to a server's plugin version when it does not match this release. */
export function PluginVersionBadge({ pluginVersion }: { pluginVersion: string | null }) {
  const t = useTranslations();
  const platform = usePlatformVersion();
  const state = pluginCompatibility(pluginVersion, platform);
  if (state === 'ok' || state === 'unknown') return null;
  return (
    <Badge variant={state === 'required' ? 'danger' : 'warning'} className="gap-1" title={t(`pluginVersion.${state}Hint`, { plugin: pluginVersion ?? '', platform })}>
      <TriangleAlert aria-hidden className="size-3" />
      {t(`pluginVersion.${state}`)}
    </Badge>
  );
}

/** Summary above server lists: which servers run a plugin from another release. */
export function PluginVersionAlert({ servers }: { servers: ServerInfo[] }) {
  const t = useTranslations();
  const platform = usePlatformVersion();
  const outdated = servers.filter((s) => s.enabled && ['required', 'recommended'].includes(pluginCompatibility(s.pluginVersion, platform)));
  if (outdated.length === 0) return null;
  const required = outdated.some((s) => pluginCompatibility(s.pluginVersion, platform) === 'required');
  return (
    <Alert variant={required ? 'destructive' : 'default'} className="mb-4 grid gap-1">
      <span className="font-medium">{t('pluginVersion.alertTitle', { count: outdated.length, version: platform })}</span>
      <span className="text-sm">
        {outdated.map((s) => `${s.name} (${s.pluginVersion})`).join(', ')} – {t('pluginVersion.alertHint', { version: platform })}
      </span>
    </Alert>
  );
}
