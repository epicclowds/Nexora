import { cn } from '@/lib/utils';

// 8x8 pixel grass block: top rows grass, the rest dirt. Purely decorative.
const PIXELS = [
  'GGGGGGGG',
  'GgGGgGGG',
  'GGdGGGgG',
  'dDdddDdd',
  'ddDddddD',
  'dddDdDdd',
  'dDdddddd',
  'ddddDddD',
];
const COLORS: Record<string, string> = { G: '#5dbb46', g: '#4a9e36', d: '#8b5a2b', D: '#6e4521' };

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 8 8" className={cn('pixelated size-8 shrink-0 rounded-sm', className)} aria-hidden shapeRendering="crispEdges">
      {PIXELS.flatMap((row, y) => [...row].map((c, x) => <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill={COLORS[c]} />))}
    </svg>
  );
}
