/**
 * Input — text/number/email/password field.
 *
 * Heights aligned with Button so a label+input+button row sits on the same
 * baseline grid: sm=32, md=40, lg=48 px. Most pages will use md.
 *
 * Why no left-icon slot here: when an icon is needed (search, currency
 * prefix, etc.) wrap the Input in a relative container with absolute-
 * positioned icon. Building a full Field shell with slots multiplied the
 * variants on shadcn's Input by 4× without buying real value — keep this
 * one minimal and let pages compose.
 *
 * Focus ring: shadow-ring is a brand-tinted token (violet @ 35%), so the
 * keyboard-focus outline lands on-brand without us repeating the color.
 */
import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from './utils';

const inputVariants = cva(
  [
    'flex w-full rounded-md border bg-bg text-fg',
    'placeholder:text-fg-subtle',
    'font-sans',
    'transition-colors duration-fast ease-standard',
    'focus-visible:outline-none focus-visible:border-primary focus-visible:shadow-ring',
    'disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-bg-muted',
    'file:border-0 file:bg-transparent file:font-medium file:text-fg',
  ].join(' '),
  {
    variants: {
      size: {
        sm: 'h-8 px-2.5 text-xs',
        md: 'h-10 px-3 text-sm',
        lg: 'h-12 px-4 text-base',
      },
      state: {
        default: 'border-border',
        invalid: 'border-danger focus-visible:border-danger focus-visible:shadow-[0_0_0_3px_rgb(244_63_94/0.30)]',
      },
    },
    defaultVariants: { size: 'md', state: 'default' },
  }
);

export interface InputProps
  // Omit `size` from native attrs — it collides with our variant prop
  // (native input.size is a width hint in chars; nobody uses it).
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'>,
    VariantProps<typeof inputVariants> {}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, size, state, type = 'text', ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(inputVariants({ size, state }), className)}
      {...props}
    />
  )
);
Input.displayName = 'Input';
