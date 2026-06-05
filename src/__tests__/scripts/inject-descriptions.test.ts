/**
 * Unit tests for the docs description-injection extraction logic.
 *
 * These lock the edge cases a multi-model review flagged in the original
 * line-by-line implementation: fenced code blocks, leading JSX/Callout
 * blocks, lists/blockquotes, CJK truncation, the truncate length bound,
 * and the YAML escape ↔ search-index round trip.
 */
import { describe, it, expect } from 'vitest';
import {
  deriveDescription,
  truncate,
  stripMarkdown,
  escapeYaml,
  splitFrontmatter,
  frontmatterDescription,
  isSkippable,
} from '../../../scripts/docs-migration/inject-descriptions.mjs';
// The search-index builder's frontmatter parser must read descriptions
// IDENTICALLY to the injector/guard — otherwise a value can pass the
// non-empty CI guard yet land empty/corrupted in the search index.
import { parseFrontmatter } from '../../../scripts/docs-migration/build-docs-index.mjs';

describe('deriveDescription — prose extraction', () => {
  it('takes the first real prose paragraph after the H1', () => {
    const body = '\n# Quick Start\n\nEvaluate a deployed policy by name. It must exist first.\n\nMore text.';
    expect(deriveDescription(body)).toBe(
      'Evaluate a deployed policy by name. It must exist first.',
    );
  });

  it('skips a leading JSX/Callout block and uses the prose after it', () => {
    const body = [
      '# Audit Logs',
      '',
      '<Callout type="tip" title="Scope">',
      'These endpoints are served by aster-api.',
      '</Callout>',
      '',
      'The real summary paragraph lives here.',
    ].join('\n');
    expect(deriveDescription(body)).toBe('The real summary paragraph lives here.');
  });

  it('does NOT leak fenced code block contents into the description', () => {
    const body = [
      '# Example',
      '',
      '```bash',
      'curl -X POST https://example.com/api  # not a description',
      'echo "should never appear"',
      '```',
      '',
      'This sentence is the actual description.',
    ].join('\n');
    const d = deriveDescription(body);
    expect(d).toBe('This sentence is the actual description.');
    expect(d).not.toContain('curl');
    expect(d).not.toContain('should never appear');
  });

  it('skips list items and blockquotes', () => {
    const body = [
      '# Heading',
      '',
      '- list item one',
      '- list item two',
      '',
      '> a blockquote',
      '',
      'Prose after the structured blocks.',
    ].join('\n');
    expect(deriveDescription(body)).toBe('Prose after the structured blocks.');
  });

  it('handles CRLF line endings when extracting', () => {
    const body = '# T\r\n\r\nA CRLF paragraph here.\r\n\r\nNext.';
    expect(deriveDescription(body)).toBe('A CRLF paragraph here.');
  });

  it('returns null when there is no prose at all', () => {
    const body = '# Only A Heading\n\n```\ncode\n```\n';
    expect(deriveDescription(body)).toBeNull();
  });
});

describe('truncate — length + boundaries', () => {
  it('returns short text unchanged', () => {
    expect(truncate('short sentence.')).toBe('short sentence.');
  });

  it('never exceeds the 155-char limit, even with appended ellipsis', () => {
    const long = 'word '.repeat(60).trim(); // 299 chars, spaces, no sentence stop
    const out = truncate(long);
    expect(out.length).toBeLessThanOrEqual(155);
    expect(out.endsWith('…')).toBe(true);
  });

  it('prefers an English sentence boundary within the window', () => {
    // First sentence is ~95 chars (>80 threshold, <155) so the sentence
    // boundary is preferred over a mid-word cut.
    const first =
      'This first sentence is deliberately long enough to clear the eighty character boundary rule.';
    const text = first
      + ' Second sentence keeps going well past the one hundred and fifty five character ceiling so it must be dropped entirely.';
    const out = truncate(text);
    expect(out).toBe(first);
    expect(out.endsWith('…')).toBe(false);
  });

  it('prefers a CJK sentence boundary (。) and does not append ellipsis', () => {
    // First sentence ~100 CJK chars (>80 threshold, <155 window) ending in 。;
    // second sentence pads total well past 155 to force truncation at the 。.
    const first = '中'.repeat(100) + '。';
    const text = first + '第二句'.repeat(40) + '。';
    expect(text.length).toBeGreaterThan(155); // precondition: truncation happens
    const out = truncate(text);
    expect(out.endsWith('。')).toBe(true);
    expect(out).not.toContain('第二句');
    expect(out.length).toBeLessThanOrEqual(155);
  });
});

describe('stripMarkdown', () => {
  it('collapses links, code, bold, italic to plain text', () => {
    expect(stripMarkdown('See [the docs](/x) for `code` and **bold** and *italic*.'))
      .toBe('See the docs for code and bold and italic.');
  });
});

describe('escapeYaml ↔ extraction round trip', () => {
  it('escapes embedded quotes and backslashes', () => {
    expect(escapeYaml('He said "hi"')).toBe('"He said \\"hi\\""');
    expect(escapeYaml('a\\b')).toBe('"a\\\\b"');
  });

  it('produced frontmatter is parseable and yields the original string', () => {
    const original = 'A description with a "quoted" word and a back\\slash.';
    const fm = ['---', 'title: "T"', `description: ${escapeYaml(original)}`, '---'];
    expect(frontmatterDescription(fm)).toBe(original);
  });

  it('injector AND search-index builder read the same escaped value (consistency)', () => {
    // The exact regression Codex flagged: both parsers must agree, or a
    // quoted description passes the guard but corrupts the search index.
    const original = 'Has a "quote", a back\\slash, and a colon: yes.';
    const file = ['---', 'title: "T"', `description: ${escapeYaml(original)}`, '---', '', '# H', '', 'Body.'].join('\n');
    // injector/guard view:
    const { fm } = splitFrontmatter(file);
    expect(frontmatterDescription(fm)).toBe(original);
    // search-index builder view:
    expect(parseFrontmatter(file).description).toBe(original);
  });

  it('both parsers agree on a YAML block scalar description', () => {
    // A multi-line block scalar is valid YAML; the old regex parser in
    // build-docs-index would have mis-read it. Both must now agree.
    const file = [
      '---',
      'title: "T"',
      'description: >-',
      '  A folded block scalar description that spans',
      '  two physical lines but is one logical string.',
      '---',
      '',
      '# H',
      '',
      'Body.',
    ].join('\n');
    const expected =
      'A folded block scalar description that spans two physical lines but is one logical string.';
    const { fm } = splitFrontmatter(file);
    expect(frontmatterDescription(fm)).toBe(expected);
    expect(parseFrontmatter(file).description).toBe(expected);
  });
});

describe('frontmatterDescription — non-empty semantics', () => {
  const fm = (descLine: string) => ['---', 'title: "T"', descLine, '---'];

  it('returns the value for a real description', () => {
    expect(frontmatterDescription(fm('description: "A real one."'))).toBe('A real one.');
  });

  it('treats empty / whitespace descriptions as blank (so the guard rejects them)', () => {
    expect((frontmatterDescription(fm('description: ""')) ?? '').trim()).toBe('');
    expect((frontmatterDescription(fm('description: "   "')) ?? '').trim()).toBe('');
    expect((frontmatterDescription(['---', 'title: "T"', 'description:', '---']) ?? '').trim()).toBe('');
  });
});

describe('splitFrontmatter', () => {
  it('separates frontmatter lines from the body', () => {
    const raw = '---\ntitle: "T"\n---\n\n# Heading\n\nBody.';
    const { fm, body } = splitFrontmatter(raw);
    expect(fm?.[0]).toBe('---');
    expect(body).toContain('# Heading');
  });

  it('returns null fm when there is no frontmatter', () => {
    expect(splitFrontmatter('# No frontmatter\n').fm).toBeNull();
  });
});

describe('isSkippable', () => {
  it('flags non-prose constructs', () => {
    for (const line of ['', '# h', '<Callout>', 'import x', '| a |', '```', '::: note', '> quote', '- item', '1. item']) {
      expect(isSkippable(line)).toBe(true);
    }
  });
  it('does not flag ordinary prose', () => {
    expect(isSkippable('This is a normal sentence.')).toBe(false);
  });
});
