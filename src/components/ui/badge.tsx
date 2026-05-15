/**
 * Badge — compact status pill.
 *
 * Variant matrix mirrors Button so palette decisions stay consistent
 * across the app: a "danger" Button and a "danger" Badge land on the same
 * rose hue. We DON'T mirror sizes — badges are intentionally one density
 * (the system one) so they read as labels, not as actions. If a page
 * needs a larger emphasis pill, that's a chip/tag concept and gets its
 * own component later.
 *
 * Subtle vs solid:
 *   - subtle  (default) — semantic-50 bg + semantic-700 text. Reads as
 *               metadata; works on white surfaces and inside cards.
 *   - solid             — semantic-600 bg + white text. Use sparingly,
 *               typically for the single highest-priority status in a row
 *               (e.g. "Default" tag on a policy version list).
 */
import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from './utils';

const badgeVariants = cva(
  [
    'inline-flex items-center gap-1 rounded-full',
    'px-2 py-0.5',
    'font-sans text-xs font-medium leading-none',
    'whitespace-nowrap',
  ].join(' '),
  {
    variants: {
      variant: {
        // Subtle (default)
        neutral: 'bg-bg-muted text-fg',
        primary: 'bg-primary-subtle text-primary',
        accent:  'bg-accent-subtle text-accent',
        success: 'bg-success-subtle text-success',
        warning: 'bg-warning-subtle text-warning',
        danger:  'bg-danger-subtle text-danger',
        // Solid
        'neutral-solid': 'bg-zinc-700 text-white',
        'primary-solid': 'bg-primary text-primary-fg',
        'accent-solid':  'bg-accent text-accent-fg',
        'success-solid': 'bg-success text-success-fg',
        'warning-solid': 'bg-warning text-warning-fg',
        'danger-solid':  'bg-danger text-danger-fg',
        // Outline variant for low-emphasis tags that still need a clear
        // edge against tinted backgrounds.
        outline: 'border border-border text-fg-muted',
      },
    },
    defaultVariants: { variant: 'neutral' },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, ...props }, ref) => (
    <span ref={ref} className={cn(badgeVariants({ variant }), className)} {...props} />
  )
);
Badge.displayName = 'Badge';
