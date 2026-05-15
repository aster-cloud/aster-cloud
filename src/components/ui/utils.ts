/**
 * Class-name combiner — the single utility every primitive depends on.
 *
 * Why both clsx + tailwind-merge:
 *   - clsx handles conditional class composition (`cn({ active })`)
 *   - tailwind-merge resolves Tailwind conflicts when consumers pass
 *     overriding utilities via `className` prop. Without it, both
 *     `bg-primary` and the consumer's `bg-red-500` would land in the
 *     final string and the LAST one wins by source order, which is
 *     surprising. twMerge guarantees "consumer wins" semantics.
 *
 * Used by every component in this folder. Don't import clsx or twMerge
 * directly elsewhere — go through this wrapper so we can swap
 * implementations centrally later (e.g. if we adopt cn-utils or a faster
 * fork).
 */
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
