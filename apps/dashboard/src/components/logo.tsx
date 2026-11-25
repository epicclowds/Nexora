import { cn } from '@/lib/utils';

/** Nexora mark: a rounded square with a geometric "N". Decorative (the name is always next to it). */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn('size-8 shrink-0', className)} aria-hidden>
      <rect width="32" height="32" rx="8" className="fill-primary" />
      <path d="M10 22V10h2.6l6.8 7.9V10H22v12h-2.6l-6.8-7.9V22z" className="fill-primary-foreground" />
    </svg>
  );
}
