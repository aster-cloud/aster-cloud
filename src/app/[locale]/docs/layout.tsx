import { setRequestLocale } from 'next-intl/server';
import { locales } from '@/i18n/config';
import { DocsTopNav } from '@/components/docs/DocsTopNav';
import { DocsSidebar } from '@/components/docs/DocsSidebar';
import { DocsTOC } from '@/components/docs/DocsTOC';
import { DocsBreadcrumb } from '@/components/docs/DocsBreadcrumb';

/**
 * Docs subtree is fully static — content is repo-owned MDX,
 * frontend chrome reads only from i18n bundles + the URL.
 *
 * Force-static here tells Next not to inherit the parent locale
 * layout's `headers()` call at request time. The CSP nonce that the
 * parent layout reads still applies to dynamic dashboard/auth pages;
 * docs pages just don't need the per-request inline-script wiring.
 *
 * Combined with the per-page generateStaticParams emitted by the
 * route wrappers (Sessions 3-4), Cloudflare Workers serve compiled
 * RSC + HTML directly from the CDN edge without Worker CPU.
 */
export const dynamic = 'force-static';

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

/**
 * Docs subsite layout — Session 2 chrome.
 *
 * Structure (top→bottom, left→right):
 *   fixed top:  <DocsTopNav>           — brand · language · open console
 *   left:       <DocsSidebar>          — section/page tree (lg+ only)
 *   center:     <main><article>{mdx}</article></main> — prose content
 *   right:      <DocsTOC>              — auto h2/h3 outline (xl+ only)
 *
 * Layout choices:
 *   - Fixed top nav (h-16) — content gets pt-16 to clear it.
 *   - Sidebar collapses below lg (1024px) — small screens get pure content.
 *   - TOC collapses below xl (1280px) — laptops drop it to give the
 *     article more horizontal room.
 *   - `.docs-article` class is the IntersectionObserver root in
 *     <DocsTOC>; do not rename without updating both.
 */
type Props = {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
};

export default async function DocsLayout({ children, params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <div className="min-h-screen bg-bg">
      <DocsTopNav />
      <div className="mx-auto flex max-w-[1400px] pt-16">
        <DocsSidebar />
        <main className="min-w-0 flex-1 px-4 sm:px-6 lg:px-8 py-10">
          <DocsBreadcrumb />
          <article
            className="docs-article prose prose-zinc dark:prose-invert max-w-3xl"
          >
            {children}
          </article>
        </main>
        <DocsTOC />
      </div>
    </div>
  );
}
