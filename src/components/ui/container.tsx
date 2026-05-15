/**
 * Container — max-width content wrapper.
 *
 * Mirrors the token spacing.containers map:
 *   prose  65ch  long-form text (legal pages, blog)
 *   narrow 640px focused forms (login, signup)
 *   base   768px default page width
 *   wide   1024px dashboard pages
 *   xl     1280px marketing surfaces
 *   2xl    1440px hero / full-bleed layouts
 *
 * Why centralize this: every marketing page today picks its own
 * max-w-*. Page-to-page consistency requires the SAME width across hero
 * + features + CTA blocks, and that's what a token-bound Container
 * guarantees.
 *
 * Padding-x defaults to px-4 on mobile, px-6 sm and up — small enough
 * that text doesn't crash into the viewport edge but not so big that
 * narrow mobile screens feel half-empty.
 */
import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from './utils';

// Arbitrary widths via Tailwind's max-w-[…] escape hatch. Tailwind 4
// doesn't carry the v3 preset's named maxWidth scale through @theme by
// default, and adding eight aliases in globals.css just to spell these
// is a worse trade than the bracket syntax — which compiles to a single
// utility class and stays self-documenting at the call site.
const containerVariants = cva('mx-auto w-full px-4 sm:px-6', {
  variants: {
    size: {
      prose:  'max-w-[65ch]',
      narrow: 'max-w-[640px]',
      base:   'max-w-[768px]',
      wide:   'max-w-[1024px]',
      xl:     'max-w-[1280px]',
      '2xl':  'max-w-[1440px]',
    },
  },
  defaultVariants: { size: 'wide' },
});

export interface ContainerProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof containerVariants> {
  as?: keyof React.JSX.IntrinsicElements;
}

export const Container = React.forwardRef<HTMLDivElement, ContainerProps>(
  ({ className, size, as: Tag = 'div', ...props }, ref) => {
    const Component = Tag as React.ElementType;
    return (
      <Component
        ref={ref}
        className={cn(containerVariants({ size }), className)}
        {...props}
      />
    );
  }
);
Container.displayName = 'Container';
