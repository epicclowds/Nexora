import type { TextSegment } from '@mnm/shared-types';
import type { CSSProperties } from 'react';

/**
 * Rank appearance helpers. Ranks arrive from the backend already parsed into
 * text segments (never markup); these helpers only turn validated values into
 * inline styles, so nothing from LuckPerms or a rank configuration can inject
 * HTML or CSS.
 */

export type RankDisplaySource = 'CUSTOM' | 'LUCKPERMS_PREFIX' | 'LUCKPERMS_DISPLAY_NAME' | 'GROUP_NAME';

export interface RankDisplay {
  source: RankDisplaySource;
  segments: TextSegment[];
  textColor: string | null;
  backgroundColor: string | null;
  bold: boolean;
  iconText: string | null;
  iconUrl: string | null;
  fallbackText: string | null;
  tooltip: string | null;
}

export interface MinecraftRank {
  primaryGroup: string | null;
  /** Plain text of the displayed rank. */
  displayName: string | null;
  prefix: string | null;
  color: string | null;
  groups: string[];
  source: string;
  synchronizedAt: string;
  /** Structured display (backend 1.4.0+). */
  display?: RankDisplay;
}

const HEX = /^#[0-9A-F]{6}$/i;

export function safeColor(value: string | null | undefined): string | null {
  return value && HEX.test(value) ? value.toUpperCase() : null;
}

/** WCAG relative luminance of a #RRGGBB colour. */
export function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** WCAG contrast ratio (1–21). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Minimum contrast for normal text (WCAG AA). */
export const MIN_CONTRAST = 4.5;

/** Neutral badge backgrounds used when a rank has a colour but no background of its own. */
export const BADGE_DARK = '#18181B';
export const BADGE_LIGHT = '#F4F4F5';

/**
 * Badge colours. Minecraft colours are made for a dark chat background, so a
 * coloured rank without its own background gets whichever neutral background
 * (dark or light) reads better – the same in the light and the dark theme. A
 * configured background is used as is (the editor warns about low contrast).
 */
export function badgeColors(display: Pick<RankDisplay, 'segments' | 'textColor' | 'backgroundColor'>): { color: string | null; background: string | null; contrast: number | null } {
  const color = safeColor(display.textColor) ?? safeColor(display.segments.find((s) => s.color)?.color);
  const configured = safeColor(display.backgroundColor);
  if (!color) return { color: null, background: configured, contrast: null };
  if (configured) return { color, background: configured, contrast: contrastRatio(color, configured) };
  const dark = contrastRatio(color, BADGE_DARK);
  const light = contrastRatio(color, BADGE_LIGHT);
  return dark >= light ? { color, background: BADGE_DARK, contrast: dark } : { color, background: BADGE_LIGHT, contrast: light };
}

/** Inline style of one text segment (validated colour plus text styles; nothing else). */
export function segmentStyle(segment: TextSegment, boldAll = false): CSSProperties {
  const decorations = [segment.underlined && 'underline', segment.strikethrough && 'line-through'].filter(Boolean).join(' ');
  return {
    color: safeColor(segment.color) ?? undefined,
    fontWeight: segment.bold || boldAll ? 700 : undefined,
    fontStyle: segment.italic ? 'italic' : undefined,
    textDecorationLine: decorations || undefined,
  };
}

/** Private-use characters (resource-pack font glyphs) cannot be shown by browsers. */
export function hasPrivateUseGlyph(text: string | null | undefined): boolean {
  return !!text && /[-]|[\u{F0000}-\u{FFFFD}]|[\u{100000}-\u{10FFFD}]/u.test(text);
}

/** Icon to show before the name: the uploaded image, else displayable icon text (glyphs fall back to the fallback text). */
export function rankIcon(display: Pick<RankDisplay, 'iconUrl' | 'iconText' | 'fallbackText'>, imageFailed: boolean): { kind: 'image'; url: string } | { kind: 'text'; text: string } | null {
  if (display.iconUrl && display.iconUrl.startsWith('/api/rank-icons/') && !imageFailed) return { kind: 'image', url: display.iconUrl };
  const text = display.iconText && !hasPrivateUseGlyph(display.iconText) ? display.iconText : display.fallbackText;
  return text ? { kind: 'text', text } : null;
}

/** Display of a rank, also for responses from older backends (plain name and colour only). */
export function rankDisplayOf(rank: MinecraftRank): RankDisplay | null {
  if (rank.display) return rank.display;
  const text = rank.displayName ?? rank.primaryGroup;
  if (!text) return null;
  return {
    source: 'LUCKPERMS_DISPLAY_NAME',
    segments: [{ text, color: safeColor(rank.color), bold: false, italic: false, underlined: false, strikethrough: false, obfuscated: false }],
    textColor: null,
    backgroundColor: null,
    bold: false,
    iconText: null,
    iconUrl: null,
    fallbackText: null,
    tooltip: null,
  };
}
