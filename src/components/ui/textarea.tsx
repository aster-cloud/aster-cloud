/**
 * Textarea — multiline text field.
 *
 * Same visual language as Input but no size variants (textareas resize
 * vertically anyway; height is controlled by `rows` or explicit style).
 * The `invalid` state ring mirrors Input for form-error consistency.
 */
import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from './utils';

const textareaVariants = cva(
  [
    'flex min-h-20 w-full rounded-md border bg-bg px-3 py-2 text-sm text-fg',
    'placeholder:text-fg-subtle',
    'font-sans leading-relaxed',
    'transition-colors duration-fast ease-standard',
    'focus-visible:outline-none focus-visible:border-primary focus-visible:shadow-ring',
    'disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-bg-muted',
    'resize-y',
  ].join(' '),
  {
    variants: {
      state: {
        default: 'border-border',
        invalid: 'border-danger focus-visible:border-danger focus-visible:shadow-[0_0_0_3px_rgb(244_63_94/0.30)]',
      },
    },
    defaultVariants: { state: 'default' },
  }
);

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement>,
    VariantProps<typeof textareaVariants> {}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, state, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(textareaVariants({ state }), className)}
      {...props}
    />
  )
);
Textarea.displayName = 'Textarea';
