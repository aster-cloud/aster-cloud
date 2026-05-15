/**
 * Skeleton — content-shape placeholder while data loads.
 *
 * One animation, one color (zinc-200 in light / zinc-800 in dark). All
 * variation comes from the consumer's sizing utilities:
 *
 *   <Skeleton className="h-4 w-32" />            // text line
 *   <Skeleton className="h-12 w-12 rounded-full" /> // avatar
 *   <Skeleton className="aspect-video w-full" />   // image/video
 *
 * Why one color: skeletons that try to match the eventual content shape
 * AND color end up looking like glitches. A single neutral surface that
 * the eye reads as "loading" is better than ten flavors.
 *
 * Why `animate-pulse` not a shimmer: pulse is built into Tailwind and
 * GPU-cheap. Shimmer (a moving gradient) requires custom keyframes,
 * needs masking to look right, and on aggregate dashboard pages with 20+
 * skeletons it becomes a perf and noise problem. Pulse wins.
 */
import * as React from 'react';
import { cn } from './utils';

export const Skeleton = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      aria-hidden
      className={cn(
        'animate-pulse rounded-md bg-bg-muted dark:bg-zinc-800',
        className
      )}
      {...props}
    />
  )
);
Skeleton.displayName = 'Skeleton';
