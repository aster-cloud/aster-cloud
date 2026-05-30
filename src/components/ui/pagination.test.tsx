/**
 * Smoke tests for the Pagination primitive. Focused on the
 * "must never regress" rules from .claude/plan/list-pagination.md:
 *   - total=0 → no DOM at all (EmptyState owns the empty state)
 *   - single page → status visible, prev/next/numbers hidden
 *   - multi page → numbered window + aria-current on the active page
 *   - disabled prev/next not in the tab order (aria-disabled + sr-only label)
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, args?: Record<string, unknown>) => {
    if (!args) return key;
    return `${key}:${JSON.stringify(args)}`;
  },
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// Mock the design-system Select with a native <select> so the test
// doesn't need the full token CSS pipeline.
vi.mock('@/components/ui', async () => {
  const mod = await vi.importActual<typeof import('@/components/ui')>('@/components/ui');
  return {
    ...mod,
    Select: (props: React.SelectHTMLAttributes<HTMLSelectElement>) => (
      <select {...props}>{props.children}</select>
    ),
    cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
  };
});

import { Pagination } from './pagination';

describe('Pagination', () => {
  afterEach(() => cleanup());

  it('renders nothing when total=0', () => {
    const { container } = render(
      <Pagination
        page={1}
        pageSize={50}
        total={0}
        buildHref={() => '/x'}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('hides numbered controls on a single page but keeps the status line + selector', () => {
    render(
      <Pagination
        page={1}
        pageSize={50}
        total={12}
        buildHref={() => '/x'}
      />,
    );
    // Status line is present (via showing key).
    expect(
      screen.getByText(/showing:\{"start":1,"end":12,"total":12/),
    ).toBeTruthy();
    // No prev/next links.
    expect(screen.queryByRole('link', { name: /previous/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /next/i })).toBeNull();
  });

  it('marks the current page with aria-current and renders prev/next links', () => {
    render(
      <Pagination
        page={2}
        pageSize={25}
        total={100}
        buildHref={({ page }) => `/x?page=${page}`}
      />,
    );
    // Numbered buttons rendered.
    const current = screen.getByText('2');
    expect(current.getAttribute('aria-current')).toBe('page');
    // Prev/next links carry the canonical hrefs.
    const prev = screen.getByLabelText('previous');
    expect(prev.getAttribute('href')).toBe('/x?page=1');
    const next = screen.getByLabelText('next');
    expect(next.getAttribute('href')).toBe('/x?page=3');
  });

  it('renders disabled prev as aria-disabled span on page 1, not a link', () => {
    render(
      <Pagination
        page={1}
        pageSize={25}
        total={100}
        buildHref={({ page }) => `/x?page=${page}`}
      />,
    );
    // No clickable previous link.
    expect(screen.queryByRole('link', { name: /previous/i })).toBeNull();
    // The disabled prev span carries the sr-only label.
    const srOnly = screen
      .getAllByText(/previous/)
      .find((el) => el.className.includes('sr-only'));
    expect(srOnly).toBeTruthy();
    const parent = srOnly?.parentElement;
    expect(parent?.getAttribute('aria-disabled')).toBe('true');
  });
});
