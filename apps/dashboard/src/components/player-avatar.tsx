import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils';

/** Lettered avatar with a colour derived from the UUID – the fallback when no skin is available. */
export function PlayerAvatar({ uuid, username, className, style }: { uuid: string; username: string; className?: string; style?: CSSProperties }) {
  const hue = parseInt(uuid.replace(/-/g, '').slice(0, 6), 16) % 360;
  return (
    <span
      aria-hidden
      className={cn('inline-flex size-8 shrink-0 items-center justify-center rounded-md font-mono text-sm font-bold text-white', className)}
      style={{ background: `oklch(0.55 0.12 ${Number.isFinite(hue) ? hue : 0})`, ...style }}
    >
      {username.slice(0, 1).toUpperCase()}
    </span>
  );
}
