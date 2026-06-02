import { setRequestLocale } from 'next-intl/server';

/**
 * Docs subsite layout — minimal Session-1 scaffold.
 *
 * Real chrome (left sidebar, right TOC, breadcrumb, top nav) lands in
 * Session 2 — see .claude/plan/cloud-docs-subsite.md §4. This shell
 * only proves the route works end-to-end through MDX → SSR → Worker.
 *
 * Inner — wraps each /docs/* page inside the existing locale layout
 * (html / fonts / theme / intl already provided by [locale]/layout.tsx).
 */
type Props = {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
};

export default async function DocsLayout({ children, params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 py-12">
        <article className="prose prose-zinc dark:prose-invert max-w-none">
          {children}
        </article>
      </main>
    </div>
  );
}
