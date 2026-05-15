/**
 * Breadcrumbs primitive.
 *
 * Used at the top of dashboard sub-pages (Policy detail, Settings/API-keys,
 * etc.) so users can step back one level without diving into the browser's
 * back-button history or guessing the URL hierarchy.
 *
 * Lives in src/components/ui because it's a generic layout primitive — no
 * dashboard-specific assumptions about route shapes. Consumers pass a flat
 * list of `{ label, href }` items; the component renders them with chevron
 * separators and treats the last item as the current page (no link, muted
 * styling).
 *
 * a11y: rendered as <nav aria-label="Breadcrumb"> with an inner <ol> so
 * screen readers announce the trail order. The current page uses
 * aria-current="page".
 */
import * as React from 'react';
import { ChevronRight } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { cn } from './utils';

export interface BreadcrumbItem {
  label: string;
  /** Omit on the final/current item; the row will render plain text. */
  href?: string;
}

export interface BreadcrumbsProps {
  items: readonly BreadcrumbItem[];
  className?: string;
}

export function Breadcrumbs({ items, className }: BreadcrumbsProps) {
  // Filter accidental empty items so server-side props that conditionally
  // include intermediate crumbs don't render dangling chevrons.
  const cleaned = items.filter((i) => i.label);
  if (cleaned.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className={cn('flex items-center', className)}>
      <ol className="flex items-center gap-1.5 text-sm">
        {cleaned.map((item, i) => {
          const isLast = i === cleaned.length - 1;
          return (
            <li key={`${item.label}-${i}`} className="flex items-center gap-1.5">
              {i > 0 && (
                <ChevronRight
                  className="size-3.5 shrink-0 text-fg-subtle"
                  aria-hidden
                />
              )}
              {isLast || !item.href ? (
                <span
                  aria-current={isLast ? 'page' : undefined}
                  className={cn(
                    'truncate',
                    isLast ? 'font-medium text-fg' : 'text-fg-muted',
                  )}
                >
                  {item.label}
                </span>
              ) : (
                <Link
                  href={item.href}
                  className="truncate text-fg-muted transition-colors hover:text-fg"
                >
                  {item.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
