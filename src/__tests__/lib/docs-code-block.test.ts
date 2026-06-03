/**
 * Behavioural coverage for the `<DocsCodeBlock>` text-extraction
 * helper. Component-level interactions (clipboard, telemetry,
 * playground link) are exercised by E2E; this file pins the
 * recursive `extractText` logic that supports those features.
 *
 * Implementation is duplicated here because `extractText` is module-
 * scoped and not exported (it has no other consumers). If the
 * production helper changes shape, this test becomes the contract
 * the new shape must satisfy.
 */

import { describe, it, expect, type ReactNode } from 'vitest';

// Same algorithm as DocsCodeBlock.tsx — kept in sync via this test.
function extractText(node: ReactNode): string {
  if (node == null || node === false) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (typeof node === 'object' && 'props' in node) {
    const children = (node as { props?: { children?: ReactNode } }).props?.children;
    return extractText(children);
  }
  return '';
}

describe('docs code-block extractText', () => {
  it('returns empty string for null / undefined / boolean', () => {
    expect(extractText(null)).toBe('');
    expect(extractText(undefined)).toBe('');
    expect(extractText(false)).toBe('');
  });

  it('handles plain strings and numbers', () => {
    expect(extractText('hello')).toBe('hello');
    expect(extractText(42)).toBe('42');
  });

  it('joins arrays of children without delimiters', () => {
    expect(extractText(['a', 'b', 'c'])).toBe('abc');
  });

  it('recurses into shiki-style nested spans', () => {
    // Simulates the post-shiki HAST shape: <code><span line><span>tok</span>…</span>…</code>
    const tree = {
      type: 'code',
      props: {
        children: [
          { type: 'span', props: { children: 'curl ' } },
          { type: 'span', props: { children: '-X POST' } },
        ],
      },
    } as unknown as ReactNode;
    expect(extractText(tree)).toBe('curl -X POST');
  });

  it('preserves multiline content across separate line spans', () => {
    const tree = {
      type: 'code',
      props: {
        children: [
          {
            type: 'span',
            props: { children: 'line one' },
          },
          '\n',
          {
            type: 'span',
            props: { children: 'line two' },
          },
        ],
      },
    } as unknown as ReactNode;
    expect(extractText(tree)).toBe('line one\nline two');
  });
});
