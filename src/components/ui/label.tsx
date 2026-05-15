/**
 * Label — form-control label.
 *
 * Why this exists when <label> is already a native element: enforcing
 * consistent typography (text-sm + font-medium) and the disabled-peer
 * cascade. Wrap a control in a peer/group so the label dims when the
 * control disables:
 *
 *   <Label htmlFor="email" className="peer-disabled:opacity-50">…</Label>
 *   <Input id="email" className="peer" disabled />
 *
 * Keeps form blocks visually coherent without bespoke CSS per page.
 */
import * as React from 'react';
import { cn } from './utils';

/** Label has no props of its own yet — alias the native label attributes
 *  so consumers still see a `LabelProps` symbol if they want to type a
 *  wrapper. ESLint flags empty interfaces; type alias is the idiomatic
 *  pass-through. */
export type LabelProps = React.LabelHTMLAttributes<HTMLLabelElement>;

export const Label = React.forwardRef<HTMLLabelElement, LabelProps>(
  ({ className, ...props }, ref) => (
    <label
      ref={ref}
      className={cn(
        'text-sm font-medium leading-none text-fg',
        'peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
);
Label.displayName = 'Label';
