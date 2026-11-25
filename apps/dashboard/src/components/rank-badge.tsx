'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { badgeColors, type MinecraftRank, type RankDisplay, rankDisplayOf, rankIcon, segmentStyle } from '@/lib/rank';
import { cn } from '@/lib/utils';

/**
 * A rank as a badge: formatted text segments (React text nodes – never HTML),
 * an optional icon and the configured colours. Used everywhere a rank appears,
 * and by the rank display editor's live preview.
 */
export function RankLabel({ display, title, className }: { display: RankDisplay; title?: string; className?: string }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const colors = badgeColors(display);
  const icon = rankIcon(display, failedUrl !== null && failedUrl === display.iconUrl);
  const text = display.segments.map((s) => s.text).join('');
  if (!text && !icon) return null;
  return (
    <span
      className={cn('inline-flex max-w-full items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium leading-5', !colors.background && 'bg-muted', className)}
      style={{
        color: colors.color ?? undefined,
        backgroundColor: colors.background ?? undefined,
        borderColor: colors.color ? `${colors.color}55` : undefined,
      }}
      title={title}
      data-rank-source={display.source}
    >
      {icon?.kind === 'image' && (
        // Inert raster image served by the backend (content-checked on upload); falls back to text when it fails.
        <img src={icon.url} alt="" width={14} height={14} className="size-3.5 shrink-0 object-contain [image-rendering:pixelated]" onError={() => setFailedUrl(display.iconUrl)} />
      )}
      {icon?.kind === 'text' && (
        <span aria-hidden className="shrink-0">
          {icon.text}
        </span>
      )}
      <span className="truncate">
        {display.segments.map((segment, i) => (
          <span key={i} style={segmentStyle(segment, display.bold)}>
            {segment.text}
          </span>
        ))}
      </span>
    </span>
  );
}

/** LuckPerms rank of a player (nothing when unknown – never invented). */
export function RankBadge({ rank, className }: { rank: MinecraftRank | null | undefined; className?: string }) {
  const t = useTranslations();
  if (!rank) return null;
  const display = rankDisplayOf(rank);
  if (!display) return null;
  const title = display.tooltip ?? t('staff.rankTitle', { group: rank.primaryGroup ?? '–', groups: rank.groups.join(', ') || '–' });
  return <RankLabel display={display} title={title} className={className} />;
}
