import type { MDXComponents } from 'mdx/types';
import { Callout, CodeGroup } from '@/components/docs/mdx-callouts';
import { TranslationFallbackBanner } from '@/components/docs/TranslationFallbackBanner';

/**
 * Global MDX component overrides.
 *
 * Required by Next.js App Router MDX integration:
 * https://nextjs.org/docs/app/building-your-application/configuring/mdx
 *
 * Globally available inside any `.mdx` file:
 *   - <Callout type="info|tip|warning|danger|note" title="...">…</Callout>
 *   - <CodeGroup>…</CodeGroup>
 *
 * Default HTML elements (h1, p, ul, table, …) flow through unmodified;
 * styling comes from the `prose` Tailwind plugin applied in the docs
 * layout's <article>.
 */
export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    ...components,
    Callout,
    CodeGroup,
    TranslationFallbackBanner,
  };
}
