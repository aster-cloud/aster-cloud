import { cn } from '@aster-cloud/ui';

/**
 * MDX callout primitives — render via `<Callout type="...">...</Callout>`.
 *
 * Five tones map to the @aster-cloud/tokens semantic palette so brand
 * theming is automatic. Used inside MDX content; injected globally via
 * mdx-components.tsx.
 *
 * Why server components, not client: callouts are pure presentational
 * wrappers — no state, no effects, no client-only hooks. Keeping them
 * server-rendered avoids unnecessary client bundle bloat across every
 * docs page that uses them.
 */
type CalloutType = 'info' | 'tip' | 'warning' | 'danger' | 'note';

const styles: Record<CalloutType, { wrap: string; label: string }> = {
  info: {
    wrap: 'border-l-4 border-l-info bg-info/5',
    label: 'text-info',
  },
  tip: {
    wrap: 'border-l-4 border-l-success bg-success/5',
    label: 'text-success',
  },
  warning: {
    wrap: 'border-l-4 border-l-warning bg-warning/5',
    label: 'text-warning',
  },
  danger: {
    wrap: 'border-l-4 border-l-danger bg-danger/5',
    label: 'text-danger',
  },
  note: {
    wrap: 'border-l-4 border-l-border bg-bg-soft',
    label: 'text-fg-muted',
  },
};

const labels: Record<CalloutType, string> = {
  info: 'Info',
  tip: 'Tip',
  warning: 'Warning',
  danger: 'Danger',
  note: 'Note',
};

export function Callout({
  type = 'info',
  title,
  children,
}: {
  type?: CalloutType;
  title?: string;
  children: React.ReactNode;
}) {
  const s = styles[type];
  return (
    <div
      className={cn(
        'my-6 rounded-md px-4 py-3 not-prose',
        'text-sm leading-relaxed text-fg',
        s.wrap,
      )}
    >
      <div className={cn('mb-1 text-xs font-semibold uppercase tracking-wider', s.label)}>
        {title ?? labels[type]}
      </div>
      <div className="prose prose-sm prose-zinc dark:prose-invert max-w-none">
        {children}
      </div>
    </div>
  );
}

/**
 * Small wrapper for grouping multiple code blocks with tabs.
 *
 * Usage:
 *   <CodeGroup>
 *     ```bash title="curl"
 *     ...
 *     ```
 *     ```ts title="fetch"
 *     ...
 *     ```
 *   </CodeGroup>
 *
 * Session-2 minimal version: just renders children stacked with a
 * subtle wrap. Tabs UI is left as a future Session 6 polish task —
 * stacked-with-titles is readable enough for technical docs.
 */
export function CodeGroup({ children }: { children: React.ReactNode }) {
  return (
    <div className="my-6 rounded-md border border-border bg-bg-soft p-1">
      {children}
    </div>
  );
}
