/**
 * MDX module augmentation.
 *
 * `@next/mdx` + `remark-mdx-frontmatter` configure each .mdx to emit
 * `export const frontmatter = { ... }` (see next.config.ts:24). The
 * default `@types/mdx` shape only describes the default export, so
 * the per-route page wrappers can't type-import `frontmatter`. Declare
 * the augmentation here once for all docs MDX.
 */
declare module '*.mdx' {
  import type { ComponentType } from 'react';

  /** YAML frontmatter exposed as a runtime object via remark-mdx-frontmatter. */
  export const frontmatter: {
    title?: string;
    description?: string;
    [key: string]: unknown;
  } | undefined;

  const Component: ComponentType;
  export default Component;
}
