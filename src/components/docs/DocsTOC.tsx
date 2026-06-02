'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

type Heading = {
  id: string;
  text: string;
  level: 2 | 3;
};

/**
 * Right rail TOC for /docs/*.
 *
 * Extracts h2/h3 headings from the rendered article on mount + observes
 * which heading is currently in view via IntersectionObserver. Pure
 * client-side — no remark plugin needed.
 *
 * Headings get their `id` from `rehype-slug` at build time (see
 * next.config.ts rehype chain). We only need to read what's already
 * baked into the DOM.
 */
export function DocsTOC() {
  const t = useTranslations();
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    const article = document.querySelector('article.docs-article');
    if (!article) return;

    const nodes = Array.from(article.querySelectorAll<HTMLElement>('h2, h3'));
    const extracted: Heading[] = nodes
      .filter((n) => n.id) // only headings rehype-slug actually slugged
      .map((n) => ({
        id: n.id,
        text: n.textContent ?? '',
        level: n.tagName === 'H2' ? 2 : 3,
      }));
    setHeadings(extracted);

    // IntersectionObserver — track topmost in-view heading.
    if (extracted.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveId(visible[0].target.id);
      },
      {
        // Trigger as headings enter the top 25% of the viewport so the
        // active state lags real reading position by less than a screen.
        rootMargin: '0px 0px -75% 0px',
        threshold: 0,
      },
    );
    nodes.forEach((n) => n.id && observer.observe(n));
    return () => observer.disconnect();
  }, []);

  if (headings.length === 0) return null;

  return (
    <aside
      className="hidden xl:block w-56 shrink-0"
      aria-label={t('docs.toc.ariaLabel')}
    >
      <div className="sticky top-16 max-h-[calc(100vh-4rem)] overflow-y-auto px-6 py-8">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-fg-muted">
          {t('docs.toc.title')}
        </p>
        <ul className="space-y-2 text-sm">
          {headings.map((h) => (
            <li key={h.id} className={h.level === 3 ? 'pl-4' : ''}>
              <a
                href={`#${h.id}`}
                className={
                  activeId === h.id
                    ? 'block text-fg font-medium'
                    : 'block text-fg-muted transition-colors hover:text-fg'
                }
              >
                {h.text}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
