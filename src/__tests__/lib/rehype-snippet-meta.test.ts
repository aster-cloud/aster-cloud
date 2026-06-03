/**
 * Unit tests for the rehype-snippet-meta plugin.
 *
 * We construct minimal HAST trees that match the post-`rehype-pretty-code`
 * shape — `<pre data-language=…><code data={meta: …}>…</code></pre>` —
 * plus the historic `<pre data-meta=…>` / `<pre metastring=…>` fall-
 * back shapes the plugin still tolerates. This avoids spinning up the
 * full MDX pipeline in the test while still exercising the exact
 * transformation that ships in production.
 */

import { describe, it, expect } from 'vitest';
import { rehypeSnippetMeta } from '@/lib/mdx/rehype-snippet-meta';

// Local HAST-shape mock — see rehype-snippet-meta.ts for why we don't
// import `hast` types directly. Mirrors the production HastNode type
// exactly so test inputs cannot drift from what the plugin accepts.
type HastNode = {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
  data?: Record<string, unknown>;
  value?: string;
};

function makePre(properties: Record<string, string>): HastNode {
  return {
    type: 'root',
    children: [
      {
        type: 'element',
        tagName: 'pre',
        properties: { ...properties },
        children: [
          {
            type: 'element',
            tagName: 'code',
            properties: {},
            children: [{ type: 'text', value: 'sample' }],
          },
        ],
      },
    ],
  };
}

function getPreProps(tree: HastNode): Record<string, unknown> {
  const pre = tree.children![0];
  return pre.properties as Record<string, unknown>;
}

describe('rehypeSnippetMeta', () => {
  it('emits data-snippet-playground when meta contains playground=true', () => {
    const tree = makePre({
      'data-language': 'bash',
      'data-meta': '{playground=true,id=evaluate-curl}',
    });
    rehypeSnippetMeta()(tree);
    const props = getPreProps(tree);
    expect(props['data-snippet-playground']).toBe('true');
    expect(props['data-snippet-id']).toBe('evaluate-curl');
    expect(props['data-snippet-lang']).toBe('bash');
  });

  it('does not emit data-snippet-playground when meta omits the flag', () => {
    const tree = makePre({
      'data-language': 'json',
      'data-meta': '{id=schema-example}',
    });
    rehypeSnippetMeta()(tree);
    const props = getPreProps(tree);
    expect(props['data-snippet-playground']).toBeUndefined();
    expect(props['data-snippet-id']).toBe('schema-example');
    expect(props['data-snippet-lang']).toBe('json');
  });

  it('mirrors data-language to data-snippet-lang when meta omits language', () => {
    const tree = makePre({ 'data-language': 'typescript' });
    rehypeSnippetMeta()(tree);
    expect(getPreProps(tree)['data-snippet-lang']).toBe('typescript');
  });

  it('honors explicit language= override in meta', () => {
    const tree = makePre({
      'data-language': 'bash',
      'data-meta': '{playground=true,id=foo,language=rego}',
    });
    rehypeSnippetMeta()(tree);
    expect(getPreProps(tree)['data-snippet-lang']).toBe('rego');
  });

  it('is idempotent — re-running yields the same attributes', () => {
    const tree = makePre({
      'data-language': 'bash',
      'data-meta': '{playground=true,id=foo}',
    });
    rehypeSnippetMeta()(tree);
    rehypeSnippetMeta()(tree);
    const props = getPreProps(tree);
    expect(props['data-snippet-playground']).toBe('true');
    expect(props['data-snippet-id']).toBe('foo');
  });

  it('tolerates malformed meta gracefully', () => {
    const tree = makePre({
      'data-language': 'bash',
      'data-meta': '{nonsense without equals}',
    });
    rehypeSnippetMeta()(tree);
    const props = getPreProps(tree);
    expect(props['data-snippet-playground']).toBeUndefined();
    expect(props['data-snippet-id']).toBeUndefined();
    // language still mirrored.
    expect(props['data-snippet-lang']).toBe('bash');
  });

  it('reads meta from code.data.meta (post-rehype-pretty-code shape)', () => {
    // Regression: rehype-pretty-code @0.14.x stashes the raw fence
    // info string on `code.data.meta`, NOT on `pre.properties[data-meta]`.
    // An earlier version of this plugin missed that and silently
    // failed to surface `playground=true,id=…` on real builds.
    const tree: HastNode = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'pre',
          properties: { 'data-language': 'bash' },
          children: [
            {
              type: 'element',
              tagName: 'code',
              properties: {},
              data: { meta: '{playground=true,id=evaluate-curl}' },
              children: [],
            },
          ],
        },
      ],
    };
    rehypeSnippetMeta()(tree);
    const props = getPreProps(tree);
    expect(props['data-snippet-playground']).toBe('true');
    expect(props['data-snippet-id']).toBe('evaluate-curl');
    expect(props['data-snippet-lang']).toBe('bash');
  });

  it('does not decorate non-pre elements', () => {
    const tree: HastNode = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'code',
          properties: { 'data-meta': '{playground=true,id=x}' },
          children: [],
        },
      ],
    };
    rehypeSnippetMeta()(tree);
    const code = tree.children![0];
    expect((code.properties as Record<string, unknown>)['data-snippet-playground']).toBeUndefined();
  });
});
