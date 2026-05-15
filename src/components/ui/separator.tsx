/**
 * Separator — semantic divider line.
 *
 * Two orientations:
 *   - horizontal (default) — 1px high, full width
 *   - vertical             — 1px wide, requires parent to have explicit
 *     height (the parent's flex/grid layout decides where it sits).
 *
 * Why this exists beyond `<hr/>`:
 *   - <hr> is block-level and adds margins by default; ours has none so
 *     the consuming layout (Stack's gap, flex's gap) controls rhythm.
 *   - "decorative" prop adds role="presentation" so screen readers don't
 *     announce "separator" between every card section. Set role="separator"
 *     by leaving decorative=false (rare; usually you want it decorative).
 */
import * as React from 'react';
import { cn } from './utils';

export interface SeparatorProps extends React.HTMLAttributes<HTMLDivElement> {
  orientation?: 'horizontal' | 'vertical';
  decorative?: boolean;
}

export const Separator = React.forwardRef<HTMLDivElement, SeparatorProps>(
  ({ className, orientation = 'horizontal', decorative = true, ...props }, ref) => (
    <div
      ref={ref}
      role={decorative ? 'presentation' : 'separator'}
      aria-orientation={orientation}
      className={cn(
        'shrink-0 bg-border',
        orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
        className
      )}
      {...props}
    />
  )
);
Separator.displayName = 'Separator';
