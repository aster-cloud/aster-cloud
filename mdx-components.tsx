import type { MDXComponents } from 'mdx/types';

/**
 * Global MDX component overrides.
 *
 * Required by Next.js App Router MDX integration. See:
 * https://nextjs.org/docs/app/building-your-application/configuring/mdx
 *
 * Session 1: identity mapping (use default HTML for everything).
 * Session 2 will inject brand-styled <Callout>, <CodeGroup>, etc.
 */
export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    ...components,
  };
}
