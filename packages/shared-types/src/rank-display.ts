import { humanizeGroupName, minecraftPlainText, parseMinecraftText, type TextSegment } from './minecraft-text';

/**
 * Rank appearance (dashboard only – never used for permission decisions):
 * which text a LuckPerms group shows, in which colours, with which icon. Shared
 * by the backend and the dashboard's live preview so both apply the same rules.
 */

export const RANK_DISPLAY_SOURCES = ['CUSTOM', 'LUCKPERMS_PREFIX', 'LUCKPERMS_DISPLAY_NAME', 'GROUP_NAME'] as const;
export type RankDisplaySource = (typeof RANK_DISPLAY_SOURCES)[number];

/** Stored configuration (without the icon bytes). */
export interface RankDisplayConfig {
  id: string;
  groupName: string;
  enabled: boolean;
  displaySource: string;
  displayName: string | null;
  textColor: string | null;
  backgroundColor: string | null;
  bold: boolean;
  iconText: string | null;
  hasIcon: boolean;
  fallbackText: string | null;
  tooltip: string | null;
  updatedAt: Date;
}

export interface RankSnapshot {
  primaryGroup: string | null;
  groupDisplay: string | null;
  prefix: string | null;
  groups: unknown;
  source: string;
  synchronizedAt: Date;
}

/** What the dashboard renders – structured text, never markup. */
export interface ResolvedRank {
  primaryGroup: string | null;
  /** Plain text of the displayed rank (kept for search, titles and older clients). */
  displayName: string | null;
  /** Plain text of the LuckPerms prefix. */
  prefix: string | null;
  /** First colour of the displayed text (compatibility). */
  color: string | null;
  groups: string[];
  source: string;
  synchronizedAt: string;
  display: {
    /** Which rule produced the text: CUSTOM, LUCKPERMS_DISPLAY_NAME, LUCKPERMS_PREFIX, GROUP_NAME. */
    source: RankDisplaySource;
    segments: TextSegment[];
    textColor: string | null;
    backgroundColor: string | null;
    bold: boolean;
    iconText: string | null;
    /** Backend URL of the uploaded icon (versioned), or null. */
    iconUrl: string | null;
    fallbackText: string | null;
    tooltip: string | null;
  };
}

const plainSegment = (text: string): TextSegment[] => [{ text, color: null, bold: false, italic: false, underlined: false, strikethrough: false, obfuscated: false }];

export function iconUrl(config: Pick<RankDisplayConfig, 'id' | 'hasIcon' | 'updatedAt'>): string | null {
  return config.hasIcon ? `/api/rank-icons/${config.id}?v=${config.updatedAt.getTime()}` : null;
}

/**
 * Display priority:
 * 1. an enabled Nexora rank display for the primary group (its source decides the text);
 * 2. the formatted LuckPerms display name, or the prefix when the display name is just the group name;
 * 3. the human-readable group name;
 * 4. nothing (null – the dashboard shows a neutral fallback).
 */
export function resolveRank(snapshot: RankSnapshot | null, configs: Map<string, RankDisplayConfig>): ResolvedRank | null {
  if (!snapshot) return null;
  const group = snapshot.primaryGroup?.toLowerCase() ?? null;
  const config = group ? configs.get(group) : undefined;
  const custom = config?.enabled ? config : undefined;

  const displayNameSegments = parseMinecraftText(snapshot.groupDisplay);
  const prefixSegments = parseMinecraftText(snapshot.prefix);
  const groupName = group ? humanizeGroupName(group) : '';
  // A display name that is literally the group identifier says less than the prefix.
  const displayIsGroupName = !!group && minecraftPlainText(snapshot.groupDisplay) === group;
  const prefixColor = prefixSegments.find((s) => s.color)?.color ?? null;

  const automatic = (): { source: RankDisplaySource; segments: TextSegment[] } | null => {
    if (displayNameSegments.length && !(displayIsGroupName && prefixSegments.length)) return { source: 'LUCKPERMS_DISPLAY_NAME', segments: displayNameSegments };
    if (prefixSegments.length) return { source: 'LUCKPERMS_PREFIX', segments: prefixSegments };
    if (groupName) return { source: 'GROUP_NAME', segments: plainSegment(groupName) };
    return null;
  };

  let chosen: { source: RankDisplaySource; segments: TextSegment[] } | null = null;
  if (custom) {
    switch (custom.displaySource) {
      case 'CUSTOM':
        if (custom.displayName) chosen = { source: 'CUSTOM', segments: plainSegment(custom.displayName) };
        break;
      case 'LUCKPERMS_PREFIX':
        if (prefixSegments.length) chosen = { source: 'LUCKPERMS_PREFIX', segments: prefixSegments };
        break;
      case 'LUCKPERMS_DISPLAY_NAME':
        if (displayNameSegments.length) chosen = { source: 'LUCKPERMS_DISPLAY_NAME', segments: displayNameSegments };
        break;
      case 'GROUP_NAME':
        if (groupName) chosen = { source: 'GROUP_NAME', segments: plainSegment(groupName) };
        break;
    }
  }
  chosen ??= automatic();
  if (!chosen) return null;

  const text = chosen.segments.map((s) => s.text).join('');
  // A custom text colour overrides the formatting colours (other styles are kept); an
  // unformatted display name takes the prefix colour, as in-game chat usually shows it.
  const accent = custom?.textColor ?? (chosen.source === 'LUCKPERMS_DISPLAY_NAME' && !chosen.segments.some((s) => s.color) ? prefixColor : null);
  const segments = accent ? chosen.segments.map((s) => ({ ...s, color: custom?.textColor ? accent : (s.color ?? accent) })) : chosen.segments;
  return {
    primaryGroup: snapshot.primaryGroup,
    displayName: text,
    prefix: minecraftPlainText(snapshot.prefix) || null,
    color: segments.find((s) => s.color)?.color ?? null,
    groups: Array.isArray(snapshot.groups) ? (snapshot.groups as string[]) : [],
    source: snapshot.source,
    synchronizedAt: snapshot.synchronizedAt.toISOString(),
    display: {
      source: chosen.source,
      segments,
      textColor: custom?.textColor ?? null,
      backgroundColor: custom?.backgroundColor ?? null,
      bold: custom?.bold ?? false,
      iconText: custom?.iconText ?? null,
      iconUrl: custom ? iconUrl(custom) : null,
      fallbackText: custom?.fallbackText ?? null,
      tooltip: custom?.tooltip ?? null,
    },
  };
}
