import { cn } from '@/lib/utils';

/**
 * Placeholder avatar derived from the UUID. Skin and head rendering (Phase 4)
 * will be served through the backend so no third-party service sees dashboard
 * traffic by default.
 */
export function PlayerAvatar({ uuid, username, className }: { uuid: string; username: string; className?: string }) {
  const hue = parseInt(uuid.replace(/-/g, '').slice(0, 6), 16) % 360;
  return (
    <span
      aria-hidden
      className={cn('inline-flex size-8 shrink-0 items-center justify-center rounded-md font-mono text-sm font-bold text-white', className)}
      style={{ background: `oklch(0.55 0.12 ${hue})` }}
    >
      {username.slice(0, 1).toUpperCase()}
    </span>
  );
}
