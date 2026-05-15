/**
 * Select — native <select> dropdown, styled to match Input.
 *
 * Why native instead of a Radix/Headless combobox: 90% of our selects are
 * short (≤ 10 options: plan tier, locale, role). Native gets us iOS/Android
 * wheel pickers for free, full keyboard navigation, and zero runtime JS.
 *
 * When we later need search/filter/virtualized lists (e.g. a tenant
 * picker), introduce a separate Combobox primitive — don't try to bolt
 * those onto Select.
 *
 * Heights match Input so a side-by-side label+input+select row stays
 * baseline-aligned.
 */
import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { ChevronDown } from 'lucide-react';
import { cn } from './utils';

const selectVariants = cva(
  [
    'flex w-full appearance-none rounded-md border bg-bg pr-9 text-fg',
    'font-sans',
    'transition-colors duration-fast ease-standard',
    'focus-visible:outline-none focus-visible:border-primary focus-visible:shadow-ring',
    'disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-bg-muted',
  ].join(' '),
  {
    variants: {
      size: {
        sm: 'h-8 pl-2.5 text-xs',
        md: 'h-10 pl-3 text-sm',
        lg: 'h-12 pl-4 text-base',
      },
      state: {
        default: 'border-border',
        invalid: 'border-danger focus-visible:border-danger',
      },
    },
    defaultVariants: { size: 'md', state: 'default' },
  }
);

export interface SelectProps
  // Omit native `size` (which means visible rows for select) so our
  // variant prop wins. Pages that want a multi-line list-box would use a
  // different component.
  extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size'>,
    VariantProps<typeof selectVariants> {}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, size, state, children, ...props }, ref) => (
    // Wrapper exists only to position the chevron icon over the native
    // dropdown arrow (which we hide via appearance-none above).
    <div className="relative w-full">
      <select
        ref={ref}
        className={cn(selectVariants({ size, state }), className)}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-fg-muted"
      />
    </div>
  )
);
Select.displayName = 'Select';
